// lib/nvidia.js — NVIDIA NIM (gratuit, 80+ modèles)
// build.nvidia.com → 1000 req/jour/modèle. Compatible OpenAI SDK.
const axios = require('axios');

const ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';
const DEFAULT_MODELS = [
  'meta/llama-3.3-70b-instruct',
  'mistralai/mistral-large-2-instruct',
  'deepseek-ai/deepseek-r1',
  'google/gemma-2-27b-it',
];
const RETRIES = 3;
const BACKOFF_MS = 1500;

async function generate(prompt, options = {}) {
  const key = options.apiKey || process.env.NVIDIA_API_KEY;
  if (!key) throw new Error('NVIDIA_API_KEY missing');

  const models = options.models || DEFAULT_MODELS;
  const timeout = options.timeout || 30000;
  const temperature = options.generationConfig?.temperature ?? 0.7;
  const maxTokens = options.generationConfig?.maxOutputTokens ?? 2048;

  let lastErr;
  for (const model of models) {
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      try {
        const r = await axios.post(ENDPOINT, {
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature,
          max_tokens: maxTokens,
        }, {
          timeout,
          headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        });
        const text = r.data?.choices?.[0]?.message?.content?.trim();
        if (text) return text;
        throw new Error('NVIDIA empty response');
      } catch (e) {
        lastErr = e;
        const code = e.response?.status;
        if (code === 429 || (code >= 500 && code < 600)) {
          await new Promise(res => setTimeout(res, BACKOFF_MS * (attempt + 1)));
          continue;
        }
        break;
      }
    }
  }
  throw lastErr || new Error('NVIDIA all models failed');
}

module.exports = { generate, DEFAULT_MODELS };
