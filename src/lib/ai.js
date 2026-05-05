// lib/ai.js — Wrapper unifié AI : NVIDIA (gratuit) → Gemini (fallback)
const gemini = require('./gemini');
const nvidia = require('./nvidia');

async function generate(prompt, options = {}) {
  const useNvidia = !!process.env.NVIDIA_API_KEY && process.env.AI_PROVIDER !== 'gemini';
  const useGemini = !!process.env.GEMINI_API_KEY;

  if (useNvidia) {
    try { return await nvidia.generate(prompt, options); }
    catch (e) {
      console.warn(`[ai] NVIDIA failed (${e.message}), fallback Gemini`);
      if (!useGemini) throw e;
    }
  }
  if (useGemini) return await gemini.generate(prompt, options);
  throw new Error('No AI provider configured (set NVIDIA_API_KEY or GEMINI_API_KEY)');
}

module.exports = { generate };
