// ============================================================
// panel/js/core/worker.js
// ExameNova — Cloudflare Worker Bridge
// The ONLY file in the panel that communicates with Workers.
// Screens never call Worker URLs directly — always use this.
// AI calls go to DoveLingua infrastructure (see Section 3 below).
// ============================================================

// ─────────────────────────────────────────────
// WORKER URLS — never change these in screens
// ─────────────────────────────────────────────
const WORKER_CORE_URL  = 'https://examenova-platforma.examenova78.workers.dev';
const WORKER_EMAIL_URL = 'https://emailing.examenova78.workers.dev';
const WORKER_AI_URL    = 'https://api-text-inteligence.dovelingua.com';

// ─────────────────────────────────────────────
// SHARED SECRET — sent with every core + email request
// Never exposed to screens — lives only here
// ─────────────────────────────────────────────
const WORKER_SECRET = 'GkeBqfV47tomDn7KIrbhOCBLAWoBbjw8SbEG6Q0jpIiKIl63H915yeeeSeM6au';

// ─────────────────────────────────────────────
// INTERNAL: POST to a Worker with secret header
// ─────────────────────────────────────────────
async function postToWorker(url, body) {
  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type':    'application/json',
      'X-Worker-Secret': WORKER_SECRET
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'unknown' }));
    const msg = err.detail ? `${err.error || 'error'}: ${err.detail}` : (err.error || `Worker error ${res.status}`);
    throw new Error(msg);
  }

  return res.json();
}

// ─────────────────────────────────────────────
// SECTION 1 — MOEDAS
// ─────────────────────────────────────────────

/**
 * Deduct Moedas from a student's balance.
 * Always deduct AFTER a successful operation — never before.
 * @param {string} userId
 * @param {number} amount
 * @returns {Promise<{ success: boolean, newBalance: number, reason?: string }>}
 */
async function deductMoedas(userId, amount) {
  return postToWorker(WORKER_CORE_URL, {
    action: 'deductMoedas',
    userId,
    amount
  });
}

/**
 * Award Moedas to a student's balance.
 * @param {string} userId
 * @param {number} amount
 * @param {string} reason — e.g. 'registration', 'daily_challenge', 'invite'
 * @returns {Promise<{ success: boolean, newBalance: number }>}
 */
async function awardMoedas(userId, amount, reason) {
  return postToWorker(WORKER_CORE_URL, {
    action: 'awardMoedas',
    userId,
    amount,
    reason
  });
}

// ─────────────────────────────────────────────
// SECTION 2 — INVITE + CLAIMS
// ─────────────────────────────────────────────

/**
 * Validate an invite code entered at registration.
 * @param {string} code
 * @returns {Promise<{ valid: boolean, inviterId?: string }>}
 */
async function validateInvite(code) {
  return postToWorker(WORKER_CORE_URL, {
    action: 'validateInvite',
    code
  });
}

/**
 * Set custom claims (groupId + role) on a Firebase user.
 * Called after onboarding is complete.
 * Required for Firestore chat rules in examenova-2 to work.
 * @param {string} userId
 * @param {string} groupId
 * @param {string} role
 * @returns {Promise<{ success: boolean }>}
 */
async function setCustomClaims(userId, groupId, role) {
  return postToWorker(WORKER_CORE_URL, {
    action: 'setCustomClaims',
    userId,
    groupId,
    role
  });
}

// ─────────────────────────────────────────────
// SECTION 3 — AI (DoveLingua Infrastructure)
// Uses api-text-inteligence.dovelingua.com
// No X-Worker-Secret — uses DoveLingua's own auth pattern
// messages array must include system prompt from the screen
// Routing flags: _hasImage, _requiresDeepReasoning
// ─────────────────────────────────────────────

/**
 * Call the AI worker with a messages array.
 * The screen is responsible for building the correct system prompt.
 * @param {Array}   messages               — full conversation history including system
 * @param {Object}  options
 * @param {boolean} options.hasImage        — triggers vision model (Qwen)
 * @param {boolean} options.deepReasoning   — triggers reasoning model (120B)
 * @param {number}  options.maxTokens       — default 1000
 * @param {number}  options.temperature     — default 0.65
 * @returns {Promise<string>} — AI response text
 */
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
      max_tokens:              maxTokens,
      temperature,
      _hasImage:               hasImage,
      _requiresDeepReasoning:  deepReasoning
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'unknown' }));
    throw new Error(err.error || `AI worker error ${res.status}`);
  }

  const data = await res.json();

  // Extract text from OpenAI-compatible response
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Empty AI response');

  return text;
}

// ─────────────────────────────────────────────
// SECTION 3B — AUDIO TRANSCRIPTION (Whisper)
// Calls DoveLingua's Whisper worker directly.
// No X-Worker-Secret — DoveLingua uses origin-based auth.
// Sends audio/webm or audio/mp4 as multipart/form-data.
// ─────────────────────────────────────────────

/**
 * Transcribe a student's audio recording to text via Whisper.
 * @param {Blob} audioBlob — audio/webm (Android) or audio/mp4 (iOS)
 * @returns {Promise<string>} — transcribed text
 */
async function transcribeAudio(audioBlob) {
  const formData = new FormData();
  formData.append('file',            audioBlob, 'recording.webm');
  formData.append('model',           'whisper-large-v3');
  formData.append('response_format', 'json');

  const res = await fetch('https://whisper.dovelingua.com/', {
    method: 'POST',
    body:   formData,
  });

  if (!res.ok) throw new Error(`Whisper error ${res.status}`);

  const data = await res.json();
  if (!data.text) throw new Error('Empty transcription');
  return data.text.trim();
}

// ─────────────────────────────────────────────
// SECTION 4 — EMAIL
// ─────────────────────────────────────────────

/**
 * Send a transactional email via the email Worker.
 * email.js calls this — screens never call it directly.
 * @param {string} to      — recipient email address
 * @param {string} subject — email subject line
 * @param {string} html    — full HTML email body
 * @returns {Promise<{ success: boolean, id: string }>}
 */
async function sendEmail(to, subject, html) {
  return postToWorker(WORKER_EMAIL_URL, { to, subject, html });
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────
export const worker = {
  deductMoedas,
  awardMoedas,
  validateInvite,
  setCustomClaims,
  callAI,
  transcribeAudio,
  sendEmail
}; 
