// ============================================================
// panel/js/screens/revisao/revisao.js
// ExameNova — Revisão de Erros Screen v1.0
//
// ARCHITECTURE:
//   Three states managed inside one screen:
//     'list'   — subject selector + wrong answer cards
//     'focus'  — single question with AI explanation + retry
//     'mentor' — inline AI chat for persistent doubts
//
//   No render screen needed. No navigation away.
//   Mentor chat is embedded and scoped to one question at a time.
//   Chat history clears when student moves to next question.
//
// DATA FLOW:
//   1. Student selects subject
//   2. getWrongAnswers() fetches 10 most recent unresolved records
//      (noCache: true — always fresh after markRetried)
//   3. Each record has questionData (full snapshot) — no re-fetch needed
//   4. When student calls Mentor, app fetches LIVE question from
//      exam DB by questionId for authoritative content
//   5. AI receives: question, correct answer, student's wrong answer,
//      Explicação, Resposta_Possível, topic, subject — never generic
//
// ANSWER COMPARISON:
//   questionData comes from simulacao — DB questions only.
//   Resposta stores full option TEXT (never a letter).
//   Compare: chosenText === q['Resposta']
//   Verdadeiro/Falso: chosenText === 'Verdadeiro' | 'Falso'
//
// EQUATIONS:
//   KaTeX auto-render runs on explanation text and question text.
//   Delimiters: $...$ for inline, $$...$$ for display.
//   AI is instructed to use KaTeX delimiters in its output.
//
// MOEDAS:
//   Revisão itself is FREE — no Moedas cost.
//   Mentor chat inside Revisão costs MENTOR_SESSION per session.
//   One session = one question's chat window lifetime.
//   Deducted when student first sends a message (not on open).
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
const WRONG_LIMIT       = 10;
const MAX_CHAT_TURNS    = 10;
const MENTOR_COST       = moeda.COSTS.MENTOR_SESSION;

// ── Module state ───────────────────────────────────────────────
let _user         = null;
let _userData     = null;
let _subjects     = [];
let _activeSubject= '';    // profile name e.g. 'Física'
let _records      = [];    // wrongAnswer records for active subject
let _state        = 'list';// 'list' | 'focus' | 'mentor'
let _focusRecord  = null;  // current wrongAnswer record in focus
let _liveQuestion = null;  // fetched live from exam DB for Mentor context
let _chatHistory  = [];    // [{role, content}] for current question
let _mentorPaid   = false; // whether MENTOR_SESSION was deducted this question
let _mentorOpen   = false;
let _isSending    = false;
let _explanationCache = {}; // docId → explanation text

// ── KaTeX render helper ────────────────────────────────────────
function _renderMath(el) {
  if (!el) return;
  if (typeof window.renderMathInElement === 'function') {
    try {
      window.renderMathInElement(el, {
        delimiters: [
          { left: '$$', right: '$$', display: true  },
          { left: '$',  right: '$',  display: false },
        ],
        throwOnError: false,
      });
    } catch (e) { /* KaTeX not yet loaded — plain text shown */ }
  }
}

// ── Escape HTML ───────────────────────────────────────────────
function _esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

// ── Date display ──────────────────────────────────────────────
function _relativeDate(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  if (diff < 7)  return `Há ${diff} dias`;
  return d.toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' });
}

// ── Profile badge ─────────────────────────────────────────────
function _profileBadge() {
  const t = _userData?.examType;
  const g = _userData?.grade;
  if (t === 'ensino-geral') return `${g}ª Classe`;
  if (t === 'admissao') {
    return (_userData.institution || _userData.course || 'Admissão').toUpperCase();
  }
  return '';
}

// ── Subject icon ──────────────────────────────────────────────
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

// ── Correct answer text ───────────────────────────────────────
function _correctText(q) {
  return (q?.['Resposta'] || '').trim() || '—';
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
      .rev-strip i {
        font-size: 11px;
        color: var(--secondary);
      }
      .rev-strip-text {
        font-size: 12px;
        font-weight: 700;
        color: var(--text-secondary);
        letter-spacing: 0.01em;
      }

      /* ── SUBJECT SELECTOR ── */
      .rev-subject-scroll {
        display: flex;
        gap: 8px;
        padding: 16px 16px 4px;
        overflow-x: auto;
        scrollbar-width: none;
        -webkit-overflow-scrolling: touch;
        scroll-snap-type: x mandatory;
      }
      .rev-subject-scroll::-webkit-scrollbar { display: none; }

      .rev-subject-pill {
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 9px 16px;
        border-radius: var(--radius-full);
        border: 1.5px solid var(--border);
        background: var(--surface);
        font-family: inherit;
        font-size: 13px;
        font-weight: 700;
        color: var(--text-secondary);
        cursor: pointer;
        white-space: nowrap;
        scroll-snap-align: start;
        transition: all 0.18s;
        -webkit-tap-highlight-color: transparent;
        flex-shrink: 0;
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
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 20px 16px 10px;
      }
      .rev-section-title {
        font-size: 13px;
        font-weight: 800;
        color: var(--text);
        display: flex;
        align-items: center;
        gap: 7px;
      }
      .rev-section-title i { font-size: 12px; color: var(--secondary); }
      .rev-section-count {
        font-size: 11px;
        font-weight: 700;
        color: var(--text-muted);
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: var(--radius-full);
        padding: 2px 10px;
      }

      /* ── FILTER TABS ── */
      .rev-filter-row {
        display: flex;
        gap: 6px;
        padding: 0 16px 14px;
      }
      .rev-filter-btn {
        padding: 6px 14px;
        border-radius: var(--radius-full);
        border: 1.5px solid var(--border);
        background: var(--surface);
        font-family: inherit;
        font-size: 12px;
        font-weight: 700;
        color: var(--text-muted);
        cursor: pointer;
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
        height: 96px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        margin-bottom: 10px;
        overflow: hidden;
        position: relative;
      }
      .rev-skeleton-card::after {
        content: '';
        position: absolute;
        inset: 0;
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
        margin-bottom: 10px;
        overflow: hidden;
        cursor: pointer;
        transition: border-color 0.18s, transform 0.12s;
        -webkit-tap-highlight-color: transparent;
        position: relative;
      }
      .rev-card::before {
        content: '';
        position: absolute;
        left: 0; top: 0; bottom: 0;
        width: 4px;
        background: var(--secondary);
        border-radius: 0;
      }
      .rev-card.resolved::before { background: var(--success, #22C55E); }
      .rev-card:active { transform: scale(0.984); }
      .rev-card:hover  { border-color: var(--secondary); }
      .rev-card.resolved:hover { border-color: var(--success, #22C55E); }

      .rev-card-inner {
        padding: 13px 14px 13px 18px;
        display: flex;
        align-items: flex-start;
        gap: 12px;
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
        background: rgba(34,197,94,0.09);
        color: var(--success, #22C55E);
      }

      .rev-card-body { flex: 1; min-width: 0; }

      .rev-card-meta {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 4px;
        flex-wrap: wrap;
      }
      .rev-card-topic {
        font-size: 10px; font-weight: 700;
        color: var(--secondary);
        background: rgba(139,92,246,0.08);
        border-radius: var(--radius-full);
        padding: 2px 8px;
      }
      .rev-card.resolved .rev-card-topic {
        color: var(--success, #22C55E);
        background: rgba(34,197,94,0.08);
      }
      .rev-card-date {
        font-size: 10px; font-weight: 600;
        color: var(--text-muted);
      }
      .rev-card-context {
        font-size: 10px; font-weight: 600;
        color: var(--text-muted);
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: var(--radius-full);
        padding: 1px 7px;
      }

      .rev-card-question {
        font-size: 13px; font-weight: 600;
        color: var(--text);
        line-height: 1.5;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        margin-bottom: 6px;
      }

      .rev-card-answer-row {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }
      .rev-card-answer-lbl {
        font-size: 10px; font-weight: 700;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .rev-card-answer-val {
        font-size: 11px; font-weight: 700;
        color: #fff;
        background: var(--secondary);
        border-radius: var(--radius-full);
        padding: 2px 9px;
        max-width: 180px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .rev-card.resolved .rev-card-answer-val {
        background: var(--success, #22C55E);
      }

      .rev-card-resolved-badge {
        display: none;
        align-items: center;
        gap: 5px;
        font-size: 10px; font-weight: 700;
        color: var(--success, #22C55E);
      }
      .rev-card.resolved .rev-card-resolved-badge { display: flex; }
      .rev-card.resolved .rev-card-answer-lbl     { display: none; }
      .rev-card.resolved .rev-card-answer-val      { display: none; }

      .rev-card-arrow {
        font-size: 11px;
        color: var(--text-muted);
        flex-shrink: 0;
        margin-top: 10px;
      }

      /* ── EMPTY STATE ── */
      .rev-empty {
        padding: 60px 24px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        text-align: center;
      }
      .rev-empty-icon {
        width: 64px; height: 64px;
        border-radius: 50%;
        background: rgba(139,92,246,0.09);
        display: flex; align-items: center; justify-content: center;
        font-size: 26px; color: var(--secondary);
        margin-bottom: 4px;
      }
      .rev-empty-title {
        font-size: 16px; font-weight: 800;
        color: var(--text);
      }
      .rev-empty-sub {
        font-size: 13px; color: var(--text-muted);
        line-height: 1.55; max-width: 260px;
      }

      /* ── CHOOSE SUBJECT STATE ── */
      .rev-choose {
        padding: 48px 24px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        text-align: center;
      }
      .rev-choose-icon {
        font-size: 40px;
        color: var(--secondary);
        opacity: 0.4;
        margin-bottom: 8px;
      }
      .rev-choose-text {
        font-size: 14px; font-weight: 600;
        color: var(--text-muted); line-height: 1.55;
      }

      /* ============================================================
         FOCUS STATE — single question study view
         ============================================================ */

      .rev-focus {
        display: none;
        min-height: calc(100dvh - 120px);
        padding: 16px 16px 40px;
        max-width: 700px;
        margin: 0 auto;
      }
      .rev-focus.show { display: block; }

      /* Navigation between questions */
      .rev-focus-nav {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 20px;
        gap: 10px;
      }
      .rev-focus-back {
        display: flex; align-items: center; gap: 7px;
        font-size: 13px; font-weight: 700;
        color: var(--text-muted);
        background: none; border: none;
        font-family: inherit; cursor: pointer;
        padding: 8px 0;
        -webkit-tap-highlight-color: transparent;
        transition: color 0.15s;
      }
      .rev-focus-back:hover { color: var(--secondary); }
      .rev-focus-pos {
        font-size: 12px; font-weight: 700;
        color: var(--text-muted);
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-full);
        padding: 4px 12px;
        white-space: nowrap;
      }

      /* Meta badges */
      .rev-focus-meta {
        display: flex;
        align-items: center;
        gap: 7px;
        flex-wrap: wrap;
        margin-bottom: 14px;
      }
      .rev-focus-badge {
        font-size: 10px; font-weight: 700;
        border-radius: var(--radius-full);
        padding: 3px 10px;
      }
      .rev-focus-badge.subject {
        color: var(--secondary);
        background: rgba(139,92,246,0.1);
        border: 1px solid rgba(139,92,246,0.2);
      }
      .rev-focus-badge.topic {
        color: var(--primary);
        background: var(--primary-light);
        border: 1px solid rgba(2,132,199,0.2);
      }
      .rev-focus-badge.year {
        color: var(--text-muted);
        background: var(--surface);
        border: 1px solid var(--border);
      }
      .rev-focus-badge.context {
        color: var(--text-muted);
        background: var(--surface);
        border: 1px solid var(--border);
      }

      /* Study mode label */
      .rev-study-label {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        background: rgba(139,92,246,0.06);
        border: 1px solid rgba(139,92,246,0.18);
        border-radius: var(--radius-md);
        margin-bottom: 16px;
        font-size: 12px;
        font-weight: 600;
        color: var(--secondary);
        line-height: 1.4;
      }
      .rev-study-label i { font-size: 13px; flex-shrink: 0; }

      /* AI explanation card */
      .rev-expl-card {
        background: var(--surface);
        border: 1.5px solid rgba(139,92,246,0.25);
        border-left: 4px solid var(--secondary);
        border-radius: var(--radius-lg);
        margin-bottom: 20px;
        overflow: hidden;
      }
      .rev-expl-head {
        padding: 12px 16px 10px;
        background: rgba(139,92,246,0.04);
        border-bottom: 1px solid rgba(139,92,246,0.12);
        display: flex;
        align-items: center;
        gap: 9px;
      }
      .rev-expl-head-icon {
        width: 30px; height: 30px;
        border-radius: var(--radius-md);
        background: rgba(139,92,246,0.12);
        display: flex; align-items: center; justify-content: center;
        font-size: 13px; color: var(--secondary);
        flex-shrink: 0;
      }
      .rev-expl-head-title {
        font-size: 13px; font-weight: 800;
        color: var(--text);
      }
      .rev-expl-head-sub {
        font-size: 11px; color: var(--text-muted); margin-top: 1px;
      }
      .rev-expl-body {
        padding: 16px;
        font-size: 14px;
        color: var(--text-secondary);
        line-height: 1.75;
      }
      .rev-expl-loading {
        display: flex; align-items: center; gap: 10px;
        padding: 20px 16px;
        font-size: 13px; color: var(--text-muted);
      }
      .rev-expl-spin {
        width: 18px; height: 18px;
        border: 2.5px solid var(--border);
        border-top-color: var(--secondary);
        border-radius: 50%;
        animation: revSpin 0.75s linear infinite;
        flex-shrink: 0;
      }

      /* Question card */
      .rev-q-card {
        background: var(--surface);
        border: 1.5px solid var(--border);
        border-radius: var(--radius-lg);
        margin-bottom: 16px;
        overflow: hidden;
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
        padding: 13px 14px;
        cursor: pointer;
        transition: all 0.15s;
        text-align: left;
        width: 100%;
        font-family: inherit;
        min-height: 48px;
        -webkit-tap-highlight-color: transparent;
      }
      .rev-option:hover:not(.locked) {
        border-color: var(--secondary);
        background: rgba(139,92,246,0.05);
        transform: translateX(2px);
      }
      .rev-option:active:not(.locked) { transform: scale(0.99); }
      .rev-option.selected {
        border-color: var(--secondary);
        background: rgba(139,92,246,0.06);
      }
      .rev-option.locked { cursor: default; }
      .rev-option.correct-reveal {
        border-color: #22C55E;
        background: rgba(34,197,94,0.07);
      }
      .rev-option.wrong-reveal {
        border-color: #EF4444;
        background: rgba(239,68,68,0.06);
        opacity: 0.75;
      }
      .rev-opt-circle {
        width: 28px; height: 28px; border-radius: 50%;
        background: var(--surface);
        border: 1.5px solid var(--border);
        display: flex; align-items: center; justify-content: center;
        font-size: 11px; font-weight: 800; color: var(--text-muted);
        flex-shrink: 0; margin-top: 1px;
        transition: all 0.15s;
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
        padding: 18px 10px;
        border-radius: var(--radius-lg);
        border: 1.5px solid var(--border);
        background: var(--bg);
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
      .rev-tf-btn.selected.v { border-color: #22C55E; background: rgba(34,197,94,0.07); color: #22C55E; }
      .rev-tf-btn.selected.f { border-color: #EF4444; background: rgba(239,68,68,0.07); color: #EF4444; }
      .rev-tf-btn.correct-reveal { border-color: #22C55E; background: rgba(34,197,94,0.07); color: #22C55E; }
      .rev-tf-btn.wrong-reveal   { border-color: #EF4444; background: rgba(239,68,68,0.07); color: #EF4444; opacity: 0.7; }
      .rev-tf-btn.locked { cursor: default; }
      .rev-tf-btn:active:not(.locked) { transform: scale(0.97); }

      /* Retry feedback */
      .rev-feedback {
        display: none;
        align-items: flex-start; gap: 10px;
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

      /* Action row below question */
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
        background: rgba(139,92,246,0.12);
        border-color: var(--secondary);
      }
      .rev-btn-mentor:active:not(:disabled) { transform: scale(0.97); }
      .rev-btn-mentor:disabled {
        opacity: 0.38; cursor: not-allowed;
      }
      .rev-btn-mentor .rev-mentor-cost {
        font-size: 10px; font-weight: 700;
        color: var(--moeda);
        background: var(--moeda-light);
        border-radius: var(--radius-full);
        padding: 2px 7px;
        display: inline-flex; align-items: center; gap: 3px;
      }

      .rev-btn-resolve {
        flex: 1; padding: 14px;
        border-radius: var(--radius-lg);
        border: none;
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
        border-radius: var(--radius-lg);
        border: none;
        background: linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%);
        font-family: inherit; font-size: 14px; font-weight: 700;
        color: #fff; cursor: pointer;
        display: none; align-items: center; justify-content: center; gap: 9px;
        transition: opacity 0.18s, transform 0.15s; min-height: 52px;
        margin-top: 12px;
        box-shadow: 0 3px 14px rgba(139,92,246,0.3);
        -webkit-tap-highlight-color: transparent;
      }
      .rev-btn-next.show { display: flex; }
      .rev-btn-next:hover  { opacity: 0.9; }
      .rev-btn-next:active { transform: scale(0.97); }

      /* ============================================================
         MENTOR CHAT PANEL
         ============================================================ */

      .rev-mentor-panel {
        display: none;
        flex-direction: column;
        background: var(--surface);
        border: 1.5px solid rgba(139,92,246,0.3);
        border-radius: var(--radius-lg);
        overflow: hidden;
        margin-top: 16px;
        max-height: 480px;
      }
      .rev-mentor-panel.show { display: flex; }

      .rev-mentor-head {
        padding: 12px 16px;
        background: rgba(139,92,246,0.06);
        border-bottom: 1px solid rgba(139,92,246,0.15);
        display: flex; align-items: center; gap: 10px;
      }
      .rev-mentor-head-icon {
        width: 32px; height: 32px;
        border-radius: var(--radius-md);
        background: rgba(139,92,246,0.15);
        display: flex; align-items: center; justify-content: center;
        font-size: 14px; color: var(--secondary);
        flex-shrink: 0;
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

      /* Cost notice */
      .rev-mentor-cost-notice {
        padding: 10px 16px;
        background: rgba(255,179,0,0.06);
        border-bottom: 1px solid rgba(255,179,0,0.15);
        display: flex; align-items: center; gap: 8px;
        font-size: 11px; font-weight: 600;
        color: var(--moeda-dark, #92400E);
      }
      .rev-mentor-cost-notice i { color: var(--moeda); font-size: 12px; }
      .rev-mentor-cost-notice.hidden { display: none; }

      /* Messages */
      .rev-mentor-messages {
        flex: 1; overflow-y: auto;
        padding: 14px 14px 8px;
        display: flex; flex-direction: column; gap: 10px;
        min-height: 160px; max-height: 280px;
        -webkit-overflow-scrolling: touch;
      }

      .rev-msg {
        max-width: 88%;
        font-size: 13px; line-height: 1.6;
        border-radius: 14px;
        padding: 10px 13px;
        word-break: break-word;
        animation: revMsgIn 0.22s ease both;
      }
      .rev-msg.user {
        align-self: flex-end;
        background: var(--secondary);
        color: #fff;
        border-bottom-right-radius: 4px;
      }
      .rev-msg.ai {
        align-self: flex-start;
        background: var(--bg);
        color: var(--text);
        border: 1px solid var(--border);
        border-bottom-left-radius: 4px;
      }
      .rev-msg.typing {
        align-self: flex-start;
        background: var(--bg);
        border: 1px solid var(--border);
        padding: 12px 16px;
        border-bottom-left-radius: 4px;
      }
      .rev-typing-dots {
        display: flex; gap: 4px; align-items: center;
      }
      .rev-typing-dots span {
        width: 7px; height: 7px; border-radius: 50%;
        background: var(--text-muted);
        animation: revDot 1.2s infinite;
      }
      .rev-typing-dots span:nth-child(2) { animation-delay: 0.2s; }
      .rev-typing-dots span:nth-child(3) { animation-delay: 0.4s; }

      /* Input row */
      .rev-mentor-input-row {
        display: flex; align-items: flex-end; gap: 8px;
        padding: 10px 12px 12px;
        border-top: 1px solid var(--border);
        background: var(--surface);
      }
      .rev-mentor-textarea {
        flex: 1;
        background: var(--bg);
        border: 1.5px solid var(--border);
        border-radius: var(--radius-md);
        padding: 10px 12px;
        font-family: inherit; font-size: 13px;
        color: var(--text); outline: none; resize: none;
        min-height: 42px; max-height: 100px;
        line-height: 1.5;
        transition: border-color 0.2s;
      }
      .rev-mentor-textarea::placeholder { color: var(--text-muted); }
      .rev-mentor-textarea:focus {
        border-color: var(--secondary);
        box-shadow: 0 0 0 3px rgba(139,92,246,0.1);
      }
      .rev-mentor-send {
        width: 42px; height: 42px; border-radius: 50%;
        background: var(--secondary);
        border: none; color: #fff; font-size: 15px;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; flex-shrink: 0;
        transition: opacity 0.15s, transform 0.12s;
        font-family: inherit;
      }
      .rev-mentor-send:hover:not(:disabled)  { opacity: 0.88; }
      .rev-mentor-send:active:not(:disabled) { transform: scale(0.93); }
      .rev-mentor-send:disabled { opacity: 0.35; cursor: not-allowed; }

      /* Understood button */
      .rev-btn-understood {
        width: calc(100% - 24px); margin: 0 12px 12px;
        padding: 11px;
        border-radius: var(--radius-md);
        border: 1.5px solid rgba(139,92,246,0.3);
        background: rgba(139,92,246,0.06);
        font-family: inherit; font-size: 13px; font-weight: 700;
        color: var(--secondary); cursor: pointer;
        display: flex; align-items: center; justify-content: center; gap: 7px;
        transition: all 0.15s; min-height: 44px;
        -webkit-tap-highlight-color: transparent;
      }
      .rev-btn-understood:hover { background: rgba(139,92,246,0.12); }
      .rev-btn-understood:active { transform: scale(0.97); }

      /* ── DARK MODE ── */
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
        0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
        30%            { transform: translateY(-5px); opacity: 1; }
      }

      /* ── RESPONSIVE ── */
      @media (min-width: 768px) {
        .rev-list,
        .rev-focus { padding: 0 24px 40px; }
        .rev-subject-scroll { padding: 16px 24px 4px; }
        .rev-section-hdr { padding: 20px 24px 10px; }
        .rev-filter-row { padding: 0 24px 14px; }
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

        <!-- Profile strip -->
        <div class="rev-strip">
          <i class="fa-solid fa-rotate" aria-hidden="true"></i>
          <span class="rev-strip-text notranslate" translate="no"
            id="rev-strip-text"></span>
        </div>

        <!-- Subject selector -->
        <div class="rev-subject-scroll" id="rev-subject-scroll"></div>

        <!-- LIST STATE -->
        <div id="rev-list-state">

          <div id="rev-section-hdr-wrap"></div>

          <!-- Filter tabs -->
          <div class="rev-filter-row" id="rev-filter-row" style="display:none;">
            <button class="rev-filter-btn active notranslate" translate="no"
              id="rev-filter-all" data-filter="all">
              Todos
            </button>
            <button class="rev-filter-btn notranslate" translate="no"
              id="rev-filter-pending" data-filter="pending">
              Por resolver
            </button>
            <button class="rev-filter-btn notranslate" translate="no"
              id="rev-filter-resolved" data-filter="resolved">
              Resolvidos
            </button>
          </div>

          <!-- Content area -->
          <div id="rev-content-area"></div>

        </div>

        <!-- FOCUS STATE -->
        <div class="rev-focus" id="rev-focus-state"></div>

      </div>
    `;
  },

  // ──────────────────────────────────────────────────────────
  async init(user, userData, params) {
    _user      = user;
    _userData  = userData;
    _subjects  = getStudentSubjects(userData);
    _state     = 'list';
    _records   = [];
    _focusRecord  = null;
    _liveQuestion = null;
    _chatHistory  = [];
    _mentorPaid   = false;
    _mentorOpen   = false;
    _isSending    = false;
    _explanationCache = {};
    _activeSubject = '';

    ui.renderHeader({
      title:          'Revisão de Erros',
      backRoute:      '/panel/dashboard',
      showDarkToggle: true,
      moedasBalance:  moeda.getBalance(userData),
    });

    // Profile strip
    const stripEl = document.getElementById('rev-strip-text');
    if (stripEl) {
      const badge = _profileBadge();
      stripEl.textContent = badge
        ? `Revisão de Erros · ${badge}`
        : 'Revisão de Erros';
    }

    // Subject pills
    _buildSubjectPills();

    // Show choose-subject state
    _showChooseSubject();
  },

  destroy() {
    _records   = [];
    _focusRecord  = null;
    _liveQuestion = null;
    _chatHistory  = [];
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
  _state = 'list';
  _records = [];
  _focusRecord = null;
  _explanationCache = {};

  // Show list state, hide focus
  const listState  = document.getElementById('rev-list-state');
  const focusState = document.getElementById('rev-focus-state');
  if (listState)  listState.style.display = 'block';
  if (focusState) focusState.classList.remove('show');

  // Show filter row
  const filterRow = document.getElementById('rev-filter-row');
  if (filterRow) filterRow.style.display = 'flex';

  // Wire filter tabs (once)
  _wireFilterTabs();

  // Show skeleton
  _showSkeleton();

  try {
    // Fetch ALL records for subject (both pending and resolved)
    // We apply client-side filter by retried status
    const dbSubject = toDbSubject(subject);
    const all = await getWrongAnswers(
      _user.uid,
      { subject: dbSubject },
      true // always fresh
    );

    // Sort by savedAt descending, take 10 most recent total
    const sorted = all
      .filter(r => r.questionData) // must have snapshot
      .sort((a, b) => {
        const ta = a.savedAt?.toMillis?.() ?? 0;
        const tb = b.savedAt?.toMillis?.() ?? 0;
        return tb - ta;
      })
      .slice(0, WRONG_LIMIT);

    _records = sorted;

    // Update section header
    _renderSectionHeader(subject, sorted.length);

    // Render list with current filter
    const activeFilter = document.querySelector('.rev-filter-btn.active')?.dataset?.filter || 'all';
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
          <div class="rev-empty-title notranslate" translate="no">
            Erro ao carregar
          </div>
          <div class="rev-empty-sub notranslate" translate="no">
            Verifique a ligação e tente novamente.
          </div>
        </div>
      `;
    }
  }
}

// ============================================================
// SECTION HEADER
// ============================================================

function _renderSectionHeader(subject, count) {
  const wrap = document.getElementById('rev-section-hdr-wrap');
  if (!wrap) return;
  const pending  = _records.filter(r => !r.retried).length;
  const resolved = _records.filter(r => r.retried).length;
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
// LIST RENDER
// ============================================================

function _showSkeleton() {
  const area = document.getElementById('rev-content-area');
  if (!area) return;
  area.innerHTML = `
    <div class="rev-skeleton-list">
      ${Array(4).fill('<div class="rev-skeleton-card"></div>').join('')}
    </div>
  `;
}

function _showChooseSubject() {
  const hdrWrap    = document.getElementById('rev-section-hdr-wrap');
  const filterRow  = document.getElementById('rev-filter-row');
  const contentArea = document.getElementById('rev-content-area');
  if (hdrWrap)    hdrWrap.innerHTML  = '';
  if (filterRow)  filterRow.style.display = 'none';
  if (contentArea) {
    contentArea.innerHTML = `
      <div class="rev-choose">
        <div class="rev-choose-icon">
          <i class="fa-solid fa-hand-pointer"></i>
        </div>
        <div class="rev-choose-text notranslate" translate="no">
          Seleccione uma disciplina acima<br>para ver os seus erros.
        </div>
      </div>
    `;
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
      ? 'Não tem erros por resolver nesta disciplina. Bom trabalho!'
      : 'Ainda não tem erros guardados para esta disciplina.';

    const iconName = filter === 'resolved' ? 'fa-check-circle' : 'fa-rotate';

    area.innerHTML = `
      <div class="rev-list">
        <div class="rev-empty">
          <div class="rev-empty-icon">
            <i class="fa-solid ${iconName}" aria-hidden="true"></i>
          </div>
          <div class="rev-empty-title notranslate" translate="no">
            ${filter === 'pending' ? 'Tudo resolvido!' : 'Sem registos'}
          </div>
          <div class="rev-empty-sub notranslate" translate="no">${_esc(msg)}</div>
        </div>
      </div>
    `;
    return;
  }

  area.innerHTML = `
    <div class="rev-list" id="rev-list-inner">
      ${visible.map(r => _cardHtml(r)).join('')}
    </div>
  `;

  // Wire card clicks
  area.querySelectorAll('.rev-card').forEach(card => {
    card.addEventListener('click', () => {
      const docId = card.dataset.docid;
      const record = _records.find(r => r._id === docId);
      if (record) _openFocus(record);
    });
  });
}

function _cardHtml(record) {
  const q       = record.questionData;
  const qText   = (q?.['Enunciado'] || '').trim();
  const qShort  = qText.length > 120 ? qText.slice(0, 117) + '...' : qText;
  const topic   = (record.topic || q?.['Tema_Relacionado'] || '').trim();
  const year    = normaliseYear(q?.['Ano'] || '');
  const context = record.context || '';
  const correct = _correctText(q);
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
            ${topic
              ? `<span class="rev-card-topic">${_esc(topic)}</span>`
              : ''}
            ${year
              ? `<span class="rev-card-date">Exame de ${_esc(year)}</span>`
              : ''}
            <span class="rev-card-date">${_relativeDate(record.savedAt)}</span>
            ${context
              ? `<span class="rev-card-context">${_esc(context)}</span>`
              : ''}
          </div>
          <div class="rev-card-question">${_esc(qShort)}</div>
          <div class="rev-card-answer-row">
            <span class="rev-card-answer-lbl">Resposta correcta:</span>
            <span class="rev-card-answer-val">${_esc(correct)}</span>
            <span class="rev-card-resolved-badge">
              <i class="fa-solid fa-check-circle"></i> Resolvido
            </span>
          </div>
        </div>
        <i class="fa-solid fa-chevron-right rev-card-arrow" aria-hidden="true"></i>
      </div>
    </div>
  `;
}

// ============================================================
// FOCUS STATE
// ============================================================

function _openFocus(record) {
  _focusRecord  = record;
  _liveQuestion = null;
  _chatHistory  = [];
  _mentorPaid   = false;
  _mentorOpen   = false;

  const listState  = document.getElementById('rev-list-state');
  const focusState = document.getElementById('rev-focus-state');
  if (listState)  listState.style.display = 'none';
  if (focusState) {
    focusState.classList.add('show');
    focusState.innerHTML = _buildFocusHtml(record);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  // Wire back button
  document.getElementById('rev-focus-back-btn')
    ?.addEventListener('click', _closeFocus);

  // Wire options
  _wireFocusOptions(record);

  // Wire mentor button
  document.getElementById('rev-btn-mentor')
    ?.addEventListener('click', _openMentor);

  // Wire resolve button
  document.getElementById('rev-btn-resolve')
    ?.addEventListener('click', () => _markResolved(record));

  // Wire next button (hidden until answered)
  document.getElementById('rev-btn-next')
    ?.addEventListener('click', _goNextQuestion);

  // Fetch AI explanation in background
  _fetchExplanation(record);
}

function _buildFocusHtml(record) {
  const q        = record.questionData;
  const qText    = (q?.['Enunciado'] || '').trim();
  const tipo     = (q?.['Tipo'] || 'escolha-multipla').trim();
  const topic    = (record.topic || q?.['Tema_Relacionado'] || '').trim();
  const year     = normaliseYear(q?.['Ano'] || '');
  const figure   = (q?.['Descrição_Figura'] || '').trim();
  const isResolved = !!record.retried;

  // Find position in visible records
  const allVisible = _records;
  const idx  = allVisible.findIndex(r => r._id === record._id);
  const pos  = idx >= 0 ? idx + 1 : 1;
  const total = allVisible.length;

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
      </div>
    `;
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
      </div>
    `;
  }

  const costLabel = `<span class="rev-mentor-cost">
    <i class="fa-solid fa-coins" style="font-size:9px;"></i> ${MENTOR_COST}
  </span>`;

  return `
    <!-- Back nav -->
    <div class="rev-focus-nav">
      <button class="rev-focus-back notranslate" translate="no" id="rev-focus-back-btn">
        <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
        Voltar à lista
      </button>
      <div class="rev-focus-pos notranslate" translate="no">
        ${pos} / ${total}
      </div>
    </div>

    <!-- Meta badges -->
    <div class="rev-focus-meta">
      <span class="rev-focus-badge subject notranslate" translate="no">
        ${_esc(_activeSubject)}
      </span>
      ${topic
        ? `<span class="rev-focus-badge topic notranslate" translate="no">
            ${_esc(topic)}</span>`
        : ''}
      ${year
        ? `<span class="rev-focus-badge year notranslate" translate="no">
            Exame de ${_esc(year)}</span>`
        : ''}
    </div>

    <!-- Study mode label -->
    <div class="rev-study-label notranslate" translate="no">
      <i class="fa-solid fa-book-open-reader" aria-hidden="true"></i>
      Leia a explicação abaixo com atenção, depois tente responder novamente.
    </div>

    <!-- AI Explanation card -->
    <div class="rev-expl-card">
      <div class="rev-expl-head">
        <div class="rev-expl-head-icon">
          <i class="fa-solid fa-lightbulb" aria-hidden="true"></i>
        </div>
        <div>
          <div class="rev-expl-head-title notranslate" translate="no">
            Explicação do Conceito
          </div>
          <div class="rev-expl-head-sub notranslate" translate="no">
            Preparada pelo Mentor com base no conteúdo do exame
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
        </div>
      ` : ''}
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
        ${costLabel}
      </button>
      <button class="rev-btn-resolve ${isResolved ? 'hidden' : ''} notranslate"
        translate="no" id="rev-btn-resolve">
        <i class="fa-solid fa-check" aria-hidden="true"></i>
        Marcar Resolvido
      </button>
    </div>

    <!-- Mentor chat panel (hidden until called) -->
    <div class="rev-mentor-panel" id="rev-mentor-panel"></div>

    <!-- Next question button (shown after answering) -->
    <button class="rev-btn-next notranslate" translate="no" id="rev-btn-next">
      <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
      Próxima Questão
    </button>
  `;
}

function _closeFocus() {
  _focusRecord  = null;
  _liveQuestion = null;
  _chatHistory  = [];
  _mentorPaid   = false;
  _mentorOpen   = false;

  const listState  = document.getElementById('rev-list-state');
  const focusState = document.getElementById('rev-focus-state');
  if (listState)  listState.style.display = 'block';
  if (focusState) {
    focusState.classList.remove('show');
    focusState.innerHTML = '';
  }

  window.scrollTo({ top: 0, behavior: 'instant' });

  // Re-render list to reflect any resolved changes
  const activeFilter = document.querySelector('.rev-filter-btn.active')?.dataset?.filter || 'all';
  _renderList(activeFilter);
  _renderSectionHeader(_activeSubject, _records.length);
}

function _goNextQuestion() {
  if (!_focusRecord) return;
  const idx = _records.findIndex(r => r._id === _focusRecord._id);
  const next = _records[idx + 1];
  if (next) {
    _openFocus(next);
  } else {
    _closeFocus();
  }
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
  const opts     = document.getElementById('rev-focus-opts');
  const feedback = document.getElementById('rev-feedback');
  const nextBtn  = document.getElementById('rev-btn-next');
  const mentorBtn = document.getElementById('rev-btn-mentor');
  if (!opts || !feedback) return;

  const correct    = _correctText(q);
  const isCorrect  = answerText === correct;

  // Lock all options
  if (tipo === 'verdadeiro-falso') {
    opts.querySelectorAll('.rev-tf-btn').forEach(btn => {
      btn.classList.add('locked');
      const isThis = btn.dataset.answer === answerText;
      const isCorrectBtn = btn.dataset.answer === correct;
      if (isCorrectBtn) btn.classList.add('correct-reveal');
      else if (isThis)  btn.classList.add('wrong-reveal');
    });
  } else {
    opts.querySelectorAll('.rev-option').forEach(btn => {
      btn.classList.add('locked');
      const isThis = btn.dataset.text === answerText;
      const isCorrectOpt = btn.dataset.text === correct;
      if (isCorrectOpt) btn.classList.add('correct-reveal');
      else if (isThis)  btn.classList.add('wrong-reveal');
    });
  }

  // Feedback
  feedback.className = `rev-feedback show ${isCorrect ? 'correct' : 'wrong'} notranslate`;
  feedback.setAttribute('translate', 'no');
  if (isCorrect) {
    feedback.innerHTML = `
      <i class="fa-solid fa-check-circle"></i>
      <span>Correcto! A sua resposta está certa. Continue assim.</span>
    `;
    // Auto-mark resolved
    if (_focusRecord && !_focusRecord.retried) {
      _markResolved(_focusRecord, true);
    }
  } else {
    feedback.innerHTML = `
      <i class="fa-solid fa-xmark-circle"></i>
      <span>Ainda não. A resposta correcta é: <strong>${_esc(correct)}</strong>. Use o Mentor se precisar de ajuda.</span>
    `;
    // Enable mentor button explicitly
    if (mentorBtn) mentorBtn.disabled = false;
  }

  // Apply KaTeX to feedback
  _renderMath(feedback);

  // Show next button
  if (nextBtn) nextBtn.classList.add('show');
}

// ============================================================
// MARK RESOLVED
// ============================================================

async function _markResolved(record, silent = false) {
  if (record.retried) return;

  try {
    await markRetried(record._id);
    record.retried   = true;
    record.retriedAt = new Date();

    // Update card in list (if list is still rendered somewhere)
    const cardEl = document.querySelector(`.rev-card[data-docid="${record._id}"]`);
    if (cardEl) cardEl.classList.add('resolved');

    if (!silent) {
      ui.showToast('Questão marcada como resolvida!', 'success');
    }

    // Hide resolve button in focus view
    document.getElementById('rev-btn-resolve')?.classList.add('hidden');

  } catch (e) {
    console.error('[Revisao] markResolved:', e);
    if (!silent) ui.showToast('Erro ao guardar. Tente novamente.', 'error');
  }
}

// ============================================================
// AI EXPLANATION — fetched before student retries
// ============================================================

async function _fetchExplanation(record) {
  const explBody = document.getElementById('rev-expl-body');
  if (!explBody) return;

  // Use cache if available
  if (_explanationCache[record._id]) {
    _setExplanationHtml(_explanationCache[record._id]);
    return;
  }

  const q           = record.questionData;
  const correct     = _correctText(q);
  const dbExpl      = (q?.['Explicação']        || '').trim();
  const dbRespPoss  = (q?.['Resposta_Possível'] || '').trim();
  const topic       = (q?.['Tema_Relacionado']  || '').trim();
  const disciplina  = (q?.['Disciplina']        || _activeSubject).trim();
  const classe      = (q?.['Classe']            || '').trim();
  const enunciado   = (q?.['Enunciado']         || '').slice(0, 500);

  const messages = [
    {
      role: 'system',
      content: `És um professor especialista em exames nacionais de Moçambique — ${disciplina}${classe ? ', ' + classe : ''}.
Tens acesso ao conteúdo oficial do exame para esta questão.
A tua tarefa: escrever uma explicação pedagógica clara (4 a 6 frases) em Português formal de Moçambique que:
1. Explica o conceito por detrás da questão — não só a resposta, mas o PORQUÊ
2. Usa os campos db_explicacao e db_resp_possivel como base — enriquece-os, nunca os copies
3. Ensina algo que o estudante pode aplicar em outras questões semelhantes
4. Usa equações e símbolos em formato KaTeX inline: $H_2O$, $x^2$, $\\frac{a}{b}$, $\\Delta$, $\\alpha$, $\\rightarrow$
   Para equações em display usa: $$E = mc^2$$
5. Tom encorajador mas rigoroso — adequado a estudante moçambicano do ensino secundário
6. Nunca menciones letras A/B/C/D — refere sempre o conteúdo da resposta
Responde APENAS com o texto da explicação — sem JSON, sem markdown, sem título.`,
    },
    {
      role: 'user',
      content: JSON.stringify({
        enunciado,
        resposta_correta: correct,
        tema:             topic,
        db_explicacao:    dbExpl.slice(0, 600),
        db_resp_possivel: dbRespPoss.slice(0, 600),
      }),
    },
  ];

  try {
    const raw = await worker.callAI(messages, { maxTokens: 600, temperature: 0.3 });
    const text = (raw || '').trim();
    _explanationCache[record._id] = text;
    _setExplanationHtml(text);
  } catch (e) {
    console.warn('[Revisao] explanation fetch:', e);
    const fallback = dbExpl || dbRespPoss || 'Consulte o seu professor ou manual para mais informações.';
    _explanationCache[record._id] = fallback;
    _setExplanationHtml(fallback);
  }
}

function _setExplanationHtml(text) {
  const explBody = document.getElementById('rev-expl-body');
  if (!explBody) return;
  explBody.innerHTML = `
    <div class="rev-expl-body notranslate" translate="no" id="rev-expl-text">
      ${_esc(text)}
    </div>
  `;
  // Run KaTeX on the explanation
  _renderMath(document.getElementById('rev-expl-text'));
  // Also run on the question text
  _renderMath(document.getElementById('rev-focus-q-text'));
}

// ============================================================
// MENTOR CHAT
// ============================================================

async function _openMentor() {
  if (_mentorOpen) return;

  const bal = moeda.getBalance(_userData);
  if (bal < MENTOR_COST) {
    moeda.showMoedasSheet(bal, MENTOR_COST);
    return;
  }

  _mentorOpen = true;
  _chatHistory = [];

  const panel = document.getElementById('rev-mentor-panel');
  if (!panel) return;

  panel.classList.add('show');
  panel.innerHTML = _buildMentorPanelHtml();

  // Scroll panel into view
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Wire close
  document.getElementById('rev-mentor-close')
    ?.addEventListener('click', _closeMentor);

  // Wire understood
  document.getElementById('rev-btn-understood')
    ?.addEventListener('click', _handleUnderstood);

  // Wire send
  document.getElementById('rev-mentor-send')
    ?.addEventListener('click', _sendMentorMessage);

  const ta = document.getElementById('rev-mentor-textarea');
  ta?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      _sendMentorMessage();
    }
  });

  // Auto-resize textarea
  ta?.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 100) + 'px';
  });

  // Fetch live question for richer context
  _fetchLiveQuestion();

  // Opening greeting from AI
  _appendMentorMessage('ai', 'Olá! Estou aqui para ajudar. O que não está a perceber nesta questão? Pode perguntar em português.');
}

function _buildMentorPanelHtml() {
  const q     = _focusRecord?.questionData;
  const topic = (q?.['Tema_Relacionado'] || _activeSubject || '').trim();

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
          ${_esc(topic)} · Conversa encerrada ao sair desta questão
        </div>
      </div>
      <button class="rev-mentor-close notranslate" translate="no" id="rev-mentor-close">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>

    <div class="rev-mentor-cost-notice notranslate" translate="no"
      id="rev-mentor-cost-notice">
      <i class="fa-solid fa-coins"></i>
      Primeira mensagem deduz ${MENTOR_COST} Moedas da sua conta
    </div>

    <div class="rev-mentor-messages" id="rev-mentor-messages"></div>

    <div class="rev-mentor-input-row">
      <textarea class="rev-mentor-textarea notranslate" translate="no"
        id="rev-mentor-textarea"
        placeholder="Escreva a sua dúvida…"
        rows="1"
        maxlength="500"></textarea>
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
    ui.showToast('Limite de mensagens desta sessão atingido. Feche e abra novamente.', 'info');
    return;
  }

  // First message — deduct Moedas
  if (!_mentorPaid) {
    const bal = moeda.getBalance(_userData);
    if (bal < MENTOR_COST) {
      moeda.showMoedasSheet(bal, MENTOR_COST);
      return;
    }
    try {
      const result = await moeda.deductMoedas(_user.uid, MENTOR_COST);
      if (!result.success) {
        ui.showToast('Erro ao deduzir Moedas. Tente novamente.', 'error');
        return;
      }
      _mentorPaid = true;
      _userData = { ..._userData, moedas: result.newBalance };
      // Hide cost notice
      document.getElementById('rev-mentor-cost-notice')?.classList.add('hidden');
    } catch (e) {
      console.error('[Revisao] deductMoedas:', e);
      ui.showToast('Erro ao deduzir Moedas.', 'error');
      return;
    }
  }

  _isSending = true;
  ta.value = '';
  ta.style.height = 'auto';
  ta.disabled = true;
  document.getElementById('rev-mentor-send')?.setAttribute('disabled', true);

  _appendMentorMessage('user', text);
  _chatHistory.push({ role: 'user', content: text });

  // Show typing indicator
  const typingId = 'rev-typing-' + Date.now();
  _appendTypingIndicator(typingId);

  try {
    // Build context from question data
    const q           = _liveQuestion || _focusRecord?.questionData;
    const correct     = _correctText(q);
    const dbExpl      = (q?.['Explicação']        || '').trim();
    const dbRespPoss  = (q?.['Resposta_Possível'] || '').trim();
    const topic       = (q?.['Tema_Relacionado']  || '').trim();
    const disciplina  = (q?.['Disciplina']        || _activeSubject).trim();
    const classe      = (q?.['Classe']            || '').trim();
    const enunciado   = (q?.['Enunciado']         || '').slice(0, 600);
    const opts        = getOptions(q);
    const optsText    = opts.map(o => `${o.letter}) ${o.text}`).join(' | ');

    const systemPrompt = `És o Mentor do ExameNova — tutor especialista em ${disciplina}${classe ? ', ' + classe : ''} para o sistema de ensino de Moçambique.
O estudante está a rever uma questão que errou. Tens todo o contexto da questão abaixo.

QUESTÃO:
${enunciado}

${optsText ? 'OPÇÕES: ' + optsText : ''}

RESPOSTA CORRECTA: ${correct}
${dbExpl      ? 'EXPLICAÇÃO OFICIAL: ' + dbExpl.slice(0, 500)      : ''}
${dbRespPoss  ? 'RESPOSTA POSSÍVEL: '  + dbRespPoss.slice(0, 500)  : ''}
${topic       ? 'TEMA: '               + topic                      : ''}

REGRAS:
- Responde SEMPRE em Português formal de Moçambique
- Usa o conteúdo oficial acima como base — nunca inventes factos
- Explica de forma clara e pedagógica, adequada ao nível do estudante
- Para equações usa KaTeX: $x^2$, $\\frac{a}{b}$, $H_2O$, etc.
- Nunca digas directamente "a resposta é X" antes do estudante tentar
- Guia o estudante a chegar à compreensão por si próprio
- Respostas curtas e focadas — máximo 4 frases por resposta
- Se o estudante já percebeu, encoraja-o a tentar a questão novamente`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ..._chatHistory.slice(-10), // last 10 turns max
    ];

    const raw = await worker.callAI(messages, { maxTokens: 400, temperature: 0.4 });
    const aiText = (raw || '').trim() || 'Não consegui gerar uma resposta. Tente novamente.';

    _chatHistory.push({ role: 'assistant', content: aiText });

    // Remove typing indicator
    document.getElementById(typingId)?.remove();

    _appendMentorMessage('ai', aiText);

  } catch (e) {
    console.error('[Revisao] mentor send:', e);
    document.getElementById(typingId)?.remove();
    _appendMentorMessage('ai', 'Ocorreu um erro. Verifique a ligação e tente novamente.');
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
  div.textContent = text;
  container.appendChild(div);

  // Render KaTeX on AI messages
  if (role === 'ai') _renderMath(div);

  // Scroll to bottom
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
    </div>
  `;
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
  // Mark as resolved if not already, silently
  if (_focusRecord && !_focusRecord.retried) {
    _markResolved(_focusRecord, true);
    ui.showToast('Bem feito! Questão marcada como compreendida.', 'success');
  }
  _closeMentor();

  // Show next button
  document.getElementById('rev-btn-next')?.classList.add('show');
}

// ============================================================
// EXPORT
// ============================================================

export default RevisaoScreen;
