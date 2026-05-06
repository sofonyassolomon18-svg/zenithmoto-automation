// lib/intent.js — Extraction d'intent + dates + moto à partir d'un email client
// Heuristique pure (regex) en 1ère passe, pas de LLM nécessaire pour la majorité des cas.
// On garde l'IA disponible pour les emails ambigus (via extractIntentWithAi).

const FLEET = [
  { key: 'tracer_700',  patterns: [/\btracer\s*-?\s*700\b/i, /\btracer\b/i],            name: 'Tracer 700',     daily: 120, weekend: 216 },
  { key: 'tmax_530',    patterns: [/\bt[\s\-]*max\s*-?\s*530\b/i, /\btmax\b/i, /\bt-max\b/i], name: 'TMAX 530',      daily: 100, weekend: 180 },
  { key: 'xadv_750',    patterns: [/\bx[\s\-]*adv\s*-?\s*750\b/i, /\bxadv\b/i, /\bx-adv\b/i],  name: 'X-ADV 750',     daily: 120, weekend: 216 },
  { key: 'xmax_300',    patterns: [/\bx[\s\-]*max\s*-?\s*300\b/i, /\bxmax\s*300\b/i],          name: 'X-Max 300',     daily: 80,  weekend: 144 },
  { key: 'xmax_125',    patterns: [/\bx[\s\-]*max\s*-?\s*125\b/i, /\bxmax\s*125\b/i],          name: 'X-Max 125',     daily: 65,  weekend: 117 },
];

// Détection rapide de la moto mentionnée dans un texte libre.
// Retourne le 1er match ou null.
function detectMoto(text) {
  if (!text) return null;
  for (const m of FLEET) {
    if (m.patterns.some(re => re.test(text))) {
      return { key: m.key, name: m.name, daily: m.daily, weekend: m.weekend };
    }
  }
  return null;
}

// Patterns d'intent (FR + DE + EN basique)
const INTENT_RULES = [
  { intent: 'cancellation', score: 5, patterns: [
    /\bannul(er|ation|é|ée)\b/i, /\bsupprim(er|é)\b/i, /\bne (plus|peux pas) (venir|louer)/i,
    /\bstornier(en|t)\b/i, /\babsag(en|e)\b/i,
    /\bcancel(l(ation|ed))?\b/i, /\bcan(no)?t come\b/i,
  ]},
  { intent: 'reschedule', score: 4, patterns: [
    /\bd[ée]plac(er|é) (la |ma )?r[ée]servation\b/i, /\bchanger (la |de )?date\b/i,
    /\bverschieb(en|t)\b/i, /\b(ein )?neuer termin\b/i,
    /\breschedule\b/i, /\bchange date\b/i,
  ]},
  { intent: 'booking_request', score: 3, patterns: [
    /\bje (souhaiterais|voudrais|aimerais) (louer|r[ée]server)\b/i, /\br[ée]server\b/i,
    /\bdisponi(ble|bilit[ée]s?)\b/i, /\blibre le\b/i,
    /\bich (m[öo]chte|w[üu]rde) (mieten|reservieren)\b/i, /\bverf[üu]gbar(keit)?\b/i,
    /\bi (would like|want) to (book|rent|reserve)\b/i, /\bavailability\b/i,
  ]},
  { intent: 'pricing_question', score: 2, patterns: [
    /\bprix\b/i, /\btarif/i, /\bco[uû]te?\b/i, /\bcombien\b/i,
    /\bpreis(e)?\b/i, /\bkostet?\b/i, /\bwie viel\b/i,
    /\bprice\b/i, /\bhow much\b/i, /\bcost\b/i,
  ]},
  { intent: 'general_info', score: 1, patterns: [
    /\binformation/i, /\bquestion/i, /\bhoraires?\b/i, /\bouvert/i,
    /\bauskunft\b/i, /\b[öo]ffnungszeit/i,
    /\binfo\b/i, /\bopening hours\b/i,
  ]},
];

function detectIntent(text) {
  if (!text) return { intent: 'unknown', confidence: 0 };
  const scores = new Map();
  for (const rule of INTENT_RULES) {
    if (rule.patterns.some(re => re.test(text))) {
      scores.set(rule.intent, (scores.get(rule.intent) || 0) + rule.score);
    }
  }
  if (scores.size === 0) return { intent: 'unknown', confidence: 0 };
  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const [intent, score] = sorted[0];
  // Confidence = score / 6 (capped at 1)
  return { intent, confidence: Math.min(1, score / 6) };
}

// Extraction des dates : DD/MM, DD.MM, DD-MM, "12 mai", "12. Mai"
const MONTHS_FR = { janvier:1, fevrier:2, février:2, mars:3, avril:4, mai:5, juin:6, juillet:7, aout:8, août:8, septembre:9, octobre:10, novembre:11, decembre:12, décembre:12 };
const MONTHS_DE = { januar:1, februar:2, marz:3, märz:3, april:4, mai:5, juni:6, juli:7, august:8, september:9, oktober:10, november:11, dezember:12 };
const ALL_MONTHS = { ...MONTHS_FR, ...MONTHS_DE };

function _normalize(s) { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

function detectDates(text) {
  if (!text) return [];
  const dates = [];
  const now = new Date();
  const currentYear = now.getFullYear();

  // Format DD/MM/YYYY ou DD/MM
  const re1 = /\b(\d{1,2})[\/\.\-](\d{1,2})(?:[\/\.\-](\d{2,4}))?\b/g;
  let m;
  while ((m = re1.exec(text)) !== null) {
    const day = parseInt(m[1]);
    const month = parseInt(m[2]);
    let year = m[3] ? parseInt(m[3]) : currentYear;
    if (year < 100) year += 2000;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const d = new Date(Date.UTC(year, month - 1, day));
      // Si la date est passée et pas d'année explicite → on suppose l'année prochaine
      if (!m[3] && d < now) d.setUTCFullYear(year + 1);
      dates.push(d.toISOString().slice(0, 10));
    }
  }

  // Format "12 mai 2026" / "12 mai" / "12. Mai"
  const re2 = /\b(\d{1,2})\.?\s+([a-zûéèêà]+)(?:\s+(\d{4}))?\b/gi;
  while ((m = re2.exec(text)) !== null) {
    const day = parseInt(m[1]);
    const monthName = _normalize(m[2]);
    const month = ALL_MONTHS[monthName];
    if (!month || day < 1 || day > 31) continue;
    let year = m[3] ? parseInt(m[3]) : currentYear;
    const d = new Date(Date.UTC(year, month - 1, day));
    if (!m[3] && d < now) d.setUTCFullYear(year + 1);
    dates.push(d.toISOString().slice(0, 10));
  }

  // Dedup, sort, max 4
  return [...new Set(dates)].sort().slice(0, 4);
}

// API publique : analyse un email entrant
function analyzeEmail({ subject = '', bodyText = '' } = {}) {
  const text = `${subject}\n${bodyText}`;
  const intent = detectIntent(text);
  const moto = detectMoto(text);
  const dates = detectDates(text);
  // Si on a trouvé booking + 2 dates + moto → on peut générer un pré-devis
  const canQuote = intent.intent === 'booking_request' && dates.length >= 2 && !!moto;
  return { ...intent, moto, dates, canQuote };
}

// Calcule un devis selon les jours / weekend
function estimateQuote(moto, startIso, endIso) {
  if (!moto || !startIso || !endIso) return null;
  const start = new Date(startIso + 'T00:00:00Z');
  const end = new Date(endIso + 'T00:00:00Z');
  if (isNaN(start) || isNaN(end) || end < start) return null;
  const days = Math.round((end - start) / 86400000) + 1;

  // 2 jours consécutifs samedi-dimanche → tarif weekend
  const isWeekend = days === 2
    && start.getUTCDay() === 6 && end.getUTCDay() === 0;
  if (isWeekend) return { days, total: moto.weekend, breakdown: `forfait weekend CHF ${moto.weekend}` };
  return { days, total: days * moto.daily, breakdown: `${days}j × CHF ${moto.daily} = CHF ${days * moto.daily}` };
}

module.exports = { analyzeEmail, detectIntent, detectMoto, detectDates, estimateQuote, FLEET };
