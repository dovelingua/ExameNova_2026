// ============================================================
// panel/js/screens/revisao/revisao.js
// ExameNova — Revisão de Erros Screen v2.0
//
// CHANGES v2.0:
//   - Correct answer NEVER revealed — student must find it
//   - Wrong answer after explanation → -1 Moeda penalty
//   - Correct without Mentor → +2 Moedas reward
//   - Correct with Mentor → +1 Moeda reward
//   - Mentor cost: 2 Moedas (COSTS.REVISAO_MENTOR)
//   - Mentor system prompt: Socratic, never reveals answer,
//     uses student level language, confirms correct answers
//     from student, never confirms wrong ones
//   - AI messages: formatted HTML (bold, paragraphs, no asterisks)
//   - Mentor explanation: teaches concept, never reveals answer
//   - Moeda transaction toasts: hardcoded inline, no imports
//   - Scroll fix: focus always starts at top
//   - Explanation never reveals correct answer
//
// ARCHITECTURE:
//   Three states inside one screen — no render screen needed:
//     'list'   — subject selector + wrong answer cards
//     'focus'  — single question with AI explanation + retry
//     'mentor' — inline AI chat embedded in focus
//
// DATA FLOW:
//   1. Student selects subject
//   2. getWrongAnswers() fetches 10 most recent records (noCache)
//   3. Each record has questionData snapshot — no re-fetch needed
//   4. Mentor open: fetchQuestion() gets live DB record for context
//   5. AI never receives the correct answer in explanation prompt
//      Mentor receives it only to validate student's chat answer
//      without confirming or denying wrong guesses
//
// MOEDAS:
//   Revisão list view: FREE
//   Mentor chat: 2 Moedas per question session (on first message)
//   Wrong answer after explanation: -1 Moeda
//   Correct without Mentor: +2 Moedas
//   Correct with Mentor: +1 Moeda
//   All transactions show inline toast notification
//
// keepAlive: false | Navbar: absent | Header: back to dashboard
// ============================================================

import { router }  from '../../core/router.js';
import { ui }      from '../../core/ui.js';
import { moeda }   from '../../core/moeda.js';
import { worker }  from '../../core/worker.js';
import {
  getWrongAnswers,
  markRetried,
  fetchQuestion,
  getOptions,
  normaliseYear,
  toDbSubject,
} from '../../core/exams.js';
import { getStudentSubjects } from '../../core/app.js';

// ── Constants ─────────────────────────────────────────────────
const WRONG_LIMIT    = 10;
const MAX_CHAT_TURNS = 10;

// ── Module state ───────────────────────────────────────────────
let _user             = null;
let _userData         = null;
let _subjects         = [];
let _activeSubject    = '';
let _records          = [];
let _state            = 'list';
let _focusRecord      = null;
let _liveQuestion     = null;
let _chatHistory      = [];
let _mentorPaid       = false;
let _mentorOpen       = false;
let _mentorCalled     = false; // tracks if Mentor was used this question
let _isSending        = false;
let _hasAnswered      = false; // tracks if student has answered in focus
let _explanationDone  = false; // true once AI explanation loaded
let _explanationCache = {};

// ── KaTeX ──────────────────────────────────────────────────────
function _renderMath(el) {
  if (!el || typeof window.renderMathInElement !== 'function') return;
  try {
    window.renderMathInElement(el, {
      delimiters: [
        { left: '$$', right: '$$', display: true  },
        { left: '$',  right: '$',  display: false },
      ],
      throwOnError: false,
    });
  } catch (e) {}
}

// ── Format AI markdown → clean HTML (no asterisks ever) ────────
function _formatAI(text) {
  if (!text) return '';
  return text
    // Bold: **word** or __word__
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g,     '<strong>$1</strong>')
    // Italic: *word* or _word_ — convert to em, not asterisk
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g,   '<em>$1</em>')
    // Strip any remaining stray asterisks
    .replace(/\*/g, '')
    // Paragraph breaks
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br>')
    // Wrap
    .replace(/^/, '<p>')
    .replace(/$/, '</p>');
}

// ── HTML escape ────────────────────────────────────────────────
function _esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

// ── Inline Moeda toast ─────────────────────────────────────────
// Hardcoded here — no import — avoids any dependency issue.
function _moedaToast(type, amount, reason) {
  // type: 'gain' | 'loss'
  const existing = document.getElementById('rev-moeda-toast');
  if (existing) existing.remove();

  const isGain = type === 'gain';
  const sign   = isGain ? '+' : '−';
  const color  = isGain ? '#16A34A' : '#DC2626';
  const bg     = isGain ? 'rgba(22,163,74,0.10)' : 'rgba(220,38,38,0.09)';
  const border = isGain ? 'rgba(22,163,74,0.25)' : 'rgba(220,38,38,0.22)';
  const icon   = isGain ? 'fa-circle-plus' : 'fa-circle-minus';

  const toast = document.createElement('div');
  toast.id = 'rev-moeda-toast';
  toast.setAttribute('translate', 'no');
  toast.className = 'notranslate';
  toast.style.cssText = `
    position: fixed;
    top: 72px;
    left: 50%;
    transform: translateX(-50%) translateY(-12px);
    z-index: 9999;
    display: flex;
    align-items: center;
    gap: 9px;
    background: ${bg};
    border: 1.5px solid ${border};
    border-radius: 99px;
    padding: 9px 18px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.12);
    font-family: inherit;
    font-size: 13px;
    font-weight: 700;
    color: ${color};
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.25s ease, transform 0.25s ease;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  `;
  toast.innerHTML = `
    <i class="fa-solid ${icon}" style="font-size:15px;"></i>
    <span>${sign}${amount} Moeda${amount !== 1 ? 's' : ''}</span>
    <span style="font-weight:500;opacity:0.75;font-size:11px;">· ${_esc(reason)}</span>
  `;

  document.body.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });

  // Auto dismiss
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(-10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ── Relative date ──────────────────────────────────────────────
function _relativeDate(ts) {
  if (!ts) return '';
  const d    = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  if (diff < 7)   return `Há ${diff} dias`;
  return d.toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' });
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

// ── Student level label for AI ─────────────────────────────────
function _studentLevel() {
  const t = _userData?.examType;
  const g = _userData?.grade;
  if (t === 'ensino-geral') {
    if (g === '9')  return '9ª Classe (equivalente 10ª, nível básico-intermédio)';
    if (g === '12') return '12ª Classe (nível secundário avançado)';
  }
  if (t === 'admissao') {
    const inst = _userData?.institution || '';
    const course = _userData?.course || '';
    return `Exame de Admissão — ${(inst || course).toUpperCase()} (nível pré-universitário)`;
  }
  return 'Ensino Secundário';
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

// ── Correct answer text ────────────────────────────────────────
function _correctText(q) {
  return (q?.['Resposta'] || '').trim() || '';
}

// ============================================================
// SCREEN OBJECT
// ============================================================

const RevisaoScreen = {

  css() {
    if (document.getElementById('rev-styles')) return '';
    return `<style id="rev-styles">

      /* ── BASE ── */
      .rev-wrap {
        min-height: 100dvh;
        background: var(--bg);
        padding-bottom: 40px;
      }

      /* ── PROFILE STRIP ── */
      .rev-strip {
        background: var(--surface);
        border-bottom: 1px solid var(--border);
        padding: 8px 16px;
        display: flex;
        align-items: center;
        gap: 7px;
      }
      .rev-strip i { font-size: 11px; color: var(--secondary); }
      .rev-strip-text {
        font-size: 12px; font-weight: 700;
        color: var(--text-secondary); letter-spacing: 0.01em;
      }

      /* ── SUBJECT PILLS ── */
      .rev-subject-scroll {
        display: flex; gap: 8px;
        padding: 16px 16px 4px;
        overflow-x: auto; scrollbar-width: none;
        -webkit-overflow-scrolling: touch;
        scroll-snap-type: x mandatory;
      }
      .rev-subject-scroll::-webkit-scrollbar { display: none; }

      .rev-subject-pill {
        display: flex; align-items: center; gap: 7px;
        padding: 9px 16px;
        border-radius: var(--radius-full);
        border: 1.5px solid var(--border);
        background: var(--surface);
        font-family: inherit; font-size: 13px; font-weight: 700;
        color: var(--text-secondary); cursor: pointer;
        white-space: nowrap; scroll-snap-align: start;
        transition: all 0.18s;
        -webkit-tap-highlight-color: transparent; flex-shrink: 0;
      }
      .rev-subject-pill i { font-size: 12px; }
      .rev-subject-pill:active { transform: scale(0.95); }
      .rev-subject-pill.active {
        border-color: var(--secondary);
        background: rgba(139,92,246,0.09);
        color: var(--secondary);
      }

      /* ── SECTION HEADER ── */
      .rev-section-hdr {
        display: flex; align-items: center; justify-content: space-between;
        padding: 20px 16px 10px;
      }
      .rev-section-title {
        font-size: 13px; font-weight: 800; color: var(--text);
        display: flex; align-items: center; gap: 7px;
      }
      .rev-section-title i { font-size: 12px; color: var(--secondary); }
      .rev-section-count {
        font-size: 11px; font-weight: 700; color: var(--text-muted);
        background: var(--bg); border: 1px solid var(--border);
        border-radius: var(--radius-full); padding: 2px 10px;
      }

      /* ── FILTER TABS ── */
      .rev-filter-row {
        display: flex; gap: 6px; padding: 0 16px 14px;
      }
      .rev-filter-btn {
        padding: 6px 14px;
        border-radius: var(--radius-full);
        border: 1.5px solid var(--border);
        background: var(--surface); font-family: inherit;
        font-size: 12px; font-weight: 700;
        color: var(--text-muted); cursor: pointer;
        transition: all 0.15s;
        -webkit-tap-highlight-color: transparent;
      }
      .rev-filter-btn.active {
        border-color: var(--secondary);
        background: rgba(139,92,246,0.09);
        color: var(--secondary);
      }
      .rev-filter-btn:active { transform: scale(0.95); }

      /* ── SKELETON ── */
      .rev-skeleton-list { padding: 0 16px; }
      .rev-skeleton-card {
        height: 96px; background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        margin-bottom: 10px; overflow: hidden; position: relative;
      }
      .rev-skeleton-card::after {
        content: ''; position: absolute; inset: 0;
        background: linear-gradient(90deg,
          transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%);
        animation: revShimmer 1.4s infinite;
      }
      [data-theme="dark"] .rev-skeleton-card::after {
        background: linear-gradient(90deg,
          transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%);
      }
      @keyframes revShimmer {
        from { transform: translateX(-100%); }
        to   { transform: translateX(100%); }
      }

      /* ── WRONG ANSWER CARD ── */
      .rev-list { padding: 0 16px; }

      .rev-card {
        background: var(--surface);
        border: 1.5px solid var(--border);
        border-radius: var(--radius-lg);
        margin-bottom: 10px; overflow: hidden;
        cursor: pointer;
        transition: border-color 0.18s, transform 0.12s;
        -webkit-tap-highlight-color: transparent;
        position: relative;
      }
      .rev-card::before {
        content: ''; position: absolute;
        left: 0; top: 0; bottom: 0; width: 4px;
        background: var(--secondary);
      }
      .rev-card.resolved::before { background: #22C55E; }
      .rev-card:active  { transform: scale(0.984); }
      .rev-card:hover   { border-color: var(--secondary); }
      .rev-card.resolved:hover { border-color: #22C55E; }

      .rev-card-inner {
        padding: 13px 14px 13px 18px;
        display: flex; align-items: flex-start; gap: 12px;
      }
      .rev-card-icon {
        width: 38px; height: 38px;
        border-radius: var(--radius-md);
        background: rgba(139,92,246,0.09);
        display: flex; align-items: center; justify-content: center;
        font-size: 16px; color: var(--secondary);
        flex-shrink: 0; margin-top: 1px;
      }
      .rev-card.resolved .rev-card-icon {
        background: rgba(34,197,94,0.09); color: #22C55E;
      }
      .rev-card-body { flex: 1; min-width: 0; }
      .rev-card-meta {
        display: flex; align-items: center;
        gap: 6px; margin-bottom: 4px; flex-wrap: wrap;
      }
      .rev-card-topic {
        font-size: 10px; font-weight: 700;
        color: var(--secondary);
        background: rgba(139,92,246,0.08);
        border-radius: var(--radius-full); padding: 2px 8px;
      }
      .rev-card.resolved .rev-card-topic {
        color: #22C55E; background: rgba(34,197,94,0.08);
      }
      .rev-card-date {
        font-size: 10px; font-weight: 600; color: var(--text-muted);
      }
      .rev-card-context {
        font-size: 10px; font-weight: 600; color: var(--text-muted);
        background: var(--bg); border: 1px solid var(--border);
        border-radius: var(--radius-full); padding: 1px 7px;
      }
      .rev-card-question {
        font-size: 13px; font-weight: 600; color: var(--text);
        line-height: 1.5;
        display: -webkit-box; -webkit-line-clamp: 2;
        -webkit-box-orient: vertical; overflow: hidden;
        margin-bottom: 6px;
      }
      .rev-card-answer-row {
        display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
      }
      .rev-card-resolved-badge {
        display: none; align-items: center; gap: 5px;
        font-size: 10px; font-weight: 700; color: #22C55E;
      }
      .rev-card.resolved .rev-card-resolved-badge { display: flex; }
      .rev-card-arrow {
        font-size: 11px; color: var(--text-muted);
        flex-shrink: 0; margin-top: 10px;
      }

      /* ── EMPTY / CHOOSE STATE ── */
      .rev-empty {
        padding: 60px 24px;
        display: flex; flex-direction: column;
        align-items: center; gap: 12px; text-align: center;
      }
      .rev-empty-icon {
        width: 64px; height: 64px; border-radius: 50%;
        background: rgba(139,92,246,0.09);
        display: flex; align-items: center; justify-content: center;
        font-size: 26px; color: var(--secondary); margin-bottom: 4px;
      }
      .rev-empty-title {
        font-size: 16px; font-weight: 800; color: var(--text);
      }
      .rev-empty-sub {
        font-size: 13px; color: var(--text-muted);
        line-height: 1.55; max-width: 260px;
      }
      .rev-choose {
        padding: 48px 24px;
        display: flex; flex-direction: column;
        align-items: center; gap: 10px; text-align: center;
      }
      .rev-choose-icon {
        font-size: 40px; color: var(--secondary);
        opacity: 0.4; margin-bottom: 8px;
      }
      .rev-choose-text {
        font-size: 14px; font-weight: 600;
        color: var(--text-muted); line-height: 1.55;
      }

      /* ============================================================
         FOCUS STATE
         ============================================================ */

      .rev-focus {
        display: none;
        padding: 16px 16px 40px;
        max-width: 700px; margin: 0 auto;
      }
      .rev-focus.show { display: block; }

      .rev-focus-nav {
        display: flex; align-items: center;
        justify-content: space-between;
        margin-bottom: 20px; gap: 10px;
      }
      .rev-focus-back {
        display: flex; align-items: center; gap: 7px;
        font-size: 13px; font-weight: 700; color: var(--text-muted);
        background: none; border: none; font-family: inherit;
        cursor: pointer; padding: 8px 0;
        -webkit-tap-highlight-color: transparent;
        transition: color 0.15s;
      }
      .rev-focus-back:hover { color: var(--secondary); }
      .rev-focus-pos {
        font-size: 12px; font-weight: 700; color: var(--text-muted);
        background: var(--surface); border: 1px solid var(--border);
        border-radius: var(--radius-full); padding: 4px 12px;
        white-space: nowrap;
      }

      .rev-focus-meta {
        display: flex; align-items: center;
        gap: 7px; flex-wrap: wrap; margin-bottom: 14px;
      }
      .rev-focus-badge {
        font-size: 10px; font-weight: 700;
        border-radius: var(--radius-full); padding: 3px 10px;
      }
      .rev-focus-badge.subject {
        color: var(--secondary); background: rgba(139,92,246,0.1);
        border: 1px solid rgba(139,92,246,0.2);
      }
      .rev-focus-badge.topic {
        color: var(--primary); background: var(--primary-light);
        border: 1px solid rgba(2,132,199,0.2);
      }
      .rev-focus-badge.year {
        color: var(--text-muted); background: var(--surface);
        border: 1px solid var(--border);
      }

      /* Study mode label */
      .rev-study-label {
        display: flex; align-items: center; gap: 8px;
        padding: 10px 14px;
        background: rgba(139,92,246,0.06);
        border: 1px solid rgba(139,92,246,0.18);
        border-radius: var(--radius-md);
        margin-bottom: 16px;
        font-size: 12px; font-weight: 600;
        color: var(--secondary); line-height: 1.4;
      }
      .rev-study-label i { font-size: 13px; flex-shrink: 0; }

      /* Explanation card */
      .rev-expl-card {
        background: var(--surface);
        border: 1.5px solid rgba(139,92,246,0.25);
        border-left: 4px solid var(--secondary);
        border-radius: var(--radius-lg);
        margin-bottom: 20px; overflow: hidden;
      }
      .rev-expl-head {
        padding: 12px 16px 10px;
        background: rgba(139,92,246,0.04);
        border-bottom: 1px solid rgba(139,92,246,0.12);
        display: flex; align-items: center; gap: 9px;
      }
      .rev-expl-head-icon {
        width: 30px; height: 30px; border-radius: var(--radius-md);
        background: rgba(139,92,246,0.12);
        display: flex; align-items: center; justify-content: center;
        font-size: 13px; color: var(--secondary); flex-shrink: 0;
      }
      .rev-expl-head-title {
        font-size: 13px; font-weight: 800; color: var(--text);
      }
      .rev-expl-head-sub {
        font-size: 11px; color: var(--text-muted); margin-top: 1px;
      }
      .rev-expl-body {
        padding: 16px;
        font-size: 14px; color: var(--text-secondary);
        line-height: 1.8;
      }
      .rev-expl-body p { margin: 0 0 10px 0; }
      .rev-expl-body p:last-child { margin-bottom: 0; }
      .rev-expl-loading {
        display: flex; align-items: center; gap: 10px;
        padding: 20px 16px;
        font-size: 13px; color: var(--text-muted);
      }
      .rev-expl-spin {
        width: 18px; height: 18px;
        border: 2.5px solid var(--border);
        border-top-color: var(--secondary); border-radius: 50%;
        animation: revSpin 0.75s linear infinite; flex-shrink: 0;
      }

      /* Question card */
      .rev-q-card {
        background: var(--surface);
        border: 1.5px solid var(--border);
        border-radius: var(--radius-lg);
        margin-bottom: 16px; overflow: hidden;
      }
      .rev-q-figure {
        margin: 14px 16px 0;
        background: rgba(2,132,199,0.04);
        border: 1.5px dashed var(--border);
        border-radius: var(--radius-md);
        padding: 12px 14px;
        display: flex; align-items: flex-start; gap: 10px;
        font-size: 13px; color: var(--text-secondary);
        line-height: 1.6; font-style: italic;
      }
      .rev-q-figure i {
        color: var(--primary); font-size: 16px;
        flex-shrink: 0; margin-top: 2px;
      }
      .rev-q-text {
        padding: 16px;
        font-size: 15px; font-weight: 600;
        color: var(--text); line-height: 1.7;
      }

      /* MC options */
      .rev-options {
        display: flex; flex-direction: column;
        gap: 8px; padding: 0 14px 16px;
      }
      .rev-option {
        display: flex; align-items: flex-start; gap: 11px;
        background: var(--bg);
        border: 1.5px solid var(--border);
        border-radius: var(--radius-lg);
        padding: 13px 14px; cursor: pointer;
        transition: all 0.15s; text-align: left;
        width: 100%; font-family: inherit; min-height: 48px;
        -webkit-tap-highlight-color: transparent;
      }
      .rev-option:hover:not(.locked) {
        border-color: var(--secondary);
        background: rgba(139,92,246,0.05);
        transform: translateX(2px);
      }
      .rev-option:active:not(.locked) { transform: scale(0.99); }
      .rev-option.locked  { cursor: default; }
      /* Correct reveal — only shown AFTER student picks correct */
      .rev-option.correct-reveal {
        border-color: #22C55E;
        background: rgba(34,197,94,0.07);
      }
      /* Wrong reveal — only dims the wrong pick, nothing else */
      .rev-option.wrong-reveal {
        border-color: #EF4444;
        background: rgba(239,68,68,0.06);
        opacity: 0.72;
      }
      /* Selected before locking */
      .rev-option.selected {
        border-color: var(--secondary);
        background: rgba(139,92,246,0.06);
      }
      .rev-opt-circle {
        width: 28px; height: 28px; border-radius: 50%;
        background: var(--surface); border: 1.5px solid var(--border);
        display: flex; align-items: center; justify-content: center;
        font-size: 11px; font-weight: 800; color: var(--text-muted);
        flex-shrink: 0; margin-top: 1px; transition: all 0.15s;
      }
      .rev-option.selected .rev-opt-circle {
        background: var(--secondary); border-color: var(--secondary); color: #fff;
      }
      .rev-option.correct-reveal .rev-opt-circle {
        background: #22C55E; border-color: #22C55E; color: #fff;
      }
      .rev-option.wrong-reveal .rev-opt-circle {
        background: #EF4444; border-color: #EF4444; color: #fff;
      }
      .rev-opt-text {
        font-size: 14px; color: var(--text);
        line-height: 1.55; flex: 1; padding-top: 3px;
      }

      /* TF options */
      .rev-tf-options {
        display: grid; grid-template-columns: 1fr 1fr;
        gap: 10px; padding: 0 14px 16px;
      }
      .rev-tf-btn {
        padding: 18px 10px; border-radius: var(--radius-lg);
        border: 1.5px solid var(--border); background: var(--bg);
        font-family: inherit; font-size: 14px; font-weight: 700;
        color: var(--text-secondary); cursor: pointer;
        display: flex; flex-direction: column; align-items: center;
        gap: 7px; transition: all 0.15s; min-height: 80px;
        justify-content: center;
        -webkit-tap-highlight-color: transparent;
      }
      .rev-tf-btn i { font-size: 22px; }
      .rev-tf-btn.v:hover:not(.locked) {
        border-color: #22C55E; background: rgba(34,197,94,0.07); color: #22C55E;
      }
      .rev-tf-btn.f:hover:not(.locked) {
        border-color: #EF4444; background: rgba(239,68,68,0.07); color: #EF4444;
      }
      .rev-tf-btn.correct-reveal {
        border-color: #22C55E; background: rgba(34,197,94,0.07); color: #22C55E;
      }
      .rev-tf-btn.wrong-reveal {
        border-color: #EF4444; background: rgba(239,68,68,0.07); color: #EF4444;
        opacity: 0.7;
      }
      .rev-tf-btn.locked { cursor: default; }
      .rev-tf-btn:active:not(.locked) { transform: scale(0.97); }

      /* Feedback strip */
      .rev-feedback {
        display: none; align-items: flex-start; gap: 10px;
        padding: 14px 16px;
        border-radius: var(--radius-md);
        margin: 0 14px 16px;
        font-size: 13px; font-weight: 600; line-height: 1.55;
      }
      .rev-feedback.show { display: flex; }
      .rev-feedback.correct {
        background: rgba(34,197,94,0.08);
        border: 1px solid rgba(34,197,94,0.25);
        color: #16A34A;
      }
      .rev-feedback.wrong {
        background: rgba(239,68,68,0.07);
        border: 1px solid rgba(239,68,68,0.22);
        color: #DC2626;
      }
      .rev-feedback i { font-size: 14px; flex-shrink: 0; margin-top: 1px; }

      /* Action row */
      .rev-action-row {
        display: flex; gap: 10px; margin-top: 8px;
      }
      .rev-btn-mentor {
        flex: 1; padding: 14px;
        border-radius: var(--radius-lg);
        border: 1.5px solid rgba(139,92,246,0.3);
        background: rgba(139,92,246,0.06);
        font-family: inherit; font-size: 13px; font-weight: 700;
        color: var(--secondary); cursor: pointer;
        display: flex; align-items: center; justify-content: center; gap: 8px;
        transition: all 0.18s; min-height: 50px;
        -webkit-tap-highlight-color: transparent;
      }
      .rev-btn-mentor:hover:not(:disabled) {
        background: rgba(139,92,246,0.12); border-color: var(--secondary);
      }
      .rev-btn-mentor:active:not(:disabled) { transform: scale(0.97); }
      .rev-btn-mentor:disabled { opacity: 0.38; cursor: not-allowed; }
      .rev-mentor-cost-pill {
        font-size: 10px; font-weight: 700; color: var(--moeda);
        background: var(--moeda-light); border-radius: var(--radius-full);
        padding: 2px 7px;
        display: inline-flex; align-items: center; gap: 3px;
      }
      .rev-btn-resolve {
        flex: 1; padding: 14px;
        border-radius: var(--radius-lg); border: none;
        background: linear-gradient(135deg, #16A34A 0%, #22C55E 100%);
        font-family: inherit; font-size: 13px; font-weight: 700;
        color: #fff; cursor: pointer;
        display: flex; align-items: center; justify-content: center; gap: 8px;
        transition: opacity 0.18s, transform 0.15s; min-height: 50px;
        box-shadow: 0 3px 12px rgba(34,197,94,0.25);
        -webkit-tap-highlight-color: transparent;
      }
      .rev-btn-resolve:hover  { opacity: 0.9; }
      .rev-btn-resolve:active { transform: scale(0.97); }
      .rev-btn-resolve.hidden { display: none; }

      .rev-btn-next {
        width: 100%; padding: 15px;
        border-radius: var(--radius-lg); border: none;
        background: linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%);
        font-family: inherit; font-size: 14px; font-weight: 700;
        color: #fff; cursor: pointer;
        display: none; align-items: center; justify-content: center; gap: 9px;
        transition: opacity 0.18s, transform 0.15s; min-height: 52px;
        margin-top: 12px;
        box-shadow: 0 3px 14px rgba(139,92,246,0.3);
        -webkit-tap-highlight-color: transparent;
      }
      .rev-btn-next.show  { display: flex; }
      .rev-btn-next:hover  { opacity: 0.9; }
      .rev-btn-next:active { transform: scale(0.97); }

      /* ============================================================
         MENTOR PANEL
         ============================================================ */

      .rev-mentor-panel {
        display: none; flex-direction: column;
        background: var(--surface);
        border: 1.5px solid rgba(139,92,246,0.3);
        border-radius: var(--radius-lg);
        overflow: hidden; margin-top: 16px;
      }
      .rev-mentor-panel.show { display: flex; }

      .rev-mentor-head {
        padding: 12px 16px;
        background: rgba(139,92,246,0.06);
        border-bottom: 1px solid rgba(139,92,246,0.15);
        display: flex; align-items: center; gap: 10px;
      }
      .rev-mentor-head-icon {
        width: 32px; height: 32px; border-radius: var(--radius-md);
        background: rgba(139,92,246,0.15);
        display: flex; align-items: center; justify-content: center;
        font-size: 14px; color: var(--secondary); flex-shrink: 0;
      }
      .rev-mentor-head-info { flex: 1; min-width: 0; }
      .rev-mentor-head-title {
        font-size: 13px; font-weight: 800; color: var(--text);
      }
      .rev-mentor-head-sub {
        font-size: 10px; color: var(--text-muted); margin-top: 1px;
      }
      .rev-mentor-close {
        width: 30px; height: 30px; border-radius: 50%;
        background: var(--bg); border: 1.5px solid var(--border);
        color: var(--text-muted); font-size: 13px;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; transition: all 0.15s; flex-shrink: 0;
        font-family: inherit;
      }
      .rev-mentor-close:hover { border-color: var(--secondary); color: var(--secondary); }

      .rev-mentor-cost-notice {
        padding: 9px 16px;
        background: rgba(255,179,0,0.06);
        border-bottom: 1px solid rgba(255,179,0,0.15);
        display: flex; align-items: center; gap: 8px;
        font-size: 11px; font-weight: 600;
        color: #92400E;
      }
      [data-theme="dark"] .rev-mentor-cost-notice { color: #FDE68A; }
      .rev-mentor-cost-notice i { color: var(--moeda); font-size: 12px; }
      .rev-mentor-cost-notice.hidden { display: none; }

      .rev-mentor-messages {
        flex: 1; overflow-y: auto;
        padding: 14px 14px 8px;
        display: flex; flex-direction: column; gap: 10px;
        min-height: 180px; max-height: 320px;
        -webkit-overflow-scrolling: touch;
      }

      .rev-msg {
        max-width: 90%; font-size: 13px;
        line-height: 1.65; border-radius: 14px;
        padding: 10px 13px; word-break: break-word;
        animation: revMsgIn 0.22s ease both;
      }
      .rev-msg.user {
        align-self: flex-end;
        background: var(--secondary); color: #fff;
        border-bottom-right-radius: 4px;
      }
      .rev-msg.ai {
        align-self: flex-start;
        background: var(--bg); color: var(--text);
        border: 1px solid var(--border);
        border-bottom-left-radius: 4px;
      }
      .rev-msg.ai p { margin: 0 0 8px 0; }
      .rev-msg.ai p:last-child { margin-bottom: 0; }
      .rev-msg.ai strong { color: var(--text); font-weight: 700; }
      .rev-msg.typing {
        align-self: flex-start;
        background: var(--bg); border: 1px solid var(--border);
        padding: 12px 16px; border-bottom-left-radius: 4px;
      }
      .rev-typing-dots {
        display: flex; gap: 4px; align-items: center;
      }
      .rev-typing-dots span {
        width: 7px; height: 7px; border-radius: 50%;
        background: var(--text-muted); animation: revDot 1.2s infinite;
      }
      .rev-typing-dots span:nth-child(2) { animation-delay: 0.2s; }
      .rev-typing-dots span:nth-child(3) { animation-delay: 0.4s; }

      .rev-mentor-input-row {
        display: flex; align-items: flex-end; gap: 8px;
        padding: 10px 12px 12px;
        border-top: 1px solid var(--border); background: var(--surface);
      }
      .rev-mentor-textarea {
        flex: 1; background: var(--bg);
        border: 1.5px solid var(--border);
        border-radius: var(--radius-md);
        padding: 10px 12px; font-family: inherit;
        font-size: 13px; color: var(--text);
        outline: none; resize: none;
        min-height: 42px; max-height: 100px; line-height: 1.5;
        transition: border-color 0.2s;
      }
      .rev-mentor-textarea::placeholder { color: var(--text-muted); }
      .rev-mentor-textarea:focus {
        border-color: var(--secondary);
        box-shadow: 0 0 0 3px rgba(139,92,246,0.1);
      }
      .rev-mentor-send {
        width: 42px; height: 42px; border-radius: 50%;
        background: var(--secondary); border: none;
        color: #fff; font-size: 15px;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; flex-shrink: 0;
        transition: opacity 0.15s, transform 0.12s; font-family: inherit;
      }
      .rev-mentor-send:hover:not(:disabled)  { opacity: 0.88; }
      .rev-mentor-send:active:not(:disabled) { transform: scale(0.93); }
      .rev-mentor-send:disabled { opacity: 0.35; cursor: not-allowed; }

      .rev-btn-understood {
        width: calc(100% - 24px); margin: 0 12px 12px;
        padding: 11px; border-radius: var(--radius-md);
        border: 1.5px solid rgba(139,92,246,0.3);
        background: rgba(139,92,246,0.06);
        font-family: inherit; font-size: 13px; font-weight: 700;
        color: var(--secondary); cursor: pointer;
        display: flex; align-items: center; justify-content: center; gap: 7px;
        transition: all 0.15s; min-height: 44px;
        -webkit-tap-highlight-color: transparent;
      }
      .rev-btn-understood:hover  { background: rgba(139,92,246,0.12); }
      .rev-btn-understood:active { transform: scale(0.97); }

      /* ── DARK ── */
      [data-theme="dark"] .rev-card,
      [data-theme="dark"] .rev-q-card,
      [data-theme="dark"] .rev-expl-card { background: var(--bg-card); }
      [data-theme="dark"] .rev-option,
      [data-theme="dark"] .rev-tf-btn    { background: var(--bg); }
      [data-theme="dark"] .rev-mentor-panel { background: var(--bg-card); }
      [data-theme="dark"] .rev-msg.ai    { background: var(--bg); }

      /* ── ANIMATIONS ── */
      @keyframes revSpin {
        to { transform: rotate(360deg); }
      }
      @keyframes revMsgIn {
        from { opacity: 0; transform: translateY(6px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @keyframes revDot {
        0%, 60%, 100% { transform: translateY(0);   opacity: 0.4; }
        30%            { transform: translateY(-5px); opacity: 1;   }
      }

      /* ── RESPONSIVE ── */
      @media (min-width: 768px) {
        .rev-list, .rev-focus { padding: 0 24px 40px; }
        .rev-subject-scroll   { padding: 16px 24px 4px; }
        .rev-section-hdr      { padding: 20px 24px 10px; }
        .rev-filter-row       { padding: 0 24px 14px; }
      }
      @media (min-width: 1025px) {
        .rev-wrap { max-width: 760px; margin: 0 auto; }
      }

    </style>`;
  },

  // ──────────────────────────────────────────────────────────
  mount() {
    return `
      <div class="rev-wrap">

        <div id="header-mount"></div>

        <div class="rev-strip">
          <i class="fa-solid fa-rotate" aria-hidden="true"></i>
          <span class="rev-strip-text notranslate" translate="no"
            id="rev-strip-text"></span>
        </div>

        <div class="rev-subject-scroll" id="rev-subject-scroll"></div>

        <!-- LIST STATE -->
        <div id="rev-list-state">
          <div id="rev-section-hdr-wrap"></div>
          <div class="rev-filter-row" id="rev-filter-row" style="display:none;">
            <button class="rev-filter-btn active notranslate" translate="no"
              data-filter="all">Todos</button>
            <button class="rev-filter-btn notranslate" translate="no"
              data-filter="pending">Por resolver</button>
            <button class="rev-filter-btn notranslate" translate="no"
              data-filter="resolved">Resolvidos</button>
          </div>
          <div id="rev-content-area"></div>
        </div>

        <!-- FOCUS STATE -->
        <div class="rev-focus" id="rev-focus-state"></div>

      </div>
    `;
  },

  // ──────────────────────────────────────────────────────────
  async init(user, userData, params) {
    _user             = user;
    _userData         = userData;
    _subjects         = getStudentSubjects(userData);
    _state            = 'list';
    _records          = [];
    _focusRecord      = null;
    _liveQuestion     = null;
    _chatHistory      = [];
    _mentorPaid       = false;
    _mentorOpen       = false;
    _mentorCalled     = false;
    _isSending        = false;
    _hasAnswered      = false;
    _explanationDone  = false;
    _explanationCache = {};
    _activeSubject    = '';

    ui.renderHeader({
      title:          'Revisão de Erros',
      backRoute:      '/panel/dashboard',
      showDarkToggle: true,
      moedasBalance:  moeda.getBalance(userData),
    });

    const stripEl = document.getElementById('rev-strip-text');
    if (stripEl) {
      const badge = _profileBadge();
      stripEl.textContent = badge ? `Revisão de Erros · ${badge}` : 'Revisão de Erros';
    }

    _buildSubjectPills();
    _showChooseSubject();
  },

  destroy() {
    _records          = [];
    _focusRecord      = null;
    _liveQuestion     = null;
    _chatHistory      = [];
    _explanationCache = {};
  },

};

// ============================================================
// SUBJECT PILLS
// ============================================================

function _buildSubjectPills() {
  const scroll = document.getElementById('rev-subject-scroll');
  if (!scroll || !_subjects.length) return;

  scroll.innerHTML = _subjects.map(s => `
    <button class="rev-subject-pill notranslate" translate="no"
      data-subject="${_esc(s)}">
      <i class="fa-solid ${_icon(s)}" aria-hidden="true"></i>
      ${_esc(s)}
    </button>
  `).join('');

  scroll.querySelectorAll('.rev-subject-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const subject = btn.dataset.subject;
      if (subject === _activeSubject) return;
      _activeSubject = subject;
      scroll.querySelectorAll('.rev-subject-pill')
        .forEach(b => b.classList.toggle('active', b.dataset.subject === subject));
      _loadSubject(subject);
    });
  });
}

// ============================================================
// LOAD SUBJECT
// ============================================================

async function _loadSubject(subject) {
  _state        = 'list';
  _records      = [];
  _focusRecord  = null;
  _explanationCache = {};

  const listState  = document.getElementById('rev-list-state');
  const focusState = document.getElementById('rev-focus-state');
  if (listState)  listState.style.display = 'block';
  if (focusState) focusState.classList.remove('show');

  const filterRow = document.getElementById('rev-filter-row');
  if (filterRow) filterRow.style.display = 'flex';

  _wireFilterTabs();
  _showSkeleton();

  try {
    const dbSubject = toDbSubject(subject);
    const all = await getWrongAnswers(_user.uid, { subject: dbSubject }, true);

    const sorted = all
      .filter(r => r.questionData)
      .sort((a, b) => {
        const ta = a.savedAt?.toMillis?.() ?? 0;
        const tb = b.savedAt?.toMillis?.() ?? 0;
        return tb - ta;
      })
      .slice(0, WRONG_LIMIT);

    _records = sorted;
    _renderSectionHeader(subject, sorted.length);

    const activeFilter = document.querySelector('.rev-filter-btn.active')
      ?.dataset?.filter || 'all';
    _renderList(activeFilter);

  } catch (e) {
    console.error('[Revisao] loadSubject:', e);
    const area = document.getElementById('rev-content-area');
    if (area) {
      area.innerHTML = `
        <div class="rev-empty">
          <div class="rev-empty-icon">
            <i class="fa-solid fa-circle-exclamation"></i>
          </div>
          <div class="rev-empty-title notranslate" translate="no">Erro ao carregar</div>
          <div class="rev-empty-sub notranslate" translate="no">
            Verifique a ligação e tente novamente.
          </div>
        </div>`;
    }
  }
}

// ============================================================
// SECTION HEADER
// ============================================================

function _renderSectionHeader(subject, total) {
  const wrap = document.getElementById('rev-section-hdr-wrap');
  if (!wrap) return;
  const pending  = _records.filter(r => !r.retried).length;
  const resolved = _records.filter(r =>  r.retried).length;
  wrap.innerHTML = `
    <div class="rev-section-hdr">
      <div class="rev-section-title notranslate" translate="no">
        <i class="fa-solid fa-rotate" aria-hidden="true"></i>
        ${_esc(subject)}
      </div>
      <div class="rev-section-count notranslate" translate="no">
        ${pending} por resolver · ${resolved} resolvidos
      </div>
    </div>
  `;
}

// ============================================================
// FILTER TABS
// ============================================================

function _wireFilterTabs() {
  const filterRow = document.getElementById('rev-filter-row');
  if (!filterRow || filterRow._wired) return;
  filterRow._wired = true;
  filterRow.querySelectorAll('.rev-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      filterRow.querySelectorAll('.rev-filter-btn')
        .forEach(b => b.classList.toggle('active', b === btn));
      _renderList(btn.dataset.filter);
    });
  });
}

// ============================================================
// LIST
// ============================================================

function _showSkeleton() {
  const area = document.getElementById('rev-content-area');
  if (!area) return;
  area.innerHTML = `
    <div class="rev-skeleton-list">
      ${Array(4).fill('<div class="rev-skeleton-card"></div>').join('')}
    </div>`;
}

function _showChooseSubject() {
  const hdrWrap  = document.getElementById('rev-section-hdr-wrap');
  const filterRow = document.getElementById('rev-filter-row');
  const area     = document.getElementById('rev-content-area');
  if (hdrWrap)   hdrWrap.innerHTML = '';
  if (filterRow) filterRow.style.display = 'none';
  if (area) {
    area.innerHTML = `
      <div class="rev-choose">
        <div class="rev-choose-icon">
          <i class="fa-solid fa-hand-pointer"></i>
        </div>
        <div class="rev-choose-text notranslate" translate="no">
          Seleccione uma disciplina acima<br>para ver os seus erros.
        </div>
      </div>`;
  }
}

function _renderList(filter = 'all') {
  const area = document.getElementById('rev-content-area');
  if (!area) return;

  let visible = _records;
  if (filter === 'pending')  visible = _records.filter(r => !r.retried);
  if (filter === 'resolved') visible = _records.filter(r =>  r.retried);

  if (!visible.length) {
    const msg = filter === 'resolved'
      ? 'Ainda não resolveu nenhuma questão desta disciplina.'
      : filter === 'pending'
      ? 'Não tem erros por resolver. Continue assim!'
      : 'Ainda não tem erros guardados para esta disciplina.';

    area.innerHTML = `
      <div class="rev-list">
        <div class="rev-empty">
          <div class="rev-empty-icon">
            <i class="fa-solid ${filter === 'resolved' ? 'fa-check-circle' : 'fa-rotate'}"></i>
          </div>
          <div class="rev-empty-title notranslate" translate="no">
            ${filter === 'pending' ? 'Tudo resolvido!' : 'Sem registos'}
          </div>
          <div class="rev-empty-sub notranslate" translate="no">${_esc(msg)}</div>
        </div>
      </div>`;
    return;
  }

  area.innerHTML = `
    <div class="rev-list" id="rev-list-inner">
      ${visible.map(r => _cardHtml(r)).join('')}
    </div>`;

  area.querySelectorAll('.rev-card').forEach(card => {
    card.addEventListener('click', () => {
      const record = _records.find(r => r._id === card.dataset.docid);
      if (record) _openFocus(record);
    });
  });
}

function _cardHtml(record) {
  const q          = record.questionData;
  const qText      = (q?.['Enunciado'] || '').trim();
  const qShort     = qText.length > 120 ? qText.slice(0, 117) + '...' : qText;
  const topic      = (record.topic || q?.['Tema_Relacionado'] || '').trim();
  const year       = normaliseYear(q?.['Ano'] || '');
  const context    = record.context || '';
  const isResolved = !!record.retried;

  return `
    <div class="rev-card ${isResolved ? 'resolved' : ''} notranslate"
      translate="no" data-docid="${_esc(record._id)}">
      <div class="rev-card-inner">
        <div class="rev-card-icon">
          <i class="fa-solid ${isResolved ? 'fa-check' : _icon(_activeSubject)}"
            aria-hidden="true"></i>
        </div>
        <div class="rev-card-body">
          <div class="rev-card-meta">
            ${topic   ? `<span class="rev-card-topic">${_esc(topic)}</span>` : ''}
            ${year    ? `<span class="rev-card-date">Exame de ${_esc(year)}</span>` : ''}
            <span class="rev-card-date">${_relativeDate(record.savedAt)}</span>
            ${context ? `<span class="rev-card-context">${_esc(context)}</span>` : ''}
          </div>
          <div class="rev-card-question">${_esc(qShort)}</div>
          <div class="rev-card-answer-row">
            <span class="rev-card-resolved-badge">
              <i class="fa-solid fa-check-circle"></i> Resolvido
            </span>
          </div>
        </div>
        <i class="fa-solid fa-chevron-right rev-card-arrow" aria-hidden="true"></i>
      </div>
    </div>`;
}

// ============================================================
// FOCUS STATE
// ============================================================

function _openFocus(record) {
  _focusRecord     = record;
  _liveQuestion    = null;
  _chatHistory     = [];
  _mentorPaid      = false;
  _mentorOpen      = false;
  _mentorCalled    = false;
  _hasAnswered     = false;
  _explanationDone = false;

  const listState  = document.getElementById('rev-list-state');
  const focusState = document.getElementById('rev-focus-state');
  if (listState)  listState.style.display = 'none';
  if (focusState) {
    focusState.classList.add('show');
    focusState.innerHTML = _buildFocusHtml(record);
    // Scroll to very top — fix for page opening mid-screen
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }

  document.getElementById('rev-focus-back-btn')
    ?.addEventListener('click', _closeFocus);

  _wireFocusOptions(record);

  document.getElementById('rev-btn-mentor')
    ?.addEventListener('click', _openMentor);

  document.getElementById('rev-btn-resolve')
    ?.addEventListener('click', () => _markResolved(record));

  document.getElementById('rev-btn-next')
    ?.addEventListener('click', _goNextQuestion);

  // Fetch explanation in background — does not reveal correct answer
  _fetchExplanation(record);
}

function _buildFocusHtml(record) {
  const q          = record.questionData;
  const qText      = (q?.['Enunciado'] || '').trim();
  const tipo       = (q?.['Tipo'] || 'escolha-multipla').trim();
  const topic      = (record.topic || q?.['Tema_Relacionado'] || '').trim();
  const year       = normaliseYear(q?.['Ano'] || '');
  const figure     = (q?.['Descrição_Figura'] || '').trim();
  const isResolved = !!record.retried;

  const allVisible = _records;
  const idx        = allVisible.findIndex(r => r._id === record._id);
  const pos        = idx >= 0 ? idx + 1 : 1;
  const total      = allVisible.length;

  let optionsHtml = '';
  if (tipo === 'verdadeiro-falso') {
    optionsHtml = `
      <div class="rev-tf-options" id="rev-focus-opts">
        <button class="rev-tf-btn v notranslate" translate="no" data-answer="Verdadeiro">
          <i class="fa-solid fa-check-circle" aria-hidden="true"></i>
          Verdadeiro
        </button>
        <button class="rev-tf-btn f notranslate" translate="no" data-answer="Falso">
          <i class="fa-solid fa-times-circle" aria-hidden="true"></i>
          Falso
        </button>
      </div>`;
  } else {
    const opts = getOptions(q);
    optionsHtml = `
      <div class="rev-options" id="rev-focus-opts">
        ${opts.map(o => `
          <button class="rev-option notranslate" translate="no"
            data-letter="${_esc(o.letter)}" data-text="${_esc(o.text)}">
            <div class="rev-opt-circle">${_esc(o.letter)}</div>
            <div class="rev-opt-text">${_esc(o.text)}</div>
          </button>
        `).join('')}
      </div>`;
  }

  const mentorCost = moeda.COSTS.REVISAO_MENTOR;

  return `
    <div class="rev-focus-nav">
      <button class="rev-focus-back notranslate" translate="no"
        id="rev-focus-back-btn">
        <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
        Voltar à lista
      </button>
      <div class="rev-focus-pos notranslate" translate="no">
        ${pos} / ${total}
      </div>
    </div>

    <div class="rev-focus-meta">
      <span class="rev-focus-badge subject notranslate" translate="no">
        ${_esc(_activeSubject)}
      </span>
      ${topic ? `<span class="rev-focus-badge topic notranslate" translate="no">
        ${_esc(topic)}</span>` : ''}
      ${year  ? `<span class="rev-focus-badge year notranslate" translate="no">
        Exame de ${_esc(year)}</span>` : ''}
    </div>

    <div class="rev-study-label notranslate" translate="no">
      <i class="fa-solid fa-book-open-reader" aria-hidden="true"></i>
      Leia a explicação com atenção, depois tente responder. Raciocine bem antes de escolher.
    </div>

    <!-- Explanation card — never reveals the correct answer -->
    <div class="rev-expl-card">
      <div class="rev-expl-head">
        <div class="rev-expl-head-icon">
          <i class="fa-solid fa-lightbulb" aria-hidden="true"></i>
        </div>
        <div>
          <div class="rev-expl-head-title notranslate" translate="no">
            Contexto e Conceito
          </div>
          <div class="rev-expl-head-sub notranslate" translate="no">
            Compreenda o tema antes de tentar novamente
          </div>
        </div>
      </div>
      <div id="rev-expl-body">
        <div class="rev-expl-loading">
          <div class="rev-expl-spin"></div>
          <span class="notranslate" translate="no">A preparar a explicação…</span>
        </div>
      </div>
    </div>

    <!-- Question card -->
    <div class="rev-q-card">
      ${figure ? `
        <div class="rev-q-figure">
          <i class="fa-solid fa-image" aria-hidden="true"></i>
          <span class="notranslate" translate="no">${_esc(figure)}</span>
        </div>` : ''}
      <div class="rev-q-text notranslate" translate="no" id="rev-focus-q-text">
        ${_esc(qText)}
      </div>
      ${optionsHtml}
      <div class="rev-feedback" id="rev-feedback"></div>
    </div>

    <!-- Action row -->
    <div class="rev-action-row">
      <button class="rev-btn-mentor notranslate" translate="no"
        id="rev-btn-mentor" ${isResolved ? 'disabled' : ''}>
        <i class="fa-solid fa-brain" aria-hidden="true"></i>
        Chamar Mentor
        <span class="rev-mentor-cost-pill">
          <i class="fa-solid fa-coins" style="font-size:9px;"></i>
          ${mentorCost}
        </span>
      </button>
      <button class="rev-btn-resolve ${isResolved ? 'hidden' : ''} notranslate"
        translate="no" id="rev-btn-resolve">
        <i class="fa-solid fa-check" aria-hidden="true"></i>
        Resolvido
      </button>
    </div>

    <!-- Mentor panel -->
    <div class="rev-mentor-panel" id="rev-mentor-panel"></div>

    <!-- Next button — shown after answering -->
    <button class="rev-btn-next notranslate" translate="no" id="rev-btn-next">
      <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
      Próxima Questão
    </button>
  `;
}

function _closeFocus() {
  _focusRecord     = null;
  _liveQuestion    = null;
  _chatHistory     = [];
  _mentorPaid      = false;
  _mentorOpen      = false;
  _mentorCalled    = false;
  _hasAnswered     = false;
  _explanationDone = false;

  const listState  = document.getElementById('rev-list-state');
  const focusState = document.getElementById('rev-focus-state');
  if (listState)  listState.style.display = 'block';
  if (focusState) {
    focusState.classList.remove('show');
    focusState.innerHTML = '';
  }

  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;

  const activeFilter = document.querySelector('.rev-filter-btn.active')
    ?.dataset?.filter || 'all';
  _renderList(activeFilter);
  _renderSectionHeader(_activeSubject, _records.length);
}

function _goNextQuestion() {
  if (!_focusRecord) return;
  const idx  = _records.findIndex(r => r._id === _focusRecord._id);
  const next = _records[idx + 1];
  if (next) _openFocus(next);
  else      _closeFocus();
}

// ============================================================
// WIRE FOCUS OPTIONS
// ============================================================

function _wireFocusOptions(record) {
  const q    = record.questionData;
  const tipo = (q?.['Tipo'] || 'escolha-multipla').trim();
  const opts = document.getElementById('rev-focus-opts');
  if (!opts) return;

  if (tipo === 'verdadeiro-falso') {
    opts.querySelectorAll('.rev-tf-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.classList.contains('locked')) return;
        _handleFocusAnswer(btn.dataset.answer, null, q, tipo);
      });
    });
  } else {
    opts.querySelectorAll('.rev-option').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.classList.contains('locked')) return;
        _handleFocusAnswer(btn.dataset.text, btn.dataset.letter, q, tipo);
      });
    });
  }
}

function _handleFocusAnswer(answerText, answerLetter, q, tipo) {
  if (_hasAnswered) return;
  _hasAnswered = true;

  const opts      = document.getElementById('rev-focus-opts');
  const feedback  = document.getElementById('rev-feedback');
  const nextBtn   = document.getElementById('rev-btn-next');
  const mentorBtn = document.getElementById('rev-btn-mentor');
  if (!opts || !feedback) return;

  const correct   = _correctText(q);
  const isCorrect = correct && answerText === correct;

  // Lock all options
  opts.querySelectorAll('.rev-option, .rev-tf-btn').forEach(btn => {
    btn.classList.add('locked');
  });

  if (isCorrect) {
    // ── CORRECT ──
    // Show the chosen option as correct (green)
    if (tipo === 'verdadeiro-falso') {
      opts.querySelectorAll('.rev-tf-btn').forEach(btn => {
        if (btn.dataset.answer === answerText) btn.classList.add('correct-reveal');
      });
    } else {
      opts.querySelectorAll('.rev-option').forEach(btn => {
        if (btn.dataset.text === answerText) btn.classList.add('correct-reveal');
      });
    }

    // Feedback — does not mention the answer, just confirms
    feedback.className = 'rev-feedback show correct notranslate';
    feedback.setAttribute('translate', 'no');
    feedback.innerHTML = `
      <i class="fa-solid fa-check-circle"></i>
      <span>Correcto! A sua resposta está certa. Muito bem!</span>
    `;

    // Award Moedas — more if no Mentor used
    const awardAmount = _mentorCalled
      ? moeda.AWARDS.REVISAO_CORRECT_WITH_MENTOR
      : moeda.AWARDS.REVISAO_CORRECT_NO_MENTOR;
    const awardReason = _mentorCalled
      ? 'Resposta correcta com Mentor'
      : 'Resposta correcta sem Mentor';

    moeda.awardMoedas(_user.uid, awardAmount, 'revisao_correct')
      .then(result => {
        if (result.success) {
          _userData = { ..._userData, moedas: result.newBalance };
          _moedaToast('gain', awardAmount, awardReason);
        }
      })
      .catch(e => console.warn('[Revisao] awardMoedas:', e));

    // Auto-mark resolved
    if (_focusRecord && !_focusRecord.retried) {
      _markResolved(_focusRecord, true);
    }

  } else {
    // ── WRONG ──
    // Only dim the chosen option — NEVER reveal the correct one
    if (tipo === 'verdadeiro-falso') {
      opts.querySelectorAll('.rev-tf-btn').forEach(btn => {
        if (btn.dataset.answer === answerText) btn.classList.add('wrong-reveal');
      });
    } else {
      opts.querySelectorAll('.rev-option').forEach(btn => {
        if (btn.dataset.text === answerText) btn.classList.add('wrong-reveal');
      });
    }

    // Feedback — tells student it's wrong, nothing more
    feedback.className = 'rev-feedback show wrong notranslate';
    feedback.setAttribute('translate', 'no');
    feedback.innerHTML = `
      <i class="fa-solid fa-xmark-circle"></i>
      <span>Resposta incorrecta. Releia a explicação acima e tente perceber o raciocínio correcto. Pode chamar o Mentor se precisar de ajuda.</span>
    `;

    // Penalty — -1 Moeda for wrong after reading explanation
    if (_explanationDone) {
      moeda.deductMoedas(_user.uid, moeda.COSTS.REVISAO_WRONG_PENALTY)
        .then(result => {
          if (result.success) {
            _userData = { ..._userData, moedas: result.newBalance };
            _moedaToast('loss', moeda.COSTS.REVISAO_WRONG_PENALTY, 'Resposta errada após explicação');
          }
        })
        .catch(e => console.warn('[Revisao] deductMoedas penalty:', e));
    }

    // Enable Mentor button explicitly
    if (mentorBtn) mentorBtn.disabled = false;

    // Allow retry — unlock options again after short delay
    // Student can try again, but penalty already applied
    setTimeout(() => {
      _hasAnswered = false;
      opts.querySelectorAll('.rev-option, .rev-tf-btn').forEach(btn => {
        btn.classList.remove('locked', 'wrong-reveal', 'selected');
      });
      feedback.className = 'rev-feedback wrong notranslate';
      feedback.setAttribute('translate', 'no');
      // Keep feedback visible but update text
      feedback.classList.add('show');
    }, 1800);
  }

  _renderMath(feedback);
  if (nextBtn && isCorrect) nextBtn.classList.add('show');
}

// ============================================================
// MARK RESOLVED
// ============================================================

async function _markResolved(record, silent = false) {
  if (record.retried) return;
  try {
    await markRetried(record._id);
    record.retried  = true;
    record.retriedAt = new Date();

    const cardEl = document.querySelector(`.rev-card[data-docid="${record._id}"]`);
    if (cardEl) cardEl.classList.add('resolved');

    if (!silent) {
      ui.showToast('Questão marcada como resolvida!', 'success');
    }

    document.getElementById('rev-btn-resolve')?.classList.add('hidden');

  } catch (e) {
    console.error('[Revisao] markResolved:', e);
    if (!silent) ui.showToast('Erro ao guardar. Tente novamente.', 'error');
  }
}

// ============================================================
// EXPLANATION — teaches concept, NEVER reveals correct answer
// ============================================================

async function _fetchExplanation(record) {
  const explBody = document.getElementById('rev-expl-body');
  if (!explBody) return;

  if (_explanationCache[record._id]) {
    _setExplanationHtml(_explanationCache[record._id]);
    _explanationDone = true;
    return;
  }

  const q          = record.questionData;
  const dbExpl     = (q?.['Explicação']        || '').trim();
  const dbRespPoss = (q?.['Resposta_Possível'] || '').trim();
  const topic      = (q?.['Tema_Relacionado']  || '').trim();
  const disciplina = (q?.['Disciplina']        || _activeSubject).trim();
  const classe     = (q?.['Classe']            || '').trim();
  const enunciado  = (q?.['Enunciado']         || '').slice(0, 500);
  const tipo       = (q?.['Tipo']              || '').trim();
  const level      = _studentLevel();

  // Build options text WITHOUT marking which is correct
  const opts     = getOptions(q);
  const optsText = tipo === 'escolha-multipla' && opts.length
    ? opts.map(o => `${o.letter}) ${o.text}`).join(' | ')
    : '';

  const messages = [
    {
      role: 'system',
      content: `És um professor especialista em ${disciplina}${classe ? ', ' + classe : ''} para o sistema de ensino de Moçambique.
Nível do estudante: ${level}.

A tua tarefa é escrever uma explicação pedagógica (4 a 6 frases) que ensine o CONCEITO por detrás desta questão.

REGRAS ABSOLUTAS:
1. NUNCA reveles qual é a resposta correcta — isso é proibido
2. NUNCA digas "a resposta é X" ou "a opção correcta é Y" ou qualquer variante
3. Ensina o conceito e o raciocínio necessário para o estudante descobrir a resposta por si próprio
4. Usa os campos db_explicacao e db_resp_possivel apenas como referência de conteúdo — nunca os copies
5. Adapta a linguagem ao nível do estudante: ${level}
6. Usa equações em KaTeX quando necessário: $x^2$, $\\frac{a}{b}$, $H_2O$, $$E=mc^2$$
7. Usa Português Europeu formal — sem tu, teu, tens
8. Faz uma pergunta de reflexão no final para guiar o raciocínio
9. Responde APENAS com o texto — sem JSON, sem markdown, sem título, sem asteriscos`,
    },
    {
      role: 'user',
      content: JSON.stringify({
        enunciado,
        opcoes:          optsText,
        tipo,
        tema:            topic,
        db_explicacao:   dbExpl.slice(0, 600),
        db_resp_possivel: dbRespPoss.slice(0, 600),
      }),
    },
  ];

  try {
    const raw  = await worker.callAI(messages, { maxTokens: 500, temperature: 0.35 });
    const text = (raw || '').trim();
    _explanationCache[record._id] = text;
    _setExplanationHtml(text);
    _explanationDone = true;
  } catch (e) {
    console.warn('[Revisao] explanation:', e);
    // Fallback: use DB fields if available, still never reveal answer
    const fallback = dbExpl || dbRespPoss
      ? 'Reveja os seus apontamentos sobre este tema e reflicta sobre os conceitos envolvidos antes de tentar novamente.'
      : 'Reflicta sobre os conceitos desta questão antes de tentar responder novamente.';
    _explanationCache[record._id] = fallback;
    _setExplanationHtml(fallback);
    _explanationDone = true;
  }
}

function _setExplanationHtml(text) {
  const explBody = document.getElementById('rev-expl-body');
  if (!explBody) return;
  const formatted = _formatAI(text);
  explBody.innerHTML = `
    <div class="rev-expl-body notranslate" translate="no" id="rev-expl-text">
      ${formatted}
    </div>`;
  _renderMath(document.getElementById('rev-expl-text'));
  _renderMath(document.getElementById('rev-focus-q-text'));
}

// ============================================================
// MENTOR CHAT
// ============================================================

async function _openMentor() {
  if (_mentorOpen) return;

  const bal = moeda.getBalance(_userData);
  if (bal < moeda.COSTS.REVISAO_MENTOR) {
    moeda.showMoedasSheet(bal, moeda.COSTS.REVISAO_MENTOR);
    return;
  }

  _mentorOpen   = true;
  _mentorCalled = true;
  _chatHistory  = [];

  const panel = document.getElementById('rev-mentor-panel');
  if (!panel) return;

  panel.classList.add('show');
  panel.innerHTML = _buildMentorPanelHtml();
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

  document.getElementById('rev-mentor-close')
    ?.addEventListener('click', _closeMentor);

  document.getElementById('rev-btn-understood')
    ?.addEventListener('click', _handleUnderstood);

  document.getElementById('rev-mentor-send')
    ?.addEventListener('click', _sendMentorMessage);

  const ta = document.getElementById('rev-mentor-textarea');
  ta?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      _sendMentorMessage();
    }
  });
  ta?.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 100) + 'px';
  });

  _fetchLiveQuestion();

  _appendMentorMessage('ai',
    'Olá! Estou aqui para ajudar. O que não está a compreender nesta questão? Descreva o seu raciocínio e eu vou guiá-lo.'
  );
}

function _buildMentorPanelHtml() {
  const q     = _focusRecord?.questionData;
  const topic = (q?.['Tema_Relacionado'] || _activeSubject || '').trim();
  const cost  = moeda.COSTS.REVISAO_MENTOR;

  return `
    <div class="rev-mentor-head">
      <div class="rev-mentor-head-icon">
        <i class="fa-solid fa-brain" aria-hidden="true"></i>
      </div>
      <div class="rev-mentor-head-info">
        <div class="rev-mentor-head-title notranslate" translate="no">
          Mentor — ${_esc(_activeSubject)}
        </div>
        <div class="rev-mentor-head-sub notranslate" translate="no">
          ${_esc(topic)} · Conversa encerrada ao mudar de questão
        </div>
      </div>
      <button class="rev-mentor-close notranslate" translate="no"
        id="rev-mentor-close">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>

    <div class="rev-mentor-cost-notice notranslate" translate="no"
      id="rev-mentor-cost-notice">
      <i class="fa-solid fa-coins"></i>
      A primeira mensagem deduzirá ${cost} Moeda${cost !== 1 ? 's' : ''} da sua conta
    </div>

    <div class="rev-mentor-messages" id="rev-mentor-messages"></div>

    <div class="rev-mentor-input-row">
      <textarea class="rev-mentor-textarea notranslate" translate="no"
        id="rev-mentor-textarea"
        placeholder="Escreva a sua dúvida…"
        rows="1" maxlength="500"></textarea>
      <button class="rev-mentor-send notranslate" translate="no"
        id="rev-mentor-send" aria-label="Enviar">
        <i class="fa-solid fa-paper-plane" aria-hidden="true"></i>
      </button>
    </div>

    <button class="rev-btn-understood notranslate" translate="no"
      id="rev-btn-understood">
      <i class="fa-solid fa-check-double" aria-hidden="true"></i>
      Percebi — Fechar Mentor
    </button>
  `;
}

async function _fetchLiveQuestion() {
  if (!_focusRecord) return;
  const questionId = _focusRecord.questionData?.['ID_Questão']
                  || _focusRecord.questionData?._id
                  || _focusRecord.questionId;
  if (!questionId) return;
  try {
    const live = await fetchQuestion(questionId, true);
    if (live) _liveQuestion = live;
  } catch (e) {
    console.warn('[Revisao] fetchLiveQuestion:', e);
  }
}

async function _sendMentorMessage() {
  if (_isSending) return;
  const ta = document.getElementById('rev-mentor-textarea');
  if (!ta) return;

  const text = ta.value.trim();
  if (!text) return;

  if (_chatHistory.length >= MAX_CHAT_TURNS * 2) {
    ui.showToast('Limite de mensagens desta sessão atingido.', 'info');
    return;
  }

  // First message — deduct Moedas
  if (!_mentorPaid) {
    const bal = moeda.getBalance(_userData);
    if (bal < moeda.COSTS.REVISAO_MENTOR) {
      moeda.showMoedasSheet(bal, moeda.COSTS.REVISAO_MENTOR);
      return;
    }
    try {
      const result = await moeda.deductMoedas(_user.uid, moeda.COSTS.REVISAO_MENTOR);
      if (!result.success) {
        ui.showToast('Erro ao deduzir Moedas. Tente novamente.', 'error');
        return;
      }
      _mentorPaid = true;
      _userData   = { ..._userData, moedas: result.newBalance };
      _moedaToast('loss', moeda.COSTS.REVISAO_MENTOR, 'Sessão do Mentor');
      document.getElementById('rev-mentor-cost-notice')?.classList.add('hidden');
    } catch (e) {
      console.error('[Revisao] deductMoedas mentor:', e);
      ui.showToast('Erro ao deduzir Moedas.', 'error');
      return;
    }
  }

  _isSending = true;
  ta.value   = '';
  ta.style.height = 'auto';
  ta.disabled = true;
  document.getElementById('rev-mentor-send')?.setAttribute('disabled', true);

  _appendMentorMessage('user', text);
  _chatHistory.push({ role: 'user', content: text });

  const typingId = 'rev-typing-' + Date.now();
  _appendTypingIndicator(typingId);

  try {
    const q          = _liveQuestion || _focusRecord?.questionData;
    const correct    = _correctText(q);
    const dbExpl     = (q?.['Explicação']        || '').trim();
    const dbRespPoss = (q?.['Resposta_Possível'] || '').trim();
    const topic      = (q?.['Tema_Relacionado']  || '').trim();
    const disciplina = (q?.['Disciplina']        || _activeSubject).trim();
    const classe     = (q?.['Classe']            || '').trim();
    const enunciado  = (q?.['Enunciado']         || '').slice(0, 600);
    const opts       = getOptions(q);
    const optsText   = opts.map(o => `${o.letter}) ${o.text}`).join(' | ');
    const level      = _studentLevel();

    // NOTE: correct answer IS passed to Mentor — only so it can
    // confirm when the STUDENT says the right answer in chat.
    // The Mentor must NEVER state it proactively.
    const systemPrompt = `És o Mentor do ExameNova — tutor de ${disciplina}${classe ? ', ' + classe : ''} no sistema de ensino de Moçambique.
O estudante está a rever uma questão que errou. Tens todo o contexto abaixo.

NÍVEL DO ESTUDANTE: ${level}

QUESTÃO:
${enunciado}

${optsText ? 'OPÇÕES: ' + optsText : ''}
${dbExpl      ? '\nEXPLICAÇÃO OFICIAL: ' + dbExpl.slice(0, 400)      : ''}
${dbRespPoss  ? '\nRESPOSTA POSSÍVEL: '   + dbRespPoss.slice(0, 400)  : ''}
${topic       ? '\nTEMA: '                + topic                      : ''}

RESPOSTA CORRECTA (USO INTERNO — vês apenas tu):
${correct}

REGRAS ABSOLUTAS:
1. NUNCA digas directamente qual é a resposta correcta — mesmo que o estudante peça
2. Se o estudante disser a resposta correcta em texto, confirma: "Isso mesmo! Está no caminho certo."
3. Se o estudante disser uma resposta errada, NÃO confirmes nem neguês directamente — faz uma nova pergunta que o guie
4. Usa o método socrático: faz perguntas que levem o estudante a raciocinar
5. Adapta a linguagem ao nível do estudante: ${level}
6. Respostas curtas e focadas — máximo 4 frases por resposta
7. Usa Português Europeu formal — nunca tu, teu, tens — usa "o/a estudante", "pode", "deve"
8. Usa KaTeX para equações: $x^2$, $\\frac{a}{b}$, $H_2O$
9. Formata bem: usa **palavra** para realçar conceitos-chave (sem asteriscos soltos)
10. Nunca uses asteriscos isolados — apenas **texto** para negrito
11. Encoraja sempre — o estudante está a esforçar-se`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ..._chatHistory.slice(-MAX_CHAT_TURNS * 2),
    ];

    const raw    = await worker.callAI(messages, { maxTokens: 350, temperature: 0.4 });
    const aiText = (raw || '').trim() || 'Não consegui gerar uma resposta. Tente novamente.';

    _chatHistory.push({ role: 'assistant', content: aiText });
    document.getElementById(typingId)?.remove();
    _appendMentorMessage('ai', aiText);

  } catch (e) {
    console.error('[Revisao] mentor send:', e);
    document.getElementById(typingId)?.remove();
    _appendMentorMessage('ai',
      'Ocorreu um erro de ligação. Verifique a sua ligação à internet e tente novamente.'
    );
  } finally {
    _isSending = false;
    if (ta) ta.disabled = false;
    document.getElementById('rev-mentor-send')?.removeAttribute('disabled');
    ta?.focus();
  }
}

function _appendMentorMessage(role, text) {
  const container = document.getElementById('rev-mentor-messages');
  if (!container) return;

  const div = document.createElement('div');
  div.className = `rev-msg ${role} notranslate`;
  div.setAttribute('translate', 'no');

  if (role === 'ai') {
    // Format markdown → HTML, strip stray asterisks
    div.innerHTML = _formatAI(text);
    // KaTeX on the formatted content
    _renderMath(div);
  } else {
    div.textContent = text;
  }

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function _appendTypingIndicator(id) {
  const container = document.getElementById('rev-mentor-messages');
  if (!container) return;
  const div = document.createElement('div');
  div.className = 'rev-msg typing';
  div.id = id;
  div.innerHTML = `
    <div class="rev-typing-dots">
      <span></span><span></span><span></span>
    </div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function _closeMentor() {
  _mentorOpen  = false;
  _chatHistory = [];
  const panel = document.getElementById('rev-mentor-panel');
  if (panel) {
    panel.classList.remove('show');
    panel.innerHTML = '';
  }
}

function _handleUnderstood() {
  if (_focusRecord && !_focusRecord.retried) {
    _markResolved(_focusRecord, true);
    ui.showToast('Questão marcada como compreendida.', 'success');
  }
  _closeMentor();
  document.getElementById('rev-btn-next')?.classList.add('show');
}

// ============================================================
// EXPORT
// ============================================================

export default RevisaoScreen;
