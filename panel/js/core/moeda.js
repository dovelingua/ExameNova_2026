// ============================================================
// panel/js/core/moeda.js
// ExameNova — Moedas Economy Layer
// The ONLY file that manages Moedas logic in the panel.
// All balance changes go via worker.js — never direct Firestore.
// Screens import from here — never hardcode Moedas values.
//
// ADDING NEW COSTS:
// When a screen AI negotiates a new cost or award with
// Teacher Dove, it registers the constant and function here
// then imports from moeda.js in that screen.
// ============================================================

import { worker } from './worker.js';
import { ui }     from './ui.js';

// ─────────────────────────────────────────────
// MOEDAS COSTS
// ─────────────────────────────────────────────
export const COSTS = {
  SIMULACAO_ANTERIORES:  6,   // Past exam simulation
  SIMULACAO_GERADAS:     3,   // AI-generated simulation
  MEU_EXAME:             20,  // Premium exam mode unlock
  MENTOR_SESSION:        5,   // AI Mentor session (standalone mentor.js)
  CUSTOM_AI_PROMPT:      3,   // +3 when student gives custom AI instructions
  REVISAO_MENTOR:        2,   // Mentor chat inside Revisão (per question session)
  REVISAO_WRONG_PENALTY: 1,   // Wrong answer after reading explanation

  // [ New costs registered here by each screen AI after
  //   negotiation with Teacher Dove ]
};

// ─────────────────────────────────────────────
// MOEDAS AWARDS
// ─────────────────────────────────────────────
export const AWARDS = {
  REGISTRATION:                30,  // Welcome bonus — award it ONCE per student (auth.js OR onboarding.js, never both)
  DAILY_CHALLENGE:             10,  // Awarded on correct daily challenge completion
  INVITE:                      50,  // Awarded to inviter when friend registers
  INVITED:                     30,  // Awarded to the newly invited student
  REVISAO_CORRECT_NO_MENTOR:    2,  // Correct answer in Revisão without calling Mentor
  REVISAO_CORRECT_WITH_MENTOR:  1,  // Correct answer in Revisão after calling Mentor
  DESAFIO_BASE:                 5,  // Complete daily challenge (any score)
  DESAFIO_BONUS_60:             3,  // Score >= 60% (added on top of BASE)
  DESAFIO_BONUS_100:            5,  // Score = 100% (replaces BONUS_60, not added on top)
  DESAFIO_STREAK_7:             5,  // 7-day streak milestone bonus
  DESAFIO_STREAK_14:            8,  // 14-day streak milestone bonus
  DESAFIO_STREAK_30:            15, // 30-day streak milestone bonus

  // [ New awards registered here by each screen AI after
  //   negotiation with Teacher Dove ]
};

// ─────────────────────────────────────────────
// SECTION 1 — BALANCE READING
// Reads from userData passed by router — no Firestore call.
// ─────────────────────────────────────────────

/**
 * Get current Moedas balance from userData.
 * @param {Object} userData — Firestore user document from router
 * @returns {number}
 */
function getBalance(userData) {
  return typeof userData?.moedas === 'number' ? userData.moedas : 0;
}

/**
 * Check if student has enough Moedas for an action.
 * @param {Object} userData
 * @param {number} amount
 * @returns {boolean}
 */
function checkMoedas(userData, amount) {
  return getBalance(userData) >= amount;
}

// ─────────────────────────────────────────────
// SECTION 2 — BALANCE CHANGES (via Worker)
// Never deduct before a successful operation.
// Always deduct after — call deductMoedas in the
// success callback of whatever feature was unlocked.
// ─────────────────────────────────────────────

/**
 * Deduct Moedas after a successful operation.
 * @param {string} userId
 * @param {number} amount  — use a constant from COSTS above
 * @returns {Promise<{ success: boolean, newBalance: number }>}
 */
async function deductMoedas(userId, amount) {
  try {
    const result = await worker.deductMoedas(userId, amount);
    return result;
  } catch (err) {
    console.error('moeda.deductMoedas failed:', err);
    return { success: false, newBalance: null };
  }
}

/**
 * Award Moedas to a student.
 * @param {string} userId
 * @param {number} amount  — use a constant from AWARDS above
 * @param {string} reason  — e.g. 'registration', 'daily_challenge'
 * @returns {Promise<{ success: boolean, newBalance: number }>}
 */
async function awardMoedas(userId, amount, reason) {
  try {
    const result = await worker.awardMoedas(userId, amount, reason);
    return result;
  } catch (err) {
    console.error('moeda.awardMoedas failed:', err);
    return { success: false, newBalance: null };
  }
}

// ─────────────────────────────────────────────
// SECTION 3 — MOEDAS BOTTOM SHEET
// Shows balance and how to earn more.
// Student never leaves current screen for this.
// ─────────────────────────────────────────────

/**
 * Open the Moedas info bottom sheet.
 * Called when student taps balance indicator or
 * when a feature requires more Moedas than available.
 * @param {number} currentBalance
 * @param {number} [requiredAmount] — if called from a locked feature
 */
function showMoedasSheet(currentBalance, requiredAmount = null) {
  const shortage = requiredAmount !== null
    ? requiredAmount - currentBalance
    : null;

  const shortageBlock = shortage !== null && shortage > 0
    ? `<div style="
        background: var(--moeda-light);
        border: 1px solid var(--moeda);
        border-radius: var(--radius-sm);
        padding: 12px 16px;
        margin-bottom: 20px;
        display: flex;
        align-items: center;
        gap: 10px;
      ">
        <i class="fa-solid fa-coins" style="color: var(--moeda); font-size: 18px;" aria-hidden="true"></i>
        <span style="font-size: 14px; color: var(--text);">
          Precisa de mais <strong>${shortage} Moeda${shortage !== 1 ? 's' : ''}</strong> para aceder a esta funcionalidade.
        </span>
      </div>`
    : '';

  const content = `
    ${shortageBlock}

    <div style="
      background: var(--moeda-light);
      border-radius: var(--radius-md);
      padding: 20px;
      text-align: center;
      margin-bottom: 24px;
    ">
      <i class="fa-solid fa-coins" style="color: var(--moeda); font-size: 32px; margin-bottom: 8px; display: block;" aria-hidden="true"></i>
      <div style="font-size: 36px; font-weight: 700; color: var(--text);">
        ${currentBalance}
      </div>
      <div style="font-size: 14px; color: var(--text-secondary); margin-top: 4px;">
        Moedas disponíveis
      </div>
    </div>

    <p style="font-size: 14px; font-weight: 600; color: var(--text); margin: 0 0 12px 0;">
      Como ganhar Moedas:
    </p>

    <div style="display: flex; flex-direction: column; gap: 10px;">
      ${_earnRow('fa-user-check', 'Completar o registo',                    '+' + AWARDS.REGISTRATION)}
      ${_earnRow('fa-fire',       'Desafio diário (correcto)',               '+' + AWARDS.DAILY_CHALLENGE)}
      ${_earnRow('fa-rotate',     'Revisão correcta sem Mentor',            '+' + AWARDS.REVISAO_CORRECT_NO_MENTOR)}
      ${_earnRow('fa-rotate',     'Revisão correcta com Mentor',            '+' + AWARDS.REVISAO_CORRECT_WITH_MENTOR)}
      ${_earnRow('fa-user-plus',  'Convidar um amigo',                      '+' + AWARDS.INVITE)}
      ${_earnRow('fa-gift',       'Ser convidado por um amigo',             '+' + AWARDS.INVITED)}
    </div>
  `;

  ui.openBottomSheet({
    title:   'As suas Moedas',
    content,
    actions: [
      { label: 'Convidar um amigo e ganhar Moedas', route: '/panel/perfil' },
      { label: 'Fechar', dismiss: true },
    ],
  });
}

// Internal: single earn row for the sheet
function _earnRow(icon, label, amount) {
  return `
    <div style="
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: var(--bg);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm);
      padding: 12px 14px;
    ">
      <div style="display: flex; align-items: center; gap: 10px;">
        <i class="fa-solid ${icon}" style="color: var(--primary); width: 18px; text-align: center;" aria-hidden="true"></i>
        <span style="font-size: 14px; color: var(--text);">${label}</span>
      </div>
      <span style="font-size: 14px; font-weight: 700; color: var(--moeda-dark);">
        ${amount} <i class="fa-solid fa-coins" style="font-size: 12px;" aria-hidden="true"></i>
      </span>
    </div>`;
}

// ─────────────────────────────────────────────
// SECTION 4 — FEATURE GATE
// Screens call this BEFORE unlocking a premium feature.
// It only CHECKS the balance — it never deducts.
// ─────────────────────────────────────────────

/**
 * Gate a premium feature behind a Moedas check.
 * Enough Moedas  → returns true (caller proceeds).
 * Not enough     → opens the Moedas sheet and returns false.
 * Deduction is the caller's job, AFTER the operation succeeds.
 *
 * Pattern in screens:
 *
 *   if (!moeda.gate(userData, COSTS.SIMULACAO_GERADAS)) return; // sheet shown
 *   // ... do the operation ...
 *   await moeda.deductMoedas(user.uid, COSTS.SIMULACAO_GERADAS);
 *
 * @param {Object} userData
 * @param {number} cost
 * @returns {boolean} — true if student can proceed
 */
function gate(userData, cost) {
  const balance = getBalance(userData);
  if (balance >= cost) return true;
  showMoedasSheet(balance, cost);
  return false;
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────
export const moeda = {
  // Constants
  COSTS,
  AWARDS,

  // Balance
  getBalance,
  checkMoedas,

  // Changes
  deductMoedas,
  awardMoedas,

  // UI
  showMoedasSheet,
  gate,

  // [ New functions registered here by each screen AI ]
};
