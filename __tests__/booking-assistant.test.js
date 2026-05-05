// Tests unitaires booking-assistant.js
// On mock imapflow, mailparser, nodemailer et axios via require.cache
// AVANT de charger le module sous test.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

// ─── Helpers de mock ──────────────────────────────────────────────

function injectMock(name, exportsObj) {
  // Résout le module comme le ferait booking-assistant.js
  const resolved = require.resolve(name, {
    paths: [path.join(__dirname, '..', 'src')],
  });
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: exportsObj,
  };
}

// État partagé pour observation des appels
let state;

function resetState() {
  state = {
    sentMail: [],         // payloads passés à transport.sendMail
    geminiCalls: [],      // { url, body }
    geminiResponses: [],  // file (FIFO) — { status, data } ou { throw: err, response: {status} }
    fetchedUids: [],      // uids parsés
    parsedEmails: [],     // emails retournés par simpleParser pour chaque UID
    flagsAdded: [],
    supabaseCalls: [],
    telegramCalls: [],
  };
}

// ─── Mocks ──────────────────────────────────────────────────────────

const imapflowMock = {
  ImapFlow: class {
    constructor(_cfg) {}
    async connect() {}
    async logout() {}
    async mailboxOpen(_name) {}
    async search(_q, _opts) { return state.fetchedUids; }
    async download(uid, _x, _opts) {
      // Stream factice : un objet content "iterable async" qui ne yield rien.
      // simpleParser sera mocké pour retourner directement.
      return {
        content: (async function*() { yield Buffer.from(`uid:${uid}`); })(),
      };
    }
    async messageFlagsAdd(uid, flags, _opts) {
      state.flagsAdded.push({ uid, flags });
    }
  },
};

const mailparserMock = {
  simpleParser: async (buf) => {
    // On extrait l'UID du buffer pour piocher l'email correspondant.
    const m = String(buf).match(/uid:(\d+)/);
    const uid = m ? Number(m[1]) : null;
    const found = state.parsedEmails.find(e => e.__uid === uid);
    if (!found) throw new Error(`no parsed email for uid ${uid}`);
    return found;
  },
};

const nodemailerMock = {
  createTransport: (_cfg) => ({
    sendMail: async (payload) => {
      state.sentMail.push(payload);
      return { messageId: 'mock-' + Date.now() };
    },
  }),
};

const axiosMock = {
  post: async (url, body, _opts) => {
    if (url.includes('generativelanguage.googleapis.com')) {
      state.geminiCalls.push({ url, body });
      const next = state.geminiResponses.shift();
      if (!next) throw new Error('no gemini response queued');
      if (next.throw) {
        const err = new Error(next.throw);
        err.response = next.response || { status: 500 };
        throw err;
      }
      return { data: next.data, status: next.status || 200 };
    }
    if (url.includes('supabase.co')) {
      state.supabaseCalls.push({ url, body });
      return { data: {}, status: 201 };
    }
    if (url.includes('api.telegram.org')) {
      state.telegramCalls.push({ url, body });
      return { data: { ok: true }, status: 200 };
    }
    throw new Error('unexpected POST ' + url);
  },
};

// ─── Setup ENV + mocks AVANT require booking-assistant ────────────

process.env.GMAIL_APP_PASSWORD = 'fake-pass';
process.env.GEMINI_API_KEY = 'fake-key';
process.env.SMTP_EMAIL = 'zenithmoto.ch@gmail.com';
delete process.env.SUPABASE_SERVICE_KEY; // désactive supabase pour les tests
delete process.env.TELEGRAM_BOT_TOKEN;   // désactive telegram

injectMock('imapflow', imapflowMock);
injectMock('mailparser', mailparserMock);
injectMock('nodemailer', nodemailerMock);
injectMock('axios', axiosMock);

const { runBookingAssistant } = require('../src/booking-assistant');

// ─── Tests ────────────────────────────────────────────────────────

test('skip emails from noreply addresses', async () => {
  resetState();
  state.fetchedUids = [101];
  state.parsedEmails = [{
    __uid: 101,
    from: { value: [{ address: 'noreply@booking.com', name: 'Booking' }] },
    subject: 'Confirmation',
    text: 'Auto message',
    headers: new Map(),
  }];

  const r = await runBookingAssistant();

  assert.equal(r.processed, 1, 'processed=1');
  assert.equal(r.replied, 0, 'replied=0');
  assert.equal(r.skipped, 1, 'skipped=1');
  assert.equal(state.sentMail.length, 0, 'aucun email envoyé');
  assert.equal(state.geminiCalls.length, 0, 'Gemini non appelé');
  assert.deepEqual(state.flagsAdded[0]?.flags, ['\\Seen'], 'marqué seen');
});

test('replies to a valid client email via generateReply + sendReply', async () => {
  resetState();
  state.fetchedUids = [202];
  state.parsedEmails = [{
    __uid: 202,
    from: { value: [{ address: 'jean@gmail.com', name: 'Jean Dupont' }] },
    subject: 'Question location TMAX',
    text: 'Bonjour, est-ce que le TMAX est dispo ce weekend ?',
    headers: new Map(),
  }];
  state.geminiResponses = [
    { data: { candidates: [{ content: { parts: [{ text: 'Bonjour Jean, oui le TMAX est dispo !' }] } }] } },
  ];

  const r = await runBookingAssistant();

  assert.equal(r.processed, 1);
  assert.equal(r.replied, 1, 'replied=1');
  assert.equal(r.skipped, 0);
  assert.equal(state.geminiCalls.length, 1, 'Gemini appelé 1×');
  assert.equal(state.sentMail.length, 1, 'sendMail appelé 1×');
  assert.equal(state.sentMail[0].to, 'jean@gmail.com');
  assert.match(state.sentMail[0].subject, /^Re: /);
  assert.match(state.sentMail[0].text, /TMAX est dispo/);
});

test('Gemini 429 on first model → fallback to next model', async () => {
  resetState();
  state.fetchedUids = [303];
  state.parsedEmails = [{
    __uid: 303,
    from: { value: [{ address: 'klient@example.ch', name: 'Klient' }] },
    subject: 'Reservation',
    text: 'Salut',
    headers: new Map(),
  }];

  // Le code retry 3× le même modèle sur 429 avant de passer au suivant.
  // Donc on file 3× 429 puis un 200 sur le 2e modèle.
  state.geminiResponses = [
    { throw: 'rate limited', response: { status: 429 } },
    { throw: 'rate limited', response: { status: 429 } },
    { throw: 'rate limited', response: { status: 429 } },
    { data: { candidates: [{ content: { parts: [{ text: 'Réponse fallback OK' }] } }] } },
  ];

  const r = await runBookingAssistant();

  assert.equal(r.replied, 1, 'fallback model used → reply sent');
  assert.equal(state.geminiCalls.length, 4, '3 retries + 1 succès = 4 calls');
  // Vérifie que le 4e call a un modèle différent du 1er
  const firstUrl = state.geminiCalls[0].url;
  const lastUrl  = state.geminiCalls[3].url;
  assert.notEqual(firstUrl, lastUrl, 'modèle différent utilisé en fallback');
  assert.equal(state.sentMail[0].text.includes('Réponse fallback OK'), true);
});
