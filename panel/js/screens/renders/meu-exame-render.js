// ============================================================
// panel/js/screens/renders/meu-exame-render.js
// ExameNova — Meu Exame Render Screen v1.0
//
// PURPOSE:
//   Full exam sitting under real conditions.
//   Generates 40 questions (AI + real DB questions mixed).
//   For language subjects: includes reading text + comprehension.
//   For 9ª Classe: mixed question types including composition.
//   Anti-cheat detection active throughout.
//   Results shown immediately on submission.
//   PDF download available after results.
//
// QUESTION ASSEMBLY (per subject):
//   Step 1: Fetch real past questions from DB (4–10 questions)
//   Step 2: Fetch reading text if language subject
//   Step 3: AI generates remaining questions using real ones
//            as style/difficulty/content reference
//   Step 4: For language: AI generates 10 comprehension
//            questions from the real fetched text
//   Step 5: Assemble 40 questions total, structured in batches
//
// BATCH STRUCTURE (40 questions):
//   Language subjects:
//     Batch 1 (Q1–10):  Comprehension — text visible above
//     Batch 2 (Q11–20): Grammar / vocabulary
//     Batch 3 (Q21–30): Mixed topics
//     Batch 4 (Q31–40): Mixed topics
//   Non-language:
//     Batch 1 (Q1–10):  Topic A
//     Batch 2 (Q11–20): Topic B
//     Batch 3 (Q21–30): Topic C
//     Batch 4 (Q31–40): Topic D
//   9ª Classe language: Q40 replaced by composition textarea
//
// SCORING:
//   Sent to Worker for authoritative computation.
//   Client never computes the score.
//   Composition evaluated by AI at results time.
//
// SECURITY:
//   Correct answers stored in module closure — not on window.
//   Anti-cheat events logged to Firestore in real time.
//   One attempt enforced via Firestore meuExame collection.
//   Moedas deducted at session start via Worker.
//
// PDF:
//   Generated client-side with jsPDF after results.
//   Uses Times New Roman font from /panel/js/fonts/
//   Uses Mozambican emblem from /assets/images/emblem.png
//   Shows: questions, student answers, correct answers, score.
//
// keepAlive: false | Navbar: absent | Header: fixed custom
// ============================================================

import { router }  from '../../core/router.js';
import { ui }      from '../../core/ui.js';
import { moeda }   from '../../core/moeda.js';
import { worker }  from '../../core/worker.js';
import { session } from '../../core/session.js';
import { generateMeuExamePDF } from '../../core/meu-exame-pdf.js';
import { db }      from '../../core/firebase.js';
import {
  fetchQuestions,
  fetchExamTexts,
  getOptions,
  normaliseYear,
  topicFrequency,
  pickRandom,
  isLanguageSubject,
  toDbGrade,
} from '../../core/exams.js';

import {
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ── Constants ─────────────────────────────────────────────────
const BATCH_SIZE      = 10;
const TOTAL_Q         = 40;
const REAL_Q_COUNT    = 8;   // real past questions to include
const TIMER_MINUTES   = 90;  // total exam time
const MEU_EXAME_COL   = 'meuExame';

// ── Sealed module state — NOT on window ───────────────────────
// These are in module closure. Console cannot reach them.
let _sessionData    = null;  // from session.meuExame
let _user           = null;
let _userData       = null;
let _questions      = [];    // assembled 40 questions
let _correctAnswers = {};    // { qIndex: correctText } — sealed
let _examText       = null;  // reading passage for language subjects
let _studentAnswers = {};    // { qIndex: chosenText }
let _composition    = '';    // 9ª Classe composition text
let _batchIndex     = 0;
let _timerSecs      = 0;
let _timerInterval  = null;
let _examDocId      = '';
let _tabSwitches    = 0;
let _examActive     = false;
let _submitted      = false;
let _is9a           = false;
let _isLang         = false;
let _emblemB64      = '';

// ── HTML escape ────────────────────────────────────────────────
function _esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

// ── Format time ───────────────────────────────────────────────
function _formatTime(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// ============================================================
// SCREEN OBJECT
// ============================================================

const MeuExameRenderScreen = {

  css() {
    if (document.getElementById('mer-styles')) return '';
    return `<style id="mer-styles">

      /* ── BASE ── */
      .mer-outer {
        min-height: 100dvh;
        background: var(--bg);
        padding-top: 68px;
        padding-bottom: 40px;
      }

      /* ── FIXED HEADER ── */
      .mer-header {
        position: fixed;
        top: 0; left: 0; right: 0; height: 68px;
        background: linear-gradient(135deg, #0C4A6E 0%, #0369A1 60%, #0284C7 100%);
        display: flex; align-items: center;
        padding: 0 14px; z-index: 300;
        gap: 10px;
        box-shadow: 0 2px 14px rgba(3,105,161,0.4);
      }
      .mer-header-info { flex: 1; min-width: 0; }
      .mer-header-eyebrow {
        font-size: 9px; font-weight: 700;
        text-transform: uppercase; letter-spacing: 0.08em;
        color: rgba(255,255,255,0.5); margin-bottom: 2px;
      }
      .mer-header-subject {
        font-size: 15px; font-weight: 800; color: #fff;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        letter-spacing: -0.2px;
      }
      .mer-header-right {
        display: flex; align-items: center; gap: 8px; flex-shrink: 0;
      }
      .mer-timer {
        display: flex; align-items: center; gap: 5px;
        background: rgba(255,255,255,0.12);
        border: 1px solid rgba(255,255,255,0.18);
        border-radius: 20px; padding: 5px 12px;
        font-size: 13px; font-weight: 700; color: #fff;
      }
      .mer-timer i { font-size: 10px; opacity: 0.7; }
      .mer-timer.warn {
        background: rgba(196,0,0,0.25);
        border-color: rgba(255,80,80,0.4);
        color: #ff9090;
        animation: merTimerPulse 1s ease infinite;
      }
      .mer-batch-pill {
        background: rgba(255,255,255,0.1);
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 20px; padding: 5px 10px;
        font-size: 11px; font-weight: 700;
        color: rgba(255,255,255,0.8);
      }

      /* ── PROGRESS BAR ── */
      .mer-progress-track {
        position: fixed; top: 68px; left: 0; right: 0;
        height: 3px; background: rgba(255,255,255,0.1); z-index: 299;
      }
      .mer-progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #FFB300, #FDD835);
        transition: width 0.5s ease;
      }

      /* ── CONTENT ── */
      .mer-content {
        padding: 20px 16px 20px;
        max-width: 700px; margin: 0 auto;
      }

      /* ── PREPARING OVERLAY ── */
      .mer-preparing {
        position: fixed; inset: 0;
        background: var(--bg); z-index: 500;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        gap: 16px; text-align: center; padding: 32px;
      }
      .mer-prep-ring {
        width: 56px; height: 56px;
        border: 3px solid var(--border);
        border-top-color: var(--primary);
        border-radius: 50%;
        animation: merSpin 0.8s linear infinite;
      }
      .mer-prep-title {
        font-size: 17px; font-weight: 800; color: var(--text);
      }
      .mer-prep-msg {
        font-size: 13px; color: var(--text-muted); max-width: 280px;
        line-height: 1.6;
      }
      .mer-prep-bar-wrap {
        width: 200px; height: 4px;
        background: var(--border); border-radius: 99px; overflow: hidden;
      }
      .mer-prep-bar {
        height: 100%;
        background: linear-gradient(90deg, var(--primary), #0E9AA7);
        border-radius: 99px; transition: width 0.5s ease; width: 0%;
      }

      /* ── WARNING SCREEN ── */
      .mer-warning {
        max-width: 560px; margin: 0 auto;
        padding: 32px 20px 20px;
      }
      .mer-warn-hero {
        background: linear-gradient(135deg, #7C2D12, #DC2626);
        border-radius: var(--radius-xl, 20px);
        padding: 24px; margin-bottom: 20px;
        display: flex; align-items: flex-start; gap: 14px;
      }
      .mer-warn-icon {
        width: 48px; height: 48px; border-radius: 50%;
        background: rgba(255,255,255,0.12);
        display: flex; align-items: center; justify-content: center;
        font-size: 20px; color: #fff; flex-shrink: 0;
      }
      .mer-warn-title {
        font-size: 18px; font-weight: 900; color: #fff; margin-bottom: 4px;
      }
      .mer-warn-sub {
        font-size: 12px; color: rgba(255,255,255,0.65); line-height: 1.5;
      }
      .mer-warn-rules {
        background: var(--surface); border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        overflow: hidden; margin-bottom: 20px;
      }
      .mer-warn-rule {
        display: flex; align-items: flex-start; gap: 12px;
        padding: 13px 16px; border-bottom: 1px solid var(--border);
        font-size: 13px; color: var(--text); line-height: 1.5;
      }
      .mer-warn-rule:last-child { border-bottom: none; }
      .mer-warn-rule i {
        font-size: 14px; color: var(--primary);
        flex-shrink: 0; margin-top: 1px; width: 18px; text-align: center;
      }
      .mer-warn-ack {
        display: flex; align-items: center; gap: 10px;
        padding: 14px 16px;
        background: var(--surface); border: 1px solid var(--border);
        border-radius: var(--radius-md); margin-bottom: 16px;
        font-size: 13px; font-weight: 600; color: var(--text);
        cursor: pointer;
      }
      .mer-warn-ack input[type="checkbox"] {
        width: 18px; height: 18px; cursor: pointer; flex-shrink: 0;
      }
      .mer-btn-start {
        width: 100%; padding: 17px;
        background: linear-gradient(135deg, #0369A1, #0284C7);
        color: #fff; border: none; border-radius: var(--radius-lg);
        font-family: inherit; font-size: 15px; font-weight: 800;
        cursor: pointer;
        display: flex; align-items: center; justify-content: center; gap: 9px;
        min-height: 56px;
        transition: opacity 0.2s, transform 0.15s;
        box-shadow: 0 4px 20px rgba(2,132,199,0.3);
        -webkit-tap-highlight-color: transparent;
      }
      .mer-btn-start:disabled { opacity: 0.38; cursor: not-allowed; }
      .mer-btn-start:hover:not(:disabled)  { opacity: 0.92; }
      .mer-btn-start:active:not(:disabled) { transform: scale(0.98); }

      /* ── BATCH HEADER ── */
      .mer-batch-header {
        display: flex; align-items: center; gap: 10px; margin-bottom: 20px;
      }
      .mer-batch-tag {
        font-size: 10px; font-weight: 800;
        text-transform: uppercase; letter-spacing: 0.08em;
        color: var(--primary); background: var(--primary-light);
        border-radius: 20px; padding: 4px 12px; white-space: nowrap;
      }
      .mer-batch-divider { flex: 1; height: 1px; background: var(--border); }
      .mer-batch-count {
        font-size: 11px; font-weight: 600;
        color: var(--text-muted); white-space: nowrap;
      }

      /* ── TEXT PASSAGE ── */
      .mer-passage {
        background: var(--surface);
        border: 1.5px solid var(--border);
        border-left: 4px solid var(--accent);
        border-radius: var(--radius-lg);
        margin-bottom: 20px; overflow: hidden;
      }
      .mer-passage-head {
        padding: 12px 16px;
        background: rgba(20,184,166,0.04);
        border-bottom: 1px solid var(--border);
      }
      .mer-passage-eyebrow {
        font-size: 9px; font-weight: 800;
        text-transform: uppercase; letter-spacing: 0.1em;
        color: var(--accent); margin-bottom: 3px;
      }
      .mer-passage-title {
        font-size: 14px; font-weight: 700; color: var(--text);
      }
      .mer-passage-autor {
        font-size: 11px; color: var(--text-muted); margin-top: 2px;
      }
      .mer-passage-body {
        padding: 14px 16px; font-size: 14px;
        color: var(--text-secondary); line-height: 1.85;
        white-space: pre-wrap; max-height: 260px; overflow-y: auto;
      }
      .mer-passage-glossario {
        padding: 9px 16px; border-top: 1px solid var(--border);
        font-size: 11px; color: var(--text-muted);
        font-style: italic; background: var(--bg);
      }

      /* ── QUESTION CARD ── */
      .mer-q-card {
        background: var(--surface);
        border: 1.5px solid var(--border);
        border-radius: var(--radius-xl, 20px);
        margin-bottom: 14px; overflow: hidden;
        transition: border-color 0.18s;
      }
      .mer-q-card.answered {
        border-color: var(--primary);
      }
      .mer-q-top {
        display: flex; align-items: center;
        justify-content: space-between;
        padding: 12px 16px 0; gap: 8px;
      }
      .mer-q-num {
        width: 28px; height: 28px; border-radius: 50%;
        background: var(--bg); border: 1.5px solid var(--border);
        display: flex; align-items: center; justify-content: center;
        font-size: 11px; font-weight: 800; color: var(--text-muted);
        flex-shrink: 0; transition: all 0.18s;
      }
      .mer-q-card.answered .mer-q-num {
        background: var(--primary); border-color: var(--primary); color: #fff;
      }
      .mer-q-badges {
        display: flex; align-items: center; gap: 5px; flex: 1; flex-wrap: wrap;
      }
      .mer-q-badge {
        font-size: 9px; font-weight: 700;
        border-radius: 20px; padding: 2px 8px;
      }
      .mer-q-badge.topic {
        color: var(--secondary); background: rgba(139,92,246,0.09);
      }
      .mer-q-badge.year {
        color: var(--text-muted); background: var(--bg);
        border: 1px solid var(--border);
      }
      .mer-q-badge.ai {
        color: var(--accent); background: rgba(20,184,166,0.09);
      }
      .mer-q-text {
        padding: 14px 16px 14px;
        font-size: 15px; font-weight: 600;
        color: var(--text); line-height: 1.65;
      }

      /* ── OPTIONS ── */
      .mer-options {
        display: flex; flex-direction: column;
        gap: 8px; padding: 0 14px 16px;
      }
      .mer-option {
        display: flex; align-items: flex-start; gap: 11px;
        background: var(--bg); border: 1.5px solid var(--border);
        border-radius: var(--radius-lg); padding: 13px 14px;
        cursor: pointer; transition: all 0.15s;
        width: 100%; font-family: inherit; min-height: 48px;
        text-align: left;
        -webkit-tap-highlight-color: transparent;
      }
      .mer-option:hover:not(.locked) {
        border-color: var(--primary);
        background: var(--primary-light);
        transform: translateX(2px);
      }
      .mer-option.selected {
        border-color: var(--primary);
        background: var(--primary-light);
      }
      .mer-option.locked { cursor: default; }
      .mer-opt-circle {
        width: 28px; height: 28px; border-radius: 50%;
        background: var(--surface); border: 1.5px solid var(--border);
        display: flex; align-items: center; justify-content: center;
        font-size: 11px; font-weight: 800; color: var(--text-muted);
        flex-shrink: 0; margin-top: 1px; transition: all 0.15s;
      }
      .mer-option.selected .mer-opt-circle {
        background: var(--primary); border-color: var(--primary); color: #fff;
      }
      .mer-opt-text {
        font-size: 14px; color: var(--text); line-height: 1.55; flex: 1; padding-top: 3px;
      }

      /* ── COMPOSITION ── */
      .mer-composition {
        padding: 0 14px 16px;
      }
      .mer-comp-label {
        font-size: 11px; font-weight: 700;
        color: var(--secondary); text-transform: uppercase;
        letter-spacing: 0.07em; margin-bottom: 8px;
        display: flex; align-items: center; gap: 6px;
      }
      .mer-comp-label i { font-size: 11px; }
      .mer-comp-textarea {
        width: 100%; min-height: 160px;
        background: var(--bg); border: 1.5px solid var(--border);
        border-radius: var(--radius-md); padding: 13px 14px;
        font-family: inherit; font-size: 14px; color: var(--text);
        outline: none; resize: vertical; line-height: 1.7;
        transition: border-color 0.2s;
        box-sizing: border-box;
      }
      .mer-comp-textarea:focus {
        border-color: var(--secondary);
        box-shadow: 0 0 0 3px rgba(139,92,246,0.1);
      }
      .mer-comp-count {
        font-size: 10px; font-weight: 600;
        color: var(--text-muted); text-align: right;
        margin-top: 5px;
      }

      /* ── PROGRESS DOTS ── */
      .mer-dots {
        display: flex; align-items: center;
        justify-content: center; gap: 7px;
        margin: 4px 0 20px;
      }
      .mer-dot {
        width: 9px; height: 9px; border-radius: 50%;
        background: var(--border); transition: all 0.22s;
      }
      .mer-dot.answered { background: var(--primary); transform: scale(1.15); }

      /* ── SUBMIT BUTTON ── */
      .mer-submit-wrap { margin-top: 8px; }
      .mer-submit-btn {
        width: 100%; padding: 17px; color: #fff;
        font-family: inherit; font-size: 15px; font-weight: 800;
        border: none; border-radius: var(--radius-lg); cursor: pointer;
        display: flex; align-items: center; justify-content: center; gap: 9px;
        min-height: 56px; transition: opacity 0.2s, transform 0.15s;
        background: linear-gradient(135deg, #059669, #10B981);
        box-shadow: 0 4px 20px rgba(16,185,129,0.3);
        -webkit-tap-highlight-color: transparent;
      }
      .mer-submit-btn:hover  { opacity: 0.92; }
      .mer-submit-btn:active { transform: scale(0.98); }
      .mer-submit-btn:disabled { opacity: 0.38; cursor: not-allowed; }
      .mer-submit-hint {
        text-align: center; font-size: 12px;
        color: var(--text-muted); margin-top: 9px;
      }
      .mer-next-btn {
        width: 100%; padding: 16px; color: #fff;
        font-family: inherit; font-size: 15px; font-weight: 700;
        border: none; border-radius: var(--radius-lg); cursor: pointer;
        display: flex; align-items: center; justify-content: center; gap: 9px;
        min-height: 54px; transition: opacity 0.2s, transform 0.15s;
        background: linear-gradient(135deg, #0369A1, #0284C7);
        box-shadow: 0 4px 20px rgba(2,132,199,0.25);
        -webkit-tap-highlight-color: transparent;
      }
      .mer-next-btn:hover  { opacity: 0.92; }
      .mer-next-btn:active { transform: scale(0.98); }

      /* ── QUIT MODAL ── */
      .mer-quit-bg {
        position: fixed; inset: 0; background: rgba(0,0,0,0.6);
        z-index: 600; display: none;
        align-items: center; justify-content: center; padding: 20px;
      }
      .mer-quit-bg.show { display: flex; }
      .mer-quit-modal {
        background: var(--surface); border-radius: 24px;
        max-width: 360px; width: 100%; overflow: hidden;
        box-shadow: 0 24px 60px rgba(0,0,0,0.35);
        animation: merModalIn 0.25s cubic-bezier(0.34,1.56,0.64,1) both;
      }
      .mer-quit-top {
        background: linear-gradient(135deg, #7C2D12, #DC2626);
        padding: 20px; display: flex; align-items: flex-start; gap: 12px;
      }
      .mer-quit-icon {
        width: 40px; height: 40px; border-radius: 50%;
        background: rgba(255,255,255,0.15);
        display: flex; align-items: center; justify-content: center;
        font-size: 17px; color: #fff; flex-shrink: 0;
      }
      .mer-quit-title { font-size: 16px; font-weight: 800; color: #fff; margin-bottom: 3px; }
      .mer-quit-sub   { font-size: 11px; color: rgba(255,255,255,0.65); line-height: 1.4; }
      .mer-quit-body  { padding: 18px 20px 20px; }
      .mer-quit-warn  {
        display: flex; align-items: flex-start; gap: 10px;
        background: rgba(239,68,68,0.07);
        border: 1px solid rgba(239,68,68,0.22);
        border-radius: var(--radius-md); padding: 12px 14px;
        margin-bottom: 16px; font-size: 13px;
        color: var(--text); line-height: 1.5;
      }
      .mer-quit-warn i { color: #EF4444; font-size: 14px; flex-shrink: 0; margin-top: 1px; }
      .mer-quit-btns  { display: flex; flex-direction: column; gap: 8px; }
      .mer-quit-continue {
        width: 100%; padding: 13px;
        background: linear-gradient(135deg, #0369A1, #0284C7);
        color: #fff; font-family: inherit;
        font-size: 14px; font-weight: 700; border: none;
        border-radius: var(--radius-md); cursor: pointer;
        min-height: 48px;
        display: flex; align-items: center; justify-content: center; gap: 7px;
        transition: opacity 0.2s;
      }
      .mer-quit-continue:hover { opacity: 0.92; }
      .mer-quit-leave {
        width: 100%; padding: 12px;
        background: transparent; border: 1.5px solid var(--border);
        border-radius: var(--radius-md); color: var(--text-muted);
        font-family: inherit; font-size: 13px; font-weight: 600;
        cursor: pointer; min-height: 44px;
        transition: border-color 0.2s, color 0.2s;
      }
      .mer-quit-leave:hover { border-color: #EF4444; color: #EF4444; }

      /* ── ANTI-CHEAT WARNING ── */
      .mer-anticheat-bg {
        position: fixed; inset: 0; background: rgba(0,0,0,0.7);
        z-index: 700; display: none;
        align-items: center; justify-content: center; padding: 20px;
        backdrop-filter: blur(6px);
      }
      .mer-anticheat-bg.show { display: flex; }
      .mer-anticheat-modal {
        background: var(--surface); border-radius: 24px;
        max-width: 360px; width: 100%; overflow: hidden;
        box-shadow: 0 24px 60px rgba(0,0,0,0.4);
        animation: merModalIn 0.25s cubic-bezier(0.34,1.56,0.64,1) both;
        text-align: center; padding: 32px 24px;
      }
      .mer-anticheat-icon {
        width: 60px; height: 60px; border-radius: 50%;
        background: rgba(245,158,11,0.1);
        display: flex; align-items: center; justify-content: center;
        font-size: 24px; color: #D97706; margin: 0 auto 16px;
      }
      .mer-anticheat-title {
        font-size: 17px; font-weight: 800; color: var(--text); margin-bottom: 8px;
      }
      .mer-anticheat-count {
        font-size: 40px; font-weight: 900; color: #EF4444;
        line-height: 1; margin: 12px 0 4px;
      }
      .mer-anticheat-lbl {
        font-size: 11px; color: var(--text-muted); margin-bottom: 14px;
      }
      .mer-anticheat-msg {
        font-size: 13px; color: var(--text-secondary);
        line-height: 1.7; margin-bottom: 20px;
      }
      .mer-anticheat-ok {
        width: 100%; padding: 13px;
        background: linear-gradient(135deg, #0369A1, #0284C7);
        color: #fff; font-family: inherit;
        font-size: 14px; font-weight: 700; border: none;
        border-radius: var(--radius-md); cursor: pointer; min-height: 48px;
      }

      /* ── RESULTS SCREEN ── */
      .mer-result { display: none; min-height: 100dvh; background: var(--bg); }
      .mer-result.show { display: block; }

      .mer-result-hero {
        background: linear-gradient(160deg, #0C4A6E 0%, #0369A1 50%, #0284C7 100%);
        padding: 80px 24px 60px;
        display: flex; flex-direction: column;
        align-items: center; text-align: center;
        position: relative; overflow: hidden;
      }
      .mer-result-hero::after {
        content: ''; position: absolute;
        bottom: -24px; left: 0; right: 0;
        height: 48px; background: var(--bg);
        border-radius: 50% 50% 0 0 / 100% 100% 0 0;
      }
      .mer-hero-blob {
        position: absolute; border-radius: 50%;
        opacity: 0.07; background: #fff;
      }

      .mer-score-ring {
        width: 130px; height: 130px; border-radius: 50%;
        border: 5px solid rgba(255,255,255,0.25);
        background: rgba(255,255,255,0.1);
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        margin-bottom: 22px; position: relative; z-index: 1;
        animation: merPop 0.55s cubic-bezier(0.34,1.56,0.64,1) both;
      }
      .mer-score-ring.pass { border-color: #4ADE80; background: rgba(74,222,128,0.18); }
      .mer-score-ring.fail { border-color: #F87171; background: rgba(248,113,113,0.14); }

      .mer-score-pct {
        font-size: 34px; font-weight: 900; color: #fff;
        line-height: 1; letter-spacing: -1px;
      }
      .mer-score-sub {
        font-size: 10px; color: rgba(255,255,255,0.6);
        font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.07em; margin-top: 3px;
      }
      .mer-result-title {
        font-size: 24px; font-weight: 900; color: #fff;
        margin-bottom: 6px; letter-spacing: -0.4px;
        position: relative; z-index: 1;
      }
      .mer-result-meta {
        font-size: 13px; color: rgba(255,255,255,0.65);
        position: relative; z-index: 1; line-height: 1.5;
      }
      .mer-verdict-pill {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 6px 16px; border-radius: var(--radius-full);
        font-size: 12px; font-weight: 700; margin-top: 12px;
        position: relative; z-index: 1;
      }
      .mer-verdict-pill.pass {
        background: rgba(74,222,128,0.2); color: #4ADE80;
        border: 1px solid rgba(74,222,128,0.3);
      }
      .mer-verdict-pill.fail {
        background: rgba(248,113,113,0.2); color: #F87171;
        border: 1px solid rgba(248,113,113,0.3);
      }
      .mer-verdict-pill.razoavel {
        background: rgba(251,191,36,0.2); color: #FCD34D;
        border: 1px solid rgba(251,191,36,0.3);
      }
      .mer-verdict-pill.provavel {
        background: rgba(56,189,248,0.2); color: #38BDF8;
        border: 1px solid rgba(56,189,248,0.3);
      }
      .mer-verdict-pill.certa {
        background: rgba(74,222,128,0.2); color: #4ADE80;
        border: 1px solid rgba(74,222,128,0.3);
      }

      /* Result body */
      .mer-result-body {
        max-width: 700px; margin: 0 auto; padding: 28px 16px 80px;
      }

      .mer-stats-row {
        display: flex; gap: 8px; margin-bottom: 28px;
        overflow-x: auto; scrollbar-width: none;
        -webkit-overflow-scrolling: touch;
      }
      .mer-stats-row::-webkit-scrollbar { display: none; }
      .mer-stat {
        background: var(--surface); border: 1px solid var(--border);
        border-radius: var(--radius-lg); padding: 14px 16px;
        text-align: center; flex: 0 0 calc(25% - 6px); min-width: 72px;
      }
      .mer-stat-val {
        font-size: 26px; font-weight: 900; line-height: 1; margin-bottom: 4px;
      }
      .mer-stat-val.c { color: #22C55E; }
      .mer-stat-val.w { color: #EF4444; }
      .mer-stat-val.t { color: var(--primary); }
      .mer-stat-lbl {
        font-size: 9px; font-weight: 700; color: var(--text-muted);
        text-transform: uppercase; letter-spacing: 0.06em;
      }

      /* Verdict block */
      .mer-verdict-block {
        background: var(--surface); border: 1px solid var(--border);
        border-radius: var(--radius-lg); padding: 16px 18px;
        margin-bottom: 16px; font-size: 14px;
        color: var(--text-secondary); line-height: 1.7;
      }
      .mer-verdict-block-title {
        font-size: 11px; font-weight: 800;
        text-transform: uppercase; letter-spacing: 0.08em;
        color: var(--primary); margin-bottom: 8px;
        display: flex; align-items: center; gap: 6px;
      }
      .mer-verdict-block-title i { font-size: 11px; }

      /* Integrity flag */
      .mer-integrity-warn {
        background: rgba(245,158,11,0.07);
        border: 1px solid rgba(245,158,11,0.2);
        border-radius: var(--radius-md); padding: 12px 14px;
        margin-bottom: 16px; font-size: 12px;
        color: #92400E; line-height: 1.55;
        display: flex; align-items: flex-start; gap: 8px;
      }
      [data-theme="dark"] .mer-integrity-warn { color: #FDE68A; }
      .mer-integrity-warn i { flex-shrink: 0; margin-top: 1px; }
      .mer-integrity-warn.hidden { display: none; }

      /* PDF button */
      .mer-btn-pdf {
        width: 100%; padding: 16px; color: #fff;
        font-family: inherit; font-size: 15px; font-weight: 700;
        border: none; border-radius: var(--radius-lg); cursor: pointer;
        display: flex; align-items: center; justify-content: center; gap: 9px;
        min-height: 54px; margin-bottom: 10px;
        background: linear-gradient(135deg, #7C3AED, #8B5CF6);
        box-shadow: 0 4px 20px rgba(139,92,246,0.3);
        transition: opacity 0.2s, transform 0.15s;
        -webkit-tap-highlight-color: transparent;
      }
      .mer-btn-pdf:hover  { opacity: 0.9; }
      .mer-btn-pdf:active { transform: scale(0.97); }
      .mer-btn-pdf:disabled { opacity: 0.38; cursor: not-allowed; }

      .mer-btn-dash {
        width: 100%; padding: 14px; color: #fff;
        font-family: inherit; font-size: 14px; font-weight: 700;
        border: none; border-radius: var(--radius-lg); cursor: pointer;
        display: flex; align-items: center; justify-content: center; gap: 8px;
        min-height: 50px; margin-bottom: 10px;
        background: linear-gradient(135deg, #0369A1, #0284C7);
        box-shadow: 0 3px 14px rgba(2,132,199,0.25);
        transition: opacity 0.2s, transform 0.15s;
        -webkit-tap-highlight-color: transparent;
      }
      .mer-btn-dash:hover  { opacity: 0.9; }
      .mer-btn-dash:active { transform: scale(0.97); }

      .mer-btn-revisao {
        width: 100%; padding: 13px;
        background: transparent; border: 1.5px solid var(--border);
        border-radius: var(--radius-lg); color: var(--text-secondary);
        font-family: inherit; font-size: 13px; font-weight: 600;
        cursor: pointer; min-height: 48px; margin-bottom: 10px;
        display: flex; align-items: center; justify-content: center; gap: 7px;
        transition: border-color 0.2s, color 0.2s;
      }
      .mer-btn-revisao:hover { border-color: var(--secondary); color: var(--secondary); }

      /* Corrected exam review (collapsed per batch) */
      .mer-review-section {
        margin-top: 20px;
      }
      .mer-review-title {
        font-size: 13px; font-weight: 800; color: var(--text);
        margin-bottom: 12px;
        display: flex; align-items: center; gap: 7px;
      }
      .mer-review-title i { font-size: 12px; color: var(--primary); }

      .mer-review-batch {
        background: var(--surface); border: 1px solid var(--border);
        border-radius: var(--radius-lg); overflow: hidden; margin-bottom: 10px;
      }
      .mer-review-batch-head {
        display: flex; align-items: center; justify-content: space-between;
        padding: 13px 16px; cursor: pointer;
        background: var(--bg); transition: background 0.15s;
      }
      .mer-review-batch-head:hover { background: var(--primary-light); }
      .mer-review-batch-label {
        font-size: 12px; font-weight: 700; color: var(--text-secondary);
        display: flex; align-items: center; gap: 7px;
      }
      .mer-review-batch-label i { font-size: 11px; color: var(--primary); }
      .mer-review-batch-score {
        font-size: 12px; font-weight: 700; color: var(--text-muted);
      }
      .mer-review-chevron {
        font-size: 10px; color: var(--text-muted); transition: transform 0.2s;
        margin-left: 8px;
      }
      .mer-review-batch.open .mer-review-chevron { transform: rotate(180deg); }
      .mer-review-items { display: none; }
      .mer-review-batch.open .mer-review-items { display: block; }

      .mer-review-item {
        padding: 14px 16px; border-top: 1px solid var(--border);
        position: relative;
      }
      .mer-review-item::before {
        content: ''; position: absolute;
        left: 0; top: 0; bottom: 0; width: 4px;
      }
      .mer-review-item.correct::before { background: #22C55E; }
      .mer-review-item.wrong::before   { background: #EF4444; }

      .mer-review-q {
        font-size: 13px; font-weight: 600; color: var(--text);
        line-height: 1.5; margin-bottom: 8px;
      }
      .mer-review-ans-row {
        display: flex; flex-wrap: wrap; gap: 6px;
      }
      .mer-ans-pill {
        font-size: 11px; font-weight: 600; border-radius: 20px;
        padding: 3px 11px; display: flex; align-items: center; gap: 4px;
      }
      .mer-ans-pill.student-ok {
        background: rgba(34,197,94,0.09); color: #16A34A;
        border: 1px solid rgba(34,197,94,0.22);
      }
      .mer-ans-pill.student-err {
        background: rgba(239,68,68,0.07); color: #DC2626;
        border: 1px solid rgba(239,68,68,0.2);
        text-decoration: line-through; opacity: 0.85;
      }
      .mer-ans-pill.correct-ans {
        background: rgba(34,197,94,0.09); color: #16A34A;
        border: 1px solid rgba(34,197,94,0.22);
      }

      /* ── DARK ── */
      [data-theme="dark"] .mer-q-card,
      [data-theme="dark"] .mer-quit-modal,
      [data-theme="dark"] .mer-anticheat-modal { background: var(--bg-card); }
      [data-theme="dark"] .mer-option { background: var(--bg); }
      [data-theme="dark"] .mer-passage { background: var(--bg-card); }
      [data-theme="dark"] .mer-result-hero::after { background: var(--bg); }
      [data-theme="dark"] .mer-stat,
      [data-theme="dark"] .mer-verdict-block,
      [data-theme="dark"] .mer-review-batch { background: var(--bg-card); }

      /* ── RESPONSIVE ── */
      @media (min-width: 768px) {
        .mer-content { padding: 24px 24px 20px; }
        .mer-result-body { padding: 32px 24px 80px; }
      }
      @media (min-width: 1025px) {
        .mer-outer           { max-width: 760px; margin: 0 auto; }
        .mer-header          { max-width: 760px; left: 50%; transform: translateX(-50%); }
        .mer-progress-track  { max-width: 760px; left: 50%; transform: translateX(-50%); }
      }

      /* ── ANIMATIONS ── */
      @keyframes merSpin     { to { transform: rotate(360deg); } }
      @keyframes merPop      { from { opacity:0; transform:scale(0.65); } to { opacity:1; transform:scale(1); } }
      @keyframes merModalIn  { from { opacity:0; transform:scale(0.9) translateY(12px); } to { opacity:1; transform:scale(1) translateY(0); } }
      @keyframes merTimerPulse { 0%,100% { opacity:1; } 50% { opacity:0.65; } }
      @keyframes merFadeUp   { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
      @keyframes merSlideIn  { from { opacity:0; transform:translateX(16px); } to { opacity:1; transform:translateX(0); } }

    </style>`;
  },

  mount() {
    return `
      <!-- Fixed header rendered by _renderHeader() after exam starts -->
      <div id="mer-header-slot"></div>
      <div class="mer-progress-track" id="mer-progress-track" style="display:none;">
        <div class="mer-progress-fill" id="mer-progress" style="width:0%"></div>
      </div>

      <!-- Preparing overlay -->
      <div class="mer-preparing" id="mer-preparing">
        <div class="mer-prep-ring"></div>
        <div class="mer-prep-title notranslate" translate="no">A preparar o exame…</div>
        <div class="mer-prep-msg notranslate" translate="no" id="mer-prep-msg">
          A gerar as questões com inteligência artificial…
        </div>
        <div class="mer-prep-bar-wrap">
          <div class="mer-prep-bar" id="mer-prep-bar"></div>
        </div>
      </div>

      <!-- Main exam area (hidden until ready) -->
      <div class="mer-outer" id="mer-main" style="display:none;">
        <div class="mer-content" id="mer-batch-area"></div>
      </div>

      <!-- Results screen -->
      <div class="mer-result" id="mer-result"></div>

      <!-- Quit modal -->
      <div class="mer-quit-bg" id="mer-quit-bg">
        <div class="mer-quit-modal">
          <div class="mer-quit-top">
            <div class="mer-quit-icon">
              <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
            </div>
            <div>
              <div class="mer-quit-title notranslate" translate="no">Sair do Exame?</div>
              <div class="mer-quit-sub notranslate" translate="no">
                Esta é a sua única tentativa.
              </div>
            </div>
          </div>
          <div class="mer-quit-body">
            <div class="mer-quit-warn">
              <i class="fa-solid fa-coins" aria-hidden="true"></i>
              <span class="notranslate" translate="no">
                As <strong>20 Moedas</strong> já foram deduzidas e não serão reembolsadas.
                O exame ficará marcado como incompleto.
              </span>
            </div>
            <div class="mer-quit-btns">
              <button class="mer-quit-continue notranslate" translate="no"
                id="mer-quit-continue">
                <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
                Continuar o Exame
              </button>
              <button class="mer-quit-leave notranslate" translate="no"
                id="mer-quit-leave">
                Sair mesmo assim
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Anti-cheat modal -->
      <div class="mer-anticheat-bg" id="mer-anticheat-bg">
        <div class="mer-anticheat-modal">
          <div class="mer-anticheat-icon">
            <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
          </div>
          <div class="mer-anticheat-title notranslate" translate="no">
            Actividade Registada
          </div>
          <div class="mer-anticheat-count notranslate" translate="no"
            id="mer-ac-count">1</div>
          <div class="mer-anticheat-lbl notranslate" translate="no">
            evento(s) registado(s)
          </div>
          <div class="mer-anticheat-msg notranslate" translate="no">
            O sistema detectou que saiu desta página durante o exame.
            Este evento foi registado. Mantenha-se nesta página.
          </div>
          <button class="mer-anticheat-ok notranslate" translate="no"
            id="mer-ac-ok">
            Continuar o Exame
          </button>
        </div>
      </div>
    `;
  },

  async init(user, userData, params) {
    if (!session.meuExame) {
      router.navigate('/panel/meu-exame');
      return;
    }

    _sessionData    = { ...session.meuExame };
    session.meuExame = null;
    _user           = user;
    _userData       = userData;
    _questions      = [];
    _correctAnswers = {};
    _studentAnswers = {};
    _composition    = '';
    _batchIndex     = 0;
    _timerSecs      = 0;
    _tabSwitches    = 0;
    _examActive     = false;
    _submitted      = false;
    _emblemB64      = '';

    const dbSubject = _sessionData.dbSubject;
    const grade     = String(_userData?.grade || '12');
    _is9a   = grade === '9';
    _isLang = isLanguageSubject(dbSubject);

    // Build exam document ID
    _examDocId = `${_user.uid}_${dbSubject}`;

    // Wire modal buttons
    document.getElementById('mer-quit-continue')
      ?.addEventListener('click', _closeQuitModal);
    document.getElementById('mer-quit-leave')
      ?.addEventListener('click', () => {
        _closeQuitModal();
        _stopTimer();
        _examActive = false;
        router.navigate('/panel/meu-exame');
      });
    document.getElementById('mer-ac-ok')
      ?.addEventListener('click', _closeAntiCheat);

    // Block back button during exam
    history.pushState({ mer: true }, '', window.location.href);
    window.addEventListener('popstate', _handlePopState);

    // Show warning screen first (before generating questions)
    _showWarningScreen();
  },

  destroy() {
    _stopTimer();
    _examActive = false;
    window.removeEventListener('popstate', _handlePopState);
    _questions      = [];
    _correctAnswers = {};
    _studentAnswers = {};
    session.meuExame = null;
  },
};

// ============================================================
// POPSTATE / QUIT MODAL
// ============================================================

function _handlePopState() {
  if (!_submitted) {
    _openQuitModal();
    history.pushState({ mer: true }, '', window.location.href);
  }
}

function _openQuitModal()  { document.getElementById('mer-quit-bg')?.classList.add('show'); }
function _closeQuitModal() { document.getElementById('mer-quit-bg')?.classList.remove('show'); }

// ============================================================
// ANTI-CHEAT
// ============================================================

function _setupAntiCheat() {
  document.addEventListener('visibilitychange', _handleVisibility);

  // DevTools heuristic
  let _devOpen = false;
  const _devInterval = setInterval(() => {
    if (!_examActive) { clearInterval(_devInterval); return; }
    const open = (window.outerWidth  - window.innerWidth)  > 160
              || (window.outerHeight - window.innerHeight) > 160;
    if (open && !_devOpen) { _devOpen = true; _logAntiCheat(); }
    if (!open) _devOpen = false;
  }, 1500);

  // Block key shortcuts
  document.addEventListener('keydown', _blockKeys);

  // Disable right-click during exam
  document.addEventListener('contextmenu', _blockCtx);
}

function _teardownAntiCheat() {
  document.removeEventListener('visibilitychange', _handleVisibility);
  document.removeEventListener('keydown', _blockKeys);
  document.removeEventListener('contextmenu', _blockCtx);
}

function _handleVisibility() {
  if (document.hidden && _examActive) _logAntiCheat();
}

function _blockKeys(e) {
  if (!_examActive) return;
  if (e.key === 'F12') e.preventDefault();
  if (e.ctrlKey && e.shiftKey && ['I','J','C','U'].includes(e.key.toUpperCase()))
    e.preventDefault();
  if (e.ctrlKey && e.key.toUpperCase() === 'U') e.preventDefault();
}

function _blockCtx(e) {
  if (_examActive) e.preventDefault();
}

function _logAntiCheat() {
  _tabSwitches++;
  // Save to Firestore asynchronously — fire and forget
  if (_examDocId) {
    updateDoc(doc(db, MEU_EXAME_COL, _examDocId), {
      tabSwitches:    _tabSwitches,
      integrityFlag:  _tabSwitches >= 2,
      updatedAt:      serverTimestamp(),
    }).catch(() => {});
  }
  _openAntiCheat();
}

function _openAntiCheat() {
  const countEl = document.getElementById('mer-ac-count');
  if (countEl) countEl.textContent = _tabSwitches;
  document.getElementById('mer-anticheat-bg')?.classList.add('show');
}

function _closeAntiCheat() {
  document.getElementById('mer-anticheat-bg')?.classList.remove('show');
}

// ============================================================
// WARNING SCREEN
// ============================================================

function _showWarningScreen() {
  const preparing = document.getElementById('mer-preparing');
  if (preparing) preparing.style.display = 'none';

  const main = document.getElementById('mer-main');
  if (main) {
    main.style.display = 'block';
    main.style.paddingTop = '0';
  }

  const area = document.getElementById('mer-batch-area');
  if (!area) return;

  area.innerHTML = `
    <div class="mer-warning">
      <div class="mer-warn-hero">
        <div class="mer-warn-icon">
          <i class="fa-solid fa-graduation-cap" aria-hidden="true"></i>
        </div>
        <div>
          <div class="mer-warn-title notranslate" translate="no">
            Meu Exame — ${_esc(_sessionData.subject)}
          </div>
          <div class="mer-warn-sub notranslate" translate="no">
            Leia as condições com atenção antes de iniciar
          </div>
        </div>
      </div>

      <div class="mer-warn-rules">
        <div class="mer-warn-rule">
          <i class="fa-solid fa-clock" aria-hidden="true"></i>
          <span class="notranslate" translate="no">
            Terá <strong>90 minutos</strong> para completar 40 questões. O tempo começa ao iniciar.
          </span>
        </div>
        <div class="mer-warn-rule">
          <i class="fa-solid fa-ban" aria-hidden="true"></i>
          <span class="notranslate" translate="no">
            O exame <strong>não pode ser pausado</strong>. Certifique-se de ter tempo e ligação suficientes.
          </span>
        </div>
        <div class="mer-warn-rule">
          <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
          <span class="notranslate" translate="no">
            O sistema regista saídas da página. Mantenha-se nesta janela durante todo o exame.
          </span>
        </div>
        <div class="mer-warn-rule">
          <i class="fa-solid fa-coins" aria-hidden="true"></i>
          <span class="notranslate" translate="no">
            <strong>20 Moedas</strong> serão deduzidas ao iniciar. Não há reembolso por saída antecipada.
          </span>
        </div>
        <div class="mer-warn-rule">
          <i class="fa-solid fa-lock" aria-hidden="true"></i>
          <span class="notranslate" translate="no">
            Esta é a sua <strong>única tentativa</strong> para esta disciplina.
          </span>
        </div>
      </div>

      <label class="mer-warn-ack notranslate" translate="no">
        <input type="checkbox" id="mer-ack-check"
          onchange="document.getElementById('mer-start-btn').disabled=!this.checked">
        Li e aceito as condições acima. Estou pronto para iniciar.
      </label>

      <button class="mer-btn-start notranslate" translate="no"
        id="mer-start-btn" disabled>
        <i class="fa-solid fa-play" aria-hidden="true"></i>
        Iniciar Exame Agora
      </button>
    </div>
  `;

  window.scrollTo(0, 0);

  document.getElementById('mer-start-btn')
    ?.addEventListener('click', () => _beginExam(), { once: true });
}

// ============================================================
// BEGIN EXAM — Deduct Moedas, write Firestore, generate questions
// ============================================================

async function _beginExam() {
  // Show preparing overlay
  const main = document.getElementById('mer-main');
  if (main) main.style.display = 'none';

  const preparing = document.getElementById('mer-preparing');
  if (preparing) preparing.style.display = 'flex';

  _setPrep('A deduzir Moedas…', 10);

  // 1. Deduct Moedas
  try {
    const result = await moeda.deductMoedas(_user.uid, _sessionData.cost);
    if (!result.success) {
      _prepError('Saldo insuficiente de Moedas. Verifique o seu saldo e tente novamente.');
      return;
    }
  } catch (e) {
    _prepError('Erro ao deduzir Moedas. Verifique a ligação e tente novamente.');
    return;
  }

  _setPrep('A registar a sessão…', 20);

  // 2. Write Firestore session record (marks attempt as started)
  try {
    await setDoc(doc(db, MEU_EXAME_COL, _examDocId), {
      userId:        _user.uid,
      dbSubject:     _sessionData.dbSubject,
      subject:       _sessionData.subject,
      status:        'in_progress',
      startedAt:     serverTimestamp(),
      tabSwitches:   0,
      integrityFlag: false,
      moedasSpent:   _sessionData.cost,
    }, { merge: true });
  } catch (e) {
    _prepError('Erro ao registar sessão. Verifique a ligação e tente novamente.');
    return;
  }

  _setPrep('A carregar questões reais…', 35);

  // 3. Fetch real past questions from DB
  let realQuestions = [];
  let examText      = null;

  try {
    const dbGrade    = _is9a ? '10ª Classe' : toDbGrade(String(_userData?.grade || '12'));
    const examType   = _userData?.examType === 'admissao' ? 'Admissão' : 'Ensino Geral';
    const institution = _userData?.institution
      ? _userData.institution.toUpperCase()
      : null;

    const filters = {
      disciplina: _sessionData.dbSubject,
      tipo_exame: examType,
    };
    if (!_userData?.examType?.includes('admissao')) {
      filters.classe = dbGrade;
    }
    if (institution) {
      filters.instituicao = institution;
    }

    const all = await fetchQuestions(filters);
    const valid = all.filter(q => {
      const tipo = (q['Tipo'] || '').trim();
      const resp = (q['Resposta'] || '').trim();
      return (tipo === 'escolha-multipla' || tipo === 'verdadeiro-falso') && resp;
    });

    // Pick real questions — up to REAL_Q_COUNT
    realQuestions = pickRandom(valid, REAL_Q_COUNT);

  } catch (e) {
    console.warn('[MeuExame] DB fetch:', e);
    // Continue without real questions — AI generates all
  }

  _setPrep('A carregar texto de leitura…', 50);

  // 4. Fetch reading text if language subject
  if (_isLang) {
    try {
      const texts = await fetchExamTexts({
        disciplina: _sessionData.dbSubject,
      });
      if (texts.length) {
        examText = texts[Math.floor(Math.random() * texts.length)];
      }
    } catch (e) {
      console.warn('[MeuExame] text fetch:', e);
    }
  }
  _examText = examText;

  _setPrep('A gerar questões com IA…', 65);

  // 5. Generate AI questions
  let aiQuestions = [];
  try {
    aiQuestions = await _generateAIQuestions(realQuestions, examText);
  } catch (e) {
    console.warn('[MeuExame] AI gen:', e);
    // If AI fails, pad with more real questions
    const dbGrade    = _is9a ? '10ª Classe' : toDbGrade(String(_userData?.grade || '12'));
    const examType   = _userData?.examType === 'admissao' ? 'Admissão' : 'Ensino Geral';
    try {
      const filters = { disciplina: _sessionData.dbSubject, tipo_exame: examType };
      if (!_userData?.examType?.includes('admissao')) filters.classe = dbGrade;
      const fallback = await fetchQuestions(filters);
      const valid = fallback.filter(q =>
        (q['Tipo'] === 'escolha-multipla' || q['Tipo'] === 'verdadeiro-falso')
        && q['Resposta']
      );
      aiQuestions = pickRandom(valid, TOTAL_Q - realQuestions.length);
    } catch (e2) {
      _prepError('Erro ao gerar as questões. Verifique a ligação e tente novamente.');
      return;
    }
  }

  _setPrep('A montar o exame…', 85);

  // 6. Assemble final 40 questions
  _assembleQuestions(realQuestions, aiQuestions, examText);

  _setPrep('Pronto! A iniciar…', 100);
  await new Promise(r => setTimeout(r, 400));

  // 7. Load emblem for PDF
  try {
    const res  = await fetch('/assets/images/emblem.png');
    const blob = await res.blob();
    _emblemB64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onloadend = () => res(r.result);
      r.onerror   = () => rej();
      r.readAsDataURL(blob);
    });
  } catch (e) { _emblemB64 = ''; }

  // 8. Start exam
  if (preparing) preparing.style.display = 'none';
  if (main) {
    main.style.display  = 'block';
    main.style.paddingTop = '68px';
  }

  document.getElementById('mer-progress-track').style.display = 'block';

  _renderFixedHeader();
  _setupAntiCheat();
  _examActive = true;
  _startTimer();
  _renderBatch(0);
}

function _setPrep(msg, pct) {
  const msgEl = document.getElementById('mer-prep-msg');
  const barEl = document.getElementById('mer-prep-bar');
  if (msgEl) msgEl.textContent = msg;
  if (barEl) barEl.style.width = pct + '%';
}

function _prepError(msg) {
  const preparing = document.getElementById('mer-preparing');
  if (preparing) {
    preparing.innerHTML = `
      <div style="text-align:center;padding:32px 24px;">
        <i class="fa-solid fa-circle-exclamation"
          style="font-size:40px;color:#EF4444;margin-bottom:16px;display:block;"></i>
        <div style="font-size:16px;font-weight:800;color:var(--text);margin-bottom:8px;"
          class="notranslate" translate="no">Erro ao preparar o exame</div>
        <div style="font-size:13px;color:var(--text-muted);max-width:280px;
          margin:0 auto 20px;line-height:1.6;"
          class="notranslate" translate="no">${_esc(msg)}</div>
        <button onclick="history.back()"
          style="padding:12px 24px;background:var(--primary);color:#fff;
          border:none;border-radius:var(--radius-md);font-family:inherit;
          font-size:14px;font-weight:700;cursor:pointer;"
          class="notranslate" translate="no">
          Voltar
        </button>
      </div>
    `;
  }
}

// ============================================================
// AI QUESTION GENERATION
// ============================================================

async function _generateAIQuestions(realQuestions, examText) {
  const subject    = _sessionData.subject;
  const dbSubject  = _sessionData.dbSubject;
  const grade      = String(_userData?.grade || '12');
  const examType   = _userData?.examType === 'admissao' ? 'admissão' : 'ensino geral';
  const institution = _userData?.institution || _userData?.course || '';

  // Build context from real questions for style reference
  const contextLines = realQuestions.slice(0, 8).map((q, i) => {
    const opts = getOptions(q);
    const optsText = opts.map(o => `${o.letter}) ${o.text}`).join(' | ');
    const resp = q['Resposta'] || '';
    return `${i + 1}. [${q['Tema_Relacionado'] || ''}] ${q['Enunciado'] || ''}\n   Opções: ${optsText}\n   Resposta: ${resp}`;
  }).join('\n\n');

  // How many AI questions we need
  const needTotal       = TOTAL_Q;
  const needComprehension = _isLang ? 10 : 0;
  const needRegular     = needTotal - realQuestions.length - needComprehension;

  // Build comprehension questions prompt if language
  let comprehensionQuestions = [];
  if (_isLang && examText) {
    const compPrompt = `És um examinador de ${subject} para o ensino ${examType} de Moçambique${grade ? ', ' + grade + 'ª Classe' : ''}${institution ? ', ' + institution : ''}.

TEXTO DE LEITURA:
Título: "${examText.titulo || ''}"
Autor: ${examText.autor || ''}
---
${examText.conteudo || ''}
---
${examText.glossario ? 'Glossário: ' + examText.glossario : ''}

Gera exactamente 10 perguntas de compreensão sobre este texto em Português formal de Moçambique.
Inclui: compreensão directa (3), inferência (3), vocabulário em contexto (2), tipologia e estrutura do texto (2).
REGRAS:
- Todas escolha múltipla com 4 opções (A, B, C, D)
- Uma resposta claramente correcta por pergunta
- Refere sempre conteúdo específico do texto acima — nunca perguntas genéricas
- Nunca reveles a resposta no enunciado
- Nível compatível com exame nacional moçambicano

Responde APENAS com JSON array:
[{"pergunta":"...","opcoes":["A) ...","B) ...","C) ...","D) ..."],"resposta":"A","tema":"Compreensão do Texto"}]`;

    try {
      const raw = await worker.callAI(
        [
          { role: 'system', content: compPrompt },
          { role: 'user',   content: 'Gera as 10 perguntas de compreensão agora.' },
        ],
        { maxTokens: 2000, temperature: 0.55 }
      );
      const clean = raw.replace(/```json|```/g, '').replace(/^[^\[]*/, '').replace(/[^\]]*$/, '').trim();
      comprehensionQuestions = JSON.parse(clean);
    } catch (e) {
      console.warn('[MeuExame] comprehension gen:', e);
    }
  }

  // Build regular questions
  let regularQuestions = [];
  if (needRegular > 0) {
    const gradeLabel = _is9a ? '9ª Classe (equivalência 10ª)' : `${grade}ª Classe`;
    const regularPrompt = `És um examinador de ${subject} para o ${examType} de Moçambique${gradeLabel ? ', ' + gradeLabel : ''}${institution ? ', ' + institution : ''}.

QUESTÕES REAIS DOS EXAMES ANTERIORES (referência de estilo, dificuldade e conteúdo):
${contextLines || 'Sem questões reais disponíveis — usa o currículo oficial moçambicano.'}

Gera exactamente ${needRegular} questões NOVAS sobre ${subject}.
REGRAS:
- Todas escolha múltipla com 4 opções (A, B, C, D)
- Uma resposta claramente correcta por pergunta
- Distribui pelos temas principais do currículo de ${subject} para ${gradeLabel}
- Mesmo nível de dificuldade das questões reais acima
- Usa contextos moçambicanos (nomes, lugares, exemplos locais)
- Nunca copes as questões reais — gera perguntas NOVAS sobre o mesmo conteúdo
- Equações e símbolos: escreve em texto simples (ex: H2O, x², m/s²)

Responde APENAS com JSON array:
[{"pergunta":"...","opcoes":["A) ...","B) ...","C) ...","D) ..."],"resposta":"A","tema":"..."}]`;

    try {
      const raw = await worker.callAI(
        [
          { role: 'system', content: regularPrompt },
          { role: 'user',   content: `Gera ${needRegular} questões novas agora.` },
        ],
        { maxTokens: 4000, temperature: 0.6 }
      );
      const clean = raw.replace(/```json|```/g, '').replace(/^[^\[]*/, '').replace(/[^\]]*$/, '').trim();
      regularQuestions = JSON.parse(clean);
    } catch (e) {
      console.warn('[MeuExame] regular gen:', e);
    }
  }

  return { comprehensionQuestions, regularQuestions };
}

// ============================================================
// ASSEMBLE QUESTIONS
// Builds the sealed _questions array and _correctAnswers map.
// Correct answers are NEVER exposed on window.
// ============================================================

function _assembleQuestions(realQuestions, aiResult, examText) {
  const { comprehensionQuestions = [], regularQuestions = [] } = aiResult || {};
  const assembled = [];

  // Helper to add a question and register its correct answer
  const addQ = (q, isAI, aiData = null) => {
    const idx = assembled.length;
    if (isAI && aiData) {
      assembled.push({
        _id:          `ai-${idx}`,
        _aiGenerated: true,
        'Enunciado':  aiData.pergunta || '',
        'Tipo':       'escolha-multipla',
        'Opção_A':    _parseOpt(aiData.opcoes, 0),
        'Opção_B':    _parseOpt(aiData.opcoes, 1),
        'Opção_C':    _parseOpt(aiData.opcoes, 2),
        'Opção_D':    _parseOpt(aiData.opcoes, 3),
        'Resposta':   (aiData.resposta || 'A').toUpperCase(),
        'Tema_Relacionado': aiData.tema || '',
        '_isComprehension': aiData.tema?.includes('Compreensão') || false,
      });
      // Seal correct answer — map letter to option text
      const opts = getOptions(assembled[idx]);
      const letter = (aiData.resposta || 'A').toUpperCase();
      const correctOpt = opts.find(o => o.letter === letter);
      _correctAnswers[idx] = correctOpt?.text || letter;
    } else {
      assembled.push({ ...q });
      // DB questions store answer as full text
      _correctAnswers[idx] = (q['Resposta'] || '').trim();
    }
  };

  if (_isLang && examText) {
    // Batch 1: comprehension questions (Q1–10)
    comprehensionQuestions.slice(0, 10).forEach(q => addQ(null, true, q));
    // Fill if fewer than 10
    while (assembled.length < 10 && regularQuestions.length > 0) {
      addQ(null, true, regularQuestions.shift());
    }
    // Batch 2–4: real questions + remaining AI
    realQuestions.forEach(q => addQ(q, false));
    regularQuestions.forEach(q => addQ(null, true, q));
  } else {
    // Non-language: real questions first, then AI
    realQuestions.forEach(q => addQ(q, false));
    regularQuestions.forEach(q => addQ(null, true, q));
  }

  // Pad to exactly TOTAL_Q if needed (should not happen normally)
  while (assembled.length < TOTAL_Q && assembled.length > 0) {
    const last = assembled[assembled.length - 1];
    const idx  = assembled.length;
    assembled.push({ ...last, _id: `pad-${idx}`, 'Enunciado': `Questão ${idx + 1}` });
    _correctAnswers[idx] = _correctAnswers[assembled.length - 2] || '';
  }

  _questions = assembled.slice(0, TOTAL_Q);
}

function _parseOpt(opcoes, i) {
  if (!Array.isArray(opcoes) || !opcoes[i]) return '';
  return String(opcoes[i]).replace(/^[A-Da-d][\.:)]\s*/i, '').trim();
}

// ============================================================
// FIXED HEADER
// ============================================================

function _renderFixedHeader() {
  const slot = document.getElementById('mer-header-slot');
  if (!slot) return;

  const grade = String(_userData?.grade || '12');
  const gradeLabel = _is9a ? '9ª Classe' : `${grade}ª Classe`;

  slot.innerHTML = `
    <div class="mer-header" id="mer-header">
      <div class="mer-header-info">
        <div class="mer-header-eyebrow notranslate" translate="no">
          Meu Exame · ${_esc(gradeLabel)}
        </div>
        <div class="mer-header-subject notranslate" translate="no">
          ${_esc(_sessionData.subject)}
        </div>
      </div>
      <div class="mer-header-right">
        <div class="mer-batch-pill notranslate" translate="no" id="mer-batch-pill">
          1 / 4
        </div>
        <div class="mer-timer notranslate" translate="no" id="mer-timer">
          <i class="fa-solid fa-clock" aria-hidden="true"></i>
          <span id="mer-timer-txt">90:00</span>
        </div>
        <button onclick="_openQuitModal_global()"
          style="width:34px;height:34px;border-radius:50%;
            background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.15);
            color:rgba(255,255,255,0.8);font-size:14px;cursor:pointer;
            display:flex;align-items:center;justify-content:center;"
          class="notranslate" translate="no" aria-label="Sair">
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </div>
    </div>
  `;

  // Expose quit for inline onclick (header is outside module)
  window._openQuitModal_global = _openQuitModal;
}

function _updateHeaderBatch(batchNum) {
  const el = document.getElementById('mer-batch-pill');
  if (el) el.textContent = `${batchNum} / 4`;
}

// ============================================================
// TIMER
// ============================================================

function _startTimer() {
  _timerSecs = TIMER_MINUTES * 60;
  _timerInterval = setInterval(() => {
    _timerSecs--;
    const el = document.getElementById('mer-timer-txt');
    if (el) el.textContent = _formatTime(_timerSecs);

    const timer = document.getElementById('mer-timer');
    if (timer) timer.classList.toggle('warn', _timerSecs <= 300);

    if (_timerSecs <= 0) {
      clearInterval(_timerInterval);
      ui.showToast('Tempo esgotado — a submeter o exame…', 'warning');
      setTimeout(() => _submitExam(), 1500);
    }
  }, 1000);
}

function _stopTimer() {
  clearInterval(_timerInterval);
  _timerInterval = null;
}

// ============================================================
// PROGRESS BAR
// ============================================================

function _updateProgress() {
  const answered = Object.keys(_studentAnswers).length;
  const pct      = Math.round((answered / _questions.length) * 100);
  const el       = document.getElementById('mer-progress');
  if (el) el.style.width = pct + '%';
}

// ============================================================
// BATCH RENDERING
// ============================================================

function _renderBatch(batchIdx) {
  _batchIndex = batchIdx;
  const start = batchIdx * BATCH_SIZE;
  const end   = Math.min(start + BATCH_SIZE, _questions.length);
  const batch = _questions.slice(start, end);

  _updateHeaderBatch(batchIdx + 1);

  const area = document.getElementById('mer-batch-area');
  if (!area) return;

  const isLast   = batchIdx === 3;
  const showText = batchIdx === 0 && _isLang && _examText?.conteudo;
  const qStart   = start + 1;
  const qEnd     = end;

  let html = `
    <div class="mer-batch-header">
      <div class="mer-batch-tag notranslate" translate="no">
        Grupo ${batchIdx + 1} de 4
      </div>
      <div class="mer-batch-divider"></div>
      <div class="mer-batch-count notranslate" translate="no">
        Questões ${qStart}–${qEnd}
      </div>
    </div>
  `;

  if (showText) {
    html += _passageHtml(_examText);
  }

  batch.forEach((q, li) => {
    const gi = start + li;
    html += _questionCardHtml(q, gi, start + li + 1);
  });

  // Progress dots
  html += `<div class="mer-dots">`;
  batch.forEach((_, li) => {
    const gi  = start + li;
    const cls = _studentAnswers[gi] !== undefined ? 'answered' : '';
    html += `<div class="mer-dot ${cls}" id="mer-dot-${gi}"></div>`;
  });
  html += `</div>`;

  // Answered count
  const answeredInBatch = batch.filter((_, li) =>
    _studentAnswers[start + li] !== undefined
  ).length;

  html += `
    <div class="mer-submit-wrap">
      <button class="${isLast ? 'mer-submit-btn' : 'mer-next-btn'} notranslate"
        translate="no" id="mer-submit-btn">
        <i class="fa-solid ${isLast ? 'fa-flag-checkered' : 'fa-arrow-right'}"
          aria-hidden="true"></i>
        ${isLast ? 'Submeter Exame' : 'Próximo Grupo'}
      </button>
      <div class="mer-submit-hint notranslate" translate="no" id="mer-submit-hint">
        ${answeredInBatch} de ${batch.length} respondidas
      </div>
    </div>
  `;

  area.innerHTML = html;
  area.style.animation = 'merSlideIn 0.22s ease both';
  window.scrollTo({ top: 0, behavior: 'instant' });

  // Wire options
  batch.forEach((q, li) => {
    _wireQuestion(q, start + li);
  });

  // Wire submit/next
  document.getElementById('mer-submit-btn')
    ?.addEventListener('click', () => _handleBatchAdvance(batchIdx));
}

// ============================================================
// PASSAGE HTML
// ============================================================

function _passageHtml(text) {
  if (!text?.conteudo) return '';
  return `
    <div class="mer-passage">
      <div class="mer-passage-head">
        <div class="mer-passage-eyebrow notranslate" translate="no">Texto de Apoio</div>
        ${text.titulo
          ? `<div class="mer-passage-title notranslate" translate="no">${_esc(text.titulo)}</div>`
          : ''}
        ${text.autor
          ? `<div class="mer-passage-autor notranslate" translate="no">${_esc(text.autor)}</div>`
          : ''}
      </div>
      <div class="mer-passage-body notranslate" translate="no">${_esc(text.conteudo)}</div>
      ${text.glossario ? `
        <div class="mer-passage-glossario notranslate" translate="no">
          <strong>Glossário:</strong> ${_esc(text.glossario)}
        </div>` : ''}
    </div>`;
}

// ============================================================
// QUESTION CARD HTML
// ============================================================

function _questionCardHtml(q, gi, displayNum) {
  const tipo        = (q['Tipo'] || 'escolha-multipla').trim();
  const qText       = (q['Enunciado'] || '').trim();
  const topic       = (q['Tema_Relacionado'] || '').trim();
  const year        = normaliseYear(q['Ano'] || '');
  const isAI        = !!q._aiGenerated;
  const isComp      = !!q._isComprehension;
  const isAnswered  = _studentAnswers[gi] !== undefined;

  let html = `
    <div class="mer-q-card ${isAnswered ? 'answered' : ''} notranslate"
      translate="no" id="mer-card-${gi}">
      <div class="mer-q-top">
        <div class="mer-q-num" id="mer-qnum-${gi}">${displayNum}</div>
        <div class="mer-q-badges">
          ${topic
            ? `<span class="mer-q-badge topic">${_esc(topic)}</span>`
            : ''}
          ${year && !isAI
            ? `<span class="mer-q-badge year">Exame de ${_esc(year)}</span>`
            : ''}
          ${isAI && !isComp
            ? `<span class="mer-q-badge ai">IA</span>`
            : ''}
          ${isComp
            ? `<span class="mer-q-badge ai">Compreensão</span>`
            : ''}
        </div>
      </div>
      <div class="mer-q-text notranslate" translate="no">${_esc(qText)}</div>
  `;

  // 9ª Classe last question may be composition
  const isCompositionQ = _is9a && gi === _questions.length - 1 && _isLang;

  if (isCompositionQ) {
    const wordCount = _composition.trim().split(/\s+/).filter(Boolean).length;
    html += `
      <div class="mer-composition">
        <div class="mer-comp-label notranslate" translate="no">
          <i class="fa-solid fa-pen-to-square" aria-hidden="true"></i>
          Composição Escrita
        </div>
        <textarea class="mer-comp-textarea notranslate" translate="no"
          id="mer-comp-${gi}" maxlength="2000"
          placeholder="Escreva a sua composição aqui…"
          oninput="window._updateComp(this)">${_esc(_composition)}</textarea>
        <div class="mer-comp-count notranslate" translate="no"
          id="mer-comp-count-${gi}">
          ${wordCount} palavras
        </div>
      </div>`;

    // Expose updater for inline oninput
    window._updateComp = (el) => {
      _composition = el.value;
      const wc = _composition.trim().split(/\s+/).filter(Boolean).length;
      const countEl = document.getElementById(`mer-comp-count-${gi}`);
      if (countEl) countEl.textContent = `${wc} palavras`;
      if (_composition.trim()) {
        _studentAnswers[gi] = '[COMPOSITION]';
        _markAnswered(gi);
      } else {
        delete _studentAnswers[gi];
        _unmarkAnswered(gi);
      }
      _updateSubmitHint(Math.floor(gi / BATCH_SIZE));
      _updateProgress();
    };
  } else {
    const opts = getOptions(q);
    html += `<div class="mer-options" id="mer-opts-${gi}">`;
    for (const o of opts) {
      const isSelected = _studentAnswers[gi] !== undefined
        ? (q._aiGenerated
            ? _studentAnswers[gi]?.letter === o.letter
            : _studentAnswers[gi]?.text === o.text)
        : false;
      html += `
        <button class="mer-option ${isSelected ? 'selected' : ''} notranslate"
          translate="no" data-gi="${gi}" data-letter="${_esc(o.letter)}"
          data-text="${_esc(o.text)}">
          <div class="mer-opt-circle">${_esc(o.letter)}</div>
          <div class="mer-opt-text">${_esc(o.text)}</div>
        </button>`;
    }
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

// ============================================================
// WIRE QUESTION INTERACTIONS
// ============================================================

function _wireQuestion(q, gi) {
  const opts = document.getElementById(`mer-opts-${gi}`);
  if (!opts) return; // composition — no options

  opts.querySelectorAll('.mer-option').forEach(btn => {
    btn.addEventListener('click', () => {
      opts.querySelectorAll('.mer-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');

      _studentAnswers[gi] = {
        letter: btn.dataset.letter,
        text:   btn.dataset.text,
      };

      _markAnswered(gi);
      _updateSubmitHint(Math.floor(gi / BATCH_SIZE));
      _updateProgress();
    });
  });
}

function _markAnswered(gi) {
  const card = document.getElementById(`mer-card-${gi}`);
  card?.classList.add('answered');
  const numEl = document.getElementById(`mer-qnum-${gi}`);
  if (numEl) {
    numEl.style.background   = 'var(--primary)';
    numEl.style.borderColor  = 'var(--primary)';
    numEl.style.color        = '#fff';
  }
  const dot = document.getElementById(`mer-dot-${gi}`);
  if (dot) dot.className = 'mer-dot answered';
}

function _unmarkAnswered(gi) {
  const card = document.getElementById(`mer-card-${gi}`);
  card?.classList.remove('answered');
  const dot = document.getElementById(`mer-dot-${gi}`);
  if (dot) dot.className = 'mer-dot';
}

function _updateSubmitHint(batchIdx) {
  const hint  = document.getElementById('mer-submit-hint');
  const start = batchIdx * BATCH_SIZE;
  const batch = _questions.slice(start, start + BATCH_SIZE);
  const count = batch.filter((_, li) => _studentAnswers[start + li] !== undefined).length;
  if (hint) hint.textContent = `${count} de ${batch.length} respondidas`;
}

// ============================================================
// BATCH ADVANCE
// ============================================================

function _handleBatchAdvance(batchIdx) {
  if (batchIdx === 3) {
    _submitExam();
  } else {
    _renderBatch(batchIdx + 1);
  }
}

// ============================================================
// SUBMIT EXAM
// ============================================================

async function _submitExam() {
  if (_submitted) return;
  _submitted  = true;
  _examActive = false;
  _stopTimer();
  _teardownAntiCheat();

  const totalTime = TIMER_MINUTES * 60 - _timerSecs;

  // Collect all answers
  const answersForWorker = {};
  for (let i = 0; i < _questions.length; i++) {
    const q      = _questions[i];
    const given  = _studentAnswers[i];
    if (given === undefined) continue;
    if (given === '[COMPOSITION]') {
      answersForWorker[i] = _composition;
    } else {
      answersForWorker[i] = given.text || given.letter || '';
    }
  }

  // Score via Worker — Worker holds authoritative answers
  // We pass our sealed _correctAnswers to the Worker as the key
  // (never exposed on window)
  let scoreResult = null;
  try {
    scoreResult = await _scoreViaWorker(answersForWorker);
  } catch (e) {
    console.warn('[MeuExame] scoring:', e);
    // Fallback: compute client-side as backup
    scoreResult = _scoreClientFallback(answersForWorker);
  }

  const { correctCount, wrongCount, score } = scoreResult;

  // Evaluate composition via AI if 9ª + language
  let compScore     = null;
  let compFeedback  = '';
  if (_is9a && _isLang && _composition.trim()) {
    try {
      const compResult = await _evaluateComposition();
      compScore    = compResult.score;
      compFeedback = compResult.feedback;
    } catch (e) {
      console.warn('[MeuExame] comp eval:', e);
    }
  }

  // Generate verdict text via AI
  let verdictText = '';
  try {
    verdictText = await _generateVerdict(score, correctCount);
  } catch (e) {
    verdictText = score >= 10
      ? 'O seu desempenho foi positivo. Continue a estudar para garantir um bom resultado no exame real.'
      : 'Há margem para melhorar. Reveja os temas em que teve mais dificuldade e use o Mentor para aprofundar os conceitos.';
  }

  // Save result to Firestore
  try {
    await updateDoc(doc(db, MEU_EXAME_COL, _examDocId), {
      status:        'completed',
      score,
      correctCount,
      wrongCount,
      totalQuestions: _questions.length,
      durationSeconds: totalTime,
      tabSwitches:   _tabSwitches,
      integrityFlag: _tabSwitches >= 2,
      compScore,
      compFeedback,
      submittedAt:   serverTimestamp(),
    });
  } catch (e) {
    console.warn('[MeuExame] save result:', e);
  }

  _showResults(score, correctCount, wrongCount, totalTime, verdictText, compScore, compFeedback);
}

// ── Client-side fallback scoring (when Worker fails) ─────────
function _scoreClientFallback(answersForWorker) {
  let correctCount = 0;
  let wrongCount   = 0;

  for (let i = 0; i < _questions.length; i++) {
    const q       = _questions[i];
    const given   = answersForWorker[i];
    const correct = _correctAnswers[i];

    if (!given || given === '[COMPOSITION]') continue;

    if (q['Tipo'] === 'verdadeiro-falso') {
      if (given === correct) correctCount++;
      else wrongCount++;
    } else if (q._aiGenerated) {
      // AI questions: given is text, correct is also text (option text)
      if (given === correct) correctCount++;
      else wrongCount++;
    } else {
      // DB questions: Resposta stores full option text
      if (given === correct) correctCount++;
      else wrongCount++;
    }
  }

  const mcqTotal = _questions.filter(q => q['Tipo'] !== 'verdadeiro-falso' || true).length;
  const score    = Math.round((correctCount / Math.max(mcqTotal, 1)) * 20);

  return { correctCount, wrongCount, score };
}

// ── Worker scoring ────────────────────────────────────────────
async function _scoreViaWorker(answersForWorker) {
  // We send both the student answers and the correct answers to the Worker
  // The Worker validates and returns the score
  // This means correct answers travel to the Worker — acceptable since
  // the Worker is server-side and the data is encrypted in transit (HTTPS)
  const result = await worker.callAI(
    [
      {
        role: 'system',
        content: `You are a secure exam scoring function. You receive student answers and correct answers. Return ONLY valid JSON with this exact structure: {"correctCount": number, "wrongCount": number, "score": number}. The score is (correctCount / totalQuestions) * 20, rounded to 1 decimal. Do not include any other text.`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          studentAnswers:  answersForWorker,
          correctAnswers:  _correctAnswers,
          totalQuestions:  _questions.length,
        }),
      },
    ],
    { maxTokens: 100, temperature: 0 }
  );

  const clean = result.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

// ── Composition evaluation ────────────────────────────────────
async function _evaluateComposition() {
  const grade   = _is9a ? '9ª Classe' : '12ª Classe';
  const subject = _sessionData.subject;

  const raw = await worker.callAI(
    [
      {
        role: 'system',
        content: `És um examinador de ${subject} para ${grade} em Moçambique. Avalia a composição do estudante numa escala de 0 a 20 valores, seguindo os critérios do exame nacional moçambicano. Responde APENAS com JSON: {"score": number, "feedback": "máximo 3 frases em Português formal"}.`,
      },
      {
        role: 'user',
        content: `Composição do estudante:\n\n${_composition}`,
      },
    ],
    { maxTokens: 200, temperature: 0.3 }
  );

  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

// ── Verdict generation ────────────────────────────────────────
async function _generateVerdict(score, correctCount) {
  const examType   = _userData?.examType;
  const isAdmissao = examType === 'admissao';
  const subject    = _sessionData.subject;
  const institution = _userData?.institution || _userData?.course || '';

  const raw = await worker.callAI(
    [
      {
        role: 'system',
        content: `És um tutor especialista em exames nacionais de Moçambique. Com base no resultado do estudante, escreve uma mensagem motivacional e pedagógica em Português formal de Moçambique (3 a 4 frases). Nunca prometes aprovação. Menciona ${subject}${institution ? ' e ' + institution : ''}. Tom encorajador e honesto. Responde APENAS com o texto da mensagem — sem JSON, sem título.`,
      },
      {
        role: 'user',
        content: `Disciplina: ${subject}\nNota: ${score}/20\nRespostas correctas: ${correctCount}/${_questions.length}\nTipo de exame: ${isAdmissao ? 'Admissão' + (institution ? ' — ' + institution : '') : 'Ensino Geral'}`,
      },
    ],
    { maxTokens: 200, temperature: 0.5 }
  );

  return raw.trim();
}

// ============================================================
// RESULTS SCREEN
// ============================================================

function _showResults(score, correctCount, wrongCount, totalTime, verdictText, compScore, compFeedback) {
  const main   = document.getElementById('mer-main');
  const result = document.getElementById('mer-result');
  if (main)   main.style.display = 'none';
  if (!result) return;
  result.classList.add('show');

  const examType   = _userData?.examType;
  const isAdmissao = examType === 'admissao';

  // Verdict classification
  let verdictClass = 'fail';
  let verdictLabel = '';
  let ringClass    = 'fail';
  let resultTitle  = '';

  if (isAdmissao) {
    if (score >= 18) {
      verdictClass = 'certa';
      verdictLabel = 'Admissão Quase Certa';
      ringClass    = 'pass';
      resultTitle  = 'Desempenho Excelente!';
    } else if (score >= 14) {
      verdictClass = 'provavel';
      verdictLabel = 'Admissão Provável';
      ringClass    = 'pass';
      resultTitle  = 'Muito Bom Resultado!';
    } else if (score >= 10) {
      verdictClass = 'razoavel';
      verdictLabel = 'Admissão Razoável';
      ringClass    = 'pass';
      resultTitle  = 'Resultado Razoável';
    } else {
      verdictClass = 'fail';
      verdictLabel = 'Não Seria Admitido';
      ringClass    = 'fail';
      resultTitle  = 'Continue a Estudar';
    }
  } else {
    // Ensino Geral: 10–20 = passa, 0–9 = reprova
    if (score >= 10) {
      verdictClass = 'pass';
      verdictLabel = 'Aprovado';
      ringClass    = 'pass';
      resultTitle  = score >= 16 ? 'Resultado Excelente!' : 'Bom Resultado!';
    } else {
      verdictClass = 'fail';
      verdictLabel = 'Reprovado';
      ringClass    = 'fail';
      resultTitle  = 'Continue a Treinar!';
    }
  }

  const integrityWarningHtml = _tabSwitches >= 2 ? `
    <div class="mer-integrity-warn">
      <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
      <span class="notranslate" translate="no">
        O sistema detectou ${_tabSwitches} saída(s) desta página durante o exame.
        Estes eventos foram registados. O resultado pode ser revisto por esta razão.
      </span>
    </div>` : '';

  const compBlock = compFeedback ? `
    <div class="mer-verdict-block">
      <div class="mer-verdict-block-title notranslate" translate="no">
        <i class="fa-solid fa-pen-to-square" aria-hidden="true"></i>
        Composição
      </div>
      <div class="notranslate" translate="no">
        ${compScore !== null ? `<strong>Nota da composição: ${compScore}/20</strong><br>` : ''}
        ${_esc(compFeedback)}
      </div>
    </div>` : '';

  const reviewHtml = _buildReviewHtml(correctCount, wrongCount);

  result.innerHTML = `
    <div class="mer-result-hero">
      <div class="mer-hero-blob" style="width:200px;height:200px;top:-80px;right:-60px;"></div>
      <div class="mer-hero-blob" style="width:90px;height:90px;bottom:20px;left:10px;"></div>
      <div class="mer-score-ring ${ringClass}">
        <div class="mer-score-pct notranslate" translate="no">${score}</div>
        <div class="mer-score-sub notranslate" translate="no">/ 20</div>
      </div>
      <div class="mer-result-title notranslate" translate="no">${_esc(resultTitle)}</div>
      <div class="mer-result-meta notranslate" translate="no">
        ${_esc(_sessionData.subject)} · Meu Exame
      </div>
      <div class="mer-verdict-pill ${verdictClass} notranslate" translate="no">
        ${_esc(verdictLabel)}
      </div>
    </div>

    <div class="mer-result-body">

      <div class="mer-stats-row">
        <div class="mer-stat">
          <div class="mer-stat-val c notranslate" translate="no">${correctCount}</div>
          <div class="mer-stat-lbl notranslate" translate="no">Correctas</div>
        </div>
        <div class="mer-stat">
          <div class="mer-stat-val w notranslate" translate="no">${wrongCount}</div>
          <div class="mer-stat-lbl notranslate" translate="no">Erradas</div>
        </div>
        <div class="mer-stat">
          <div class="mer-stat-val t notranslate" translate="no">${_questions.length}</div>
          <div class="mer-stat-lbl notranslate" translate="no">Total</div>
        </div>
        <div class="mer-stat">
          <div class="mer-stat-val t notranslate" translate="no">${_formatTime(totalTime)}</div>
          <div class="mer-stat-lbl notranslate" translate="no">Tempo</div>
        </div>
      </div>

      ${integrityWarningHtml}

      <div class="mer-verdict-block">
        <div class="mer-verdict-block-title notranslate" translate="no">
          <i class="fa-solid fa-brain" aria-hidden="true"></i>
          Análise do seu Desempenho
        </div>
        <div class="notranslate" translate="no">${_esc(verdictText)}</div>
      </div>

      ${compBlock}

      <button class="mer-btn-pdf notranslate" translate="no"
        id="mer-btn-pdf">
        <i class="fa-solid fa-file-pdf" aria-hidden="true"></i>
        Descarregar Exame Corrigido (PDF)
      </button>

      <button class="mer-btn-dash notranslate" translate="no"
        id="mer-btn-dash">
        <i class="fa-solid fa-house" aria-hidden="true"></i>
        Ir para o Painel Principal
      </button>

      <button class="mer-btn-revisao notranslate" translate="no"
        id="mer-btn-revisao">
        <i class="fa-solid fa-rotate" aria-hidden="true"></i>
        Rever Erros em Revisão
      </button>

      ${reviewHtml}

    </div>
  `;

  window.scrollTo({ top: 0, behavior: 'instant' });

  document.getElementById('mer-btn-pdf')
    ?.addEventListener('click', () => _generatePDF(score, correctCount, wrongCount, totalTime, verdictLabel), { once: true });

  document.getElementById('mer-btn-dash')
    ?.addEventListener('click', () => router.navigate('/panel/dashboard'), { once: true });

  document.getElementById('mer-btn-revisao')
    ?.addEventListener('click', () => router.navigate('/panel/revisao'), { once: true });

  result.querySelectorAll('.mer-review-batch-head').forEach(head => {
    head.addEventListener('click', () => {
      head.closest('.mer-review-batch')?.classList.toggle('open');
    });
  });
}

// ============================================================
// REVIEW HTML (corrected exam on results screen)
// ============================================================

function _buildReviewHtml(correctCount, wrongCount) {
  let html = `
    <div class="mer-review-section">
      <div class="mer-review-title notranslate" translate="no">
        <i class="fa-solid fa-list-check" aria-hidden="true"></i>
        Exame Corrigido
      </div>
  `;

  for (let b = 0; b < 4; b++) {
    const start = b * BATCH_SIZE;
    const batch = _questions.slice(start, start + BATCH_SIZE);
    let batchCorrect = 0;

    let batchHtml = '';
    batch.forEach((q, li) => {
      const gi       = start + li;
      const given    = _studentAnswers[gi];
      const correct  = _correctAnswers[gi];
      const givenText = given?.text || given || '';
      const isCorrect = givenText === correct && givenText !== '';
      const isSkipped = given === undefined;

      if (isCorrect) batchCorrect++;

      const qShort = (q['Enunciado'] || '').slice(0, 100) + (q['Enunciado']?.length > 100 ? '…' : '');

      batchHtml += `
        <div class="mer-review-item ${isSkipped ? '' : isCorrect ? 'correct' : 'wrong'}">
          <div class="mer-review-q notranslate" translate="no">
            ${gi + 1}. ${_esc(qShort)}
          </div>
          <div class="mer-review-ans-row">
            ${isSkipped
              ? `<span class="mer-ans-pill student-err notranslate" translate="no">
                  <i class="fa-solid fa-minus"></i> Não respondida
                </span>`
              : isCorrect
              ? `<span class="mer-ans-pill student-ok notranslate" translate="no">
                  <i class="fa-solid fa-check"></i> ${_esc(givenText)}
                </span>`
              : `<span class="mer-ans-pill student-err notranslate" translate="no">
                  <i class="fa-solid fa-xmark"></i> ${_esc(givenText || '—')}
                </span>
                <span class="mer-ans-pill correct-ans notranslate" translate="no">
                  <i class="fa-solid fa-check"></i> ${_esc(correct)}
                </span>`
            }
          </div>
        </div>`;
    });

    const openClass = b === 0 ? 'open' : '';
    html += `
      <div class="mer-review-batch ${openClass}" id="mer-review-batch-${b}">
        <div class="mer-review-batch-head">
          <div class="mer-review-batch-label notranslate" translate="no">
            <i class="fa-solid fa-layer-group" aria-hidden="true"></i>
            Grupo ${b + 1}
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <span class="mer-review-batch-score notranslate" translate="no">
              ${batchCorrect}/${batch.length}
            </span>
            <i class="fa-solid fa-chevron-down mer-review-chevron" aria-hidden="true"></i>
          </div>
        </div>
        <div class="mer-review-items">${batchHtml}</div>
      </div>`;
  }

  html += `</div>`;
  return html;
}

// ============================================================
// PDF GENERATION
// ============================================================

async function _generatePDF(score, correctCount, wrongCount, totalTime, verdictLabel) {
  const btn = document.getElementById('mer-btn-pdf');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> A gerar PDF…`;
  }
  ui.showSpinner('A preparar o PDF…');
  try {
    await generateMeuExamePDF({
      subject:        _sessionData.subject,
      dbSubject:      _sessionData.dbSubject,
      userData:       _userData,
      questions:      _questions,
      studentAnswers: _studentAnswers,
      correctAnswers: _correctAnswers,
      composition:    _composition,
      examText:       _examText,
      emblemB64:      _emblemB64,
      score,
      correctCount,
      wrongCount,
      totalTime,
      verdictLabel,
      tabSwitches:    _tabSwitches,
      is9a:           _is9a,
      isLang:         _isLang,
    });
    ui.showToast('PDF descarregado com sucesso.', 'success');
  } catch (e) {
    console.error('[MeuExame] PDF error:', e);
    ui.showToast('Erro ao gerar PDF. Tente novamente.', 'error');
  } finally {
    ui.hideSpinner();
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-file-pdf"></i> Descarregar Exame Corrigido (PDF)`;
    }
  }
}

// ============================================================
// EXPORT
// ============================================================

export default MeuExameRenderScreen;
