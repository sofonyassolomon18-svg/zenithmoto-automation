// lib/gemini.js — Gemini wrapper avec fallback automatique sur 4 modèles + retry
// Partagé WebMake / ZenithMoto. Dépendance : axios.
const axios = require('axios');

const DEFAULT_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemma-3-12b-it',
  'gemini-2.5-flash',
];
const RETRIES = 3;
const BACKOFF_MS = 1500;

async function generate(prompt, options = {}) {
  const key = options.apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY missing');

  const models = options.models || DEFAULT_MODELS;
  const timeout = options.timeout || 30000;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    ...(options.generationConfig ? { generationConfig: options.generationConfig } : {}),
  };

  let lastErr;
  for (const model of models) {
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      try {
        const r = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          body,
          { timeout }
        );
        const text = r.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) return text;
        throw new Error('Gemini empty response');
      } catch (e) {
        lastErr = e;
        const code = e.response?.status;
        if (code === 429 || (code >= 500 && code < 600)) {
          await new Promise(res => setTimeout(res, BACKOFF_MS * (attempt + 1)));
          continue;
        }
        break; // non-retriable for this model → next
      }
    }
  }
  throw lastErr || new Error('Gemini all models failed');
}

module.exports = { generate, DEFAULT_MODELS };
