// ============================================================
// panel/js/core/ai-worker.js
// ExameNova — DoveLingua AI Infrastructure Bridge
// All AI calls go through here — shared across DoveLingua projects
// Never import this in worker.js — screens import it directly
// ============================================================

const WORKER_AI_URL      = 'https://api-text-inteligence.dovelingua.com';
const WORKER_WHISPER_URL = 'https://whisper.dovelingua.com/';

async function callAI(messages, options = {}) {
  const {
    hasImage      = false,
    deepReasoning = false,
    maxTokens     = 1000,
    temperature   = 0.65
  } = options;

  const res = await fetch(WORKER_AI_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      messages,
      max_tokens:             maxTokens,
      temperature,
      _hasImage:              hasImage,
      _requiresDeepReasoning: deepReasoning
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'unknown' }));
    throw new Error(err.error || `AI worker error ${res.status}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Empty AI response');
  return text;
}

async function transcribeAudio(audioBlob) {
  const formData = new FormData();
  formData.append('file',            audioBlob, 'recording.webm');
  formData.append('model',           'whisper-large-v3');
  formData.append('response_format', 'json');

  const res = await fetch(WORKER_WHISPER_URL, {
    method: 'POST',
    body:   formData,
  });

  if (!res.ok) throw new Error(`Whisper error ${res.status}`);

  const data = await res.json();
  if (!data.text) throw new Error('Empty transcription');
  return data.text.trim();
}

export const aiWorker = {
  callAI,
  transcribeAudio,
};
