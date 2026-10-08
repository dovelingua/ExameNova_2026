// ============================================================
// panel/js/screens/renders/simulacao-render.js
// ExameNova — Simulation Render Screen v3.1
//
// CHANGES v3.1:
//   - "Exame de YYYY" on year badges
//   - Score ring no longer cropped by fixed header
//   - Results always scroll to top on show
//   - Stats: single scrollable flex row on mobile
//   - CTA buttons reordered and redesigned
//   - Explanation: AI reads Resposta_Possível + Explicação
//     fields first and writes clean pedagogical explanation
//   - Equations rendered as plain Unicode inline
//   - Text passage: full Conteúdo from DB, random but matched
//   - Batch 1 questions filtered to text-related ones
//   - Auto Gera: AI generates 5 questions from the text
//
// ANSWER COMPARISON RULES:
//   DB questions (_aiGenerated falsy):
//     q['Resposta'] = option TEXT e.g. "Filogenético"
//     Compare: chosenOptionText === q['Resposta']
//   AI questions (_aiGenerated = true):
//     q['Resposta'] = letter e.g. "A"
//     Compare: chosenLetter === q['Resposta']
//
//   Verdadeiro/Falso (both modes):
//     q['Resposta'] = "Verdadeiro" | "Falso"
//     Compare: chosenAnswer === q['Resposta']
//
// EXPLANATION: reads Resposta_Possível + Explicação from DB
//   then AI writes a clean pedagogical explanation from them.
//
// BATCHES: 5 questions per group
// FEEDBACK: shown on results screen only — not per question
// keepAlive: false | Navbar: absent | Header: fixed
// ============================================================

import { router }  from '../../core/router.js';
import { ui }      from '../../core/ui.js';
import { moeda }   from '../../core/moeda.js';
import { worker }  from '../../core/worker.js';
import { session } from '../../core/session.js';
import {
  exams,
  getOptions,
  saveWrongAnswer,
  normaliseYear,
} from '../../core/exams.js';

// ── Constants ─────────────────────────────────────────────
const BATCH_SIZE       = 5;
const WHATSAPP_HELP    = 'https://wa.me/258848920143';
const WHATSAPP_GROUP   = 'https://chat.whatsapp.com/FVYCayFjaGCAdCwrGEaJrv';

// ── Module state ──────────────────────────────────────────
let _data          = null;
let _questions     = [];
let _batches       = [];
let _batchIndex    = 0;
let _answers       = {};
let _skipped       = {};
let _timerSecs     = 0;
let _timerInterval = null;
let _sessionDone   = false;
let _resultShown   = false;
let _userData      = null;
let _user          = null;

// ============================================================
// SCREEN OBJECT
// ============================================================

const SimulacaoRenderScreen = {

  css() {
    if (document.getElementById('sr3-styles')) return '';
    return `<style id="sr3-styles">

      /* ── CSS VARIABLES ── */
      :root {
        --sr3-correct:        #16A34A;
        --sr3-correct-bg:     rgba(22,163,74,0.08);
        --sr3-correct-border: rgba(22,163,74,0.3);
        --sr3-wrong:          #DC2626;
        --sr3-wrong-bg:       rgba(220,38,38,0.07);
        --sr3-wrong-border:   rgba(220,38,38,0.25);
        --sr3-skip:           #64748B;
        --sr3-skip-bg:        rgba(100,116,139,0.07);
        --sr3-amber:          #D97706;
        --sr3-amber-bg:       rgba(217,119,6,0.08);
      }

      /* ── BASE ── */
      .sr3-outer {
        min-height: 100dvh;
        background: var(--bg);
        padding-top: 64px;
      }

      /* ── FIXED HEADER ── */
      .sr3-header {
        position: fixed;
        top: 0; left: 0; right: 0;
        height: 64px;
        background: linear-gradient(135deg, #0C4A6E 0%, #0369A1 60%, #0284C7 100%);
        display: flex;
        align-items: center;
        padding: 0 14px;
        z-index: 200;
        gap: 10px;
        box-shadow: 0 2px 12px rgba(3,105,161,0.35);
      }

      .sr3-header-info {
        flex: 1; min-width: 0;
        display: flex; flex-direction: column;
        justify-content: center; gap: 1px;
      }

      .sr3-header-profile {
        font-size: 9px; font-weight: 700;
        text-transform: uppercase; letter-spacing: 0.07em;
        color: rgba(255,255,255,0.55);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }

      .sr3-header-subject {
        font-size: 15px; font-weight: 800;
        color: #fff;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        line-height: 1.2; letter-spacing: -0.2px;
      }

      .sr3-header-right {
        display: flex; align-items: center; gap: 8px; flex-shrink: 0;
      }

      .sr3-timer-pill {
        display: flex; align-items: center; gap: 4px;
        background: rgba(255,255,255,0.12);
        border: 1px solid rgba(255,255,255,0.18);
        border-radius: 20px; padding: 5px 11px;
        font-size: 12px; font-weight: 700; color: #fff;
      }
      .sr3-timer-pill i { font-size: 10px; opacity: 0.7; }

      .sr3-batch-pill {
        display: flex; align-items: center; gap: 3px;
        background: rgba(255,255,255,0.1);
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 20px; padding: 5px 10px;
        font-size: 11px; font-weight: 700;
        color: rgba(255,255,255,0.85);
      }

      .sr3-quit-btn {
        width: 34px; height: 34px; border-radius: 50%;
        background: rgba(255,255,255,0.1);
        border: 1px solid rgba(255,255,255,0.15);
        color: rgba(255,255,255,0.85); font-size: 14px;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; transition: background 0.2s; flex-shrink: 0;
      }
      .sr3-quit-btn:hover { background: rgba(255,255,255,0.22); }

      /* ── PROGRESS BAR ── */
      .sr3-progress-track {
        position: fixed; top: 64px; left: 0; right: 0;
        height: 3px; background: #e2e8f0; z-index: 199;
      }
      [data-theme="dark"] .sr3-progress-track {
        background: rgba(255,255,255,0.08);
      }
      .sr3-progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #FFB300, #FDD835);
        transition: width 0.5s ease;
        border-radius: 0 2px 2px 0;
      }

      /* ── LOADING OVERLAY ── */
      .sr3-loading {
        display: none; position: fixed; inset: 0;
        background: var(--bg); z-index: 400;
        flex-direction: column; align-items: center;
        justify-content: center; gap: 16px;
      }
      .sr3-loading.show { display: flex; }
      .sr3-loading-ring {
        width: 44px; height: 44px;
        border: 3px solid var(--border);
        border-top-color: var(--primary);
        border-radius: 50%;
        animation: sr3Spin 0.8s linear infinite;
      }
      .sr3-loading-text {
        font-size: 14px; font-weight: 600; color: var(--text-muted);
      }

      /* ── MAIN CONTENT ── */
      .sr3-content {
        padding: 20px 16px 48px;
        max-width: 700px; margin: 0 auto;
      }

      /* ── BATCH HEADER ── */
      .sr3-batch-header {
        display: flex; align-items: center; gap: 10px; margin-bottom: 20px;
      }
      .sr3-batch-tag {
        font-size: 10px; font-weight: 800;
        text-transform: uppercase; letter-spacing: 0.08em;
        color: var(--primary); background: var(--primary-light);
        border-radius: 20px; padding: 4px 12px; white-space: nowrap;
      }
      .sr3-batch-divider { flex: 1; height: 1px; background: var(--border); }
      .sr3-batch-count {
        font-size: 11px; font-weight: 600;
        color: var(--text-muted); white-space: nowrap;
      }

      /* ── TEXT PASSAGE ── */
      .sr3-passage {
        background: var(--surface);
        border: 1.5px solid var(--border);
        border-left: 4px solid var(--accent);
        border-radius: var(--radius-lg);
        margin-bottom: 24px; overflow: hidden;
      }
      .sr3-passage-head {
        padding: 12px 16px 10px;
        border-bottom: 1px solid var(--border);
        background: rgba(20,184,166,0.04);
      }
      .sr3-passage-eyebrow {
        font-size: 9px; font-weight: 800;
        text-transform: uppercase; letter-spacing: 0.1em;
        color: var(--accent); margin-bottom: 3px;
      }
      .sr3-passage-title {
        font-size: 15px; font-weight: 700;
        color: var(--text); line-height: 1.3;
      }
      .sr3-passage-autor {
        font-size: 11px; color: var(--text-muted); margin-top: 3px;
      }
      .sr3-passage-body {
        padding: 16px; font-size: 14px;
        color: var(--text-secondary); line-height: 1.9;
        white-space: pre-wrap; max-height: 280px; overflow-y: auto;
      }
      .sr3-passage-glossario {
        padding: 10px 16px;
        border-top: 1px solid var(--border);
        font-size: 11px; color: var(--text-muted);
        line-height: 1.65; font-style: italic; background: var(--bg);
      }

      /* ── QUESTION CARD ── */
      .sr3-q-card {
        background: var(--surface);
        border: 1.5px solid var(--border);
        border-radius: var(--radius-xl, 20px);
        margin-bottom: 16px; overflow: hidden;
        transition: border-color 0.2s, box-shadow 0.2s;
      }
      .sr3-q-card.answered {
        border-color: var(--primary);
        box-shadow: 0 2px 12px rgba(2,132,199,0.1);
      }
      .sr3-q-card.skipped { opacity: 0.75; border-style: dashed; }

      .sr3-q-top {
        display: flex; align-items: center;
        justify-content: space-between;
        padding: 12px 16px 0; gap: 8px;
      }
      .sr3-q-num-row { display: flex; align-items: center; gap: 7px; }
      .sr3-q-num-badge {
        width: 26px; height: 26px; border-radius: 50%;
        background: var(--bg); border: 1.5px solid var(--border);
        display: flex; align-items: center; justify-content: center;
        font-size: 11px; font-weight: 800; color: var(--text-muted);
        flex-shrink: 0; transition: all 0.2s;
      }
      .sr3-q-card.answered .sr3-q-num-badge {
        background: var(--primary); border-color: var(--primary); color: #fff;
      }
      .sr3-q-meta-badges {
        display: flex; align-items: center; gap: 5px; flex-wrap: wrap;
      }
      .sr3-q-badge {
        font-size: 9px; font-weight: 700;
        border-radius: 20px; padding: 2px 9px;
      }
      .sr3-q-badge.topic {
        color: var(--secondary); background: rgba(139,92,246,0.1);
      }
      .sr3-q-badge.year {
        color: var(--text-muted); background: var(--bg);
        border: 1px solid var(--border);
      }

      .sr3-skip-btn {
        font-size: 11px; font-weight: 600;
        color: var(--text-muted); background: none;
        border: 1px solid var(--border); border-radius: 20px;
        padding: 3px 10px; cursor: pointer;
        transition: all 0.15s; white-space: nowrap; flex-shrink: 0;
      }
      .sr3-skip-btn:hover { border-color: var(--sr3-amber); color: var(--sr3-amber); }

      .sr3-skipped-badge {
        font-size: 10px; font-weight: 700;
        color: var(--sr3-skip); background: var(--sr3-skip-bg);
        border: 1px solid rgba(100,116,139,0.2);
        border-radius: 20px; padding: 3px 10px; flex-shrink: 0;
      }

      /* ── FIGURE BOX ── */
      .sr3-figure-box {
        margin: 12px 16px 0;
        background: rgba(2,132,199,0.04);
        border: 1.5px dashed var(--border);
        border-radius: var(--radius-md);
        padding: 12px 14px;
        display: flex; align-items: flex-start; gap: 10px;
      }
      .sr3-figure-box i {
        color: var(--primary); font-size: 18px;
        flex-shrink: 0; margin-top: 1px;
      }
      .sr3-figure-desc {
        font-size: 13px; color: var(--text-secondary);
        line-height: 1.65; font-style: italic; margin-bottom: 4px;
      }
      .sr3-figure-ref {
        font-size: 10px; font-weight: 600; color: var(--primary);
      }

      /* ── QUESTION TEXT ── */
      .sr3-q-text {
        padding: 14px 16px 16px;
        font-size: 15px; font-weight: 600;
        color: var(--text); line-height: 1.65;
      }

      /* ── MC OPTIONS ── */
      .sr3-options {
        display: flex; flex-direction: column;
        gap: 8px; padding: 0 14px 16px;
      }
      .sr3-option {
        display: flex; align-items: flex-start; gap: 11px;
        background: var(--bg); border: 1.5px solid var(--border);
        border-radius: var(--radius-lg); padding: 13px 14px;
        cursor: pointer; transition: all 0.15s; text-align: left;
        width: 100%; font-family: inherit; min-height: 48px;
      }
      .sr3-option:hover:not(.locked) {
        border-color: var(--primary); background: var(--primary-light);
        transform: translateX(2px);
      }
      .sr3-option:active:not(.locked) { transform: scale(0.99); }
      .sr3-option.selected {
        border-color: var(--primary); background: var(--primary-light);
      }
      .sr3-option.locked { cursor: default; }
      .sr3-opt-circle {
        width: 28px; height: 28px; border-radius: 50%;
        background: var(--surface); border: 1.5px solid var(--border);
        display: flex; align-items: center; justify-content: center;
        font-size: 11px; font-weight: 800; color: var(--text-muted);
        flex-shrink: 0; transition: all 0.15s; margin-top: 1px;
      }
      .sr3-option.selected .sr3-opt-circle {
        background: var(--primary); border-color: var(--primary); color: #fff;
      }
      .sr3-opt-text {
        font-size: 14px; color: var(--text);
        line-height: 1.55; flex: 1; padding-top: 3px;
      }

      /* ── TF OPTIONS ── */
      .sr3-tf-options {
        display: grid; grid-template-columns: 1fr 1fr;
        gap: 10px; padding: 0 14px 16px;
      }
      .sr3-tf-btn {
        padding: 18px 10px; border-radius: var(--radius-lg);
        border: 1.5px solid var(--border); background: var(--bg);
        font-family: inherit; font-size: 14px; font-weight: 700;
        color: var(--text-secondary); cursor: pointer;
        display: flex; flex-direction: column; align-items: center;
        gap: 7px; transition: all 0.15s; min-height: 80px;
        justify-content: center;
      }
      .sr3-tf-btn i { font-size: 22px; }
      .sr3-tf-btn.v:hover:not(.locked) {
        border-color: var(--sr3-correct);
        background: var(--sr3-correct-bg); color: var(--sr3-correct);
      }
      .sr3-tf-btn.f:hover:not(.locked) {
        border-color: var(--sr3-wrong);
        background: var(--sr3-wrong-bg); color: var(--sr3-wrong);
      }
      .sr3-tf-btn.selected.v {
        border-color: var(--sr3-correct);
        background: var(--sr3-correct-bg); color: var(--sr3-correct);
      }
      .sr3-tf-btn.selected.f {
        border-color: var(--sr3-wrong);
        background: var(--sr3-wrong-bg); color: var(--sr3-wrong);
      }
      .sr3-tf-btn.locked { cursor: default; }
      .sr3-tf-btn:active:not(.locked) { transform: scale(0.97); }

      /* ── PROGRESS DOTS ── */
      .sr3-dots {
        display: flex; align-items: center;
        justify-content: center; gap: 7px; margin: 4px 0 20px;
      }
      .sr3-dot {
        width: 9px; height: 9px; border-radius: 50%;
        background: var(--border); transition: all 0.25s;
      }
      .sr3-dot.answered { background: var(--primary); transform: scale(1.15); }
      .sr3-dot.skipped  { background: var(--sr3-amber); }

      /* ── SKIP WARNING ── */
      .sr3-skip-note {
        display: none; align-items: flex-start; gap: 8px;
        background: var(--sr3-amber-bg);
        border: 1px solid rgba(217,119,6,0.2);
        border-radius: var(--radius-md);
        padding: 10px 14px; margin-bottom: 16px;
        font-size: 12px; color: var(--sr3-amber); line-height: 1.5;
      }
      .sr3-skip-note.show { display: flex; }
      .sr3-skip-note i { font-size: 12px; flex-shrink: 0; margin-top: 1px; }

      /* ── SUBMIT BUTTON ── */
      .sr3-submit-wrap { margin-top: 8px; }
      .sr3-submit-btn {
        width: 100%; padding: 16px; color: #fff;
        font-family: inherit; font-size: 15px; font-weight: 700;
        border: none; border-radius: var(--radius-lg); cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        gap: 9px; min-height: 54px;
        transition: opacity 0.2s, transform 0.15s;
        background: linear-gradient(135deg, #0369A1 0%, #0284C7 100%);
        box-shadow: 0 4px 20px rgba(2,132,199,0.3);
      }
      .sr3-submit-btn.finish {
        background: linear-gradient(135deg, #059669 0%, #10B981 100%);
        box-shadow: 0 4px 20px rgba(16,185,129,0.3);
      }
      .sr3-submit-btn:hover  { opacity: 0.92; }
      .sr3-submit-btn:active { transform: scale(0.98); }
      .sr3-submit-hint {
        text-align: center; font-size: 12px;
        color: var(--text-muted); margin-top: 9px;
      }

      /* ── QUIT MODAL ── */
      .sr3-modal-bg {
        position: fixed; inset: 0; background: rgba(0,0,0,0.6);
        z-index: 500; display: none; align-items: center;
        justify-content: center; padding: 20px;
      }
      .sr3-modal-bg.show { display: flex; }
      .sr3-modal {
        background: var(--surface); border-radius: 24px;
        max-width: 360px; width: 100%; overflow: hidden;
        box-shadow: 0 24px 60px rgba(0,0,0,0.35);
        animation: sr3ModalIn 0.25s cubic-bezier(0.34,1.56,0.64,1) both;
      }
      .sr3-modal-top {
        background: linear-gradient(135deg, #7C2D12, #DC2626);
        padding: 20px; display: flex; align-items: flex-start; gap: 12px;
      }
      .sr3-modal-icon {
        width: 42px; height: 42px; border-radius: 50%;
        background: rgba(255,255,255,0.15);
        display: flex; align-items: center; justify-content: center;
        font-size: 18px; color: #fff; flex-shrink: 0;
      }
      .sr3-modal-title {
        font-size: 17px; font-weight: 800; color: #fff; margin-bottom: 3px;
      }
      .sr3-modal-sub {
        font-size: 12px; color: rgba(255,255,255,0.7); line-height: 1.45;
      }
      .sr3-modal-body { padding: 18px 20px 20px; }
      .sr3-modal-warn {
        display: flex; align-items: flex-start; gap: 10px;
        background: var(--sr3-wrong-bg);
        border: 1px solid var(--sr3-wrong-border);
        border-radius: var(--radius-md); padding: 12px 14px;
        margin-bottom: 16px; font-size: 13px;
        color: var(--text); line-height: 1.5;
      }
      .sr3-modal-warn i {
        color: var(--sr3-wrong); font-size: 15px;
        flex-shrink: 0; margin-top: 1px;
      }
      .sr3-modal-warn strong { color: var(--sr3-wrong); }
      .sr3-modal-btns { display: flex; flex-direction: column; gap: 8px; }
      .sr3-modal-continue {
        width: 100%; padding: 13px;
        background: linear-gradient(135deg, #0369A1, #0284C7);
        color: #fff; font-family: inherit;
        font-size: 14px; font-weight: 700; border: none;
        border-radius: var(--radius-md); cursor: pointer;
        min-height: 48px;
        display: flex; align-items: center; justify-content: center; gap: 7px;
        transition: opacity 0.2s;
      }
      .sr3-modal-continue:hover { opacity: 0.92; }
      .sr3-modal-leave {
        width: 100%; padding: 12px; background: transparent;
        border: 1.5px solid var(--border); border-radius: var(--radius-md);
        color: var(--text-muted); font-family: inherit;
        font-size: 13px; font-weight: 600; cursor: pointer; min-height: 44px;
        transition: border-color 0.2s, color 0.2s;
      }
      .sr3-modal-leave:hover { border-color: var(--sr3-wrong); color: var(--sr3-wrong); }

      /* ── RESULT SCREEN ── */
      .sr3-result { display: none; min-height: 100dvh; background: var(--bg); }
      .sr3-result.show { display: block; }

      /* Hero — enough top padding to clear fixed header */
      .sr3-result-hero {
        background: linear-gradient(160deg, #0C4A6E 0%, #0369A1 50%, #0284C7 100%);
        padding: 80px 24px 60px;
        display: flex; flex-direction: column;
        align-items: center; text-align: center;
        position: relative; overflow: hidden;
      }
      .sr3-result-hero::after {
        content: '';
        position: absolute; bottom: -24px; left: 0; right: 0;
        height: 48px; background: var(--bg);
        border-radius: 50% 50% 0 0 / 100% 100% 0 0;
      }
      .sr3-hero-blob {
        position: absolute; border-radius: 50%;
        opacity: 0.07; background: #fff;
      }

      /* Score ring */
      .sr3-score-ring {
        width: 120px; height: 120px; border-radius: 50%;
        border: 5px solid rgba(255,255,255,0.25);
        background: rgba(255,255,255,0.1);
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        margin-bottom: 20px; position: relative; z-index: 1;
        animation: sr3Pop 0.55s cubic-bezier(0.34,1.56,0.64,1) both;
        transition: border-color 0.6s, background 0.6s;
      }
      .sr3-score-ring.great  { border-color:#4ADE80; background:rgba(74,222,128,0.18); }
      .sr3-score-ring.good   { border-color:#38BDF8; background:rgba(56,189,248,0.14); }
      .sr3-score-ring.fair   { border-color:#FCD34D; background:rgba(252,211,77,0.14); }
      .sr3-score-ring.low    { border-color:#F87171; background:rgba(248,113,113,0.14); }

      .sr3-score-pct {
        font-size: 32px; font-weight: 900; color: #fff;
        line-height: 1; letter-spacing: -1.5px;
      }
      .sr3-score-sub {
        font-size: 10px; color: rgba(255,255,255,0.6); font-weight: 700;
        text-transform: uppercase; letter-spacing: 0.07em; margin-top: 3px;
      }
      .sr3-result-title {
        font-size: 24px; font-weight: 900; color: #fff;
        margin-bottom: 6px; letter-spacing: -0.4px;
        position: relative; z-index: 1;
        animation: sr3FadeDown 0.4s ease 0.12s both;
      }
      .sr3-result-meta {
        font-size: 13px; color: rgba(255,255,255,0.65);
        position: relative; z-index: 1;
        animation: sr3FadeDown 0.4s ease 0.18s both; line-height: 1.5;
      }

      /* Body */
      .sr3-result-body {
        max-width: 700px; margin: 0 auto; padding: 28px 16px 80px;
      }

      /* ── STATS — single scrollable row on mobile ── */
      .sr3-stats-row {
        display: flex; gap: 8px;
        margin-bottom: 32px; overflow-x: auto;
        padding-bottom: 4px; scroll-snap-type: x mandatory;
        -webkit-overflow-scrolling: touch;
        animation: sr3FadeUp 0.4s ease 0.2s both;
        /* hide scrollbar */
        scrollbar-width: none;
      }
      .sr3-stats-row::-webkit-scrollbar { display: none; }

      .sr3-stat {
        background: var(--surface); border: 1px solid var(--border);
        border-radius: var(--radius-lg); padding: 14px 16px;
        text-align: center;
        box-shadow: 0 1px 4px rgba(0,0,0,0.04);
        flex: 0 0 calc(25% - 6px); scroll-snap-align: start;
        min-width: 72px;
      }
      .sr3-stat-val {
        font-size: 26px; font-weight: 900; line-height: 1; margin-bottom: 4px;
      }
      .sr3-stat-val.c  { color: var(--sr3-correct); }
      .sr3-stat-val.w  { color: var(--sr3-wrong); }
      .sr3-stat-val.sk { color: var(--sr3-skip); }
      .sr3-stat-val.t  { color: var(--primary); }
      .sr3-stat-lbl {
        font-size: 9px; font-weight: 700; color: var(--text-muted);
        text-transform: uppercase; letter-spacing: 0.06em;
      }

      /* Section heading */
      .sr3-section-head {
        font-size: 13px; font-weight: 800; color: var(--text);
        margin-bottom: 14px; margin-top: 28px;
        display: flex; align-items: center; gap: 8px;
      }
      .sr3-section-head i { font-size: 12px; color: var(--primary); }
      .sr3-section-head:first-child { margin-top: 0; }

      /* Batch review block */
      .sr3-review-batch {
        background: var(--surface); border: 1px solid var(--border);
        border-radius: var(--radius-xl, 20px); overflow: hidden;
        margin-bottom: 12px; box-shadow: 0 1px 4px rgba(0,0,0,0.04);
      }
      .sr3-review-batch-head {
        display: flex; align-items: center; justify-content: space-between;
        padding: 13px 16px; cursor: pointer; user-select: none;
        background: var(--bg); transition: background 0.15s;
      }
      .sr3-review-batch-head:hover { background: var(--primary-light); }
      .sr3-review-batch-label {
        font-size: 12px; font-weight: 700; color: var(--text-secondary);
        display: flex; align-items: center; gap: 7px;
      }
      .sr3-review-batch-label i { font-size: 11px; color: var(--primary); }
      .sr3-review-batch-right { display: flex; align-items: center; gap: 10px; }
      .sr3-review-batch-score {
        font-size: 12px; font-weight: 700; color: var(--text-muted);
      }
      .sr3-review-chevron {
        font-size: 10px; color: var(--text-muted); transition: transform 0.2s;
      }
      .sr3-review-batch.open .sr3-review-chevron { transform: rotate(180deg); }
      .sr3-review-items { display: none; }
      .sr3-review-batch.open .sr3-review-items { display: block; }

      /* Review item */
      .sr3-review-item {
        padding: 16px; border-top: 1px solid var(--border); position: relative;
      }
      .sr3-review-item::before {
        content: ''; position: absolute;
        left: 0; top: 0; bottom: 0; width: 4px;
      }
      .sr3-review-item.correct::before { background: var(--sr3-correct); }
      .sr3-review-item.wrong::before   { background: var(--sr3-wrong); }
      .sr3-review-item.skipped::before { background: var(--sr3-skip); }

      .sr3-review-item-top {
        display: flex; align-items: flex-start; gap: 10px; margin-bottom: 10px;
      }
      .sr3-review-item-icon {
        width: 26px; height: 26px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        font-size: 11px; flex-shrink: 0; margin-top: 1px;
      }
      .sr3-review-item-icon.correct {
        background: var(--sr3-correct-bg); color: var(--sr3-correct);
        border: 1px solid var(--sr3-correct-border);
      }
      .sr3-review-item-icon.wrong {
        background: var(--sr3-wrong-bg); color: var(--sr3-wrong);
        border: 1px solid var(--sr3-wrong-border);
      }
      .sr3-review-item-icon.skipped {
        background: var(--sr3-skip-bg); color: var(--sr3-skip);
        border: 1px solid rgba(100,116,139,0.2);
      }
      .sr3-review-q-text {
        font-size: 14px; font-weight: 600; color: var(--text);
        line-height: 1.55; flex: 1;
      }

      /* Answer pills */
      .sr3-review-ans-row {
        display: flex; flex-wrap: wrap; gap: 6px;
        margin-bottom: 10px; padding-left: 36px;
      }
      .sr3-ans-pill {
        font-size: 11px; font-weight: 600; border-radius: 20px;
        padding: 4px 12px; display: flex; align-items: center; gap: 5px;
      }
      .sr3-ans-pill.student-ok {
        background: var(--sr3-correct-bg); color: var(--sr3-correct);
        border: 1px solid var(--sr3-correct-border);
      }
      .sr3-ans-pill.student-err {
        background: var(--sr3-wrong-bg); color: var(--sr3-wrong);
        border: 1px solid var(--sr3-wrong-border);
        text-decoration: line-through; opacity: 0.85;
      }
      .sr3-ans-pill.correct-ans {
        background: var(--sr3-correct-bg); color: var(--sr3-correct);
        border: 1px solid var(--sr3-correct-border);
      }
      .sr3-ans-pill.skipped-ans {
        background: var(--sr3-skip-bg); color: var(--sr3-skip);
        border: 1px solid rgba(100,116,139,0.2);
      }

      /* Explanation block */
      .sr3-explanation {
        margin-left: 36px;
        background: linear-gradient(135deg,rgba(2,132,199,0.05),rgba(2,132,199,0.02));
        border: 1px solid rgba(2,132,199,0.15);
        border-left: 3px solid var(--primary);
        border-radius: 0 var(--radius-md) var(--radius-md) 0;
        padding: 12px 14px;
      }
      .sr3-explanation-label {
        font-size: 9px; font-weight: 800; text-transform: uppercase;
        letter-spacing: 0.08em; color: var(--primary); margin-bottom: 5px;
        display: flex; align-items: center; gap: 5px;
      }
      .sr3-explanation-text {
        font-size: 13px; color: var(--text-secondary); line-height: 1.7;
      }
      .sr3-explanation-loading {
        display: flex; align-items: center; gap: 8px;
        font-size: 12px; color: var(--text-muted);
      }
      .sr3-expl-spin {
        width: 14px; height: 14px;
        border: 2px solid var(--border); border-top-color: var(--primary);
        border-radius: 50%; animation: sr3Spin 0.7s linear infinite; flex-shrink: 0;
      }

      /* Exam references block */
      .sr3-refs-block {
        background: var(--surface); border: 1px solid var(--border);
        border-radius: var(--radius-xl, 20px); overflow: hidden; margin-bottom: 20px;
      }
      .sr3-refs-head {
        padding: 14px 16px; background: var(--bg);
        border-bottom: 1px solid var(--border);
        display: flex; align-items: center; gap: 10px;
      }
      .sr3-refs-icon {
        width: 32px; height: 32px; border-radius: var(--radius-md);
        background: var(--primary-light);
        display: flex; align-items: center; justify-content: center;
        font-size: 13px; color: var(--primary); flex-shrink: 0;
      }
      .sr3-refs-head-title { font-size: 13px; font-weight: 700; color: var(--text); }
      .sr3-refs-head-sub { font-size: 11px; color: var(--text-muted); margin-top: 1px; }
      .sr3-refs-row {
        display: flex; align-items: center; justify-content: space-between;
        padding: 11px 16px; border-bottom: 1px solid var(--border); gap: 10px;
      }
      .sr3-refs-row:last-child { border-bottom: none; }
      .sr3-refs-exam-name { font-size: 13px; font-weight: 600; color: var(--text); }
      .sr3-refs-year {
        font-size: 11px; font-weight: 700; color: var(--primary);
        background: var(--primary-light); border-radius: 20px; padding: 2px 9px;
        flex-shrink: 0;
      }

      /* ── CTA SECTION ── */
      .sr3-cta-section { margin-top: 28px; }

      .sr3-cta-divider {
        display: flex; align-items: center; gap: 10px;
        margin: 20px 0 14px;
      }
      .sr3-cta-divider-line { flex: 1; height: 1px; background: var(--border); }
      .sr3-cta-divider-lbl {
        font-size: 10px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.08em; color: var(--text-muted); white-space: nowrap;
      }

      .sr3-btn-new {
        width: 100%; padding: 16px; color: #fff; font-family: inherit;
        font-size: 15px; font-weight: 700; border: none;
        border-radius: var(--radius-lg); cursor: pointer;
        display: flex; align-items: center; justify-content: center; gap: 8px;
        min-height: 52px;
        background: linear-gradient(135deg, #059669 0%, #10B981 100%);
        box-shadow: 0 4px 20px rgba(16,185,129,0.28);
        transition: opacity 0.2s, transform 0.15s; margin-bottom: 10px;
      }
      .sr3-btn-new:hover  { opacity: 0.92; }
      .sr3-btn-new:active { transform: scale(0.98); }

      .sr3-btn-dash {
        width: 100%; padding: 14px; color: #fff; font-family: inherit;
        font-size: 14px; font-weight: 700; border: none;
        border-radius: var(--radius-lg); cursor: pointer;
        display: flex; align-items: center; justify-content: center; gap: 8px;
        min-height: 50px;
        background: linear-gradient(135deg, #0369A1 0%, #0284C7 100%);
        box-shadow: 0 4px 16px rgba(2,132,199,0.25);
        transition: opacity 0.2s, transform 0.15s; margin-bottom: 10px;
      }
      .sr3-btn-dash:hover  { opacity: 0.92; }
      .sr3-btn-dash:active { transform: scale(0.98); }

      .sr3-btn-revisao {
        width: 100%; padding: 13px; background: transparent;
        border: 1.5px solid var(--border); border-radius: var(--radius-lg);
        color: var(--text-secondary); font-family: inherit;
        font-size: 13px; font-weight: 600; cursor: pointer;
        min-height: 48px;
        display: flex; align-items: center; justify-content: center; gap: 7px;
        transition: border-color 0.2s, color 0.2s; margin-bottom: 10px;
      }
      .sr3-btn-revisao:hover { border-color: var(--secondary); color: var(--secondary); }

      .sr3-social-row {
        display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
      }
      .sr3-btn-wa {
        padding: 13px 10px; background: #25D366; color: #fff;
        font-family: inherit; font-size: 13px; font-weight: 700;
        border: none; border-radius: var(--radius-lg); cursor: pointer;
        display: flex; align-items: center; justify-content: center; gap: 7px;
        min-height: 48px; box-shadow: 0 3px 12px rgba(37,211,102,0.3);
        transition: opacity 0.2s, transform 0.15s; text-decoration: none;
      }
      .sr3-btn-wa:hover  { opacity: 0.92; }
      .sr3-btn-wa:active { transform: scale(0.97); }
      .sr3-btn-wa.group {
        background: #128C7E; box-shadow: 0 3px 12px rgba(18,140,126,0.3);
      }

      /* ── DARK MODE ── */
      [data-theme="dark"] .sr3-result-hero::after { background: var(--bg); }
      [data-theme="dark"] .sr3-stat,
      [data-theme="dark"] .sr3-review-batch,
      [data-theme="dark"] .sr3-refs-block { background: var(--bg-card); }
      [data-theme="dark"] .sr3-q-card    { background: var(--bg-card); }
      [data-theme="dark"] .sr3-option,
      [data-theme="dark"] .sr3-tf-btn    { background: var(--bg); }
      [data-theme="dark"] .sr3-passage   { background: var(--bg-card); }
      [data-theme="dark"] .sr3-explanation { background: rgba(2,132,199,0.06); }

      /* ── RESPONSIVE ── */
      @media (min-width: 768px) {
        .sr3-content      { padding: 24px 24px 60px; }
        .sr3-result-body  { padding: 32px 24px 80px; }
        .sr3-stat         { flex: 0 0 calc(25% - 6px); }
      }
      @media (min-width: 1025px) {
        .sr3-outer           { max-width: 760px; margin: 0 auto; }
        .sr3-header          { max-width: 760px; left: 50%; transform: translateX(-50%); }
        .sr3-progress-track  { max-width: 760px; left: 50%; transform: translateX(-50%); }
      }
      @media (max-width: 360px) {
        .sr3-batch-pill { display: none; }
      }

      /* ── ANIMATIONS ── */
      @keyframes sr3Spin     { to { transform: rotate(360deg); } }
      @keyframes sr3FadeUp   { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
      @keyframes sr3FadeDown { from { opacity:0; transform:translateY(-10px); } to { opacity:1; transform:translateY(0); } }
      @keyframes sr3Pop      { from { opacity:0; transform:scale(0.65); } to { opacity:1; transform:scale(1); } }
      @keyframes sr3ModalIn  { from { opacity:0; transform:scale(0.9) translateY(12px); } to { opacity:1; transform:scale(1) translateY(0); } }
      @keyframes sr3SlideIn  { from { opacity:0; transform:translateX(16px); } to { opacity:1; transform:translateX(0); } }

    </style>`;
  },

  mount() {
    return `
      <div id="sr3-header-slot"></div>
      <div class="sr3-progress-track">
        <div class="sr3-progress-fill" id="sr3-progress" style="width:0%"></div>
      </div>
      <div class="sr3-loading" id="sr3-loading">
        <div class="sr3-loading-ring"></div>
        <div class="sr3-loading-text notranslate" translate="no">A preparar as perguntas...</div>
      </div>
      <div class="sr3-outer" id="sr3-main" style="display:none;">
        <div class="sr3-content" id="sr3-batch-area"></div>
      </div>
      <div class="sr3-result" id="sr3-result"></div>
      <div class="sr3-modal-bg" id="sr3-quit-bg">
        <div class="sr3-modal">
          <div class="sr3-modal-top">
            <div class="sr3-modal-icon">
              <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
            </div>
            <div>
              <div class="sr3-modal-title notranslate" translate="no">Sair da Simulação?</div>
              <div class="sr3-modal-sub notranslate" translate="no">
                O progresso desta sessão não será guardado.
              </div>
            </div>
          </div>
          <div class="sr3-modal-body">
            <div class="sr3-modal-warn">
              <i class="fa-solid fa-coins" aria-hidden="true"></i>
              <span class="notranslate" translate="no">
                Se sair agora, esta sessão conta como incompleta e
                <strong>será cobrado o custo total</strong> desta simulação.
              </span>
            </div>
            <div class="sr3-modal-btns">
              <button class="sr3-modal-continue notranslate" translate="no" id="sr3-modal-continue">
                <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
                Continuar a Simulação
              </button>
              <button class="sr3-modal-leave notranslate" translate="no" id="sr3-modal-leave">
                Sair mesmo assim
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  async init(user, userData, params) {
    _user     = user;
    _userData = userData;

    if (!session.simulacao || !session.simulacao.questions?.length) {
      router.navigate('/panel/simulacao');
      return;
    }

    _data          = { ...session.simulacao };
    session.simulacao = null;
    _questions     = _data.questions;
    _answers       = {};
    _skipped       = {};
    _timerSecs     = 0;
    _sessionDone   = false;
    _resultShown   = false;
    _batchIndex    = 0;

    _batches = [];
    for (let i = 0; i < _questions.length; i += BATCH_SIZE) {
      _batches.push(_questions.slice(i, i + BATCH_SIZE));
    }

    _renderHeader();

    document.getElementById('sr3-modal-continue')?.addEventListener('click', _closeQuitModal);
    document.getElementById('sr3-modal-leave')?.addEventListener('click', () => {
      _closeQuitModal();
      _stopTimer();
      router.navigate('/panel/simulacao');
    });

    history.pushState({ sr3: true }, '', window.location.href);
    window.addEventListener('popstate', _handlePopState);

    _startTimer();

    document.getElementById('sr3-loading').classList.add('show');
    await _cleanEmbeddedOptions();
    document.getElementById('sr3-loading').classList.remove('show');
    document.getElementById('sr3-main').style.display = '';

    _renderBatch(_batchIndex);
  },

  destroy() {
    _stopTimer();
    session.simulacao = null;
    window.removeEventListener('popstate', _handlePopState);
  },
};

// ============================================================
// POPSTATE / QUIT MODAL
// ============================================================

function _handlePopState() {
  if (!_sessionDone) {
    _openQuitModal();
    history.pushState({ sr3: true }, '', window.location.href);
  }
}

function _openQuitModal()  { document.getElementById('sr3-quit-bg')?.classList.add('show'); }
function _closeQuitModal() { document.getElementById('sr3-quit-bg')?.classList.remove('show'); }

// ============================================================
// HEADER
// ============================================================

function _renderHeader() {
  const slot = document.getElementById('sr3-header-slot');
  if (!slot) return;

  const profileText = _buildProfileText();
  const subject     = _data.subject || '';

  slot.innerHTML = `
    <div class="sr3-header" id="sr3-header">
      <div class="sr3-header-info">
        ${profileText
          ? `<div class="sr3-header-profile notranslate" translate="no">${_esc(profileText)}</div>`
          : ''}
        <div class="sr3-header-subject notranslate" translate="no">${_esc(subject)}</div>
      </div>
      <div class="sr3-header-right">
        <div class="sr3-batch-pill notranslate" translate="no" id="sr3-batch-pill">
          1 / ${_batches.length}
        </div>
        <div class="sr3-timer-pill notranslate" translate="no">
          <i class="fa-solid fa-clock" aria-hidden="true"></i>
          <span id="sr3-timer-txt">0:00</span>
        </div>
        <button class="sr3-quit-btn" id="sr3-quit-btn" aria-label="Sair">
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </div>
    </div>
  `;

  document.getElementById('sr3-quit-btn')?.addEventListener('click', _openQuitModal);
}

function _buildProfileText() {
  const examType    = _userData?.examType;
  const grade       = _userData?.grade;
  const course      = _userData?.course      || '';
  const institution = _userData?.institution || '';
  if (examType === 'ensino-geral') {
    return `Ensino Geral · ${grade === '9' ? '9ª Classe' : '12ª Classe'}`;
  } else if (examType === 'admissao') {
    return course || institution?.toUpperCase() || 'Admissão';
  }
  return '';
}

function _updateHeaderBatch() {
  const el = document.getElementById('sr3-batch-pill');
  if (el) el.textContent = `${_batchIndex + 1} / ${_batches.length}`;
}

// ============================================================
// TIMER
// ============================================================

function _startTimer() {
  _timerSecs = 0;
  _timerInterval = setInterval(() => {
    _timerSecs++;
    const el = document.getElementById('sr3-timer-txt');
    if (el) el.textContent = _formatTime(_timerSecs);
  }, 1000);
}

function _stopTimer() {
  clearInterval(_timerInterval);
  _timerInterval = null;
}

function _formatTime(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// ============================================================
// PROGRESS BAR
// ============================================================

function _updateProgress() {
  const done = Object.keys(_answers).length + Object.keys(_skipped).length;
  const pct  = Math.round((done / _questions.length) * 100);
  const el   = document.getElementById('sr3-progress');
  if (el) el.style.width = pct + '%';
}

// ============================================================
// CLEAN EMBEDDED OPTIONS
// ============================================================

async function _cleanEmbeddedOptions() {
  for (let i = 0; i < _questions.length; i++) {
    const q = _questions[i];
    if (q._aiGenerated) continue;
    if ((q['Tipo'] || '').trim() !== 'escolha-multipla') continue;

    const enunciado = (q['Enunciado'] || '').trim();
    const opts      = getOptions(q);
    if (!opts.length) continue;

    const hasEmbedded = /\b[A-Fa-f]\s*[\)\.]/.test(enunciado);
    if (!hasEmbedded) continue;

    const cleaned = enunciado
      .replace(/\s+[A-Fa-f]\s*[\)\.]\s+.*/s, '')
      .trim();

    if (cleaned && cleaned !== enunciado) {
      _questions[i] = { ...q, 'Enunciado': cleaned };
    }
  }
}

// ============================================================
// BATCH RENDERING
// ============================================================

function _renderBatch(idx) {
  const batch      = _batches[idx];
  const batchStart = idx * BATCH_SIZE;
  const area       = document.getElementById('sr3-batch-area');
  if (!area || !batch) return;

  _updateHeaderBatch();

  const isLast   = idx === _batches.length - 1;
  const showText = idx === 0 && !!_data.examText?.conteudo;

  let html = '';

  const qStart = batchStart + 1;
  const qEnd   = Math.min(batchStart + batch.length, _questions.length);

  html += `
    <div class="sr3-batch-header">
      <div class="sr3-batch-tag notranslate" translate="no">
        Grupo ${idx + 1} de ${_batches.length}
      </div>
      <div class="sr3-batch-divider"></div>
      <div class="sr3-batch-count notranslate" translate="no">
        Perguntas ${qStart}–${qEnd}
      </div>
    </div>
  `;

  if (showText) {
    html += _passageHtml(_data.examText);
  }

  batch.forEach((q, li) => {
    const gi = batchStart + li;
    html += _questionCardHtml(q, gi, batchStart + li + 1);
  });

  html += `<div class="sr3-dots">`;
  batch.forEach((_, li) => {
    const gi  = batchStart + li;
    const cls = _answers[gi] !== undefined ? 'answered' : _skipped[gi] ? 'skipped' : '';
    html += `<div class="sr3-dot ${cls}" id="sr3-dot-${gi}"></div>`;
  });
  html += `</div>`;

  html += `
    <div class="sr3-skip-note" id="sr3-skip-note">
      <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
      <span class="notranslate" translate="no">
        As perguntas saltadas contam como erradas na revisão final.
      </span>
    </div>
  `;

  const doneCount = batch.filter((_, li) => {
    const gi = batchStart + li;
    return _answers[gi] !== undefined || _skipped[gi];
  }).length;

  html += `
    <div class="sr3-submit-wrap">
      <button class="sr3-submit-btn ${isLast ? 'finish' : ''} notranslate"
        translate="no" id="sr3-submit-btn">
        <i class="fa-solid ${isLast ? 'fa-flag-checkered' : 'fa-arrow-right'}"
          aria-hidden="true"></i>
        ${isLast ? 'Submeter Simulação' : 'Próximo Grupo'}
      </button>
      <div class="sr3-submit-hint notranslate" translate="no" id="sr3-submit-hint">
        ${doneCount} de ${batch.length} respondidas
      </div>
    </div>
  `;

  area.innerHTML = html;
  area.style.animation = 'sr3SlideIn 0.22s ease both';
  window.scrollTo({ top: 0, behavior: 'instant' });

  batch.forEach((q, li) => {
    _wireQuestion(q, batchStart + li);
  });

  document.getElementById('sr3-submit-btn')?.addEventListener('click', () => {
    _handleBatchSubmit(idx);
  });
}

// ============================================================
// PASSAGE HTML
// ============================================================

function _passageHtml(text) {
  if (!text?.conteudo) return '';
  return `
    <div class="sr3-passage">
      <div class="sr3-passage-head">
        <div class="sr3-passage-eyebrow notranslate" translate="no">Texto de Apoio</div>
        ${text.titulo
          ? `<div class="sr3-passage-title notranslate" translate="no">${_esc(text.titulo)}</div>`
          : ''}
        ${text.autor
          ? `<div class="sr3-passage-autor notranslate" translate="no">${_esc(text.autor)}</div>`
          : ''}
      </div>
      <div class="sr3-passage-body notranslate" translate="no">${_esc(text.conteudo)}</div>
      ${text.glossario ? `
        <div class="sr3-passage-glossario notranslate" translate="no">
          <strong>Glossário:</strong> ${_esc(text.glossario)}
        </div>
      ` : ''}
    </div>
  `;
}

// ============================================================
// QUESTION CARD HTML
// ============================================================

function _questionCardHtml(q, gi, displayNum) {
  const tipo       = (q['Tipo'] || 'escolha-multipla').trim();
  const qText      = (q['Enunciado'] || '').trim();
  const topic      = (q['Tema_Relacionado'] || '').trim();
  const year       = normaliseYear(q['Ano']) || '';
  const figureDesc = (q['Descrição_Figura'] || '').trim();
  const isAnswered = _answers[gi] !== undefined;
  const isSkipped  = !!_skipped[gi];

  let cardClass = 'sr3-q-card';
  if (isAnswered) cardClass += ' answered';
  if (isSkipped)  cardClass += ' skipped';

  // Year badge shows "Exame de YYYY"
  const yearLabel = year ? `Exame de ${year}` : '';

  const skipControl = isSkipped
    ? `<span class="sr3-skipped-badge notranslate" translate="no">Saltada</span>`
    : `<button class="sr3-skip-btn notranslate" translate="no"
        id="sr3-skip-${gi}" data-gi="${gi}">Saltar</button>`;

  let html = `
    <div class="${cardClass}" id="sr3-card-${gi}">
      <div class="sr3-q-top">
        <div class="sr3-q-num-row">
          <div class="sr3-q-num-badge">${displayNum}</div>
          <div class="sr3-q-meta-badges">
            ${topic
              ? `<span class="sr3-q-badge topic notranslate" translate="no">${_esc(topic)}</span>`
              : ''}
            ${yearLabel
              ? `<span class="sr3-q-badge year notranslate" translate="no">${_esc(yearLabel)}</span>`
              : ''}
          </div>
        </div>
        ${skipControl}
      </div>
  `;

  if (figureDesc) {
    html += `
      <div class="sr3-figure-box">
        <i class="fa-solid fa-image" aria-hidden="true"></i>
        <div>
          <div class="sr3-figure-desc notranslate" translate="no">${_esc(figureDesc)}</div>
          <div class="sr3-figure-ref notranslate" translate="no">
            Consulte a figura no Exame de ${_esc(q['Disciplina'] || '')}${year ? ', ' + _esc(year) : ''}
          </div>
        </div>
      </div>
    `;
  }

  html += `<div class="sr3-q-text notranslate" translate="no">${_esc(qText)}</div>`;

  if (!isSkipped) {
    if (tipo === 'verdadeiro-falso') {
      html += _tfHtml(gi);
    } else {
      html += _mcHtml(q, gi);
    }
  }

  html += `</div>`;
  return html;
}

function _mcHtml(q, gi) {
  const opts     = getOptions(q);
  const selected = _answers[gi];

  if (!opts.length) {
    return `<div style="padding:12px 16px 16px;font-size:13px;color:var(--text-muted);">
      Opções não disponíveis.
    </div>`;
  }

  let html = `<div class="sr3-options" id="sr3-opts-${gi}">`;
  for (const o of opts) {
    const isSelected = selected !== undefined
      ? (q._aiGenerated
          ? selected.letter === o.letter
          : selected.text   === o.text)
      : false;

    html += `
      <button class="sr3-option ${isSelected ? 'selected' : ''} notranslate"
        translate="no" data-gi="${gi}" data-letter="${o.letter}"
        data-text="${_esc(o.text)}">
        <div class="sr3-opt-circle">${o.letter}</div>
        <div class="sr3-opt-text">${_esc(o.text)}</div>
      </button>
    `;
  }
  html += `</div>`;
  return html;
}

function _tfHtml(gi) {
  const selected = _answers[gi];
  const isV = selected?.text === 'Verdadeiro';
  const isF = selected?.text === 'Falso';

  return `
    <div class="sr3-tf-options" id="sr3-opts-${gi}">
      <button class="sr3-tf-btn v ${isV ? 'selected' : ''} notranslate"
        translate="no" data-gi="${gi}" data-answer="Verdadeiro">
        <i class="fa-solid fa-check-circle" aria-hidden="true"></i>
        Verdadeiro
      </button>
      <button class="sr3-tf-btn f ${isF ? 'selected' : ''} notranslate"
        translate="no" data-gi="${gi}" data-answer="Falso">
        <i class="fa-solid fa-times-circle" aria-hidden="true"></i>
        Falso
      </button>
    </div>
  `;
}

// ============================================================
// WIRING INTERACTIONS
// ============================================================

function _wireQuestion(q, gi) {
  const tipo = (q['Tipo'] || 'escolha-multipla').trim();

  document.getElementById(`sr3-skip-${gi}`)?.addEventListener('click', () => {
    _handleSkip(gi);
  }, { once: true });

  if (tipo === 'verdadeiro-falso') {
    const container = document.getElementById(`sr3-opts-${gi}`);
    container?.querySelectorAll('.sr3-tf-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _selectAnswer(gi, { letter: null, text: btn.dataset.answer }, q, container, 'tf');
      });
    });
  } else {
    const container = document.getElementById(`sr3-opts-${gi}`);
    container?.querySelectorAll('.sr3-option').forEach(btn => {
      btn.addEventListener('click', () => {
        _selectAnswer(gi, { letter: btn.dataset.letter, text: btn.dataset.text }, q, container, 'mc');
      });
    });
  }
}

function _selectAnswer(gi, value, q, container, type) {
  delete _skipped[gi];
  _answers[gi] = value;

  if (type === 'mc') {
    container?.querySelectorAll('.sr3-option').forEach(b => {
      const match = q._aiGenerated
        ? b.dataset.letter === value.letter
        : b.dataset.text   === value.text;
      b.classList.toggle('selected', match);
    });
  } else {
    container?.querySelectorAll('.sr3-tf-btn').forEach(b => {
      b.classList.toggle('selected', b.dataset.answer === value.text);
    });
  }

  const card = document.getElementById(`sr3-card-${gi}`);
  card?.classList.add('answered');
  card?.classList.remove('skipped');

  const dot = document.getElementById(`sr3-dot-${gi}`);
  if (dot) { dot.className = 'sr3-dot answered'; }

  _updateProgress();
  _updateSubmitHint();
}

function _handleSkip(gi) {
  _skipped[gi] = true;
  delete _answers[gi];

  const q          = _questions[gi];
  const displayNum = gi + 1;
  const card       = document.getElementById(`sr3-card-${gi}`);
  if (card) {
    const tmp = document.createElement('div');
    tmp.innerHTML = _questionCardHtml(q, gi, displayNum);
    card.replaceWith(tmp.firstElementChild);
  }

  const dot = document.getElementById(`sr3-dot-${gi}`);
  if (dot) { dot.className = 'sr3-dot skipped'; }

  const note = document.getElementById('sr3-skip-note');
  if (note) note.classList.add('show');

  _updateProgress();
  _updateSubmitHint();
}

function _updateSubmitHint() {
  const hint       = document.getElementById('sr3-submit-hint');
  const batchStart = _batchIndex * BATCH_SIZE;
  const batch      = _batches[_batchIndex];
  if (!hint || !batch) return;

  const answered = batch.filter((_, li) => _answers[batchStart + li] !== undefined).length;
  const skipped  = batch.filter((_, li) => _skipped[batchStart + li]).length;

  let text = `${answered} de ${batch.length} respondidas`;
  if (skipped > 0) text += ` · ${skipped} saltada${skipped !== 1 ? 's' : ''}`;
  hint.textContent = text;
}

// ============================================================
// BATCH SUBMISSION
// ============================================================

function _handleBatchSubmit(idx) {
  const batchStart = idx * BATCH_SIZE;
  const batch      = _batches[idx];

  batch.forEach((_, li) => {
    const gi = batchStart + li;
    if (_answers[gi] === undefined && !_skipped[gi]) {
      _skipped[gi] = true;
    }
  });

  if (idx === _batches.length - 1) {
    _finishSession();
  } else {
    _batchIndex++;
    _renderBatch(_batchIndex);
  }
}

// ============================================================
// SESSION COMPLETION
// ============================================================

async function _finishSession() {
  if (_sessionDone) return;
  _sessionDone = true;
  _stopTimer();

  const totalTime  = _timerSecs;
  const allAnswers = [];

  for (let i = 0; i < _questions.length; i++) {
    const q         = _questions[i];
    const given     = _answers[i];
    const isSkipped = !!_skipped[i] && given === undefined;
    const correctText = _getCorrectText(q);

    let isCorrect = false;
    if (!isSkipped && given !== undefined) {
      if (q['Tipo'] === 'verdadeiro-falso') {
        isCorrect = given.text === q['Resposta'];
      } else if (q._aiGenerated) {
        isCorrect = given.letter === q['Resposta'];
      } else {
        isCorrect = given.text === q['Resposta'];
      }
    }

    allAnswers.push({ index: i, question: q, given, correctText, isCorrect, isSkipped });
  }

  const correctCount = allAnswers.filter(a => a.isCorrect).length;
  const wrongCount   = allAnswers.filter(a => !a.isCorrect && !a.isSkipped).length;
  const skippedCount = allAnswers.filter(a => a.isSkipped).length;
  const score        = Math.round((correctCount / _questions.length) * 100);

  _showResult(score, correctCount, wrongCount, skippedCount, totalTime, allAnswers);

  const wrongList = allAnswers.filter(a => !a.isCorrect);
  _saveWrongAnswers(wrongList).catch(e => console.warn('[SimRender] saveWrongAnswers:', e));

  if (_data.userId && _data.cost) {
    moeda.deductMoedas(_data.userId, _data.cost).catch(e =>
      console.warn('[SimRender] deductMoedas:', e)
    );
  }
}

function _getCorrectText(q) {
  const resp = (q['Resposta'] || '').trim();
  if (!resp) return '—';
  if (q['Tipo'] === 'verdadeiro-falso') return resp;
  if (q._aiGenerated) {
    const opts  = getOptions(q);
    const match = opts.find(o => o.letter === resp.toUpperCase());
    return match ? match.text : resp;
  }
  return resp;
}

// ============================================================
// RESULT SCREEN
// ============================================================

function _showResult(score, correctCount, wrongCount, skippedCount, totalTime, allAnswers) {
  if (_resultShown) return;
  _resultShown = true;

  const main   = document.getElementById('sr3-main');
  const result = document.getElementById('sr3-result');
  if (main)   main.style.display = 'none';
  if (!result) return;
  result.classList.add('show');

  let ringClass = 'low';
  let title     = 'Continue a Treinar!';
  if (score >= 80) { ringClass = 'great'; title = 'Excelente Resultado!'; }
  else if (score >= 60) { ringClass = 'good'; title = 'Bom Trabalho!'; }
  else if (score >= 40) { ringClass = 'fair'; title = 'Está a Melhorar!'; }

  const subLine    = `${_data.subject} · ${_data.mode === 'geradas' ? 'Perguntas Personalizadas' : 'Exames Anteriores'}`;
  const refsHtml   = _buildRefsHtml();
  const reviewHtml = _buildReviewHtml(allAnswers);

  result.innerHTML = `
    <div class="sr3-result-hero">
      <div class="sr3-hero-blob" style="width:200px;height:200px;top:-80px;right:-60px;"></div>
      <div class="sr3-hero-blob" style="width:90px;height:90px;bottom:20px;left:10px;"></div>
      <div class="sr3-score-ring ${ringClass}">
        <div class="sr3-score-pct notranslate" translate="no">${score}%</div>
        <div class="sr3-score-sub notranslate" translate="no">Score</div>
      </div>
      <div class="sr3-result-title notranslate" translate="no">${_esc(title)}</div>
      <div class="sr3-result-meta notranslate" translate="no">${_esc(subLine)}</div>
    </div>

    <div class="sr3-result-body">

      <div class="sr3-stats-row">
        <div class="sr3-stat">
          <div class="sr3-stat-val c notranslate" translate="no">${correctCount}</div>
          <div class="sr3-stat-lbl notranslate" translate="no">Correctas</div>
        </div>
        <div class="sr3-stat">
          <div class="sr3-stat-val w notranslate" translate="no">${wrongCount}</div>
          <div class="sr3-stat-lbl notranslate" translate="no">Erradas</div>
        </div>
        <div class="sr3-stat">
          <div class="sr3-stat-val sk notranslate" translate="no">${skippedCount}</div>
          <div class="sr3-stat-lbl notranslate" translate="no">Saltadas</div>
        </div>
        <div class="sr3-stat">
          <div class="sr3-stat-val t notranslate" translate="no">${_formatTime(totalTime)}</div>
          <div class="sr3-stat-lbl notranslate" translate="no">Tempo</div>
        </div>
      </div>

      <div class="sr3-section-head notranslate" translate="no">
        <i class="fa-solid fa-list-check" aria-hidden="true"></i>
        Revisão Completa
      </div>
      ${reviewHtml}

      ${refsHtml}

      <div class="sr3-cta-section">

        <button class="sr3-btn-new notranslate" translate="no" id="sr3-btn-new">
          <i class="fa-solid fa-rotate" aria-hidden="true"></i>
          Nova Simulação
        </button>

        <button class="sr3-btn-dash notranslate" translate="no" id="sr3-btn-dash">
          <i class="fa-solid fa-house" aria-hidden="true"></i>
          Ir para o Painel Principal
        </button>

        <button class="sr3-btn-revisao notranslate" translate="no" id="sr3-btn-revisao">
          <i class="fa-solid fa-bookmark" aria-hidden="true"></i>
          Ver Revisão de Erros
        </button>

        <div class="sr3-cta-divider">
          <div class="sr3-cta-divider-line"></div>
          <div class="sr3-cta-divider-lbl">Precisas de ajuda?</div>
          <div class="sr3-cta-divider-line"></div>
        </div>

        <div class="sr3-social-row">
          <a class="sr3-btn-wa notranslate" translate="no"
            href="${WHATSAPP_HELP}" target="_blank" rel="noopener">
            <i class="fa-brands fa-whatsapp" aria-hidden="true"></i>
            Suporte
          </a>
          <a class="sr3-btn-wa group notranslate" translate="no"
            href="${WHATSAPP_GROUP}" target="_blank" rel="noopener">
            <i class="fa-brands fa-whatsapp" aria-hidden="true"></i>
            Grupo de Estudo
          </a>
        </div>

      </div>
    </div>
  `;

  // Wire buttons
  document.getElementById('sr3-btn-new')?.addEventListener('click', () => {
    router.navigate('/panel/simulacao');
  }, { once: true });

  document.getElementById('sr3-btn-dash')?.addEventListener('click', () => {
    router.navigate('/panel/dashboard');
  }, { once: true });

  document.getElementById('sr3-btn-revisao')?.addEventListener('click', () => {
    router.navigate('/panel/revisao');
  }, { once: true });

  result.querySelectorAll('.sr3-review-batch-head').forEach(head => {
    head.addEventListener('click', () => {
      head.closest('.sr3-review-batch')?.classList.toggle('open');
    });
  });

  // Scroll to top so score ring is fully visible
  window.scrollTo({ top: 0, behavior: 'instant' });

  _requestExplanations(allAnswers);
}

// ============================================================
// REVIEW HTML
// ============================================================

function _buildReviewHtml(allAnswers) {
  let html = '';

  _batches.forEach((batch, bIdx) => {
    const bStart   = bIdx * BATCH_SIZE;
    const bAnswers = allAnswers.slice(bStart, bStart + batch.length);
    const correct  = bAnswers.filter(a => a.isCorrect).length;
    const openClass = bIdx === 0 ? 'open' : '';

    html += `
      <div class="sr3-review-batch ${openClass}" id="sr3-review-batch-${bIdx}">
        <div class="sr3-review-batch-head">
          <div class="sr3-review-batch-label notranslate" translate="no">
            <i class="fa-solid fa-layer-group" aria-hidden="true"></i>
            Grupo ${bIdx + 1}
          </div>
          <div class="sr3-review-batch-right">
            <div class="sr3-review-batch-score notranslate" translate="no">
              ${correct}/${batch.length}
            </div>
            <i class="fa-solid fa-chevron-down sr3-review-chevron" aria-hidden="true"></i>
          </div>
        </div>
        <div class="sr3-review-items">
    `;

    bAnswers.forEach((a) => {
      const { index, question: q, given, correctText, isCorrect, isSkipped } = a;
      const qText  = (q['Enunciado'] || `Pergunta ${index + 1}`).trim();
      const qShort = qText.length > 140 ? qText.slice(0, 137) + '...' : qText;

      let itemClass = 'sr3-review-item';
      let iconClass = '';
      let iconName  = '';

      if (isSkipped)       { itemClass += ' skipped'; iconClass = 'skipped'; iconName = 'fa-minus'; }
      else if (isCorrect)  { itemClass += ' correct'; iconClass = 'correct'; iconName = 'fa-check'; }
      else                 { itemClass += ' wrong';   iconClass = 'wrong';   iconName = 'fa-xmark'; }

      let pillsHtml = '';
      if (isSkipped) {
        pillsHtml = `<span class="sr3-ans-pill skipped-ans notranslate" translate="no">
          <i class="fa-solid fa-minus"></i> Saltada
        </span>`;
      } else if (isCorrect) {
        pillsHtml = `<span class="sr3-ans-pill student-ok notranslate" translate="no">
          <i class="fa-solid fa-check"></i>
          ${_esc(given?.text || correctText)}
        </span>`;
      } else {
        pillsHtml = `
          <span class="sr3-ans-pill student-err notranslate" translate="no">
            <i class="fa-solid fa-xmark"></i>
            ${_esc(given?.text || '—')}
          </span>
          <span class="sr3-ans-pill correct-ans notranslate" translate="no">
            <i class="fa-solid fa-check"></i>
            ${_esc(correctText)}
          </span>
        `;
      }

      // Show existing Explicação or Resposta_Possível immediately if available
      // AI will enrich/rewrite it either way
      const existingExpl = (q['Explicação'] || q['Resposta_Possível'] || '').trim();

      html += `
        <div class="${itemClass}">
          <div class="sr3-review-item-top">
            <div class="sr3-review-item-icon ${iconClass}">
              <i class="fa-solid ${iconName}" aria-hidden="true"></i>
            </div>
            <div class="sr3-review-q-text notranslate" translate="no">
              ${_esc(qShort)}
            </div>
          </div>
          <div class="sr3-review-ans-row">${pillsHtml}</div>
          <div class="sr3-explanation" id="sr3-expl-${index}">
            <div class="sr3-explanation-label notranslate" translate="no">
              <i class="fa-solid fa-lightbulb" aria-hidden="true"></i>
              Explicação
            </div>
            <div class="sr3-explanation-text notranslate" translate="no"
              id="sr3-expl-text-${index}">
              ${existingExpl
                ? _esc(existingExpl)
                : `<div class="sr3-explanation-loading">
                    <div class="sr3-expl-spin"></div>
                    <span>A preparar a explicação...</span>
                  </div>`
              }
            </div>
          </div>
        </div>
      `;
    });

    html += `</div></div>`;
  });

  return html;
}

// ============================================================
// EXAM REFERENCES HTML
// ============================================================

function _buildRefsHtml() {
  const refMap = new Map();

  for (const q of _questions) {
    const id = (q['ID_Exame'] || '').trim();
    if (!id || q._aiGenerated) continue;
    if (!refMap.has(id)) {
      refMap.set(id, {
        disciplina: q['Disciplina'] || '',
        ano:        normaliseYear(q['Ano']) || '',
        classe:     q['Classe'] || '',
        chamada:    q['Chamada'] || '',
      });
    }
  }

  if (!refMap.size) return '';

  let rows = '';
  for (const [id, meta] of refMap.entries()) {
    const parts = [meta.disciplina, meta.classe, meta.chamada].filter(Boolean);
    const label = parts.join(' · ') || id;
    rows += `
      <div class="sr3-refs-row">
        <div class="sr3-refs-exam-name notranslate" translate="no">${_esc(label)}</div>
        ${meta.ano
          ? `<div class="sr3-refs-year notranslate" translate="no">${_esc(meta.ano)}</div>`
          : ''}
      </div>
    `;
  }

  return `
    <div class="sr3-section-head notranslate" translate="no">
      <i class="fa-solid fa-book-open" aria-hidden="true"></i>
      Exames Consultados
    </div>
    <div class="sr3-refs-block">
      <div class="sr3-refs-head">
        <div class="sr3-refs-icon">
          <i class="fa-solid fa-graduation-cap" aria-hidden="true"></i>
        </div>
        <div>
          <div class="sr3-refs-head-title notranslate" translate="no">
            Referência dos Exames Utilizados
          </div>
          <div class="sr3-refs-head-sub notranslate" translate="no">
            As perguntas foram seleccionadas dos seguintes exames nacionais.
          </div>
        </div>
      </div>
      ${rows}
    </div>
  `;
}

// ============================================================
// EXPLANATIONS
// AI reads Resposta_Possível + Explicação from DB fields,
// uses them as source material, then writes a clean
// pedagogical explanation that teaches the student something.
// Equations and symbols written as plain Unicode inline.
// ============================================================

async function _requestExplanations(allAnswers) {
  // All questions get an explanation — AI enriches from DB fields
  // AI questions already have explanations but we still rewrite them
  // for pedagogical quality. Process in chunks of 5.
  const batchSize = 5;
  for (let i = 0; i < allAnswers.length; i += batchSize) {
    const chunk = allAnswers.slice(i, i + batchSize);
    try {
      await _fetchExplanationsForChunk(chunk);
    } catch (e) {
      console.warn('[SimRender] Explanation chunk failed:', e);
      for (const a of chunk) {
        // Only set fallback if not already filled
        const el = document.getElementById(`sr3-expl-text-${a.index}`);
        if (el && el.querySelector('.sr3-expl-spin')) {
          el.textContent = 'Consulte o seu professor ou manual para mais informações.';
        }
      }
    }
  }
}

async function _fetchExplanationsForChunk(chunk) {
  const payload = chunk.map(a => ({
    index:            a.index,
    enunciado:        (a.question['Enunciado'] || '').slice(0, 400),
    resposta_correta: a.correctText,
    resposta_aluno:   a.isSkipped ? 'Saltada' : (a.given?.text || '—'),
    acertou:          a.isCorrect,
    saltou:           a.isSkipped,
    // Pass DB source fields so AI uses them as teaching material
    db_explicacao:    (a.question['Explicação']       || '').slice(0, 600),
    db_resp_possivel: (a.question['Resposta_Possível'] || '').slice(0, 600),
    tema:             a.question['Tema_Relacionado'] || '',
    disciplina:       a.question['Disciplina']       || '',
    classe:           a.question['Classe']           || '',
  }));

  const messages = [
    {
      role: 'system',
      content: `És um professor especialista em exames nacionais de Moçambique.
Para cada questão no array JSON abaixo, escreve uma explicação pedagógica em Português formal (3 a 5 frases) que:
1. Explica PORQUÊ a resposta correcta está certa — com raciocínio claro
2. Se o aluno errou, explica subtilmente onde o raciocínio falhou
3. Usa os campos db_explicacao e db_resp_possivel como base de conteúdo — enriquece-os, não os copias
4. Ensina algo útil sobre o tema para o aluno aprender com o erro ou confirmar o acerto
5. Escreve equações, fórmulas e símbolos químicos/matemáticos/biológicos como texto Unicode inline: use x², H₂O, →, ≥, Δ, α, β, π etc. — NUNCA LaTeX, NUNCA backticks, NUNCA markdown
6. Nunca menciones letras A/B/C/D — refere sempre o conteúdo da resposta
7. Tom encorajador mas rigoroso — adequado a um estudante moçambicano do ensino secundário
Responde APENAS com JSON array válido, sem markdown, sem texto extra:
[{"index": número, "explicacao": "texto da explicação"}]`,
    },
    {
      role: 'user',
      content: JSON.stringify(payload),
    },
  ];

  const raw = await worker.callAI(messages, { maxTokens: 1500, temperature: 0.3 });
  const clean = raw
    .replace(/```json|```/g, '')
    .replace(/^[^\[]*/, '')
    .replace(/[^\]]*$/, '')
    .trim();
  const parsed = JSON.parse(clean);

  if (!Array.isArray(parsed)) throw new Error('not array');

  for (const item of parsed) {
    if (typeof item.index === 'number' && item.explicacao) {
      _setExplanationText(item.index, item.explicacao);
    }
  }
}

function _setExplanationText(index, text) {
  const el = document.getElementById(`sr3-expl-text-${index}`);
  if (el) el.textContent = text;
}

// ============================================================
// SAVE WRONG ANSWERS
// ============================================================

async function _saveWrongAnswers(wrongList) {
  if (!wrongList.length || !_data.userId) return;

  // Invalidate Progresso wrongAnswers cache — next visit fetches fresh data
  try {
    const now = new Date();
    const mz  = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const y   = mz.getUTCFullYear();
    const m   = String(mz.getUTCMonth() + 1).padStart(2, '0');
    const d   = String(mz.getUTCDate()).padStart(2, '0');
    localStorage.removeItem(`en_wa_${_data.userId}_${y}-${m}-${d}`);
  } catch {}

  for (const a of wrongList) {
    try {
      await saveWrongAnswer(_data.userId, a.question, 'simulacao');
    } catch (e) {
      console.warn('[SimRender] saveWrongAnswer:', e);
    }
  }
}

// ============================================================
// HELPERS
// ============================================================

function _esc(str) {
  return String(str ?? '')
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

export default SimulacaoRenderScreen; 
