// ============================================================
// panel/js/screens/desafio/desafio.js
// ExameNova — Desafio Diário Screen v1.0
//
// ARCHITECTURE:
//   Three states inside one screen — no render screen needed:
//     'ready'  — hero card, streak, start button (or done state)
//     'active' — one question at a time, game-like tap-to-answer
//     'result' — score ring, confetti, Moedas earned, share
//
// QUESTION STRATEGY (priority order):
//   1. Wrong answers (retried: false) from wrongAnswers collection
//   2. High-frequency topics from exam DB (smart fallback)
//   3. Pure random DB fallback
//
// QUESTION COUNT:
//   1-3 subjects → 5 questions
//   4-6 subjects → 7 questions
//   7+ subjects  → 10 questions
//
// MOEDAS:
//   Complete (any score):   +5
//   Score >= 60%:           +3 bonus
//   Score = 100%:           +5 bonus (replaces +3, not stacked)
//   Streak 7 days:          +5 milestone bonus
//   Streak 14 days:         +8 milestone bonus
//   Streak 30 days:         +15 milestone bonus
//
// ANSWER FEEDBACK — game-like:
//   Correct → green flash + confetti + Moeda coin animation
//   Wrong   → red flash + correct answer revealed green
//             + one AI sentence explanation (fetched per wrong answer)
//
// FIRESTORE WRITES (direct — not sensitive balance changes):
//   lastDesafioDate, desafioStreak, desafioBestScore, desafioHistory
//   All written to user document after challenge completes.
//
// LANGUAGE FOR AI INSIGHTS:
//   Grade 9 or non-language subject → Portuguese
//   English subject → English
//   French subject  → French
//
// KATEX: renderMathInElement() called after every DOM update
//
// keepAlive: false | Navbar: absent | Header: back to dashboard
// ============================================================

import { router }  from '../../core/router.js';
import { ui }      from '../../core/ui.js';
import { moeda }   from '../../core/moeda.js';
import { worker }  from '../../core/worker.js';
import { session } from '../../core/session.js';
import { db }      from '../../core/firebase.js';
import { getStudentSubjects } from '../../core/app.js';
import {
  exams,
  getWrongAnswers,
  fetchQuestions,
  getOptions,
  topicFrequency,
  normaliseYear,
  toDbSubject,
  toDbGrade,
  toDbInstitution,
  pickRandom,
  markRetried,
} from '../../core/exams.js';

import {
  doc,
  updateDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ── Constants ─────────────────────────────────────────────────
const SUPPORTED_TYPES = ['escolha-multipla', 'verdadeiro-falso'];

// ── Module state ───────────────────────────────────────────────
let _user        = null;
let _userData    = null;
let _subjects    = [];
let _state       = 'ready';
let _questions   = [];
let _currentIdx  = 0;
let _answers     = []; // { question, chosen, correct, isCorrect, insight }
let _startTime   = 0;
let _insightCache = {};

// ── KaTeX ──────────────────────────────────────────────────────
function _renderMath(el) {
  if (!el || typeof window.renderMathInElement !== 'function') return;
  try {
    window.renderMathInElement(el, {
      delimiters: [
        { left: '$$', right: '$$', display: true  },
        { left: '$',  right: '$',  display: false },
        { left: '\\(', right: '\\)', display: false },
        { left: '\\[', right: '\\]', display: true  },
      ],
      throwOnError: false,
    });
  } catch (e) {}
}

// ── HTML escape ────────────────────────────────────────────────
function _esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

// ── Mozambique local date ──────────────────────────────────────
function _mzToday() {
  const now = new Date();
  const mz  = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  return [
    mz.getUTCFullYear(),
    String(mz.getUTCMonth() + 1).padStart(2, '0'),
    String(mz.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

// ── Question count from subject count ─────────────────────────
function _targetCount(subjects) {
  const n = subjects.length;
  if (n <= 3) return 5;
  if (n <= 6) return 7;
  return 10;
}

// ── AI language for a question ────────────────────────────────
function _questionLang(question) {
  const grade = _userData?.grade;
  if (grade === '9') return 'pt';
  const subj = (question['Disciplina'] || '').toLowerCase();
  if (subj.includes('ingl')) return 'en';
  if (subj.includes('franc')) return 'fr';
  return 'pt';
}

// ── Correct answer text ────────────────────────────────────────
function _correctText(q) {
  return (q['Resposta'] || '').trim();
}

// ── Subject icon ───────────────────────────────────────────────
const SUBJECT_ICONS = {
  'matemática':    'fa-square-root-variable',
  'física':        'fa-atom',
  'química':       'fa-flask',
  'biologia':      'fa-dna',
  'história':      'fa-landmark',
  'geografia':     'fa-earth-africa',
  'portuguesa':    'fa-book',
  'inglesa':       'fa-comment-dots',
  'francesa':      'fa-comment-dots',
  'filosofia':     'fa-brain',
  'economia':      'fa-chart-line',
  'contabilidade': 'fa-calculator',
  'direito':       'fa-scale-balanced',
  'informática':   'fa-laptop-code',
  'sociologia':    'fa-people-group',
};

function _icon(subject) {
  const low = (subject || '').toLowerCase();
  for (const [k, v] of Object.entries(SUBJECT_ICONS)) {
    if (low.includes(k)) return v;
  }
  return 'fa-book-open';
}

// ── Profile badge ──────────────────────────────────────────────
function _profileBadge() {
  const t = _userData?.examType;
  const g = _userData?.grade;
  if (t === 'ensino-geral') return `${g}ª Classe`;
  if (t === 'admissao') {
    return (_userData.institution || _userData.course || 'Admissão').toUpperCase();
  }
  return '';
}

// ── Day of week in Portuguese ──────────────────────────────────
function _todayLabel() {
  const days = [
    'Domingo','Segunda-feira','Terça-feira','Quarta-feira',
    'Quinta-feira','Sexta-feira','Sábado',
  ];
  const months = [
    'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
    'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro',
  ];
  const now = new Date(new Date().getTime() + 2 * 60 * 60 * 1000);
  return `${days[now.getUTCDay()]}, ${now.getUTCDate()} de ${months[now.getUTCMonth()]}`;
}

// ── Moeda inline toast ─────────────────────────────────────────
function _moedaToast(amount, reason) {
  const existing = document.getElementById('des-moeda-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'des-moeda-toast';
  toast.setAttribute('translate', 'no');
  toast.className = 'notranslate';
  toast.style.cssText = `
    position: fixed; top: 72px; left: 50%;
    transform: translateX(-50%) translateY(-12px);
    z-index: 9999;
    display: flex; align-items: center; gap: 9px;
    background: rgba(22,163,74,0.10);
    border: 1.5px solid rgba(22,163,74,0.3);
    border-radius: 99px; padding: 9px 18px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.12);
    font-family: inherit; font-size: 13px; font-weight: 700;
    color: #16A34A; white-space: nowrap;
    pointer-events: none; opacity: 0;
    transition: opacity 0.25s ease, transform 0.25s ease;
  `;
  toast.innerHTML = `
    <i class="fa-solid fa-circle-plus" style="font-size:15px;"></i>
    <span>+${amount} Moeda${amount !== 1 ? 's' : ''}</span>
    <span style="font-weight:500;opacity:0.75;font-size:11px;">· ${_esc(reason)}</span>
  `;
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(-10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ============================================================
// SCREEN OBJECT
// ============================================================

const DesafioScreen = {

  css() {
    if (document.getElementById('des-styles')) return '';
    return `<style id="des-styles">

      /* ── BASE ── */
      .des-wrap {
        min-height: 100dvh;
        background: var(--bg);
        padding-bottom: 48px;
      }

      /* ── PROFILE STRIP ── */
      .des-strip {
        background: var(--surface);
        border-bottom: 1px solid var(--border);
        padding: 8px 16px;
        display: flex; align-items: center; gap: 7px;
      }
      .des-strip i { font-size: 11px; color: var(--accent); }
      .des-strip-text {
        font-size: 12px; font-weight: 700;
        color: var(--text-secondary); letter-spacing: 0.01em;
      }

      /* ── CONTENT ── */
      .des-content {
        padding: 20px 16px 0;
        max-width: 700px; margin: 0 auto;
      }

      /* ── READY STATE ── */
      .des-ready-header {
        display: flex; align-items: center;
        justify-content: space-between;
        padding: 20px 16px 14px;
        max-width: 700px; margin: 0 auto;
      }
      .des-ready-date {
        font-size: 12px; font-weight: 700;
        color: var(--text-muted);
        text-transform: uppercase; letter-spacing: 0.06em;
      }
      .des-ready-streak {
        display: flex; align-items: center; gap: 6px;
        background: var(--surface);
        border: 1.5px solid var(--border);
        border-radius: 99px; padding: 5px 12px;
      }
      .des-ready-streak-fire {
        font-size: 14px; line-height: 1;
        animation: desFire 1.8s ease-in-out infinite alternate;
      }
      .des-ready-streak-text {
        font-size: 12px; font-weight: 800; color: var(--text);
      }

      .des-start-card {
        background: var(--surface);
        border: 1.5px solid var(--border);
        border-radius: var(--radius-lg);
        padding: 20px 16px;
        margin-bottom: 16px;
      }
      .des-start-card-top {
        display: flex; align-items: center;
        justify-content: space-between;
        margin-bottom: 16px; gap: 12px;
      }
      .des-start-card-label {
        font-size: 11px; font-weight: 700;
        color: var(--primary);
        text-transform: uppercase; letter-spacing: 0.07em;
        margin-bottom: 3px;
        display: flex; align-items: center; gap: 6px;
      }
      .des-start-card-label i { font-size: 10px; }
      .des-start-card-count {
        font-size: 22px; font-weight: 900; color: var(--text);
        line-height: 1;
      }
      .des-start-card-count span {
        font-size: 13px; font-weight: 600;
        color: var(--text-muted); margin-left: 4px;
      }
      .des-start-card-icon {
        width: 48px; height: 48px;
        border-radius: var(--radius-md);
        background: var(--primary-light);
        display: flex; align-items: center; justify-content: center;
        font-size: 20px; color: var(--primary);
        flex-shrink: 0;
      }

      .des-start-btn {
        width: 100%; padding: 15px;
        background: var(--primary);
        color: #fff;
        font-family: inherit; font-size: 15px; font-weight: 800;
        border: none; border-radius: var(--radius-lg);
        cursor: pointer; display: flex;
        align-items: center; justify-content: center; gap: 9px;
        min-height: 52px;
        transition: opacity 0.2s, transform 0.15s;
        box-shadow: 0 3px 14px rgba(2,132,199,0.25);
      }
      .des-start-btn:hover  { opacity: 0.92; }
      .des-start-btn:active { transform: scale(0.98); }

      /* Done state */
      .des-done-state {
        width: 100%; padding: 14px 16px;
        background: rgba(22,163,74,0.07);
        border: 1.5px solid rgba(22,163,74,0.25);
        border-radius: var(--radius-lg);
        display: flex; align-items: center;
        gap: 12px;
        font-family: inherit; font-size: 14px; font-weight: 700;
        color: #16A34A;
      }
      .des-done-state i { font-size: 18px; flex-shrink: 0; }
      .des-done-score {
        font-size: 16px; font-weight: 900; color: #16A34A;
      }
      .des-done-label {
        font-size: 13px; font-weight: 700; color: #16A34A;
      }
      .des-done-sub {
        font-size: 11px; color: var(--text-muted); margin-top: 1px;
      }

      /* ── STREAK MILESTONE CARD ── */
      .des-milestone-card {
        display: none;
        background: linear-gradient(135deg,
          rgba(255,179,0,0.12) 0%, rgba(255,179,0,0.06) 100%);
        border: 1.5px solid rgba(255,179,0,0.3);
        border-radius: var(--radius-lg);
        padding: 14px 16px;
        margin-bottom: 16px;
        display: flex; align-items: center; gap: 13px;
      }
      .des-milestone-card.show { display: flex; }
      .des-milestone-icon {
        font-size: 28px; flex-shrink: 0;
        animation: desFire 1.4s ease-in-out infinite alternate;
      }
      .des-milestone-title {
        font-size: 14px; font-weight: 800; color: var(--text);
        margin-bottom: 3px;
      }
      .des-milestone-sub {
        font-size: 12px; color: var(--text-muted); line-height: 1.5;
      }
      .des-milestone-award {
        display: inline-flex; align-items: center; gap: 4px;
        font-size: 12px; font-weight: 700; color: var(--moeda);
        background: var(--moeda-light); border-radius: 99px;
        padding: 3px 10px; margin-top: 4px;
      }

      /* ── HOW TO EARN CARD ── */
      .des-earn-card {
        background: var(--surface);
        border: 1.5px solid var(--border);
        border-radius: var(--radius-lg);
        overflow: hidden; margin-bottom: 16px;
      }
      .des-earn-head {
        padding: 13px 16px;
        background: var(--bg);
        border-bottom: 1px solid var(--border);
        font-size: 13px; font-weight: 800; color: var(--text);
        display: flex; align-items: center; gap: 8px;
      }
      .des-earn-head i { font-size: 12px; color: var(--moeda); }
      .des-earn-row {
        display: flex; align-items: center;
        justify-content: space-between;
        padding: 11px 16px;
        border-bottom: 1px solid var(--border);
        gap: 10px;
      }
      .des-earn-row:last-child { border-bottom: none; }
      .des-earn-label {
        font-size: 13px; color: var(--text);
        display: flex; align-items: center; gap: 8px;
      }
      .des-earn-label i { font-size: 12px; color: var(--primary); }
      .des-earn-amount {
        font-size: 13px; font-weight: 800; color: var(--moeda);
        display: flex; align-items: center; gap: 4px;
      }

      /* ── ACTIVE STATE ── */
      .des-active-wrap { display: none; }
      .des-active-wrap.show { display: block; }

      /* Progress bar */
      .des-progress-track {
        height: 6px; background: var(--border);
        border-radius: 99px; overflow: hidden;
        margin-bottom: 20px;
      }
      .des-progress-fill {
        height: 100%;
        background: linear-gradient(90deg, var(--accent), #0284C7);
        border-radius: 99px;
        transition: width 0.4s ease;
      }

      /* Question header */
      .des-q-header {
        display: flex; flex-direction: column;
        gap: 6px; margin-bottom: 16px;
      }
      .des-q-counter {
        font-size: 13px; font-weight: 800;
        color: var(--text);
      }
      .des-q-meta {
        display: flex; align-items: center;
        flex-wrap: wrap; gap: 5px;
      }
      .des-q-badge {
        font-size: 10px; font-weight: 700;
        border-radius: 99px; padding: 3px 10px;
      }
      .des-q-badge.topic {
        color: var(--secondary); background: rgba(139,92,246,0.1);
        border: 1px solid rgba(139,92,246,0.2);
      }
      .des-q-badge.year {
        color: var(--text-muted); background: var(--surface);
        border: 1px solid var(--border);
      }
      .des-q-badge.wrong-src {
        color: var(--accent); background: rgba(20,184,166,0.1);
        border: 1px solid rgba(20,184,166,0.2);
      }

      /* Question card */
      .des-q-card {
        background: var(--surface);
        border: 1.5px solid var(--border);
        border-radius: var(--radius-xl, 20px);
        overflow: hidden; margin-bottom: 16px;
        transition: border-color 0.2s;
      }
      .des-q-card.answered-correct {
        border-color: #16A34A;
        box-shadow: 0 0 0 3px rgba(22,163,74,0.1);
      }
      .des-q-card.answered-wrong {
        border-color: #DC2626;
        box-shadow: 0 0 0 3px rgba(220,38,38,0.08);
      }

      .des-q-figure {
        margin: 14px 16px 0;
        background: rgba(2,132,199,0.04);
        border: 1.5px dashed var(--border);
        border-radius: var(--radius-md);
        padding: 12px 14px;
        display: flex; align-items: flex-start; gap: 10px;
        font-size: 13px; color: var(--text-secondary);
        line-height: 1.6; font-style: italic;
      }
      .des-q-figure i {
        color: var(--primary); font-size: 16px;
        flex-shrink: 0; margin-top: 2px;
      }

      .des-q-text {
        padding: 16px;
        font-size: 15px; font-weight: 600;
        color: var(--text); line-height: 1.7;
      }

      /* MC options */
      .des-options {
        display: flex; flex-direction: column;
        gap: 8px; padding: 0 14px 16px;
      }
      .des-option {
        display: flex; align-items: flex-start; gap: 11px;
        background: var(--bg); border: 1.5px solid var(--border);
        border-radius: var(--radius-lg);
        padding: 13px 14px; cursor: pointer;
        transition: all 0.15s; text-align: left;
        width: 100%; font-family: inherit; min-height: 48px;
        -webkit-tap-highlight-color: transparent;
      }
      .des-option:hover:not(.locked) {
        border-color: var(--primary);
        background: var(--primary-light);
        transform: translateX(2px);
      }
      .des-option:active:not(.locked) { transform: scale(0.99); }
      .des-option.locked { cursor: default; }
      .des-option.flash-correct {
        border-color: #16A34A;
        background: rgba(22,163,74,0.09);
        animation: desCorrectPulse 0.5s ease;
      }
      .des-option.flash-wrong {
        border-color: #DC2626;
        background: rgba(220,38,38,0.08);
        animation: desWrongShake 0.4s ease;
      }
      .des-option.reveal-correct {
        border-color: #16A34A;
        background: rgba(22,163,74,0.09);
      }
      .des-opt-circle {
        width: 28px; height: 28px; border-radius: 50%;
        background: var(--surface); border: 1.5px solid var(--border);
        display: flex; align-items: center; justify-content: center;
        font-size: 11px; font-weight: 800; color: var(--text-muted);
        flex-shrink: 0; transition: all 0.15s; margin-top: 1px;
      }
      .des-option.flash-correct .des-opt-circle,
      .des-option.reveal-correct .des-opt-circle {
        background: #16A34A; border-color: #16A34A; color: #fff;
      }
      .des-option.flash-wrong .des-opt-circle {
        background: #DC2626; border-color: #DC2626; color: #fff;
      }
      .des-opt-text {
        font-size: 14px; color: var(--text);
        line-height: 1.55; flex: 1; padding-top: 3px;
      }

      /* TF options */
      .des-tf-options {
        display: grid; grid-template-columns: 1fr 1fr;
        gap: 10px; padding: 0 14px 16px;
      }
      .des-tf-btn {
        padding: 18px 10px; border-radius: var(--radius-lg);
        border: 1.5px solid var(--border); background: var(--bg);
        font-family: inherit; font-size: 14px; font-weight: 700;
        color: var(--text-secondary); cursor: pointer;
        display: flex; flex-direction: column; align-items: center;
        gap: 7px; transition: all 0.15s; min-height: 80px;
        justify-content: center;
        -webkit-tap-highlight-color: transparent;
      }
      .des-tf-btn i { font-size: 22px; }
      .des-tf-btn.v:hover:not(.locked) {
        border-color: #16A34A; background: rgba(22,163,74,0.07); color: #16A34A;
      }
      .des-tf-btn.f:hover:not(.locked) {
        border-color: #DC2626; background: rgba(220,38,38,0.07); color: #DC2626;
      }
      .des-tf-btn.flash-correct, .des-tf-btn.reveal-correct {
        border-color: #16A34A; background: rgba(22,163,74,0.09); color: #16A34A;
        animation: desCorrectPulse 0.5s ease;
      }
      .des-tf-btn.flash-wrong {
        border-color: #DC2626; background: rgba(220,38,38,0.08); color: #DC2626;
        animation: desWrongShake 0.4s ease;
      }
      .des-tf-btn.locked { cursor: default; }
      .des-tf-btn:active:not(.locked) { transform: scale(0.97); }

      /* Insight block — shown below question on wrong answer */
      .des-insight-block {
        display: none;
        margin: 0 14px 16px;
        background: linear-gradient(135deg,
          rgba(2,132,199,0.06) 0%, rgba(2,132,199,0.02) 100%);
        border: 1px solid rgba(2,132,199,0.18);
        border-left: 3px solid var(--primary);
        border-radius: 0 var(--radius-md) var(--radius-md) 0;
        padding: 12px 14px;
        animation: desInsightIn 0.3s ease both;
      }
      .des-insight-block.show { display: block; }
      .des-insight-label {
        font-size: 9px; font-weight: 800;
        text-transform: uppercase; letter-spacing: 0.08em;
        color: var(--primary); margin-bottom: 6px;
        display: flex; align-items: center; gap: 5px;
      }
      .des-insight-text {
        font-size: 13px; color: var(--text-secondary); line-height: 1.7;
      }
      .des-insight-loading {
        display: flex; align-items: center; gap: 8px;
        font-size: 12px; color: var(--text-muted);
      }
      .des-insight-spin {
        width: 14px; height: 14px;
        border: 2px solid var(--border); border-top-color: var(--primary);
        border-radius: 50%; animation: desSpin 0.7s linear infinite; flex-shrink: 0;
      }

      /* Next button */
      .des-next-btn {
        width: 100%; padding: 16px; color: #fff;
        font-family: inherit; font-size: 15px; font-weight: 700;
        border: none; border-radius: var(--radius-lg); cursor: pointer;
        display: none; align-items: center; justify-content: center; gap: 9px;
        min-height: 52px; margin-top: 4px;
        background: linear-gradient(135deg, #0369A1 0%, #0284C7 100%);
        box-shadow: 0 4px 20px rgba(2,132,199,0.28);
        transition: opacity 0.2s, transform 0.15s;
        -webkit-tap-highlight-color: transparent;
      }
      .des-next-btn.show { display: flex; }
      .des-next-btn.finish {
        background: linear-gradient(135deg, #059669 0%, #10B981 100%);
        box-shadow: 0 4px 20px rgba(16,185,129,0.28);
      }
      .des-next-btn:hover  { opacity: 0.92; }
      .des-next-btn:active { transform: scale(0.98); }

      /* ── CONFETTI CANVAS ── */
      #des-confetti-canvas {
        position: fixed; inset: 0;
        pointer-events: none; z-index: 8000;
        width: 100%; height: 100%;
      }

      /* ── COIN BURST ── */
      .des-coin-burst {
        position: fixed; pointer-events: none; z-index: 8001;
        font-size: 22px; opacity: 0;
        animation: desCoinBurst 0.9s ease forwards;
      }

      /* ── RESULT STATE ── */
      .des-result-wrap { display: none; }
      .des-result-wrap.show { display: block; }

      /* Hero */
      .des-result-hero {
        background: var(--surface);
        border-bottom: 1px solid var(--border);
        padding: 48px 24px 40px;
        display: flex; flex-direction: column;
        align-items: center; text-align: center;
        position: relative; overflow: hidden;
      }
      .des-result-hero::after {
        content: '';
        position: absolute; bottom: -24px; left: 0; right: 0;
        height: 48px; background: var(--bg);
        border-radius: 50% 50% 0 0 / 100% 100% 0 0;
      }
      .des-result-hero-blob {
        position: absolute; border-radius: 50%;
        opacity: 0.07; background: #fff; pointer-events: none;
      }

      .des-score-ring {
        width: 120px; height: 120px; border-radius: 50%;
        border: 5px solid var(--border);
        background: var(--bg);
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        margin-bottom: 20px; position: relative; z-index: 1;
        animation: desPop 0.55s cubic-bezier(0.34,1.56,0.64,1) both;
      }
      .des-score-ring.great  { border-color:#4ADE80; background:rgba(74,222,128,0.18); }
      .des-score-ring.good   { border-color:#38BDF8; background:rgba(56,189,248,0.14); }
      .des-score-ring.fair   { border-color:#FCD34D; background:rgba(252,211,77,0.14); }
      .des-score-ring.low    { border-color:#F87171; background:rgba(248,113,113,0.14); }

      .des-score-pct {
        font-size: 32px; font-weight: 900; color: var(--text);
        line-height: 1; letter-spacing: -1.5px;
      }
      .des-score-sub {
        font-size: 10px; color: var(--text-muted); font-weight: 700;
        text-transform: uppercase; letter-spacing: 0.07em; margin-top: 3px;
      }
      .des-result-title {
        font-size: 24px; font-weight: 900; color: var(--text);
        margin-bottom: 6px; letter-spacing: -0.4px;
        position: relative; z-index: 1;
        animation: desFadeDown 0.4s ease 0.12s both;
      }
      .des-result-meta {
        font-size: 13px; color: var(--text-muted);
        position: relative; z-index: 1;
        animation: desFadeDown 0.4s ease 0.18s both;
        line-height: 1.5;
      }

      /* Streak badge on result */
      .des-streak-result-badge {
        display: flex; align-items: center; gap: 8px;
        background: var(--bg);
        border: 1.5px solid var(--border);
        border-radius: 99px; padding: 8px 16px;
        margin-top: 14px;
        position: relative; z-index: 1;
        animation: desFadeDown 0.4s ease 0.24s both;
      }
      .des-streak-result-badge .fire { font-size: 18px; }
      .des-streak-result-badge .text {
        font-size: 13px; font-weight: 700; color: var(--text);
      }

      /* Result body */
      .des-result-body {
        max-width: 700px; margin: 0 auto;
        padding: 28px 16px 80px;
      }

      /* Stats row */
      .des-stats-row {
        display: flex; gap: 8px; margin-bottom: 28px;
        overflow-x: auto; padding-bottom: 4px;
        scrollbar-width: none; scroll-snap-type: x mandatory;
        -webkit-overflow-scrolling: touch;
        animation: desFadeUp 0.4s ease 0.2s both;
      }
      .des-stats-row::-webkit-scrollbar { display: none; }
      .des-stat {
        background: var(--surface); border: 1px solid var(--border);
        border-radius: var(--radius-lg); padding: 14px 10px;
        text-align: center; flex: 0 0 calc(25% - 6px);
        min-width: 64px; scroll-snap-align: start;
        box-shadow: 0 1px 4px rgba(0,0,0,0.04);
      }
      .des-stat-val {
        font-size: 24px; font-weight: 900;
        line-height: 1; margin-bottom: 4px;
      }
      .des-stat-val.c  { color: #16A34A; }
      .des-stat-val.w  { color: #DC2626; }
      .des-stat-val.m  { color: var(--moeda); }
      .des-stat-val.s  { color: var(--accent); }
      .des-stat-lbl {
        font-size: 9px; font-weight: 700; color: var(--text-muted);
        text-transform: uppercase; letter-spacing: 0.06em;
      }

      /* Moedas earned breakdown */
      .des-moedas-card {
        background: var(--surface); border: 1.5px solid var(--border);
        border-radius: var(--radius-lg); overflow: hidden; margin-bottom: 16px;
      }
      .des-moedas-head {
        padding: 13px 16px; background: var(--bg);
        border-bottom: 1px solid var(--border);
        display: flex; align-items: center; gap: 8px;
        font-size: 13px; font-weight: 800; color: var(--text);
      }
      .des-moedas-head i { font-size: 13px; color: var(--moeda); }
      .des-moedas-row {
        display: flex; align-items: center;
        justify-content: space-between;
        padding: 11px 16px; border-bottom: 1px solid var(--border); gap: 10px;
      }
      .des-moedas-row:last-child { border-bottom: none; }
      .des-moedas-row-label {
        font-size: 13px; color: var(--text);
        display: flex; align-items: center; gap: 8px;
      }
      .des-moedas-row-label i { font-size: 12px; color: var(--primary); }
      .des-moedas-row-amount {
        font-size: 14px; font-weight: 800; color: var(--moeda);
        display: flex; align-items: center; gap: 4px;
      }
      .des-moedas-total {
        padding: 12px 16px;
        background: var(--moeda-light);
        border-top: 1px solid rgba(255,179,0,0.2);
        display: flex; align-items: center;
        justify-content: space-between;
      }
      .des-moedas-total-label {
        font-size: 13px; font-weight: 800; color: var(--text);
      }
      .des-moedas-total-amount {
        font-size: 20px; font-weight: 900; color: var(--moeda);
        display: flex; align-items: center; gap: 6px;
      }

      /* Personal best banner */
      .des-best-banner {
        display: none;
        background: linear-gradient(135deg,
          rgba(139,92,246,0.1) 0%, rgba(139,92,246,0.05) 100%);
        border: 1.5px solid rgba(139,92,246,0.25);
        border-radius: var(--radius-lg);
        padding: 13px 16px; margin-bottom: 16px;
        align-items: center; gap: 12px;
        animation: desFadeUp 0.4s ease 0.3s both;
      }
      .des-best-banner.show { display: flex; }
      .des-best-icon { font-size: 24px; flex-shrink: 0; }
      .des-best-text { flex: 1; }
      .des-best-title {
        font-size: 14px; font-weight: 800; color: var(--secondary);
        margin-bottom: 2px;
      }
      .des-best-sub { font-size: 12px; color: var(--text-muted); }

      /* Wrong answers review */
      .des-result-sec {
        font-size: 11px; font-weight: 700;
        text-transform: uppercase; letter-spacing: 0.08em;
        color: var(--primary); margin: 24px 0 12px;
        display: flex; align-items: center; gap: 6px;
      }
      .des-result-sec i { font-size: 10px; }

      .des-wrong-item {
        background: var(--surface); border: 1.5px solid var(--border);
        border-radius: var(--radius-lg); overflow: hidden;
        margin-bottom: 10px; position: relative;
      }
      .des-wrong-item::before {
        content: ''; position: absolute;
        left: 0; top: 0; bottom: 0; width: 4px;
        background: #DC2626;
      }
      .des-wrong-inner { padding: 14px 16px 14px 20px; }
      .des-wrong-q-text {
        font-size: 13px; font-weight: 600; color: var(--text);
        line-height: 1.55; margin-bottom: 10px;
      }
      .des-wrong-answers {
        display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px;
      }
      .des-wrong-pill {
        font-size: 11px; font-weight: 600; border-radius: 99px;
        padding: 4px 12px; display: flex; align-items: center; gap: 5px;
      }
      .des-wrong-pill.student {
        background: rgba(220,38,38,0.08); color: #DC2626;
        border: 1px solid rgba(220,38,38,0.22);
        text-decoration: line-through; opacity: 0.85;
      }
      .des-wrong-pill.correct {
        background: rgba(22,163,74,0.08); color: #16A34A;
        border: 1px solid rgba(22,163,74,0.25);
      }
      .des-wrong-insight {
        font-size: 12px; color: var(--text-muted);
        line-height: 1.65; padding: 9px 12px;
        background: var(--bg); border: 1px solid var(--border);
        border-radius: var(--radius-md);
        border-left: 3px solid var(--primary);
      }
      .des-wrong-insight-loading {
        display: flex; align-items: center; gap: 7px;
        font-size: 12px; color: var(--text-muted);
      }
      .des-wrong-insight-spin {
        width: 12px; height: 12px;
        border: 2px solid var(--border); border-top-color: var(--primary);
        border-radius: 50%; animation: desSpin 0.7s linear infinite; flex-shrink: 0;
      }

      /* CTA */
      .des-cta-section { margin-top: 28px; }
      .des-cta-divider {
        display: flex; align-items: center; gap: 10px; margin: 20px 0 14px;
      }
      .des-cta-divider-line { flex: 1; height: 1px; background: var(--border); }
      .des-cta-divider-lbl {
        font-size: 10px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.08em; color: var(--text-muted); white-space: nowrap;
      }
      .des-btn-primary {
        width: 100%; padding: 15px; color: #fff; font-family: inherit;
        font-size: 15px; font-weight: 700; border: none;
        border-radius: var(--radius-lg); cursor: pointer;
        display: flex; align-items: center; justify-content: center; gap: 8px;
        min-height: 52px; margin-bottom: 10px;
        background: linear-gradient(135deg, #059669 0%, #10B981 100%);
        box-shadow: 0 4px 20px rgba(16,185,129,0.28);
        transition: opacity 0.2s, transform 0.15s;
      }
      .des-btn-primary:hover  { opacity: 0.92; }
      .des-btn-primary:active { transform: scale(0.98); }
      .des-btn-secondary {
        width: 100%; padding: 14px; color: #fff; font-family: inherit;
        font-size: 14px; font-weight: 700; border: none;
        border-radius: var(--radius-lg); cursor: pointer;
        display: flex; align-items: center; justify-content: center; gap: 8px;
        min-height: 50px; margin-bottom: 10px;
        background: linear-gradient(135deg, #0369A1 0%, #0284C7 100%);
        box-shadow: 0 4px 16px rgba(2,132,199,0.25);
        transition: opacity 0.2s, transform 0.15s;
      }
      .des-btn-secondary:hover  { opacity: 0.92; }
      .des-btn-secondary:active { transform: scale(0.98); }
      .des-btn-share {
        width: 100%; padding: 14px; color: #fff; font-family: inherit;
        font-size: 14px; font-weight: 700; border: none;
        border-radius: var(--radius-lg); cursor: pointer;
        display: flex; align-items: center; justify-content: center; gap: 8px;
        min-height: 50px; margin-bottom: 10px;
        background: #25D366;
        box-shadow: 0 4px 16px rgba(37,211,102,0.3);
        transition: opacity 0.2s, transform 0.15s;
      }
      .des-btn-share:hover  { opacity: 0.92; }
      .des-btn-share:active { transform: scale(0.98); }

      /* ── DARK ── */
      [data-theme="dark"] .des-earn-card,
      [data-theme="dark"] .des-moedas-card,
      [data-theme="dark"] .des-q-card,
      [data-theme="dark"] .des-wrong-item,
      [data-theme="dark"] .des-stat { background: var(--bg-card); }
      [data-theme="dark"] .des-option,
      [data-theme="dark"] .des-tf-btn { background: var(--bg); }
      [data-theme="dark"] .des-result-hero { background: var(--surface); }
      .des-result-hero::after { display: none; }

      /* ── RESPONSIVE ── */
      @media (min-width: 768px) {
        .des-content { padding: 24px 24px 0; }
        .des-result-body { padding: 32px 24px 80px; }
      }
      @media (min-width: 1025px) {
        .des-wrap { max-width: 760px; margin: 0 auto; }
      }

      /* ── ANIMATIONS ── */
      @keyframes desFire {
        from { transform: scale(1) rotate(-3deg); }
        to   { transform: scale(1.15) rotate(3deg); }
      }
      @keyframes desCorrectPulse {
        0%   { transform: scale(1); }
        40%  { transform: scale(1.03); }
        100% { transform: scale(1); }
      }
      @keyframes desWrongShake {
        0%,100% { transform: translateX(0); }
        20%     { transform: translateX(-6px); }
        60%     { transform: translateX(6px); }
      }
      @keyframes desInsightIn {
        from { opacity: 0; transform: translateY(8px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @keyframes desSpin { to { transform: rotate(360deg); } }
      @keyframes desPop {
        from { opacity:0; transform:scale(0.65); }
        to   { opacity:1; transform:scale(1); }
      }
      @keyframes desFadeUp {
        from { opacity:0; transform:translateY(14px); }
        to   { opacity:1; transform:translateY(0); }
      }
      @keyframes desFadeDown {
        from { opacity:0; transform:translateY(-10px); }
        to   { opacity:1; transform:translateY(0); }
      }
      @keyframes desCoinBurst {
        0%   { opacity:1; transform:translateY(0) scale(1); }
        60%  { opacity:1; transform:translateY(-60px) scale(1.3); }
        100% { opacity:0; transform:translateY(-90px) scale(0.8); }
      }

    </style>`;
  },

  mount() {
    return `
      <canvas id="des-confetti-canvas"></canvas>

      <div class="des-wrap">
        <div id="header-mount"></div>

        <div class="des-strip">
          <i class="fa-solid fa-fire" aria-hidden="true"></i>
          <span class="des-strip-text notranslate" translate="no"
            id="des-strip-text"></span>
        </div>

        <!-- READY STATE -->
        <div id="des-ready-wrap">

          <!-- Date + streak row -->
          <div class="des-ready-header notranslate" translate="no">
            <div class="des-ready-date" id="des-ready-date"></div>
            <div class="des-ready-streak">
              <span class="des-ready-streak-fire">🔥</span>
              <span class="des-ready-streak-text notranslate"
                translate="no" id="des-streak-num">0</span>
              <span class="des-ready-streak-text"
                style="font-weight:600;color:var(--text-muted);">dias</span>
            </div>
          </div>

          <!-- Start card -->
          <div class="des-content">
            <div class="des-start-card" id="des-start-card">
              <div class="des-start-card-top">
                <div>
                  <div class="des-start-card-label notranslate" translate="no">
                    <i class="fa-solid fa-bolt" aria-hidden="true"></i>
                    Desafio de Hoje
                  </div>
                  <div class="des-start-card-count notranslate" translate="no">
                    <span id="des-q-count-val">—</span>
                    <span>perguntas</span>
                  </div>
                </div>
                <div class="des-start-card-icon">
                  <i class="fa-solid fa-bolt" aria-hidden="true"></i>
                </div>
              </div>
              <div id="des-hero-action"></div>
            </div>

            <!-- Streak milestone (shown when applicable) -->
            <div class="des-milestone-card" id="des-milestone-card">
              <div class="des-milestone-icon">🏆</div>
              <div>
                <div class="des-milestone-title notranslate" translate="no"
                  id="des-milestone-title"></div>
                <div class="des-milestone-sub notranslate" translate="no"
                  id="des-milestone-sub"></div>
                <div class="des-milestone-award notranslate" translate="no"
                  id="des-milestone-award">
                  <i class="fa-solid fa-coins" style="font-size:11px;"></i>
                  <span></span>
                </div>
              </div>
            </div>

            <!-- How to earn Moedas -->
            <div class="des-earn-card">
              <div class="des-earn-head notranslate" translate="no">
                <i class="fa-solid fa-coins" aria-hidden="true"></i>
                Como Ganhar Moedas Hoje
              </div>
              <div class="des-earn-row">
                <div class="des-earn-label notranslate" translate="no">
                  <i class="fa-solid fa-check-circle"></i>
                  Completar o desafio
                </div>
                <div class="des-earn-amount notranslate" translate="no">
                  +5 <i class="fa-solid fa-coins" style="font-size:11px;"></i>
                </div>
              </div>
              <div class="des-earn-row">
                <div class="des-earn-label notranslate" translate="no">
                  <i class="fa-solid fa-star"></i>
                  Score ≥ 60%
                </div>
                <div class="des-earn-amount notranslate" translate="no">
                  +3 <i class="fa-solid fa-coins" style="font-size:11px;"></i>
                </div>
              </div>
              <div class="des-earn-row">
                <div class="des-earn-label notranslate" translate="no">
                  <i class="fa-solid fa-trophy"></i>
                  Score 100%
                </div>
                <div class="des-earn-amount notranslate" translate="no">
                  +5 <i class="fa-solid fa-coins" style="font-size:11px;"></i>
                </div>
              </div>
              <div class="des-earn-row">
                <div class="des-earn-label notranslate" translate="no">
                  <i class="fa-solid fa-fire"></i>
                  Streak de 7 dias
                </div>
                <div class="des-earn-amount notranslate" translate="no">
                  +5 <i class="fa-solid fa-coins" style="font-size:11px;"></i>
                </div>
              </div>
            </div>
          </div>

        </div>

        <!-- ACTIVE STATE -->
        <div class="des-content des-active-wrap" id="des-active-wrap">
          <div class="des-progress-track">
            <div class="des-progress-fill" id="des-progress-fill"
              style="width:0%"></div>
          </div>
          <div id="des-active-body"></div>
        </div>

        <!-- RESULT STATE -->
        <div class="des-result-wrap" id="des-result-wrap"></div>

      </div>
    `;
  },

  async init(user, userData, params) {
    _user        = user;
    _userData    = userData;
    _subjects    = getStudentSubjects(userData);
    _state       = 'ready';
    _questions   = [];
    _currentIdx  = 0;
    _answers     = [];
    _startTime   = 0;
    _insightCache = {};

    ui.renderHeader({
      title:          'Desafio Diário',
      backRoute:      '/panel/dashboard',
      showDarkToggle: true,
      moedasBalance:  moeda.getBalance(userData),
    });

    const strip = document.getElementById('des-strip-text');
    if (strip) {
      const badge = _profileBadge();
      strip.textContent = badge
        ? `Desafio Diário · ${badge}`
        : 'Desafio Diário';
    }

    _renderReadyState();
  },

  destroy() {
    _questions    = [];
    _answers      = [];
    _insightCache = {};
  },
};

// ============================================================
// READY STATE
// ============================================================

function _renderReadyState() {
  const today   = _mzToday();
  const streak  = _userData?.desafioStreak  || 0;
  const lastDate = _userData?.lastDesafioDate || '';
  const isDone  = lastDate === today;
  const target  = _targetCount(_subjects);

  // Date
  const dateEl = document.getElementById('des-ready-date');
  if (dateEl) dateEl.textContent = _todayLabel();

  // Streak
  const streakEl = document.getElementById('des-streak-num');
  if (streakEl) streakEl.textContent = streak;

  // Question count
  const qEl = document.getElementById('des-q-count-val');
  if (qEl) qEl.textContent = target;

  // Action — start or done
  const actionEl = document.getElementById('des-hero-action');
  if (actionEl) {
    if (isDone) {
      const history = _userData?.desafioHistory || [];
      const todayResult = history.find(h => h.date === today);
      const todayScore = todayResult?.score ?? null;
      actionEl.innerHTML = `
        <div class="des-done-state notranslate" translate="no">
          <i class="fa-solid fa-check-circle" aria-hidden="true"></i>
          <div>
            <div class="des-done-label">Desafio de hoje concluído!</div>
            ${todayScore !== null
              ? `<div class="des-done-sub">${todayScore}% de acerto</div>`
              : ''}
          </div>
        </div>
      `;
    } else {
      actionEl.innerHTML = `
        <button class="des-start-btn notranslate" translate="no" id="des-start-btn">
          <i class="fa-solid fa-bolt" aria-hidden="true"></i>
          Começar o Desafio
        </button>
      `;
      document.getElementById('des-start-btn')
        ?.addEventListener('click', _startChallenge, { once: true });
    }
  }

  // Streak milestone card
  _checkStreakMilestone(streak);
}

function _checkStreakMilestone(streak) {
  const card = document.getElementById('des-milestone-card');
  if (!card) return;

  const milestones = [
    { days: 30, bonus: moeda.AWARDS.DESAFIO_STREAK_30,
      title: '30 Dias! Lendário! 🏆',
      sub: 'Manteve o desafio por um mês completo. Incrível dedicação.' },
    { days: 14, bonus: moeda.AWARDS.DESAFIO_STREAK_14,
      title: '14 Dias! Imparável! 🔥',
      sub: 'Duas semanas consecutivas. Está a construir um hábito real.' },
    { days: 7,  bonus: moeda.AWARDS.DESAFIO_STREAK_7,
      title: '7 Dias! Uma semana completa! 🎯',
      sub: 'Completou 7 dias seguidos. Consistência é a chave do sucesso.' },
  ];

  const match = milestones.find(m => streak === m.days);
  if (!match) return;

  card.classList.add('show');
  const titleEl  = document.getElementById('des-milestone-title');
  const subEl    = document.getElementById('des-milestone-sub');
  const awardEl  = card.querySelector('.des-milestone-award span');
  if (titleEl)  titleEl.textContent = match.title;
  if (subEl)    subEl.textContent   = match.sub;
  if (awardEl)  awardEl.textContent = `+${match.bonus} Moedas de bónus`;
}

// ============================================================
// START CHALLENGE — BUILD QUESTION POOL
// ============================================================

async function _startChallenge() {
  ui.showSpinner('A preparar o desafio…');

  try {
    const target  = _targetCount(_subjects);
    const pool    = await _buildQuestionPool(target);

    if (!pool.length) {
      ui.hideSpinner();
      ui.showToast('Sem perguntas disponíveis. Tente novamente.', 'error');
      return;
    }

    _questions  = pool;
    _currentIdx = 0;
    _answers    = [];
    _startTime  = Date.now();
    _state      = 'active';

    ui.hideSpinner();
    _showActiveState();
    _renderCurrentQuestion();

  } catch (e) {
    console.error('[Desafio] start:', e);
    ui.hideSpinner();
    ui.showToast('Erro ao preparar o desafio. Tente novamente.', 'error');
  }
}

async function _buildQuestionPool(target) {
  const pool = [];
  const usedIds = new Set();

  // ── Priority 1: Wrong answers (retried: false) ─────────
  try {
    const allWrong = await getWrongAnswers(_user.uid, {}, true);
    const pending  = allWrong.filter(r =>
      !r.retried && r.questionData && _isValidQ(r.questionData)
    );

    // Shuffle and pick — spread across subjects
    const shuffled = _shuffle(pending);
    const perSubject = {};

    for (const r of shuffled) {
      const subj = r.subject || '';
      if (!perSubject[subj]) perSubject[subj] = [];
      perSubject[subj].push(r);
    }

    // Round-robin across subjects for balance
    let added = 0;
    const needed = Math.min(Math.ceil(target * 0.6), target);
    let exhausted = false;

    while (added < needed && !exhausted) {
      exhausted = true;
      for (const subj of Object.keys(perSubject)) {
        if (added >= needed) break;
        const arr = perSubject[subj];
        if (!arr.length) continue;
        exhausted = false;
        const rec = arr.shift();
        const q   = { ...rec.questionData, _wrongRecordId: rec._id, _fromWrong: true };
        const id  = q['_id'] || q['Nº'] + (q['Ano'] || '');
        if (!usedIds.has(id)) {
          usedIds.add(id);
          pool.push(q);
          added++;
        }
      }
    }
  } catch (e) {
    console.warn('[Desafio] wrong answers fetch:', e);
  }

  // ── Priority 2 + 3: DB fallback ────────────────────────
  if (pool.length < target) {
    const still = target - pool.length;

    // Build filters for all subjects
    const isAdm  = _userData?.examType === 'admissao';
    const grade  = _userData?.grade
      ? toDbGrade(_userData.grade) : null;

    // Fetch per subject to get good coverage
    const perSubjectQ = {};
    for (const s of _subjects) {
      try {
        const filters = { disciplina: toDbSubject(s) };
        if (!isAdm) {
          filters.tipo_exame = 'Ensino Geral';
          if (grade) filters.classe = grade;
        } else {
          filters.tipo_exame = 'Admissão';
          if (_userData?.institution) {
            filters.instituicao = toDbInstitution(_userData.institution);
          }
        }
        const all    = await fetchQuestions(filters);
        const valid  = all.filter(q => _isValidQ(q));
        if (!valid.length) continue;

        // Priority 2: high-frequency topics
        const freq   = topicFrequency(valid);
        const topTopics = freq.slice(0, 3).map(f => f.topic);
        const topQ   = valid.filter(q =>
          topTopics.includes((q['Tema_Relacionado'] || '').trim())
        );
        perSubjectQ[s] = topQ.length >= 2 ? topQ : valid;
      } catch (e) {
        console.warn('[Desafio] DB fetch for', s, ':', e);
      }
    }

    // Round-robin across subjects
    const keys    = Object.keys(perSubjectQ);
    const buckets = {};
    for (const k of keys) buckets[k] = _shuffle(perSubjectQ[k]);

    let added = 0;
    let exhausted = false;
    while (added < still && !exhausted) {
      exhausted = true;
      for (const k of keys) {
        if (added >= still) break;
        const arr = buckets[k];
        if (!arr || !arr.length) continue;
        exhausted = false;
        const q  = arr.shift();
        const id = q['_id'] || q['Nº'] + (q['Ano'] || '');
        if (!usedIds.has(id)) {
          usedIds.add(id);
          pool.push(q);
          added++;
        }
      }
    }
  }

  return _shuffle(pool).slice(0, target);
}

function _isValidQ(q) {
  if (!q) return false;
  const tipo = (q['Tipo'] || '').trim();
  if (!SUPPORTED_TYPES.includes(tipo)) return false;
  if (!(q['Enunciado'] || '').trim()) return false;
  const resp = (q['Resposta'] || '').trim();
  if (!resp) return false;
  if (tipo === 'verdadeiro-falso') {
    return resp === 'Verdadeiro' || resp === 'Falso';
  }
  return getOptions(q).length >= 2;
}

function _shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ============================================================
// ACTIVE STATE
// ============================================================

function _showActiveState() {
  document.getElementById('des-ready-wrap').style.display  = 'none';
  document.getElementById('des-active-wrap').classList.add('show');
  document.getElementById('des-result-wrap').classList.remove('show');
}

function _renderCurrentQuestion() {
  const q   = _questions[_currentIdx];
  const idx = _currentIdx;
  const total = _questions.length;
  const pct = Math.round((idx / total) * 100);

  // Progress bar
  const fill = document.getElementById('des-progress-fill');
  if (fill) fill.style.width = pct + '%';

  const tipo      = (q['Tipo'] || 'escolha-multipla').trim();
  const qText     = (q['Enunciado'] || '').trim();
  const topic     = (q['Tema_Relacionado'] || '').trim();
  const year      = normaliseYear(q['Ano'] || '');
  const figDesc   = (q['Descrição_Figura'] || '').trim();
  const isLast    = idx === total - 1;
  const fromWrong = !!q._fromWrong;

  let optionsHtml = '';
  if (tipo === 'verdadeiro-falso') {
    optionsHtml = `
      <div class="des-tf-options" id="des-opts">
        <button class="des-tf-btn v notranslate" translate="no"
          data-answer="Verdadeiro">
          <i class="fa-solid fa-check-circle" aria-hidden="true"></i>
          Verdadeiro
        </button>
        <button class="des-tf-btn f notranslate" translate="no"
          data-answer="Falso">
          <i class="fa-solid fa-times-circle" aria-hidden="true"></i>
          Falso
        </button>
      </div>`;
  } else {
    const opts = getOptions(q);
    optionsHtml = `
      <div class="des-options" id="des-opts">
        ${opts.map(o => `
          <button class="des-option notranslate" translate="no"
            data-letter="${_esc(o.letter)}" data-text="${_esc(o.text)}">
            <div class="des-opt-circle">${_esc(o.letter)}</div>
            <div class="des-opt-text">${_esc(o.text)}</div>
          </button>
        `).join('')}
      </div>`;
  }

  const html = `
    <div class="des-q-header">
      <div class="des-q-counter notranslate" translate="no">
        Pergunta ${idx + 1} de ${total}
      </div>
      <div class="des-q-meta">
        ${fromWrong
          ? `<span class="des-q-badge wrong-src notranslate" translate="no">
              <i class="fa-solid fa-rotate" style="font-size:9px;margin-right:3px;"></i>
              Revisão
            </span>`
          : ''}
        ${(q['Disciplina'] || '').trim()
          ? `<span class="des-q-badge year notranslate" translate="no">
              <i class="fa-solid ${_icon(q['Disciplina'])} " style="font-size:9px;margin-right:3px;"></i>
              ${_esc((q['Disciplina'] || '').trim())}
            </span>`
          : ''}
        ${topic
          ? `<span class="des-q-badge topic notranslate" translate="no">
              ${_esc(topic)}
            </span>`
          : ''}
        ${year
          ? `<span class="des-q-badge year notranslate" translate="no">
              ${_esc(year)}
            </span>`
          : ''}
      </div>
    </div>

    <div class="des-q-card" id="des-q-card">
      ${figDesc ? `
        <div class="des-q-figure">
          <i class="fa-solid fa-image" aria-hidden="true"></i>
          <span class="notranslate" translate="no">${_esc(figDesc)}</span>
        </div>` : ''}
      <div class="des-q-text notranslate" translate="no" id="des-q-text">
        ${_esc(qText)}
      </div>
      ${optionsHtml}
      <!-- Insight shown here on wrong answer -->
      <div class="des-insight-block" id="des-insight-block">
        <div class="des-insight-label notranslate" translate="no">
          <i class="fa-solid fa-lightbulb" aria-hidden="true"></i>
          Sabia que…
        </div>
        <div class="des-insight-text notranslate" translate="no"
          id="des-insight-text">
          <div class="des-insight-loading">
            <div class="des-insight-spin"></div>
            <span>A preparar a explicação…</span>
          </div>
        </div>
      </div>
    </div>

    <button class="des-next-btn ${isLast ? 'finish' : ''} notranslate"
      translate="no" id="des-next-btn">
      <i class="fa-solid ${isLast ? 'fa-flag-checkered' : 'fa-arrow-right'}"
        aria-hidden="true"></i>
      ${isLast ? 'Ver Resultado' : 'Próxima Pergunta'}
    </button>
  `;

  document.getElementById('des-active-body').innerHTML = html;

  // Render math in question
  _renderMath(document.getElementById('des-q-text'));

  // Wire options
  _wireOptions(q, tipo);

  // Wire next button
  document.getElementById('des-next-btn')
    ?.addEventListener('click', _goNext, { once: true });

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// ============================================================
// WIRE OPTIONS
// ============================================================

function _wireOptions(q, tipo) {
  const opts = document.getElementById('des-opts');
  if (!opts) return;

  if (tipo === 'verdadeiro-falso') {
    opts.querySelectorAll('.des-tf-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.classList.contains('locked')) return;
        _handleAnswer(btn.dataset.answer, null, q, tipo);
      });
    });
  } else {
    opts.querySelectorAll('.des-option').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.classList.contains('locked')) return;
        _handleAnswer(btn.dataset.text, btn.dataset.letter, q, tipo);
      });
    });
  }
}

// ============================================================
// HANDLE ANSWER
// ============================================================

function _handleAnswer(answerText, answerLetter, q, tipo) {
  const opts    = document.getElementById('des-opts');
  const card    = document.getElementById('des-q-card');
  const nextBtn = document.getElementById('des-next-btn');
  if (!opts) return;

  const correct   = _correctText(q);
  const isCorrect = answerText === correct;

  // Lock all
  opts.querySelectorAll('.des-option, .des-tf-btn').forEach(btn => {
    btn.classList.add('locked');
  });

  if (isCorrect) {
    // ── CORRECT ──────────────────────────────────────────
    if (tipo === 'verdadeiro-falso') {
      opts.querySelectorAll('.des-tf-btn').forEach(btn => {
        if (btn.dataset.answer === answerText) btn.classList.add('flash-correct');
      });
    } else {
      opts.querySelectorAll('.des-option').forEach(btn => {
        if (btn.dataset.text === answerText) btn.classList.add('flash-correct');
      });
    }

    card?.classList.add('answered-correct');
    _spawnConfetti();
    _spawnCoinBurst();

  } else {
    // ── WRONG ────────────────────────────────────────────
    // Dim chosen
    if (tipo === 'verdadeiro-falso') {
      opts.querySelectorAll('.des-tf-btn').forEach(btn => {
        if (btn.dataset.answer === answerText) btn.classList.add('flash-wrong');
        if (btn.dataset.answer === correct)    btn.classList.add('reveal-correct');
      });
    } else {
      opts.querySelectorAll('.des-option').forEach(btn => {
        if (btn.dataset.text === answerText) btn.classList.add('flash-wrong');
        if (btn.dataset.text === correct)    btn.classList.add('reveal-correct');
      });
    }

    card?.classList.add('answered-wrong');

    // Show insight block and fetch AI insight
    const insightBlock = document.getElementById('des-insight-block');
    if (insightBlock) insightBlock.classList.add('show');
    _fetchInsight(q, _currentIdx);
  }

  // Record answer
  _answers.push({
    question:  q,
    chosen:    answerText,
    correct,
    isCorrect,
    insight:   null, // filled later by _fetchInsight
  });

  // Show next button
  if (nextBtn) nextBtn.classList.add('show');
}

// ============================================================
// FETCH AI INSIGHT (one sentence, wrong answers only)
// ============================================================

async function _fetchInsight(q, idx) {
  const cacheKey = q['_id'] || q['Nº'] + (q['Ano'] || '');
  if (_insightCache[cacheKey]) {
    _setInsightText(_insightCache[cacheKey]);
    if (_answers[idx]) _answers[idx].insight = _insightCache[cacheKey];
    return;
  }

  const lang       = _questionLang(q);
  const disciplina = (q['Disciplina'] || '').trim();
  const classe     = (q['Classe']     || '').trim();
  const enunciado  = (q['Enunciado']  || '').slice(0, 150);
  const correct    = _correctText(q);
  const tipo       = (q['Tipo'] || '').trim();
  const dbExpl     = (q['Explicação']        || '').slice(0, 400);
  const dbRespPoss = (q['Resposta_Possível'] || '').slice(0, 400);

  const langInstr = lang === 'en'
    ? 'Reply in simple English (B1 level).'
    : lang === 'fr'
    ? 'Réponds en français simple (niveau B1).'
    : 'Responde em Português simples e directo.';

  const prompt = `Respond immediately with the answer only. No thinking. No reasoning steps.\n${langInstr}
Disciplina: ${disciplina}${classe ? ', ' + classe : ''}.
Questão: ${enunciado}
${tipo === 'verdadeiro-falso' ? '' : `Resposta correcta: ${correct}`}
${dbExpl      ? `Explicação oficial: ${dbExpl}`      : ''}
${dbRespPoss  ? `Referência: ${dbRespPoss}`           : ''}

Escreve UMA frase curta (máximo 25 palavras) que explique O PORQUÊ da resposta correcta estar certa. Vai directo ao facto. Sem introdução. Sem asteriscos.`;

  try {
    const messages = [
      { role: 'user', content: prompt },
    ];
    const raw     = await worker.callAI(messages, { maxTokens: 600, temperature: 0.25 });
    const insight = (raw || '').trim().replace(/\*\*/g, '').replace(/\*/g, '');
    _insightCache[cacheKey] = insight;
    _setInsightText(insight);
    if (_answers[idx]) _answers[idx].insight = insight;
  } catch (e) {
    console.warn('[Desafio] insight fetch:', e);
    const fallback = lang === 'en'
      ? 'Review this topic in your notes for a deeper understanding.'
      : lang === 'fr'
      ? 'Consultez vos notes sur ce sujet pour mieux comprendre.'
      : 'Consulte os seus apontamentos sobre este tema.';
    _setInsightText(fallback);
    if (_answers[idx]) _answers[idx].insight = fallback;
  }
}

function _setInsightText(text) {
  const el = document.getElementById('des-insight-text');
  if (el) {
    el.textContent = text;
    _renderMath(el);
  }
}

// ============================================================
// NEXT QUESTION / FINISH
// ============================================================

function _goNext() {
  _currentIdx++;
  if (_currentIdx >= _questions.length) {
    _finishChallenge();
  } else {
    _renderCurrentQuestion();
  }
}

// ============================================================
// CONFETTI
// ============================================================

function _spawnConfetti() {
  const canvas = document.getElementById('des-confetti-canvas');
  if (!canvas) return;
  const ctx    = canvas.getContext('2d');
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  const COLORS = ['#FFB300','#0284C7','#16A34A','#8B5CF6','#F87171','#38BDF8'];
  const pieces = Array.from({ length: 60 }, () => ({
    x:   Math.random() * canvas.width,
    y:   -10,
    w:   6 + Math.random() * 8,
    h:   4 + Math.random() * 6,
    r:   Math.random() * Math.PI * 2,
    vx:  (Math.random() - 0.5) * 4,
    vy:  3 + Math.random() * 4,
    vr:  (Math.random() - 0.5) * 0.2,
    col: COLORS[Math.floor(Math.random() * COLORS.length)],
    life: 1,
  }));

  let frame;
  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let any = false;
    for (const p of pieces) {
      p.x  += p.vx;
      p.y  += p.vy;
      p.r  += p.vr;
      p.vy += 0.12;
      p.life -= 0.012;
      if (p.life <= 0 || p.y > canvas.height) continue;
      any = true;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle   = p.col;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (any) frame = requestAnimationFrame(draw);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  };
  cancelAnimationFrame(frame);
  draw();
}

function _spawnCoinBurst() {
  const el = document.createElement('div');
  el.className = 'des-coin-burst';
  el.textContent = '🪙';
  el.style.left = `${40 + Math.random() * 20}%`;
  el.style.top  = '40%';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

// ============================================================
// FINISH CHALLENGE
// ============================================================

async function _finishChallenge() {
  _state = 'result';

  const total   = _questions.length;
  const correct = _answers.filter(a => a.isCorrect).length;
  const score   = Math.round((correct / total) * 100);
  const today   = _mzToday();

  // Moedas calculation
  let moedasEarned = moeda.AWARDS.DESAFIO_BASE;
  let breakdown    = [
    { label: 'Completar o desafio', amount: moeda.AWARDS.DESAFIO_BASE },
  ];

  if (score === 100) {
    moedasEarned += moeda.AWARDS.DESAFIO_BONUS_100;
    breakdown.push({ label: 'Score perfeito (100%!)', amount: moeda.AWARDS.DESAFIO_BONUS_100 });
  } else if (score >= 60) {
    moedasEarned += moeda.AWARDS.DESAFIO_BONUS_60;
    breakdown.push({ label: `Score ≥ 60% (${score}%)`, amount: moeda.AWARDS.DESAFIO_BONUS_60 });
  }

  // Streak calculation
  const prevDate   = _userData?.lastDesafioDate || '';
  const prevStreak = _userData?.desafioStreak   || 0;

  // Check if yesterday
  const yesterday = (() => {
    const d = new Date(new Date().getTime() + 2 * 60 * 60 * 1000);
    d.setUTCDate(d.getUTCDate() - 1);
    return [
      d.getUTCFullYear(),
      String(d.getUTCMonth() + 1).padStart(2, '0'),
      String(d.getUTCDate()).padStart(2, '0'),
    ].join('-');
  })();

  const newStreak = (prevDate === yesterday || prevDate === today)
    ? prevStreak + 1
    : 1;

  // Streak milestone bonus
  let streakBonus = 0;
  let streakBonusLabel = '';
  if (newStreak === 7) {
    streakBonus      = moeda.AWARDS.DESAFIO_STREAK_7;
    streakBonusLabel = '🔥 Streak de 7 dias!';
  } else if (newStreak === 14) {
    streakBonus      = moeda.AWARDS.DESAFIO_STREAK_14;
    streakBonusLabel = '🔥 Streak de 14 dias!';
  } else if (newStreak === 30) {
    streakBonus      = moeda.AWARDS.DESAFIO_STREAK_30;
    streakBonusLabel = '🔥 Streak de 30 dias!';
  }
  if (streakBonus) {
    moedasEarned += streakBonus;
    breakdown.push({ label: streakBonusLabel, amount: streakBonus });
  }

  // Personal best
  const prevBest   = _userData?.desafioBestScore ?? null;
  const newBest    = prevBest === null || score > prevBest ? score : prevBest;
  const isNewBest  = newBest > (prevBest ?? -1);

  // History entry
  const history    = [...(_userData?.desafioHistory || [])];
  const subjectMap = {};
  for (const a of _answers) {
    if (!a.isCorrect) {
      const s = a.question['Disciplina'] || '';
      subjectMap[s] = (subjectMap[s] || 0) + 1;
    }
  }
  history.push({ date: today, score, subjects: subjectMap });
  // Keep last 30 days
  const trimmed = history.slice(-30);

  // Mark correct wrong-answer questions as retried
  for (const a of _answers) {
    if (a.isCorrect && a.question._wrongRecordId) {
      markRetried(a.question._wrongRecordId).catch(e =>
        console.warn('[Desafio] markRetried:', e)
      );
    }
  }

  // Save to Firestore (direct — not a balance change)
  try {
    await updateDoc(doc(db, 'users', _user.uid), {
      lastDesafioDate:  today,
      desafioStreak:    newStreak,
      desafioBestScore: newBest,
      desafioHistory:   trimmed,
    });
    _userData = {
      ..._userData,
      lastDesafioDate:  today,
      desafioStreak:    newStreak,
      desafioBestScore: newBest,
      desafioHistory:   trimmed,
    };
  } catch (e) {
    console.warn('[Desafio] Firestore update:', e);
  }

  // Award Moedas via worker
  try {
    const result = await moeda.awardMoedas(
      _user.uid, moedasEarned, 'desafio_diario'
    );
    if (result.success) {
      _userData = { ..._userData, moedas: result.newBalance };
    }
  } catch (e) {
    console.warn('[Desafio] awardMoedas:', e);
  }

  // Confetti if score >= 60
  if (score >= 60) {
    setTimeout(_spawnConfetti, 400);
  }

  _renderResult({
    score, correct, total, moedasEarned, breakdown,
    newStreak, isNewBest, prevBest, newBest,
  });
}

// ============================================================
// RESULT STATE
// ============================================================

function _renderResult({ score, correct, total, moedasEarned, breakdown,
                          newStreak, isNewBest, prevBest, newBest }) {
  // Hide active
  document.getElementById('des-active-wrap').classList.remove('show');

  const resultWrap = document.getElementById('des-result-wrap');
  if (!resultWrap) return;
  resultWrap.classList.add('show');

  let ringClass = 'low';
  let title     = 'Continue a Tentar!';
  if (score === 100)    { ringClass = 'great'; title = 'Perfeição! Incrível! 🏆'; }
  else if (score >= 80) { ringClass = 'great'; title = 'Excelente! Muito Bem!'; }
  else if (score >= 60) { ringClass = 'good';  title = 'Bom Trabalho!'; }
  else if (score >= 40) { ringClass = 'fair';  title = 'Está a Melhorar!'; }

  const wrongAnswers = _answers.filter(a => !a.isCorrect);
  const inviteCode   = _userData?.inviteCode || '';

  // Moedas breakdown rows
  const breakdownHtml = breakdown.map(b => `
    <div class="des-moedas-row">
      <div class="des-moedas-row-label notranslate" translate="no">
        <i class="fa-solid fa-coins"></i>
        ${_esc(b.label)}
      </div>
      <div class="des-moedas-row-amount notranslate" translate="no">
        +${b.amount}
        <i class="fa-solid fa-coins" style="font-size:11px;"></i>
      </div>
    </div>
  `).join('');

  // Wrong answers review
  const wrongHtml = wrongAnswers.map((a, i) => {
    const q      = a.question;
    const qText  = (q['Enunciado'] || '').trim();
    const qShort = qText.length > 120 ? qText.slice(0, 117) + '...' : qText;
    const insightHtml = a.insight
      ? `<div class="des-wrong-insight notranslate" translate="no"
            id="des-result-insight-${i}">
            ${_esc(a.insight)}
          </div>`
      : `<div class="des-wrong-insight notranslate" translate="no"
            id="des-result-insight-${i}">
            <div class="des-wrong-insight-loading">
              <div class="des-wrong-insight-spin"></div>
              <span>A preparar…</span>
            </div>
          </div>`;

    return `
      <div class="des-wrong-item">
        <div class="des-wrong-inner">
          <div class="des-wrong-q-text notranslate" translate="no">
            ${_esc(qShort)}
          </div>
          <div class="des-wrong-answers">
            <span class="des-wrong-pill student notranslate" translate="no">
              <i class="fa-solid fa-xmark"></i>
              ${_esc(a.chosen)}
            </span>
            <span class="des-wrong-pill correct notranslate" translate="no">
              <i class="fa-solid fa-check"></i>
              ${_esc(a.correct)}
            </span>
          </div>
          ${insightHtml}
        </div>
      </div>
    `;
  }).join('');

  resultWrap.innerHTML = `
    <!-- HERO -->
    <div class="des-result-hero">
      <div class="des-score-ring ${ringClass}">
        <div class="des-score-pct notranslate" translate="no">${score}%</div>
        <div class="des-score-sub notranslate" translate="no">Score</div>
      </div>
      <div class="des-result-title notranslate" translate="no">${_esc(title)}</div>
      <div class="des-result-meta notranslate" translate="no">
        ${correct} de ${total} correctas · Desafio Diário
      </div>
      <div class="des-streak-result-badge notranslate" translate="no">
        <span class="fire">🔥</span>
        <span class="text">${newStreak} dia${newStreak !== 1 ? 's' : ''} seguido${newStreak !== 1 ? 's' : ''}</span>
      </div>
    </div>

    <!-- BODY -->
    <div class="des-result-body">

      <!-- Stats row -->
      <div class="des-stats-row">
        <div class="des-stat">
          <div class="des-stat-val c notranslate" translate="no">${correct}</div>
          <div class="des-stat-lbl notranslate" translate="no">Correctas</div>
        </div>
        <div class="des-stat">
          <div class="des-stat-val w notranslate" translate="no">
            ${total - correct}
          </div>
          <div class="des-stat-lbl notranslate" translate="no">Erradas</div>
        </div>
        <div class="des-stat">
          <div class="des-stat-val m notranslate" translate="no">
            +${moedasEarned}
          </div>
          <div class="des-stat-lbl notranslate" translate="no">Moedas</div>
        </div>
        <div class="des-stat">
          <div class="des-stat-val s notranslate" translate="no">
            ${newStreak}🔥
          </div>
          <div class="des-stat-lbl notranslate" translate="no">Streak</div>
        </div>
      </div>

      <!-- Personal best banner -->
      <div class="des-best-banner ${isNewBest ? 'show' : ''}" id="des-best-banner">
        <div class="des-best-icon">🏅</div>
        <div class="des-best-text">
          <div class="des-best-title notranslate" translate="no">
            Novo Recorde Pessoal!
          </div>
          <div class="des-best-sub notranslate" translate="no">
            ${prevBest !== null
              ? `Anterior: ${prevBest}% → Novo: ${newBest}%`
              : `Primeiro desafio completo: ${newBest}%`}
          </div>
        </div>
      </div>

      <!-- Moedas breakdown -->
      <div class="des-moedas-card">
        <div class="des-moedas-head notranslate" translate="no">
          <i class="fa-solid fa-coins" aria-hidden="true"></i>
          Moedas Ganhas Hoje
        </div>
        ${breakdownHtml}
        <div class="des-moedas-total">
          <div class="des-moedas-total-label notranslate" translate="no">
            Total
          </div>
          <div class="des-moedas-total-amount notranslate" translate="no">
            +${moedasEarned}
            <i class="fa-solid fa-coins" style="font-size:16px;"></i>
          </div>
        </div>
      </div>

      <!-- Wrong answers -->
      ${wrongAnswers.length ? `
        <div class="des-result-sec notranslate" translate="no">
          <i class="fa-solid fa-rotate" aria-hidden="true"></i>
          O que Errou — Aprenda Com Isto
        </div>
        ${wrongHtml}
      ` : `
        <div style="text-align:center;padding:20px 0 4px;">
          <div style="font-size:36px;margin-bottom:8px;">🎯</div>
          <div style="font-size:14px;font-weight:700;color:var(--text);"
            class="notranslate" translate="no">
            Sem erros hoje! Perfeito!
          </div>
        </div>
      `}

      <!-- CTAs -->
      <div class="des-cta-section">

        <button class="des-btn-primary notranslate" translate="no"
          id="des-btn-simulacao">
          <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
          Fazer uma Simulação
        </button>

        <button class="des-btn-secondary notranslate" translate="no"
          id="des-btn-dashboard">
          <i class="fa-solid fa-house" aria-hidden="true"></i>
          Ir para o Painel
        </button>

        <div class="des-cta-divider">
          <div class="des-cta-divider-line"></div>
          <div class="des-cta-divider-lbl">Partilha o teu resultado</div>
          <div class="des-cta-divider-line"></div>
        </div>

        <button class="des-btn-share notranslate" translate="no"
          id="des-btn-share">
          <i class="fa-brands fa-whatsapp" aria-hidden="true"></i>
          Partilhar no WhatsApp
        </button>

      </div>

    </div>
  `;

  // Wire buttons
  document.getElementById('des-btn-simulacao')
    ?.addEventListener('click', () => router.navigate('/panel/simulacao'), { once: true });

  document.getElementById('des-btn-dashboard')
    ?.addEventListener('click', () => router.navigate('/panel/dashboard'), { once: true });

  document.getElementById('des-btn-share')
    ?.addEventListener('click', () => {
      const streakEmoji = newStreak >= 30 ? '🏆' : newStreak >= 7 ? '🔥' : '📚';
      const msg = encodeURIComponent(
        `${streakEmoji} Completei o Desafio Diário no ExameNova!\n` +
        `📊 Resultado: ${score}% — ${newStreak} dia${newStreak !== 1 ? 's' : ''} seguido${newStreak !== 1 ? 's' : ''}!\n` +
        `Junta-te a mim: https://examenova.dovelingua.com/plataforma/convite/${inviteCode}`
      );
      window.open(`https://wa.me/?text=${msg}`, '_blank');
    });

  // Render math in wrong answers
  document.querySelectorAll('.des-wrong-q-text, .des-wrong-insight').forEach(el => {
    _renderMath(el);
  });

  // Fetch insights for wrong answers that don't have them yet
  // (may already be cached from the active question phase)
  wrongAnswers.forEach((a, i) => {
    if (!a.insight) {
      _fetchInsightForResult(a.question, i);
    } else {
      // Already have it — render math
      const el = document.getElementById(`des-result-insight-${i}`);
      if (el) _renderMath(el);
    }
  });

  window.scrollTo({ top: 0, behavior: 'instant' });
  _moedaToast(moedasEarned, 'Desafio Diário');
}

async function _fetchInsightForResult(q, idx) {
  const cacheKey = q['_id'] || q['Nº'] + (q['Ano'] || '');
  if (_insightCache[cacheKey]) {
    const el = document.getElementById(`des-result-insight-${idx}`);
    if (el) {
      el.textContent = _insightCache[cacheKey];
      _renderMath(el);
    }
    return;
  }

  // Reuse same fetch logic
  const lang       = _questionLang(q);
  const disciplina = (q['Disciplina'] || '').trim();
  const classe     = (q['Classe']     || '').trim();
  const enunciado  = (q['Enunciado']  || '').slice(0, 150);
  const correct    = _correctText(q);
  const tipo       = (q['Tipo'] || '').trim();
  const dbExpl     = (q['Explicação']        || '').slice(0, 80);
  const dbRespPoss = (q['Resposta_Possível'] || '').slice(0, 80);

  const langInstr = lang === 'en'
    ? 'Reply in simple English (B1 level).'
    : lang === 'fr'
    ? 'Réponds en français simple (niveau B1).'
    : 'Responde em Português simples e directo.';

  const prompt = `Respond immediately with the answer only. No thinking. No reasoning steps.\n${langInstr}
Disciplina: ${disciplina}${classe ? ', ' + classe : ''}.
Questão: ${enunciado}
${tipo === 'verdadeiro-falso' ? '' : `Resposta correcta: ${correct}`}
${dbExpl      ? `Explicação oficial: ${dbExpl}`  : ''}
${dbRespPoss  ? `Referência: ${dbRespPoss}`       : ''}

Escreve UMA frase curta (máximo 25 palavras) que explique O PORQUÊ da resposta correcta estar certa. Vai directo ao facto. Sem introdução. Sem asteriscos.`;

  try {
    const messages = [
      { role: 'user', content: prompt },
    ];
    const raw     = await worker.callAI(messages, { maxTokens: 600, temperature: 0.25 });
    const insight = (raw || '').trim().replace(/\*\*/g, '').replace(/\*/g, '');
    _insightCache[cacheKey] = insight;
    const el = document.getElementById(`des-result-insight-${idx}`);
    if (el) {
      el.textContent = insight;
      _renderMath(el);
    }
  } catch (e) {
    console.warn('[Desafio] result insight:', e);
    const el = document.getElementById(`des-result-insight-${idx}`);
    if (el) el.textContent = '—';
  }
}

// ============================================================
// EXPORT
// ============================================================

export default DesafioScreen;
