// Buffer GraphQL client (api.buffer.com/graphql)
// REST v1 (bufferapp.com/1/*) rejette les tokens OIDC depuis 2024-2025.
// GraphQL accepte le Bearer OIDC token actuel.

const URL = process.env.BUFFER_API_URL || 'https://api.buffer.com/graphql';
const TOKEN = process.env.BUFFER_ACCESS_TOKEN;
const CHANNEL_IG = process.env.BUFFER_CHANNEL_INSTAGRAM || process.env.BUFFER_IG_ID;
const CHANNEL_FB = process.env.BUFFER_CHANNEL_FACEBOOK  || process.env.BUFFER_FB_ID;
const CHANNEL_TT = process.env.BUFFER_CHANNEL_TIKTOK    || process.env.BUFFER_TT_ID;

async function gql(query, variables = {}) {
  if (!TOKEN) throw new Error('BUFFER_ACCESS_TOKEN missing');
  const r = await fetch(URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`Buffer GraphQL HTTP ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  }
  if (j.errors) {
    throw new Error(`Buffer GraphQL errors: ${JSON.stringify(j.errors).slice(0, 500)}`);
  }
  return j.data;
}

async function listChannels() {
  const q = `{ account { currentOrganization { channels { id name service } } } }`;
  const d = await gql(q);
  return d?.account?.currentOrganization?.channels || [];
}

async function ping() {
  // Lightweight health-check (replaces REST /1/user.json)
  const q = `{ account { id email } }`;
  const d = await gql(q);
  return d?.account || null;
}

async function createPost({ channelId, text, mediaUrl, scheduledAt }) {
  const variables = {
    input: {
      channelId,
      text,
      schedulingType: scheduledAt ? 'SCHEDULED' : 'IMMEDIATE',
      dueAt: scheduledAt || null,
      assets: mediaUrl ? [{ type: 'IMAGE', url: mediaUrl }] : [],
      mode: 'POST',
      source: 'API',
    },
  };
  const q = `mutation Create($input: CreatePostInput!) { createPost(input: $input) { __typename } }`;
  return gql(q, variables);
}

async function publishToAll(text, mediaUrl) {
  const channels = [CHANNEL_FB, CHANNEL_IG, CHANNEL_TT].filter(Boolean);
  const results = [];
  for (const c of channels) {
    try {
      const r = await createPost({ channelId: c, text, mediaUrl });
      results.push({ channelId: c, ok: true, res: r });
    } catch (e) {
      results.push({ channelId: c, ok: false, error: e.message });
    }
  }
  return results;
}

module.exports = { listChannels, ping, createPost, publishToAll, gql };
