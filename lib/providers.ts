import type { ProviderConfig, ProviderId } from '@/types/subtitle'

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  gemini: {
    label: 'Gemini',
    placeholder: 'AIza...',
    hint: 'aistudio.google.com — No credit card needed',
    batchSize: 30,
    pauseMs: 10000,
    models: [
      { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash-Lite  ·  15 RPM / 1K/day' },
      { id: 'gemini-2.5-flash',      name: 'Gemini 2.5 Flash       ·  10 RPM / 250/day' },
    ],
  },
  groq: {
    label: 'Groq',
    placeholder: 'gsk_...',
    hint: 'console.groq.com — No credit card needed',
    batchSize: 30,
    pauseMs: 5000,
    models: [
      { id: 'llama-3.1-8b-instant',              name: 'Llama 3.1 8B     ·  30 RPM / 14.4K/day' },
      { id: 'llama-3.3-70b-versatile',           name: 'Llama 3.3 70B    ·  30 RPM / 1K/day' },
      { id: 'llama-4-scout-17b-16e-instruct',    name: 'Llama 4 Scout    ·  30 RPM' },
      { id: 'qwen-qwq-32b',                      name: 'QwQ 32B          ·  30 RPM' },
      { id: 'deepseek-r1-distill-llama-70b',     name: 'DeepSeek R1      ·  30 RPM' },
      { id: 'gemma2-9b-it',                      name: 'Gemma 2 9B       ·  30 RPM' },
    ],
  },
  openrouter: {
    label: 'OpenRouter',
    placeholder: 'sk-or-...',
    hint: 'openrouter.ai — Free models available',
    batchSize: 30,
    pauseMs: 5000,
    models: [
      { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B (free)' },
      { id: 'meta-llama/llama-4-maverick:free',        name: 'Llama 4 Maverick (free)' },
      { id: 'google/gemma-3-27b-it:free',              name: 'Gemma 3 27B (free)' },
      { id: 'mistralai/mistral-7b-instruct:free',      name: 'Mistral 7B (free)' },
      { id: 'deepseek/deepseek-r1:free',               name: 'DeepSeek R1 (free)' },
      { id: 'qwen/qwq-32b:free',                       name: 'QwQ 32B (free)' },
      { id: 'microsoft/phi-4:free',                    name: 'Phi-4 (free)' },
    ],
  },
  mistral: {
    label: 'Mistral',
    placeholder: '...',
    hint: 'console.mistral.ai — Free tier: 1 RPM',
    batchSize: 10,
    pauseMs: 65000,
    models: [
      { id: 'mistral-small-latest', name: 'Mistral Small  ·  1 RPM free' },
      { id: 'open-mistral-7b',      name: 'Mistral 7B     ·  1 RPM free' },
    ],
  },
}

export const LANG_CODES: Record<string, string> = {
  English: 'EN', Spanish: 'ES', French: 'FR', German: 'DE', Italian: 'IT',
  Portuguese: 'PT', Dutch: 'NL', Polish: 'PL', Russian: 'RU', Turkish: 'TR',
  Arabic: 'AR', Japanese: 'JA', Korean: 'KO', 'Chinese (Simplified)': 'ZH', Catalan: 'CA',
}

export const SOURCE_LANGUAGES = [
  'Auto-detect', 'English', 'Spanish', 'French', 'German', 'Italian',
  'Portuguese', 'Dutch', 'Polish', 'Russian', 'Turkish', 'Arabic',
  'Japanese', 'Korean', 'Chinese (Simplified)', 'Catalan',
]

export const TARGET_LANGUAGES = SOURCE_LANGUAGES.filter(l => l !== 'Auto-detect')

export const QUICK_LANGS = ['English', 'Spanish', 'French', 'German', 'Italian', 'Catalan', 'Japanese', 'Korean']
