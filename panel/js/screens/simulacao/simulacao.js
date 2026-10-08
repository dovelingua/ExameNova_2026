// ============================================================
// panel/js/screens/simulacao/simulacao.js
// ExameNova — Exam Simulation Setup Screen v4.1
//
// CHANGES v4.1:
//   - Coloured sheet header (gradient blue)
//   - Blue section headings
//   - Green question count badge
//   - X button in sheet header + Fechar button at bottom
//   - Insufficient moedas card (WhatsApp + Convidar Amigos)
//   - moeda.gate() replaced with inline balance check
//
// ARCHITECTURE:
//   - Sheet + overlay appended to document.body directly
//   - Never inside .sim-wrap — eliminates all duplication bugs
//   - Sheet always opens first, fetch happens inside it
//   - _isStillOpen() guard discards stale fetches
//   - Back always goes to dashboard
//
// KEY RULES:
//   - q['Resposta'] stores OPTION TEXT not a letter (DB questions)
//   - q['Enunciado'] is the question text
//   - Admissão: no Classe filter, no Chamada
//   - Grade 9 → '10ª Classe' in DB
//   - AI questions store letter in Resposta ('A','B'...)
//   - q._aiGenerated = true for AI questions
//
// keepAlive: false | Navbar: absent | Header: back button only
// ============================================================

import { router }  from '../../core/router.js';
import { ui }      from '../../core/ui.js';
import { moeda }   from '../../core/moeda.js';
import { worker }  from '../../core/worker.js';
import { session } from '../../core/session.js';
import { getStudentSubjects } from '../../core/app.js';
import {
  exams,
  fetchQuestions,
  fetchExamTexts,
  getOptions,
  getInlineText,
  isLanguageSubject,
  normaliseYear,
  pickRandom,
  topicFrequency,
} from '../../core/exams.js';

// ── Constants ─────────────────────────────────────────────────
const SUPPORTED_TYPES = ['escolha-multipla', 'verdadeiro-falso'];
const MAX_Q = 40;
const MIN_Q = 5;

// ── Module-level state ────────────────────────────────────────
let _user      = null;
let _userData  = null;
let _subjects  = [];
let _activeTab = 'autogera';

// Cache: avoids re-fetching same subject
const _cache = {
  autogera:   {},
  anteriores: {},
};

// What is currently open in the sheet
const _sheet = {
  subject: '',
  tab:     '',
  open:    false,
};

// Live selections — reset each time a sheet opens
const _sel = {
  autogera: {
    topics: [], types: [], numQ: 10,
    includeText: false, promptText: '',
  },
  anteriores: {
    years: [], topics: [], types: [],
    numQ: 10, includeText: true,
  },
};

// DOM references for the body-level sheet elements
let _overlayEl = null;
let _sheetEl   = null;

// ── Subject icons ─────────────────────────────────────────────
const SUBJECT_ICONS = {
  'matemática':   'fa-square-root-variable',
  'física':       'fa-atom',
  'química':      'fa-flask',
  'biologia':     'fa-dna',
  'história':     'fa-landmark',
  'geografia':    'fa-earth-africa',
  'portuguesa':   'fa-book',
  'inglesa':      'fa-comment-dots',
  'francesa':     'fa-comment-dots',
  'filosofia':    'fa-brain',
  'economia':     'fa-chart-line',
  'contabilidade':'fa-calculator',
  'direito':      'fa-scale-balanced',
  'informática':  'fa-laptop-code',
  'sociologia':   'fa-people-group',
};

function _icon(subject) {
  const low = subject.toLowerCase();
  for (const [k, v] of Object.entries(SUBJECT_ICONS)) {
    if (low.includes(k)) return v;
  }
  return 'fa-book-open';
}

// ── Profile badge text ────────────────────────────────────────
function _profileBadgeText() {
  const examType    = _userData?.examType;
  const grade       = _userData?.grade;
  const course      = _userData?.course      || '';
  const institution = _userData?.institution || '';
  const repeating   = _userData?.repeating;

  if (examType === 'ensino-geral') {
    const gradeLabel = grade === '9'  ? '9ª Classe'
                     : grade === '12' ? '12ª Classe'
                     : `${grade}ª Classe`;
    const modeLabel  = repeating ? 'Repetente' : 'Normal';
    return `${gradeLabel} · ${modeLabel}`;
  }
  if (examType === 'admissao') {
    if (institution) return `Admissão · ${institution.toUpperCase()}`;
    if (course)      return `Admissão · ${course}`;
    return 'Exame de Admissão';
  }
  return '';
}

// ============================================================
// SCREEN OBJECT
// ============================================================

const SimulacaoScreen = {

  css() {
    if (document.getElementById('sim-styles')) return '';
    return `<style id="sim-styles">

      /* ── PAGE ── */
      .sim-wrap {
        min-height: 100dvh;
        background: var(--bg);
        padding-bottom: 40px;
      }

      /* ── PROFILE STRIP (under header) ── */
      .sim-profile-strip {
        background: var(--surface);
        border-bottom: 1px solid var(--border);
        padding: 8px 16px;
        display: flex;
        align-items: center;
        gap: 7px;
      }
      .sim-profile-strip i {
        font-size: 11px;
        color: var(--primary);
      }
      .sim-profile-strip-text {
        font-size: 12px;
        font-weight: 700;
        color: var(--text-secondary);
        letter-spacing: 0.01em;
      }

      /* ── TABS ── */
      .sim-tabs {
        display: flex;
        background: var(--surface);
        border-bottom: 2px solid var(--border);
        position: sticky;
        top: 0;
        z-index: 10;
      }
      .sim-tab {
        flex: 1;
        padding: 14px 8px;
        font-family: inherit;
        font-size: 14px; font-weight: 700;
        color: var(--text-muted);
        background: none;
        border: none;
        border-bottom: 3px solid transparent;
        margin-bottom: -2px;
        cursor: pointer;
        transition: color 0.2s, border-color 0.2s;
        display: flex; align-items: center;
        justify-content: center; gap: 7px;
      }
      .sim-tab.active {
        color: var(--primary);
        border-bottom-color: var(--primary);
      }
      .sim-tab-cost {
        display: inline-flex; align-items: center; gap: 3px;
        font-size: 11px; font-weight: 700;
        color: var(--moeda);
        background: var(--moeda-light);
        border-radius: var(--radius-full);
        padding: 2px 8px;
      }
      .sim-tab.active .sim-tab-cost {
        background: rgba(2,132,199,0.1);
        color: var(--primary);
      }

      /* ── PANELS ── */
      .sim-panel { display: none; }
      .sim-panel.active { display: block; }

      /* ── SUBJECT LIST ── */
      .sim-list {
        padding: 16px 16px 0;
      }
      .sim-item {
        display: flex; align-items: center; gap: 14px;
        padding: 14px 16px;
        background: var(--surface);
        border: 1.5px solid var(--border);
        border-radius: var(--radius-lg);
        margin-bottom: 10px;
        cursor: pointer;
        transition: border-color 0.18s, transform 0.12s;
        -webkit-tap-highlight-color: transparent;
        user-select: none;
      }
      .sim-item:active {
        transform: scale(0.984);
        border-color: var(--primary);
      }
      .sim-item-icon {
        width: 46px; height: 46px;
        border-radius: var(--radius-md);
        background: rgba(2,132,199,0.09);
        display: flex; align-items: center; justify-content: center;
        font-size: 19px; color: var(--primary);
        flex-shrink: 0;
      }
      .sim-item-name {
        flex: 1;
        font-size: 15px; font-weight: 700;
        color: var(--text); line-height: 1.3;
      }
      .sim-item-arrow {
        font-size: 12px; color: var(--text-muted);
      }

      /* ── BODY-LEVEL OVERLAY ── */
      .simov {
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.5);
        z-index: 9000;
        opacity: 0; pointer-events: none;
        transition: opacity 0.25s;
      }
      .simov.on { opacity: 1; pointer-events: all; }

      /* ── BODY-LEVEL BOTTOM SHEET ── */
      .simsht {
        position: fixed;
        bottom: 0; left: 0; right: 0;
        background: var(--surface);
        border-radius: 22px 22px 0 0;
        z-index: 9001;
        max-height: 92dvh;
        display: flex; flex-direction: column;
        transform: translateY(100%);
        transition: transform 0.32s cubic-bezier(0.32,0,0,1);
        padding-bottom: env(safe-area-inset-bottom, 16px);
        will-change: transform;
      }
      .simsht.on { transform: translateY(0); }

      .simsht-handle {
        width: 36px; height: 4px;
        background: var(--border);
        border-radius: 99px;
        margin: 12px auto 0;
        flex-shrink: 0;
      }

      /* ── SHEET HEADER — coloured ── */
      .simsht-hdr {
        padding: 14px 20px 13px;
        display: flex; align-items: center; gap: 13px;
        background: linear-gradient(135deg, rgba(3,105,161,0.08) 0%, rgba(2,132,199,0.05) 100%);
        border-radius: 16px 16px 0 0;
        border-bottom: 1.5px solid var(--border);
        flex-shrink: 0;
        position: relative;
      }
      .simsht-hdr-icon {
        width: 42px; height: 42px;
        border-radius: var(--radius-md);
        background: rgba(2,132,199,0.09);
        display: flex; align-items: center; justify-content: center;
        font-size: 18px; color: var(--primary);
        flex-shrink: 0;
      }
      .simsht-hdr-title {
        font-size: 16px; font-weight: 800;
        color: var(--text); line-height: 1.2;
      }
      .simsht-hdr-sub {
        font-size: 12px;
        color: var(--text-muted);
        margin-top: 2px;
      }
      .simsht-hdr-close {
        position: absolute; top: 50%; right: 16px;
        transform: translateY(-50%);
        width: 32px; height: 32px;
        background: var(--bg);
        border: 1.5px solid var(--border); border-radius: 50%;
        color: var(--text-muted); font-size: 14px;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer;
        transition: background 0.15s;
        font-family: inherit;
        flex-shrink: 0;
      }
      .simsht-hdr-close:hover {
        border-color: var(--primary);
        color: var(--primary);
      }
      .simsht-hdr-close:active {
        transform: translateY(-50%) scale(0.92);
      }

      /* scrollable area */
      .simsht-body {
        overflow-y: auto; flex: 1;
        padding: 20px 20px 8px;
        -webkit-overflow-scrolling: touch;
      }

      /* ── SECTION LABEL — primary blue ── */
      .sht-sec {
        font-size: 11px; font-weight: 700;
        text-transform: uppercase; letter-spacing: 0.08em;
        color: var(--primary);
        margin: 20px 0 8px;
      }
      .sht-sec:first-child { margin-top: 0; }

      /* ── SHEET STATES (loading / error) ── */
      .sht-state {
        padding: 44px 16px;
        display: flex; flex-direction: column;
        align-items: center; gap: 14px;
        text-align: center;
      }
      .sht-spin {
        width: 30px; height: 30px;
        border: 3px solid var(--border);
        border-top-color: var(--primary);
        border-radius: 50%;
        animation: shtSpin 0.7s linear infinite;
      }
      .sht-state-txt {
        font-size: 14px; font-weight: 600;
        color: var(--text-muted); line-height: 1.5;
        max-width: 260px;
      }
      .sht-err-icon {
        font-size: 36px; color: #EF4444;
      }

      /* ── DROPDOWN CHECKLIST ── */
      .sht-dd { position: relative; margin-bottom: 4px; }
      .sht-dd-btn {
        width: 100%;
        background: var(--bg);
        border: 1.5px solid var(--border);
        border-radius: var(--radius-md);
        padding: 12px 14px;
        font-family: inherit;
        font-size: 14px; color: var(--text);
        text-align: left; cursor: pointer;
        box-sizing: border-box;
        display: flex; align-items: center;
        justify-content: space-between; gap: 8px;
        min-height: 48px;
        transition: border-color 0.15s;
      }
      .sht-dd-btn:hover { border-color: var(--primary); }
      .sht-dd-btn.on {
        border-color: var(--primary);
        border-radius: var(--radius-md) var(--radius-md) 0 0;
      }
      .sht-dd-inner {
        display: flex; align-items: center; gap: 7px;
        flex: 1; min-width: 0;
      }
      .sht-dd-lbl {
        font-size: 14px; flex: 1;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        color: var(--text);
      }
      .sht-dd-lbl.ph { color: var(--text-muted); }
      .sht-dd-badge {
        background: var(--primary); color: #fff;
        border-radius: 99px;
        font-size: 10px; font-weight: 700;
        padding: 1px 8px; flex-shrink: 0;
      }
      .sht-dd-arrow {
        font-size: 10px; color: var(--primary);
        transition: transform 0.2s; flex-shrink: 0;
      }
      .sht-dd-btn.on .sht-dd-arrow { transform: rotate(180deg); }

      .sht-dd-list {
        display: none;
        position: absolute;
        top: 100%; left: 0; right: 0;
        background: var(--surface);
        border: 1.5px solid var(--primary);
        border-top: none;
        border-radius: 0 0 var(--radius-md) var(--radius-md);
        max-height: 180px; overflow-y: auto;
        z-index: 20;
        box-shadow: 0 6px 20px rgba(0,0,0,0.12);
      }
      .sht-dd-list.on { display: block; }

      .sht-dd-item {
        display: flex; align-items: center; gap: 10px;
        padding: 11px 14px; cursor: pointer;
        border-bottom: 1px solid var(--border);
        transition: background 0.1s;
      }
      .sht-dd-item:last-child { border-bottom: none; }
      .sht-dd-item:hover { background: rgba(2,132,199,0.06); }
      .sht-dd-chk {
        width: 18px; height: 18px;
        border-radius: 4px;
        border: 1.5px solid var(--border);
        background: var(--bg);
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0;
        font-size: 10px; color: #fff;
        transition: all 0.12s;
      }
      .sht-dd-item.on .sht-dd-chk {
        background: var(--primary);
        border-color: var(--primary);
      }
      .sht-dd-item-lbl {
        font-size: 14px; color: var(--text);
        flex: 1; line-height: 1.4;
      }

      /* ── TYPE PILLS ── */
      .sht-type-row { display: flex; gap: 8px; }
      .sht-type-pill {
        flex: 1; padding: 11px 8px;
        border-radius: var(--radius-md);
        border: 1.5px solid var(--border);
        background: var(--bg);
        font-family: inherit;
        font-size: 13px; font-weight: 600;
        color: var(--text-secondary);
        cursor: pointer; text-align: center;
        transition: all 0.15s;
        -webkit-tap-highlight-color: transparent;
      }
      .sht-type-pill.on {
        border-color: var(--primary);
        background: rgba(2,132,199,0.08);
        color: var(--primary);
      }
      .sht-type-pill:active { transform: scale(0.96); }

      /* ── TOGGLE ── */
      .sht-toggle-row {
        display: flex; align-items: center;
        justify-content: space-between; gap: 12px;
        padding: 13px 16px;
        background: var(--bg);
        border: 1.5px solid var(--border);
        border-radius: var(--radius-md);
      }
      .sht-toggle-lbl {
        font-size: 14px; font-weight: 700; color: var(--text);
      }
      .sht-toggle {
        position: relative; width: 44px; height: 24px; flex-shrink: 0;
      }
      .sht-toggle input { opacity: 0; width: 0; height: 0; }
      .sht-toggle-sl {
        position: absolute; inset: 0;
        background: var(--border);
        border-radius: 99px; cursor: pointer;
        transition: background 0.2s;
      }
      .sht-toggle-sl::before {
        content: '';
        position: absolute;
        width: 18px; height: 18px;
        left: 3px; bottom: 3px;
        background: #fff; border-radius: 50%;
        transition: transform 0.2s;
        box-shadow: 0 1px 4px rgba(0,0,0,0.2);
      }
      .sht-toggle input:checked + .sht-toggle-sl { background: var(--primary); }
      .sht-toggle input:checked + .sht-toggle-sl::before { transform: translateX(20px); }

      /* structure note */
      .sht-struct-note {
        font-size: 12px; color: var(--text-muted);
        line-height: 1.6; padding: 10px 14px;
        background: var(--bg); border: 1px solid var(--border);
        border-radius: var(--radius-md); margin-top: 8px;
      }
      .sht-struct-note strong { color: var(--text-secondary); }

      /* ── STEPPER ── */
      .sht-stepper {
        display: flex; align-items: center;
        background: var(--bg);
        border: 1.5px solid var(--border);
        border-radius: var(--radius-md);
        overflow: hidden; width: fit-content;
      }
      .sht-step-btn {
        width: 54px; height: 52px;
        background: none; border: none;
        font-size: 22px; font-weight: 700;
        color: var(--primary); cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        font-family: inherit; transition: background 0.15s;
      }
      .sht-step-btn:hover  { background: rgba(2,132,199,0.07); }
      .sht-step-btn:active { transform: scale(0.9); }
      .sht-step-btn:disabled { color: var(--border); cursor: not-allowed; }
      .sht-step-val {
        min-width: 64px; text-align: center;
        font-size: 20px; font-weight: 800; color: var(--text);
        border-left: 1px solid var(--border);
        border-right: 1px solid var(--border);
        line-height: 52px;
      }

      /* ── PROMPT ── */
      .sht-prompt-wrap { position: relative; }
      .sht-prompt {
        width: 100%;
        background: var(--bg);
        border: 1.5px solid var(--border);
        border-radius: var(--radius-md);
        padding: 13px 16px 36px;
        font-family: inherit;
        font-size: 14px; color: var(--text);
        outline: none; resize: none;
        box-sizing: border-box;
        min-height: 86px; line-height: 1.5;
        transition: border-color 0.2s;
      }
      .sht-prompt::placeholder { color: var(--text-muted); }
      .sht-prompt:focus {
        border-color: var(--primary);
        box-shadow: 0 0 0 3px rgba(2,132,199,0.1);
      }
      .sht-prompt-foot {
        position: absolute; bottom: 9px;
        left: 14px; right: 14px;
        display: flex; align-items: center;
        justify-content: space-between;
        pointer-events: none;
      }
      .sht-prompt-cc { font-size: 10px; color: var(--text-muted); }
      .sht-prompt-extra {
        font-size: 10px; font-weight: 700; color: var(--moeda);
        background: var(--moeda-light); border-radius: 99px;
        padding: 2px 8px;
        display: inline-flex; align-items: center; gap: 3px;
      }

      /* ── COUNT BADGE — green ── */
      .sht-count {
        display: inline-flex; align-items: center; gap: 5px;
        font-size: 12px; font-weight: 600;
        color: #16A34A;
        background: rgba(22,163,74,0.08);
        border: 1px solid rgba(22,163,74,0.25);
        border-radius: 99px;
        padding: 5px 14px;
      }
      .sht-count.err {
        color: #EF4444;
        background: rgba(239,68,68,0.07);
        border-color: #EF4444;
      }

      /* ── COST BLOCK ── */
      .sht-cost {
        display: flex; align-items: center;
        justify-content: center; gap: 10px;
        padding: 16px;
        background: var(--moeda-light);
        border-radius: var(--radius-md);
        margin-top: 24px;
      }
      .sht-cost i { font-size: 22px; color: var(--moeda); }
      .sht-cost-n {
        font-size: 26px; font-weight: 900;
        color: var(--moeda); line-height: 1;
      }
      .sht-cost-lbl {
        font-size: 14px; font-weight: 600;
        color: var(--text-secondary);
      }

      /* ── INSUFFICIENT MOEDAS CARD ── */
      .sht-moeda-warn {
        display: none;
        margin-top: 12px;
        background: rgba(239,68,68,0.06);
        border: 1.5px solid rgba(239,68,68,0.25);
        border-radius: var(--radius-md);
        padding: 14px 16px;
      }
      .sht-moeda-warn.on { display: block; }
      .sht-moeda-warn-title {
        display: flex; align-items: center; gap: 8px;
        font-size: 13px; font-weight: 700;
        color: #EF4444; margin-bottom: 4px;
      }
      .sht-moeda-warn-msg {
        font-size: 12px; font-weight: 500;
        color: var(--text-secondary); line-height: 1.5;
        margin-bottom: 12px;
      }
      .sht-moeda-warn-btns {
        display: flex; gap: 8px;
      }
      .sht-moeda-btn {
        flex: 1; padding: 10px 8px;
        border-radius: var(--radius-md);
        border: none; font-family: inherit;
        font-size: 12px; font-weight: 700;
        cursor: pointer; display: flex;
        align-items: center; justify-content: center; gap: 6px;
        transition: opacity 0.15s, transform 0.12s;
        -webkit-tap-highlight-color: transparent;
      }
      .sht-moeda-btn:active { transform: scale(0.96); }
      .sht-moeda-btn-wa {
        background: #25D366; color: #fff;
      }
      .sht-moeda-btn-inv {
        background: var(--primary); color: #fff;
      }

      /* ── START BUTTON ── */
      .sht-go {
        width: 100%; padding: 17px;
        color: #fff; font-family: inherit;
        font-size: 16px; font-weight: 800;
        border: none; border-radius: var(--radius-md);
        cursor: pointer;
        display: flex; align-items: center;
        justify-content: center; gap: 9px;
        margin-top: 12px;
        min-height: 54px;
        transition: opacity 0.2s, transform 0.15s;
      }
      .sht-go:hover:not(:disabled)  { opacity: 0.9; }
      .sht-go:active:not(:disabled) { transform: scale(0.98); }
      .sht-go:disabled { opacity: 0.38; cursor: not-allowed; }
      .sht-go-spin {
        width: 18px; height: 18px;
        border: 2.5px solid rgba(255,255,255,0.3);
        border-top-color: #fff; border-radius: 50%;
        animation: shtSpin 0.7s linear infinite;
        display: none; flex-shrink: 0;
      }
      .sht-go.loading .sht-go-spin { display: block; }
      .sht-go.loading .sht-go-lbl  { display: none; }

      /* ── FECHAR BUTTON ── */
      .sht-fechar {
        width: 100%; padding: 14px;
        background: none;
        border: 1.5px solid var(--border);
        border-radius: var(--radius-md);
        font-family: inherit;
        font-size: 14px; font-weight: 700;
        color: var(--text-muted);
        cursor: pointer;
        margin-top: 10px; margin-bottom: 20px;
        transition: border-color 0.15s, color 0.15s;
        -webkit-tap-highlight-color: transparent;
      }
      .sht-fechar:hover {
        border-color: var(--primary);
        color: var(--primary);
      }
      .sht-fechar:active { transform: scale(0.98); }

      /* ── DARK ── */
      [data-theme="dark"] .sim-item,
      [data-theme="dark"] .simsht { background: var(--bg-card); }
      [data-theme="dark"] .sim-item-icon { background: rgba(56,189,248,0.08); }
      [data-theme="dark"] .simsht-hdr-icon { background: rgba(56,189,248,0.08); }
      [data-theme="dark"] .sht-dd-btn,
      [data-theme="dark"] .sht-dd-list,
      [data-theme="dark"] .sht-dd-chk,
      [data-theme="dark"] .sht-type-pill,
      [data-theme="dark"] .sht-toggle-row,
      [data-theme="dark"] .sht-stepper,
      [data-theme="dark"] .sht-prompt,
      [data-theme="dark"] .sht-struct-note,
      [data-theme="dark"] .sht-count { background: var(--bg); }
      [data-theme="dark"] .sht-dd-list { background: var(--bg-card); }
      [data-theme="dark"] .sim-profile-strip { background: var(--bg-card); }

      /* ── RESPONSIVE ── */
      @media (min-width: 768px) {
        .sim-list { padding: 20px 24px 0; }
        .simsht {
          max-width: 480px;
          left: 50%;
          right: auto;
          transform: translateX(-50%) translateY(100%);
        }
        .simsht.on { transform: translateX(-50%) translateY(0); }
      }
      @media (min-width: 1025px) {
        .sim-wrap { max-width: 720px; margin: 0 auto; }
      }

      @keyframes shtSpin { to { transform: rotate(360deg); } }

    </style>`;
  },

  mount() {
    return `
      <div class="sim-wrap">
        <div id="header-mount"></div>

        <!-- Profile strip -->
        <div class="sim-profile-strip" id="sim-profile-strip">
          <i class="fa-solid fa-circle-user" aria-hidden="true"></i>
          <span class="sim-profile-strip-text notranslate" translate="no"
            id="sim-profile-txt"></span>
        </div>

        <!-- Tabs -->
        <div class="sim-tabs">
          <button class="sim-tab active notranslate" id="sim-tab-ag" translate="no">
            <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
            Auto Gera
            <span class="sim-tab-cost">
              <i class="fa-solid fa-coins"></i> 3
            </span>
          </button>
          <button class="sim-tab notranslate" id="sim-tab-ant" translate="no">
            <i class="fa-solid fa-book-open" aria-hidden="true"></i>
            Exames Anteriores
            <span class="sim-tab-cost">
              <i class="fa-solid fa-coins"></i> 6
            </span>
          </button>
        </div>

        <!-- Subject lists -->
        <div class="sim-panel active" id="sim-panel-ag">
          <div class="sim-list" id="sim-list-ag"></div>
        </div>
        <div class="sim-panel" id="sim-panel-ant">
          <div class="sim-list" id="sim-list-ant"></div>
        </div>

      </div>
      <!-- NOTE: overlay + sheet are injected into document.body in init() -->
    `;
  },

  async init(user, userData, params) {
    _user      = user;
    _userData  = userData;
    _activeTab = 'autogera';
    _cache.autogera   = {};
    _cache.anteriores = {};
    _sheet.open    = false;
    _sheet.subject = '';
    _sheet.tab     = '';

    ui.renderHeader({
      title:          'Simulação',
      backRoute:      '/panel/dashboard',
      showDarkToggle: true,
      moedasBalance:  moeda.getBalance(userData),
    });

    const profileTxt = document.getElementById('sim-profile-txt');
    if (profileTxt) profileTxt.textContent = _profileBadgeText();

    _subjects = getStudentSubjects(userData);

    document.getElementById('sim-tab-ag')
      ?.addEventListener('click', () => _switchTab('autogera'));
    document.getElementById('sim-tab-ant')
      ?.addEventListener('click', () => _switchTab('anteriores'));

    _buildList('sim-list-ag',  'autogera');
    _buildList('sim-list-ant', 'anteriores');

    _injectSheet();
  },

  destroy() {
    _cache.autogera   = {};
    _cache.anteriores = {};
    _destroySheet();
  },
};

// ============================================================
// INJECT / DESTROY BODY-LEVEL SHEET
// ============================================================

function _injectSheet() {
  _destroySheet();

  _overlayEl = document.createElement('div');
  _overlayEl.className = 'simov';
  _overlayEl.id = 'simov';
  _overlayEl.addEventListener('click', _closeSheet);
  document.body.appendChild(_overlayEl);

  _sheetEl = document.createElement('div');
  _sheetEl.className = 'simsht';
  _sheetEl.id = 'simsht';
  _sheetEl.innerHTML = `
    <div class="simsht-handle"></div>
    <div class="simsht-hdr" id="simsht-hdr"></div>
    <div class="simsht-body" id="simsht-body"></div>
  `;
  document.body.appendChild(_sheetEl);
}

function _destroySheet() {
  document.body.style.overflow = '';
  if (_overlayEl) { _overlayEl.remove(); _overlayEl = null; }
  if (_sheetEl)   { _sheetEl.remove();   _sheetEl   = null; }
  _sheet.open    = false;
  _sheet.subject = '';
  _sheet.tab     = '';
}

// ============================================================
// TAB SWITCHING
// ============================================================

function _switchTab(tab) {
  _activeTab = tab;
  const ag  = tab === 'autogera';
  document.getElementById('sim-tab-ag')?.classList.toggle('active',  ag);
  document.getElementById('sim-tab-ant')?.classList.toggle('active', !ag);
  document.getElementById('sim-panel-ag')?.classList.toggle('active',  ag);
  document.getElementById('sim-panel-ant')?.classList.toggle('active', !ag);
}

// ============================================================
// SUBJECT LIST
// ============================================================

function _buildList(containerId, tab) {
  const el = document.getElementById(containerId);
  if (!el) return;

  if (!_subjects.length) {
    el.innerHTML = `
      <div style="padding:48px 16px;text-align:center;">
        <div style="font-size:14px;color:var(--text-muted);font-weight:600;">
          Nenhuma disciplina encontrada no seu perfil.
        </div>
      </div>`;
    return;
  }

  el.innerHTML = _subjects.map(s => `
    <div class="sim-item notranslate" translate="no"
         data-subject="${_esc(s)}" data-tab="${tab}">
      <div class="sim-item-icon">
        <i class="fa-solid ${_icon(s)}" aria-hidden="true"></i>
      </div>
      <div class="sim-item-name">${_esc(s)}</div>
      <i class="fa-solid fa-chevron-right sim-item-arrow" aria-hidden="true"></i>
    </div>
  `).join('');

  el.querySelectorAll('.sim-item').forEach(item => {
    item.addEventListener('click', () => {
      _openSheet(item.dataset.subject, item.dataset.tab);
    });
  });
}

// ============================================================
// SHEET — OPEN / CLOSE
// ============================================================

function _openSheet(subject, tab) {
  if (!_overlayEl || !_sheetEl) return;

  _sheet.open    = true;
  _sheet.subject = subject;
  _sheet.tab     = tab;

  if (tab === 'autogera') {
    Object.assign(_sel.autogera, {
      topics: [], types: [], numQ: 10,
      includeText: false, promptText: '',
    });
  } else {
    Object.assign(_sel.anteriores, {
      years: [], topics: [], types: [],
      numQ: 10, includeText: true,
    });
  }

  // Write header with X close button
  const hdr = document.getElementById('simsht-hdr');
  if (hdr) {
    hdr.innerHTML = `
      <div class="simsht-hdr-icon">
        <i class="fa-solid ${_icon(subject)}" aria-hidden="true"></i>
      </div>
      <div style="flex:1;min-width:0;">
        <div class="simsht-hdr-title notranslate" translate="no">
          ${_esc(subject)}
        </div>
        <div class="simsht-hdr-sub notranslate" translate="no">
          ${tab === 'autogera'
            ? 'Geração automática de perguntas'
            : 'Perguntas reais de exames anteriores'}
        </div>
      </div>
      <button class="simsht-hdr-close notranslate" translate="no"
        id="simsht-x" aria-label="Fechar">
        <i class="fa-solid fa-xmark"></i>
      </button>
    `;
    document.getElementById('simsht-x')
      ?.addEventListener('click', _closeSheet);
  }

  _setSheetBody(`
    <div class="sht-state">
      <div class="sht-spin"></div>
      <div class="sht-state-txt notranslate" translate="no">
        A carregar perguntas…
      </div>
    </div>
  `);

  _overlayEl.classList.add('on');
  _sheetEl.classList.add('on');
  document.body.style.overflow = 'hidden';

  if (tab === 'autogera') {
    _fetchAg(subject);
  } else {
    _fetchAnt(subject);
  }
}

function _closeSheet() {
  if (!_overlayEl || !_sheetEl) return;
  _overlayEl.classList.remove('on');
  _sheetEl.classList.remove('on');
  document.body.style.overflow = '';
  _sheet.open    = false;
  _sheet.subject = '';
  _sheet.tab     = '';
}

function _setSheetBody(html) {
  const body = document.getElementById('simsht-body');
  if (body) body.innerHTML = html;
}

function _isStillOpen(subject, tab) {
  return _sheet.open
    && _sheet.subject === subject
    && _sheet.tab     === tab;
}

// ============================================================
// INSUFFICIENT MOEDAS CARD
// ============================================================

function _showMoedaWarn(needed, current, goId) {
  // goId is e.g. 'ag-go' — warn id is 'ag-moeda-warn'
  const prefix = goId.replace('-go', '');
  const warn   = document.getElementById(`${prefix}-moeda-warn`);
  const go     = document.getElementById(goId);
  if (!warn || !go) return;
  warn.classList.add('on');
  go.disabled = true;
}

function _hideMoedaWarn(goId) {
  const prefix = goId.replace('-go', '');
  const warn   = document.getElementById(`${prefix}-moeda-warn`);
  const go     = document.getElementById(goId);
  if (warn) warn.classList.remove('on');
  if (go)   go.disabled = false;
}

function _moedaWarnHtml(id, needed, current) {
  return `
    <div class="sht-moeda-warn notranslate" translate="no" id="${id}-moeda-warn">
      <div class="sht-moeda-warn-title">
        <i class="fa-solid fa-circle-exclamation"></i>
        Moedas insuficientes
      </div>
      <div class="sht-moeda-warn-msg">
        Tens ${current} moeda${current !== 1 ? 's' : ''}, precisas de ${needed}.
        Obtém mais moedas para continuar.
      </div>
      <div class="sht-moeda-warn-btns">
        <button class="sht-moeda-btn sht-moeda-btn-wa notranslate" translate="no"
          onclick="window.open('https://wa.me/258848920143?text=Ol%C3%A1%2C+preciso+de+ajuda+para+obter+moedas+no+ExameNova','_blank')">
          <i class="fa-brands fa-whatsapp"></i>
          WhatsApp
        </button>
        <button class="sht-moeda-btn sht-moeda-btn-inv notranslate" translate="no"
          onclick="window.location.href='/plataforma/convite.html'">
          <i class="fa-solid fa-user-plus"></i>
          Convidar Amigos
        </button>
      </div>
    </div>
  `;
}

// ============================================================
// HELPERS
// ============================================================

function _isLang(subject) {
  return isLanguageSubject(exams.toDbSubject(subject));
}

function _getLang(subject) {
  if (subject === 'Língua Inglesa')  return 'English';
  if (subject === 'Língua Francesa') return 'French';
  return 'Portuguese';
}

function _isAdmissao() {
  return _userData?.examType === 'admissao';
}

function _resolveDisplayGrade() {
  if (_isAdmissao()) return null;
  return String(_userData?.grade || '12');
}

function _resolveDbGrade() {
  if (_isAdmissao()) return null;
  return exams.toDbGrade(String(_userData?.grade || '12'));
}

function _buildFilters(tab, subject) {
  const filters = { disciplina: exams.toDbSubject(subject) };
  if (_isAdmissao()) {
    filters.tipo_exame = 'Admissão';
    if (_userData?.institution) {
      filters.instituicao = exams.toDbInstitution(_userData.institution);
    }
  } else {
    filters.tipo_exame = 'Ensino Geral';
    const g = _resolveDbGrade();
    if (g) filters.classe = g;
  }
  return filters;
}

function _isValidQ(q, requireResposta = true) {
  const tipo      = (q['Tipo']      || '').trim();
  const enunciado = (q['Enunciado'] || '').trim();
  if (!SUPPORTED_TYPES.includes(tipo)) return false;
  if (!enunciado) return false;
  if (requireResposta) {
    const resp = (q['Resposta'] || '').trim();
    if (!resp) return false;
    if (tipo === 'verdadeiro-falso') return resp === 'Verdadeiro' || resp === 'Falso';
    if (tipo === 'escolha-multipla') return getOptions(q).length >= 2;
  }
  return true;
}

function _defaultNumQ(topics) {
  return topics.length > 0 ? 5 : 10;
}

// ── Dropdown checklist ────────────────────────────────────────

function _makeDropdown(btnId, listId, items, selectedArr, labelFn, onChangeFn, placeholder) {
  const btn  = document.getElementById(btnId);
  const list = document.getElementById(listId);
  if (!btn || !list) return;

  const syncBtn = () => {
    const lbl   = btn.querySelector('.sht-dd-lbl');
    const badge = btn.querySelector('.sht-dd-badge');
    if (!selectedArr.length) {
      if (lbl)   { lbl.textContent = placeholder; lbl.classList.add('ph'); }
      if (badge) badge.style.display = 'none';
    } else {
      if (lbl)   { lbl.textContent = selectedArr.map(labelFn).join(', '); lbl.classList.remove('ph'); }
      if (badge) { badge.textContent = selectedArr.length; badge.style.display = ''; }
    }
  };

  const drawList = () => {
    list.innerHTML = items.map(item => `
      <div class="sht-dd-item ${selectedArr.includes(String(item)) ? 'on' : ''} notranslate"
           translate="no" data-v="${_esc(String(item))}">
        <div class="sht-dd-chk">
          ${selectedArr.includes(String(item)) ? '<i class="fa-solid fa-check"></i>' : ''}
        </div>
        <div class="sht-dd-item-lbl">${_esc(labelFn(item))}</div>
      </div>
    `).join('');
    list.querySelectorAll('.sht-dd-item').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        const val = el.dataset.v;
        const idx = selectedArr.indexOf(val);
        if (idx === -1) selectedArr.push(val);
        else selectedArr.splice(idx, 1);
        drawList();
        syncBtn();
        onChangeFn();
      });
    });
  };

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const wasOpen = list.classList.contains('on');
    document.querySelectorAll('#simsht-body .sht-dd-list.on').forEach(l => {
      l.classList.remove('on');
      l.previousElementSibling?.classList.remove('on');
    });
    if (!wasOpen) {
      list.classList.add('on');
      btn.classList.add('on');
    }
  });

  drawList();
  syncBtn();
}

document.addEventListener('click', () => {
  document.querySelectorAll('.sht-dd-list.on').forEach(l => {
    l.classList.remove('on');
    l.previousElementSibling?.classList.remove('on');
  });
});

// ── Stepper ───────────────────────────────────────────────────

function _wireStepper(prefix, selObj, onChange = null) {
  const numEl = document.getElementById(`${prefix}-num`);
  const minus = document.getElementById(`${prefix}-minus`);
  const plus  = document.getElementById(`${prefix}-plus`);
  const sync  = () => {
    if (numEl) numEl.textContent = selObj.numQ;
    if (minus) minus.disabled = selObj.numQ <= MIN_Q;
    if (plus)  plus.disabled  = selObj.numQ >= MAX_Q;
    if (onChange) onChange();
  };
  minus?.addEventListener('click', () => { if (selObj.numQ > MIN_Q) { selObj.numQ--; sync(); } });
  plus?.addEventListener('click',  () => { if (selObj.numQ < MAX_Q) { selObj.numQ++; sync(); } });
  sync();
}

// ── Type pills ────────────────────────────────────────────────

function _wireTypePills(prefix, selObj, onChange = null) {
  ['escolha-multipla', 'verdadeiro-falso'].forEach(t => {
    const btn = document.getElementById(`${prefix}-tp-${t}`);
    if (!btn) return;
    btn.addEventListener('click', () => {
      const idx = selObj.types.indexOf(t);
      if (idx === -1) selObj.types.push(t);
      else selObj.types.splice(idx, 1);
      btn.classList.toggle('on', selObj.types.includes(t));
      if (onChange) onChange();
    });
  });
}

// ============================================================
// AUTO GERA — FETCH
// ============================================================

async function _fetchAg(subject) {
  if (_cache.autogera[subject]) {
    if (!_isStillOpen(subject, 'autogera')) return;
    const c = _cache.autogera[subject];
    if (c.empty) { _showError('Sem perguntas disponíveis para esta disciplina.'); return; }
    if (c.error) { _showError('Erro ao carregar. Verifique a ligação e tente novamente.'); return; }
    _renderAg(subject, c.allQuestions, c.topics);
    return;
  }

  try {
    const all = await fetchQuestions(_buildFilters('autogera', subject));
    if (!_isStillOpen(subject, 'autogera')) return;

    const v1 = all.filter(q => _isValidQ(q, false));
    if (!v1.length) {
      _cache.autogera[subject] = { empty: true };
      _showError('Sem perguntas disponíveis para esta disciplina.');
      return;
    }

    const topics = topicFrequency(v1).map(f => f.topic);
    _cache.autogera[subject] = { allQuestions: v1, topics };
    _renderAg(subject, v1, topics);

  } catch (e) {
    console.error('[Simulacao] AG fetch:', e);
    if (!_isStillOpen(subject, 'autogera')) return;
    _cache.autogera[subject] = { error: true };
    _showError('Erro ao carregar. Verifique a ligação e tente novamente.');
  }
}

function _showError(msg) {
  _setSheetBody(`
    <div class="sht-state">
      <i class="fa-solid fa-circle-exclamation sht-err-icon"></i>
      <div class="sht-state-txt notranslate" translate="no">${_esc(msg)}</div>
    </div>
  `);
}

function _renderAg(subject, allQ, topics) {
  const sel    = _sel.autogera;
  const isLang = _isLang(subject);
  const bal    = moeda.getBalance(_userData);
  const cost   = moeda.COSTS.SIMULACAO_GERADAS;

  _setSheetBody(`

    ${topics.length ? `
      <div class="sht-sec notranslate" translate="no">Tema</div>
      <div class="sht-dd">
        <button class="sht-dd-btn notranslate" translate="no" id="ag-topic-btn">
          <div class="sht-dd-inner">
            <span class="sht-dd-badge" style="display:none;"></span>
            <span class="sht-dd-lbl ph">Todos os temas</span>
          </div>
          <i class="fa-solid fa-chevron-down sht-dd-arrow"></i>
        </button>
        <div class="sht-dd-list" id="ag-topic-list"></div>
      </div>
    ` : ''}

    <div class="sht-sec notranslate" translate="no">Tipo de Pergunta</div>
    <div class="sht-type-row">
      <button id="ag-tp-escolha-multipla"
        class="sht-type-pill notranslate" translate="no">Escolha Múltipla</button>
      <button id="ag-tp-verdadeiro-falso"
        class="sht-type-pill notranslate" translate="no">Verdadeiro / Falso</button>
    </div>

    ${isLang ? `
      <div class="sht-sec notranslate" translate="no">Texto de Leitura</div>
      <div class="sht-toggle-row">
        <span class="sht-toggle-lbl notranslate" translate="no">
          Incluir texto de leitura
        </span>
        <label class="sht-toggle">
          <input type="checkbox" id="ag-txt-toggle">
          <span class="sht-toggle-sl"></span>
        </label>
      </div>
      <div id="ag-struct-wrap" style="display:none;">
        <div class="sht-struct-note notranslate" translate="no"
          id="ag-struct-note"></div>
      </div>
    ` : ''}

    <div class="sht-sec notranslate" translate="no">Número de Perguntas</div>
    <div class="sht-stepper">
      <button class="sht-step-btn" id="ag-minus">−</button>
      <div class="sht-step-val notranslate" translate="no" id="ag-num">10</div>
      <button class="sht-step-btn" id="ag-plus">+</button>
    </div>

    <div class="sht-sec notranslate" translate="no">
      Instruções Personalizadas
      <span style="font-size:10px;font-weight:500;color:var(--text-muted);
        background:var(--surface);border:1px solid var(--border);
        border-radius:99px;padding:2px 8px;margin-left:6px;">
        Opcional · +3 Moedas
      </span>
    </div>
    <div class="sht-prompt-wrap">
      <textarea class="sht-prompt notranslate" translate="no"
        id="ag-prompt" maxlength="300" rows="3"
        placeholder="Ex: Foca em questões sobre a Segunda Guerra Mundial."></textarea>
      <div class="sht-prompt-foot">
        <span class="sht-prompt-cc notranslate" translate="no"
          id="ag-cc">0/300</span>
        <span class="sht-prompt-extra notranslate" translate="no">
          <i class="fa-solid fa-coins" style="font-size:9px;"></i>
          +3 se preenchido
        </span>
      </div>
    </div>

    <div class="sht-cost notranslate" translate="no">
      <i class="fa-solid fa-coins"></i>
      <div class="sht-cost-n" id="ag-cost">${cost}</div>
      <div class="sht-cost-lbl">Moedas</div>
    </div>

    ${_moedaWarnHtml('ag', cost, bal)}

    <button class="sht-go notranslate" translate="no" id="ag-go"
      style="background:linear-gradient(135deg,#6D28D9 0%,#8B5CF6 100%);
             box-shadow:0 4px 20px rgba(139,92,246,0.28);">
      <div class="sht-go-spin"></div>
      <span class="sht-go-lbl">
        <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
        Gerar Simulação
      </span>
    </button>

    <button class="sht-fechar notranslate" translate="no" id="ag-fechar">
      Fechar
    </button>

  `);

  // Topics dropdown
  if (topics.length) {
    _makeDropdown(
      'ag-topic-btn', 'ag-topic-list',
      topics, sel.topics, t => t,
      () => {
        sel.numQ = _defaultNumQ(sel.topics);
        const el = document.getElementById('ag-num');
        if (el) el.textContent = sel.numQ;
        const m = document.getElementById('ag-minus');
        const p = document.getElementById('ag-plus');
        if (m) m.disabled = sel.numQ <= MIN_Q;
        if (p) p.disabled = sel.numQ >= MAX_Q;
        _agStructNote(subject);
      },
      'Todos os temas'
    );
  }

  _wireTypePills('ag', sel);

  if (isLang) {
    document.getElementById('ag-txt-toggle')?.addEventListener('change', e => {
      sel.includeText = e.target.checked;
      _agStructNote(subject);
    });
  }

  _wireStepper('ag', sel, () => _agStructNote(subject));

  const ta   = document.getElementById('ag-prompt');
  const cc   = document.getElementById('ag-cc');
  const costEl = document.getElementById('ag-cost');
  ta?.addEventListener('input', () => {
    sel.promptText = ta.value;
    if (cc) cc.textContent = `${ta.value.length}/300`;
    const total = moeda.COSTS.SIMULACAO_GERADAS
                + (ta.value.trim().length > 0 ? moeda.COSTS.CUSTOM_AI_PROMPT : 0);
    if (costEl) costEl.textContent = total;
    // Hide warn if user sees cost change
    _hideMoedaWarn('ag-go');
  });

  document.getElementById('ag-go')?.addEventListener('click', () => {
    _startAg(subject, allQ);
  });

  document.getElementById('ag-fechar')?.addEventListener('click', _closeSheet);
}

function _agStructNote(subject) {
  const sel  = _sel.autogera;
  const wrap = document.getElementById('ag-struct-wrap');
  const note = document.getElementById('ag-struct-note');
  if (!wrap || !note) return;
  if (!_isLang(subject) || !sel.includeText) {
    wrap.style.display = 'none'; return;
  }
  wrap.style.display = 'block';
  const lang = _getLang(subject);
  const isG9 = _resolveDisplayGrade() === '9';
  const n = sel.numQ;
  const c = Math.round(n * 0.25);
  if (!isG9) {
    note.innerHTML = lang === 'English'
      ? `<strong>Grade 12:</strong> All MC. Comprehension + grammar. No writing task.`
      : lang === 'French'
      ? `<strong>12ème:</strong> Tout QCM. Compréhension + grammaire.`
      : `<strong>12ª Classe:</strong> Compreensão + gramática. Sem composição.`;
  } else {
    note.innerHTML = lang === 'English'
      ? `<strong>Grade 9:</strong> Q1–${c} comprehension · Q${c+1}–${n-1} grammar · Q${n} writing task.`
      : lang === 'French'
      ? `<strong>9ème:</strong> Q1–${c} compréhension · Q${c+1}–${n-1} grammaire · Q${n} écriture.`
      : `<strong>9ª Classe:</strong> Q1–${c} compreensão · Q${c+1}–${n-1} gramática · Q${n} composição.`;
  }
}

// ============================================================
// EXAMES ANTERIORES — FETCH
// ============================================================

async function _fetchAnt(subject) {
  if (_cache.anteriores[subject]) {
    if (!_isStillOpen(subject, 'anteriores')) return;
    const c = _cache.anteriores[subject];
    if (c.empty) { _showError('Sem perguntas disponíveis para esta disciplina.'); return; }
    if (c.error) { _showError('Erro ao carregar. Verifique a ligação e tente novamente.'); return; }
    _renderAnt(subject, c.allQuestions, c.topics, c.years);
    return;
  }

  try {
    const all = await fetchQuestions(_buildFilters('anteriores', subject));
    if (!_isStillOpen(subject, 'anteriores')) return;

    const v1 = all.filter(q => _isValidQ(q, true));
    if (!v1.length) {
      _cache.anteriores[subject] = { empty: true };
      _showError('Sem perguntas disponíveis para esta disciplina.');
      return;
    }

    const yearSet = new Set();
    for (const q of v1) {
      const y = normaliseYear(q['Ano']);
      if (y) yearSet.add(y);
    }
    const years  = [...yearSet].sort((a, b) => Number(b) - Number(a));
    const topics = topicFrequency(v1).map(f => f.topic);

    _cache.anteriores[subject] = { allQuestions: v1, topics, years };
    _renderAnt(subject, v1, topics, years);

  } catch (e) {
    console.error('[Simulacao] ANT fetch:', e);
    if (!_isStillOpen(subject, 'anteriores')) return;
    _cache.anteriores[subject] = { error: true };
    _showError('Erro ao carregar. Verifique a ligação e tente novamente.');
  }
}

function _renderAnt(subject, allQ, topics, years) {
  const sel    = _sel.anteriores;
  const isLang = _isLang(subject);
  const count  = allQ.length;
  const bal    = moeda.getBalance(_userData);
  const cost   = moeda.COSTS.SIMULACAO_ANTERIORES;

  _setSheetBody(`

    ${years.length ? `
      <div class="sht-sec notranslate" translate="no">Ano do Exame</div>
      <div class="sht-dd">
        <button class="sht-dd-btn notranslate" translate="no" id="ant-year-btn">
          <div class="sht-dd-inner">
            <span class="sht-dd-badge" style="display:none;"></span>
            <span class="sht-dd-lbl ph">Todos os anos</span>
          </div>
          <i class="fa-solid fa-chevron-down sht-dd-arrow"></i>
        </button>
        <div class="sht-dd-list" id="ant-year-list"></div>
      </div>
    ` : ''}

    ${topics.length ? `
      <div class="sht-sec notranslate" translate="no">Tema</div>
      <div class="sht-dd">
        <button class="sht-dd-btn notranslate" translate="no" id="ant-topic-btn">
          <div class="sht-dd-inner">
            <span class="sht-dd-badge" style="display:none;"></span>
            <span class="sht-dd-lbl ph">Todos os temas</span>
          </div>
          <i class="fa-solid fa-chevron-down sht-dd-arrow"></i>
        </button>
        <div class="sht-dd-list" id="ant-topic-list"></div>
      </div>
    ` : ''}

    <div class="sht-sec notranslate" translate="no">Tipo de Pergunta</div>
    <div class="sht-type-row">
      <button id="ant-tp-escolha-multipla"
        class="sht-type-pill notranslate" translate="no">Escolha Múltipla</button>
      <button id="ant-tp-verdadeiro-falso"
        class="sht-type-pill notranslate" translate="no">Verdadeiro / Falso</button>
    </div>

    ${isLang ? `
      <div class="sht-sec notranslate" translate="no">Texto de Leitura</div>
      <div class="sht-toggle-row">
        <span class="sht-toggle-lbl notranslate" translate="no">
          Incluir texto de leitura
        </span>
        <label class="sht-toggle">
          <input type="checkbox" id="ant-txt-toggle" checked>
          <span class="sht-toggle-sl"></span>
        </label>
      </div>
    ` : ''}

    <div class="sht-sec notranslate" translate="no">Número de Perguntas</div>
    <div class="sht-stepper">
      <button class="sht-step-btn" id="ant-minus">−</button>
      <div class="sht-step-val notranslate" translate="no" id="ant-num">10</div>
      <button class="sht-step-btn" id="ant-plus">+</button>
    </div>

    <div style="margin-top:14px;">
      <span class="sht-count notranslate" translate="no" id="ant-count">
        ${count} pergunta${count !== 1 ? 's' : ''} disponíve${count !== 1 ? 'is' : 'l'}
      </span>
    </div>

    <div class="sht-cost notranslate" translate="no">
      <i class="fa-solid fa-coins"></i>
      <div class="sht-cost-n">${cost}</div>
      <div class="sht-cost-lbl">Moedas</div>
    </div>

    ${_moedaWarnHtml('ant', cost, bal)}

    <button class="sht-go notranslate" translate="no" id="ant-go"
      style="background:linear-gradient(135deg,#0369A1 0%,#0284C7 100%);
             box-shadow:0 4px 20px rgba(2,132,199,0.28);">
      <div class="sht-go-spin"></div>
      <span class="sht-go-lbl">
        <i class="fa-solid fa-play" aria-hidden="true"></i>
        Começar Simulação
      </span>
    </button>

    <button class="sht-fechar notranslate" translate="no" id="ant-fechar">
      Fechar
    </button>

  `);

  if (years.length) {
    _makeDropdown(
      'ant-year-btn', 'ant-year-list',
      years, sel.years, y => y,
      () => _antCount(allQ),
      'Todos os anos'
    );
  }

  if (topics.length) {
    _makeDropdown(
      'ant-topic-btn', 'ant-topic-list',
      topics, sel.topics, t => t,
      () => {
        sel.numQ = _defaultNumQ(sel.topics);
        const el = document.getElementById('ant-num');
        if (el) el.textContent = sel.numQ;
        const m = document.getElementById('ant-minus');
        const p = document.getElementById('ant-plus');
        if (m) m.disabled = sel.numQ <= MIN_Q;
        if (p) p.disabled = sel.numQ >= MAX_Q;
        _antCount(allQ);
      },
      'Todos os temas'
    );
  }

  _wireTypePills('ant', sel, () => _antCount(allQ));

  if (isLang) {
    document.getElementById('ant-txt-toggle')?.addEventListener('change', e => {
      sel.includeText = e.target.checked;
    });
  }

  _wireStepper('ant', sel);

  document.getElementById('ant-go')?.addEventListener('click', () => {
    _startAnt(subject, allQ);
  });

  document.getElementById('ant-fechar')?.addEventListener('click', _closeSheet);
}

function _antFiltered(allQ) {
  const sel = _sel.anteriores;
  let qs    = [...allQ];
  if (sel.years.length)  qs = qs.filter(q => sel.years.includes(normaliseYear(q['Ano'])));
  if (sel.topics.length) qs = qs.filter(q => sel.topics.includes((q['Tema_Relacionado'] || '').trim()));
  if (sel.types.length)  qs = qs.filter(q => sel.types.includes(q['Tipo']));
  return qs;
}

function _antCount(allQ) {
  const n     = _antFiltered(allQ).length;
  const badge = document.getElementById('ant-count');
  const go    = document.getElementById('ant-go');
  if (badge) {
    badge.textContent = n > 0
      ? `${n} pergunta${n !== 1 ? 's' : ''} disponíve${n !== 1 ? 'is' : 'l'}`
      : 'Sem perguntas com estes filtros — remova alguns.';
    badge.classList.toggle('err', n === 0);
  }
  if (go) go.disabled = n === 0;
}

// ============================================================
// START — AUTO GERA
// ============================================================

async function _startAg(subject, allQ) {
  const sel = _sel.autogera;
  const btn = document.getElementById('ag-go');

  const promptText = (document.getElementById('ag-prompt')?.value || '').trim();
  const hasPrompt  = promptText.length > 0;
  const totalCost  = moeda.COSTS.SIMULACAO_GERADAS
                   + (hasPrompt ? moeda.COSTS.CUSTOM_AI_PROMPT : 0);
  const bal        = moeda.getBalance(_userData);

  // Inline balance check — no moeda.gate()
  if (bal < totalCost) {
    _showMoedaWarn(totalCost, bal, 'ag-go');
    return;
  }

  if (btn) { btn.disabled = true; btn.classList.add('loading'); }
  ui.showSpinner('A preparar a sua simulação…');

  try {
    let pool = [...allQ];
    if (sel.topics.length) {
      const filtered = pool.filter(q =>
        sel.topics.includes((q['Tema_Relacionado'] || '').trim())
      );
      if (filtered.length) pool = filtered;
    }
    const contextSample = pickRandom(pool, 25);

    let examText = null;
    if (_isLang(subject) && sel.includeText) {
      try {
        const texts = await fetchExamTexts({ disciplina: exams.toDbSubject(subject) });
        if (texts.length) {
          // Pick random text — full record passed to prompt builder
          // so AI generates questions based on this specific passage
          const picked = texts[Math.floor(Math.random() * texts.length)];
          examText = picked;
        }
      } catch (e) { console.warn('[Simulacao] text fetch:', e); }
    }

    const prompt = _buildAgPrompt({
      subject,
      displayGrade:   _resolveDisplayGrade(),
      numQ:           sel.numQ,
      selectedTopics: sel.topics,
      selectedTypes:  sel.types,
      promptText,
      examText,
      contextSample,
    });

    const messages = [
      { role: 'system', content: prompt },
      { role: 'user',   content: `Gera ${sel.numQ} perguntas agora.` },
    ];

    let raw;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        raw = await worker.callAI(messages, { maxTokens: 2500, temperature: 0.62 });
        break;
      } catch (err) {
        if (attempt === 3) throw err;
        await new Promise(r => setTimeout(r, 1500 * attempt));
      }
    }

    let generated;
    try {
      const clean = raw
        .replace(/```json|```/g, '')
        .replace(/^[^\[]*/, '')
        .replace(/[^\]]*$/, '')
        .trim();
      generated = JSON.parse(clean);
      if (!Array.isArray(generated)) throw new Error('not array');
    } catch {
      throw new Error('Erro ao processar resposta. Tente novamente.');
    }
    if (!generated.length) throw new Error('Sem perguntas geradas. Tente novamente.');

    const dbSubject = exams.toDbSubject(subject);
    const dbGrade   = _resolveDbGrade();

    const questions = generated.slice(0, sel.numQ).map((q, i) => ({
      _id:               `ai-${Date.now()}-${i}`,
      _aiGenerated:      true,
      'Enunciado':       q.pergunta   || q.text || '',
      'Tipo':            q.tipo       || 'escolha-multipla',
      'Opção_A':         _parseOpt(q.opcoes, 0),
      'Opção_B':         _parseOpt(q.opcoes, 1),
      'Opção_C':         _parseOpt(q.opcoes, 2),
      'Opção_D':         _parseOpt(q.opcoes, 3),
      'Resposta':        (q.resposta  || '').trim().toUpperCase(),
      'Explicação':      q.explicacao || q.explanation || '',
      'Tema_Relacionado': q.tema      || sel.topics[0] || subject,
      'Disciplina':      dbSubject,
      'Ano':             String(new Date().getFullYear()),
      'Classe':          dbGrade || '',
      'ID_Exame': '', 'Chamada': '',
      'Nº': String(i + 1),
      'Descrição_Figura': '', 'Resposta_Possível': '',
    }));

    // Build full passage object from DB record — no truncation
    let passageForRender = null;
    if (examText) {
      passageForRender = {
        titulo:    examText['Título']    || examText['texto_titulo']   || '',
        autor:     examText['Autor']     || examText['texto_autor']    || '',
        conteudo:  examText['Conteúdo']  || examText['texto_conteudo'] || '',
        glossario: examText['Glossário'] || examText['texto_glossario']|| '',
      };
    }

    session.simulacao = {
      mode: 'geradas', subject, dbSubject,
      questions, examText: passageForRender,
      meta: null, userId: _user?.uid || '',
      cost: totalCost, hasPrompt,
    };

    _destroySheet();
    router.navigate('/panel/renders/simulacao-render');

  } catch (err) {
    console.error('[Simulacao] AG start:', err);
    ui.showToast(err.message || 'Erro ao gerar. Tente novamente.', 'error');
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
  } finally {
    ui.hideSpinner();
  }
}

// ============================================================
// START — EXAMES ANTERIORES
// ============================================================

async function _startAnt(subject, allQ) {
  const sel  = _sel.anteriores;
  const btn  = document.getElementById('ant-go');
  const cost = moeda.COSTS.SIMULACAO_ANTERIORES;
  const bal  = moeda.getBalance(_userData);

  // Inline balance check — no moeda.gate()
  if (bal < cost) {
    _showMoedaWarn(cost, bal, 'ant-go');
    return;
  }

  const pool = _antFiltered(allQ);
  if (!pool.length) {
    ui.showToast('Sem perguntas com estes filtros. Ajuste a selecção.', 'warning');
    return;
  }

  if (btn) { btn.disabled = true; btn.classList.add('loading'); }

  try {
    const dbSubject = exams.toDbSubject(subject);
    let questions   = [];
    let examText    = null;

    if (_isLang(subject) && sel.includeText) {
      // ── TEXT-FIRST STRATEGY ──────────────────────────────
      // 1. Fetch all available texts for this subject
      // 2. Pick one randomly
      // 3. Find questions from the same exam (ID_Exame or Ano match)
      // 4. If enough text-related questions exist, use them for batch 1
      //    and fill remaining slots from the general pool
      // 5. If no text found, fall back to general pool (no text shown)

      let textRecord = null;
      try {
        const texts = await fetchExamTexts({ disciplina: dbSubject });
        if (texts.length) {
          // Pick a random text
          textRecord = texts[Math.floor(Math.random() * texts.length)];
        }
      } catch (e) {
        console.warn('[Simulacao] ANT text fetch:', e);
      }

      if (textRecord) {
        // Build the passage object from the full DB record
        examText = {
          titulo:    textRecord['Título']    || '',
          autor:     textRecord['Autor']     || '',
          conteudo:  textRecord['Conteúdo']  || '',
          glossario: textRecord['Glossário'] || '',
        };

        // Find questions that belong to the same exam as this text
        // Match by ID_Exame first, then fall back to Ano
        const textId  = (textRecord['ID_Exame'] || '').trim();
        const textAno = normaliseYear(textRecord['Ano'] || textRecord['ano'] || '');

        let textRelated = [];
        if (textId) {
          textRelated = pool.filter(q =>
            (q['ID_Exame'] || '').trim() === textId
          );
        }
        // If ID_Exame match gave nothing, try matching by year
        if (!textRelated.length && textAno) {
          textRelated = pool.filter(q =>
            normaliseYear(q['Ano']) === textAno
          );
        }

        const BATCH_NEEDED = 5;

        if (textRelated.length >= BATCH_NEEDED) {
          // Take exactly 5 text-related questions for batch 1
          const batch1 = pickRandom(textRelated, BATCH_NEEDED);
          const batch1Ids = new Set(batch1.map(q => q['_id'] || q['Nº'] + q['Ano']));

          // Remaining questions from pool excluding batch1 items
          const remaining = pool.filter(q => {
            const qId = q['_id'] || q['Nº'] + q['Ano'];
            return !batch1Ids.has(qId);
          });

          const stillNeeded = Math.max(0, sel.numQ - BATCH_NEEDED);
          const batch2plus  = stillNeeded > 0
            ? pickRandom(remaining, stillNeeded)
            : [];

          questions = [...batch1, ...batch2plus];
        } else {
          // Not enough text-related questions — use general pool
          // but still show the text passage
          questions = pickRandom(pool, sel.numQ);
        }
      } else {
        // No text found — no passage, general pool
        examText  = null;
        questions = pickRandom(pool, sel.numQ);
      }

    } else {
      // Non-language subject or text toggle off — general pool
      questions = pickRandom(pool, sel.numQ);
    }

    session.simulacao = {
      mode: 'anteriores', subject, dbSubject,
      questions, examText,
      meta:   exams.getExamMeta(questions),
      userId: _user?.uid || '',
      cost:   cost,
    };

    _destroySheet();
    router.navigate('/panel/renders/simulacao-render');

  } catch (err) {
    console.error('[Simulacao] ANT start:', err);
    ui.showToast('Erro inesperado. Tente novamente.', 'error');
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
  }
}

// ============================================================
// AI PROMPT BUILDER
// ============================================================

function _buildAgPrompt({
  subject, displayGrade, numQ,
  selectedTopics, selectedTypes,
  promptText, examText, contextSample,
}) {
  const lang  = _getLang(subject);
  const isEng = lang === 'English';
  const isFr  = lang === 'French';
  const isLng = _isLang(subject);
  const isG9  = displayGrade === '9';
  const isG12 = displayGrade === '12';

  const langRule = isEng
    ? `ABSOLUTE RULE: Every word MUST be in English.`
    : isFr
    ? `RÈGLE ABSOLUE: Chaque mot DOIT être en français.`
    : `REGRA ABSOLUTA: Todo o conteúdo DEVE estar em Português de Moçambique.`;

  const typeRule = selectedTypes.length === 1
    ? selectedTypes[0] === 'verdadeiro-falso'
      ? (isEng ? 'True/False ONLY.' : isFr ? 'Vrai/Faux UNIQUEMENT.' : 'APENAS Verdadeiro/Falso.')
      : (isEng ? 'Multiple choice ONLY.' : isFr ? 'QCM UNIQUEMENT.' : 'APENAS escolha múltipla.')
    : (isEng ? 'Mix of MC and True/False.'
      : isFr  ? 'Mix QCM et Vrai/Faux.'
      : 'Mix de escolha múltipla e Verdadeiro/Falso.');

  const topicRule = selectedTopics.length
    ? (isEng ? `ONLY topics: ${selectedTopics.join(', ')}.`
      : isFr  ? `UNIQUEMENT sujets: ${selectedTopics.join(', ')}.`
      : `APENAS temas: ${selectedTopics.join(', ')}.`)
    : (isEng ? 'Cover a variety of topics from the real questions below.'
      : isFr  ? 'Couvrez les sujets des questions réelles ci-dessous.'
      : 'Cobre temas variados das questões reais abaixo.');

  const instrRule = promptText
    ? (isEng ? `EXTRA INSTRUCTIONS: ${promptText}`
      : isFr  ? `INSTRUCTIONS SUPPLÉMENTAIRES: ${promptText}`
      : `INSTRUÇÕES EXTRA: ${promptText}`)
    : '';

  const contextBlock = contextSample.map((q, i) => {
    const tipo  = q['Tipo'] || '';
    const enunc = (q['Enunciado'] || '').replace(/\n/g, ' ').trim();
    const tema  = (q['Tema_Relacionado'] || '').trim();
    const resp  = (q['Resposta'] || '').trim();
    const opts  = getOptions(q);
    const ano   = (q['Ano'] || '').trim();
    let line = `${i+1}. [${tema}${ano ? ' | ' + ano : ''}]\n   ${enunc}\n`;
    if (tipo === 'escolha-multipla' && opts.length) {
      opts.forEach((o, oi) => {
        line += `   ${String.fromCharCode(65+oi)}) ${o}${o === resp ? ' ✓' : ''}\n`;
      });
    } else if (tipo === 'verdadeiro-falso') {
      line += `   Resposta: ${resp}\n`;
    }
    return line;
  }).join('\n');

  let passageBlock = '';
  if (isLng && examText) {
    const c = examText['Conteúdo'] || examText['texto_conteudo'] || '';
    const t = examText['Título']   || examText['texto_titulo']   || '';
    const a = examText['Autor']    || examText['texto_autor']    || '';
    if (c) passageBlock = isEng
      ? `READING TEXT:\nTitle: "${t}" | Author: ${a}\n---\n${c}\n---`
      : isFr
      ? `TEXTE:\nTitre: "${t}" | Auteur: ${a}\n---\n${c}\n---`
      : `TEXTO:\nTítulo: "${t}" | Autor: ${a}\n---\n${c}\n---`;
  }

  let structBlock = '';
  if (isLng) {
    if (isG12) {
      structBlock = isEng
        ? `STRUCTURE (Grade 12): All MC. Comprehension + grammar. NO writing.`
        : isFr
        ? `STRUCTURE (12ème): Tout QCM. Compréhension + grammaire. PAS de composition.`
        : `ESTRUTURA (12ª Classe): Tudo EM. Compreensão + gramática. SEM composição.`;
    } else if (isG9) {
      const c = Math.round(numQ * 0.25);
      structBlock = isEng
        ? `STRUCTURE (Grade 9): Q1–${c} comprehension · Q${c+1}–${numQ-1} grammar MC · Q${numQ} writing task.`
        : isFr
        ? `STRUCTURE (9ème): Q1–${c} compréhension · Q${c+1}–${numQ-1} grammaire · Q${numQ} écriture.`
        : `ESTRUTURA (9ª Classe): Q1–${c} compreensão · Q${c+1}–${numQ-1} gramática · Q${numQ} composição.`;
    }
  }

  const jsonFmt = `Responda APENAS com JSON array válido — sem markdown, sem texto extra:
[
  {
    "pergunta": "apenas o enunciado, nunca as opções",
    "tipo": "escolha-multipla",
    "opcoes": ["opção A", "opção B", "opção C", "opção D"],
    "resposta": "A",
    "explicacao": "máximo 2 frases",
    "tema": "tema"
  },
  {
    "pergunta": "afirmação completa.",
    "tipo": "verdadeiro-falso",
    "opcoes": [],
    "resposta": "Verdadeiro",
    "explicacao": "máximo 2 frases",
    "tema": "tema"
  }
]
opcoes: só o texto, posição 0=A 1=B 2=C 3=D.
resposta: letra (A/B/C/D) para EM; "Verdadeiro" ou "Falso" para V/F.`;

  return `És especialista em educação moçambicana — ${subject}${displayGrade ? ', ' + displayGrade + 'ª Classe' : ' (Admissão)'}.
${langRule}
Gera exactamente ${numQ} perguntas NOVAS.
TIPO: ${typeRule}
TEMAS: ${topicRule}
${instrRule ? instrRule + '\n' : ''}${structBlock ? structBlock + '\n\n' : ''}${passageBlock ? passageBlock + '\n\n' : ''}CONTEÚDO REAL DO CURRÍCULO (base de conteúdo e nível — NÃO copies, gera perguntas NOVAS sobre o mesmo conteúdo):
${contextBlock}
REGRAS:
- Usa nomes/contextos moçambicanos (Rosa, Maputo, machamba, rio Zambeze…)
- Uma resposta claramente correcta por pergunta
- EM: 4 opções plausíveis; enunciado nunca inclui A/B/C/D
- Nível compatível com exame nacional moçambicano
${jsonFmt}`;
}

// ============================================================
// TINY HELPERS
// ============================================================

function _parseOpt(opcoes, i) {
  if (!Array.isArray(opcoes) || !opcoes[i]) return '';
  return String(opcoes[i]).replace(/^[A-Da-d][\.:]\s*/i, '').trim();
}

function _esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

export default SimulacaoScreen;
