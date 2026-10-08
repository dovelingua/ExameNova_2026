// ============================================================
// panel/js/screens/progresso/progresso.js
// ExameNova — Progresso & Tendências Screen v2.0
//
// CACHING STRATEGY:
//   wrongAnswers  → localStorage daily cache (key: en_wa_{uid}_{MZ-date})
//                   Fallback: module Map per-subject cache (Option A)
//                   Invalidated by: invalidateWrongAnswersCache(userId)
//                   called from simulacao-render.js after saving wrongs
//
//   Tendências    → localStorage 7-day cache (key: en_tend_{subj}_{grade})
//                   Stores computed topics only — NOT raw questions
//                   Fallback: module Map session cache
//                   Never needs manual invalidation (exam data is static)
//
// READS:
//   wrongAnswers:  1 read per day max (0 on cache hit)
//   Tendências:    1 read per subject per 7 days (0 on cache hit)
//   After simulation: 1 fresh read next Progresso visit (cache cleared)
//
// DATA SOURCES:
//   userData.examDates  — { 'Língua Portuguesa': 'YYYY-MM-DD' }
//   wrongAnswers collection (exams.getWrongAnswers)
//   exams_questions collection (exams.fetchQuestions) — Tendências only
//   getStudentSubjects(userData)
//
// MOZAMBIQUE: UTC+2. Never toISOString() for local dates.
//
// keepAlive: false | Navbar: absent | Header: back to dashboard
// ============================================================

import { router }  from '../../core/router.js';
import { ui }      from '../../core/ui.js';
import { moeda }   from '../../core/moeda.js';
import { getStudentSubjects } from '../../core/app.js';
import {
  exams,
  getWrongAnswers,
  topicFrequency,
  toDbSubject,
  toDbGrade,
  toDbInstitution,
  normaliseYear,
  getYear,
} from '../../core/exams.js';

// ============================================================
// CACHE LAYER
// ============================================================

// Module-level fallback cache (Option A) — lives for the session
const _sessionCache = {
  wrongAnswers: null,   // all wrong answers array or null
  tendencias:   {},     // { cacheKey: { topics, totalQ } }
};

// ── localStorage helpers ──────────────────────────────────────

function _lsGet(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function _lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // localStorage full or unavailable — fallback to session cache
    return false;
  }
}

function _lsDel(key) {
  try { localStorage.removeItem(key); } catch {}
}

// ── Mozambique local date ─────────────────────────────────────

function _mzToday() {
  const now = new Date();
  const mz  = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const y   = mz.getUTCFullYear();
  const m   = String(mz.getUTCMonth() + 1).padStart(2, '0');
  const d   = String(mz.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ── Cache keys ────────────────────────────────────────────────

function _waKey(userId) {
  return `en_wa_${userId}_${_mzToday()}`;
}

function _tendKey(dbSubject, dbGrade) {
  return `en_tend_${dbSubject}_${dbGrade || 'adm'}`;
}

// ── wrongAnswers cache ────────────────────────────────────────

function _waReadCache(userId) {
  // 1. Try localStorage (daily)
  const cached = _lsGet(_waKey(userId));
  if (cached && Array.isArray(cached.data)) {
    return cached.data;
  }
  // 2. Try session fallback
  if (_sessionCache.wrongAnswers !== null) {
    return _sessionCache.wrongAnswers;
  }
  return null;
}

function _waWriteCache(userId, data) {
  // Always write to session cache (always works)
  _sessionCache.wrongAnswers = data;
  // Try localStorage — silent fail
  _lsSet(_waKey(userId), { data, savedAt: _mzToday() });
}

/**
 * Call this from simulacao-render.js after saving wrong answers.
 * Clears today's localStorage cache so next Progresso visit
 * fetches fresh data reflecting the new wrong answers.
 * @param {string} userId
 */
export function invalidateWrongAnswersCache(userId) {
  _lsDel(_waKey(userId));
  _sessionCache.wrongAnswers = null;
}

// ── Tendências cache ──────────────────────────────────────────

const TEND_TTL_DAYS = 7;

function _tendReadCache(dbSubject, dbGrade) {
  const key = _tendKey(dbSubject, dbGrade);

  // 1. Try localStorage (7-day TTL)
  const cached = _lsGet(key);
  if (cached && cached.topics && cached.savedAt) {
    const savedMs  = new Date(cached.savedAt).getTime();
    const nowMs    = Date.now();
    const ageDays  = (nowMs - savedMs) / 86400000;
    if (ageDays < TEND_TTL_DAYS) {
      return { topics: cached.topics, totalQ: cached.totalQ };
    }
    // Stale — remove it
    _lsDel(key);
  }

  // 2. Try session fallback
  if (_sessionCache.tendencias[key]) {
    return _sessionCache.tendencias[key];
  }

  return null;
}

function _tendWriteCache(dbSubject, dbGrade, topics, totalQ) {
  const key  = _tendKey(dbSubject, dbGrade);
  const data = { topics, totalQ, savedAt: new Date().toISOString() };

  // Always write to session cache
  _sessionCache.tendencias[key] = { topics, totalQ };

  // Try localStorage — store computed topics only, not raw questions
  _lsSet(key, data);
}

// ============================================================
// MODULE STATE
// ============================================================

let _user        = null;
let _userData    = null;
let _subjects    = [];
let _activeTab   = 'progresso';
let _tendSubject = '';

// ============================================================
// SUBJECT ICONS
// ============================================================

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

// ============================================================
// SCREEN
// ============================================================

const ProgressoScreen = {

  css() {
    if (document.getElementById('prog-styles')) return '';
    return `<style id="prog-styles">

      .prog-wrap {
        min-height: 100dvh;
        background: var(--bg);
        padding-bottom: 48px;
      }

      /* ── PROFILE STRIP ── */
      .prog-strip {
        background: var(--surface);
        border-bottom: 1px solid var(--border);
        padding: 8px 16px;
        display: flex; align-items: center; gap: 7px;
      }
      .prog-strip i { font-size: 11px; color: var(--primary); }
      .prog-strip-text {
        font-size: 12px; font-weight: 700;
        color: var(--text-secondary);
      }

      /* ── TABS ── */
      .prog-tabs {
        display: flex;
        background: var(--surface);
        border-bottom: 2px solid var(--border);
        position: sticky; top: 0; z-index: 10;
      }
      .prog-tab {
        flex: 1; padding: 14px 8px;
        font-family: inherit;
        font-size: 14px; font-weight: 700;
        color: var(--text-muted);
        background: none; border: none;
        border-bottom: 3px solid transparent;
        margin-bottom: -2px; cursor: pointer;
        transition: color 0.2s, border-color 0.2s;
        display: flex; align-items: center;
        justify-content: center; gap: 7px;
      }
      .prog-tab.active {
        color: var(--primary);
        border-bottom-color: var(--primary);
      }

      /* ── PANELS ── */
      .prog-panel { display: none; }
      .prog-panel.active { display: block; }

      /* ── BODY PADDING ── */
      .prog-body { padding: 20px 16px 0; }

      /* ── SECTION TITLE ── */
      .prog-sec {
        font-size: 11px; font-weight: 700;
        text-transform: uppercase; letter-spacing: 0.08em;
        color: var(--text-muted);
        margin: 28px 0 10px;
        display: flex; align-items: center; gap: 6px;
      }
      .prog-sec i { font-size: 10px; color: var(--primary); }
      .prog-sec:first-child { margin-top: 0; }

      /* ── VERDICT BANNER ── */
      .prog-verdict {
        border-radius: var(--radius-lg);
        padding: 16px 18px;
        margin-bottom: 24px;
        display: flex; align-items: flex-start; gap: 13px;
        border: 1.5px solid;
      }
      .prog-verdict.great {
        background: rgba(34,197,94,0.06);
        border-color: rgba(34,197,94,0.25);
      }
      .prog-verdict.good {
        background: rgba(2,132,199,0.06);
        border-color: rgba(2,132,199,0.2);
      }
      .prog-verdict.fair {
        background: rgba(245,158,11,0.07);
        border-color: rgba(245,158,11,0.25);
      }
      .prog-verdict.low {
        background: rgba(239,68,68,0.06);
        border-color: rgba(239,68,68,0.2);
      }
      .prog-verdict.none {
        background: var(--surface);
        border-color: var(--border);
      }
      .prog-verdict-icon {
        font-size: 22px; flex-shrink: 0; margin-top: 1px;
      }
      .prog-verdict.great .prog-verdict-icon { color: #22C55E; }
      .prog-verdict.good  .prog-verdict-icon { color: var(--primary); }
      .prog-verdict.fair  .prog-verdict-icon { color: #F59E0B; }
      .prog-verdict.low   .prog-verdict-icon { color: #EF4444; }
      .prog-verdict.none  .prog-verdict-icon { color: var(--text-muted); }
      .prog-verdict-body { flex: 1; }
      .prog-verdict-title {
        font-size: 14px; font-weight: 800;
        color: var(--text); margin-bottom: 4px;
      }
      .prog-verdict-sub {
        font-size: 12px; color: var(--text-muted); line-height: 1.6;
      }

      /* ── COUNTDOWN CARD ── */
      .prog-countdown {
        background: var(--surface);
        border: 1.5px solid var(--border);
        border-radius: var(--radius-lg);
        overflow: hidden; margin-bottom: 10px;
        position: relative;
      }
      .prog-countdown::before {
        content: '';
        position: absolute;
        left: 0; top: 0; bottom: 0; width: 4px;
      }
      .prog-countdown.urgent::before  { background: #EF4444; }
      .prog-countdown.warning::before { background: #F59E0B; }
      .prog-countdown.safe::before    { background: #22C55E; }
      .prog-countdown.nodate::before  { background: var(--border); }

      .prog-countdown-inner {
        padding: 14px 16px 14px 20px;
        display: flex; align-items: center; gap: 14px;
      }
      .prog-countdown-icon {
        width: 44px; height: 44px;
        border-radius: var(--radius-md);
        display: flex; align-items: center; justify-content: center;
        font-size: 18px; flex-shrink: 0;
      }
      .prog-countdown-icon.urgent  {
        background: rgba(239,68,68,0.09); color: #EF4444;
      }
      .prog-countdown-icon.warning {
        background: rgba(245,158,11,0.09); color: #F59E0B;
      }
      .prog-countdown-icon.safe {
        background: rgba(34,197,94,0.09); color: #22C55E;
      }
      .prog-countdown-icon.nodate {
        background: var(--bg); color: var(--text-muted);
      }
      .prog-countdown-body { flex: 1; min-width: 0; }
      .prog-countdown-name {
        font-size: 14px; font-weight: 800; color: var(--text);
        margin-bottom: 3px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .prog-countdown-date {
        font-size: 12px; color: var(--text-muted); line-height: 1.4;
      }
      .prog-countdown-days {
        font-size: 13px; font-weight: 800;
        text-align: right; flex-shrink: 0; line-height: 1.2;
      }
      .prog-countdown-days.urgent  { color: #EF4444; }
      .prog-countdown-days.warning { color: #F59E0B; }
      .prog-countdown-days.safe    { color: #22C55E; }
      .prog-countdown-days.nodate  {
        color: var(--text-muted); font-size: 11px; font-weight: 600;
      }

      /* ── PREP CARD ── */
      .prog-prep {
        background: var(--surface);
        border: 1.5px solid var(--border);
        border-radius: var(--radius-lg);
        padding: 16px 18px;
        margin-bottom: 10px;
      }
      .prog-prep-top {
        display: flex; align-items: center;
        justify-content: space-between; margin-bottom: 12px; gap: 10px;
      }
      .prog-prep-subject {
        font-size: 14px; font-weight: 800; color: var(--text);
        display: flex; align-items: center; gap: 8px;
      }
      .prog-prep-subject i { font-size: 13px; color: var(--primary); }
      .prog-prep-pct {
        font-size: 13px; font-weight: 800; color: var(--primary);
        flex-shrink: 0;
      }
      .prog-prep-track {
        height: 7px; background: var(--bg);
        border-radius: 99px; overflow: hidden;
        border: 1px solid var(--border); margin-bottom: 10px;
      }
      .prog-prep-fill {
        height: 100%; border-radius: 99px;
        transition: width 0.7s ease;
      }
      .prog-prep-fill.great { background: #22C55E; }
      .prog-prep-fill.good  { background: var(--primary); }
      .prog-prep-fill.fair  { background: #F59E0B; }
      .prog-prep-fill.low   { background: #EF4444; }
      .prog-prep-fill.none  { background: var(--border); width: 0 !important; }

      .prog-prep-verdict {
        font-size: 12px; color: var(--text-muted);
        line-height: 1.6; margin-bottom: 10px;
      }
      .prog-prep-verdict strong { color: var(--text-secondary); }

      .prog-prep-stats {
        display: flex; gap: 6px;
      }
      .prog-prep-stat {
        flex: 1; text-align: center;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        padding: 9px 6px;
      }
      .prog-prep-stat-val {
        font-size: 19px; font-weight: 900;
        line-height: 1; margin-bottom: 3px;
      }
      .prog-prep-stat-val.w { color: #EF4444; }
      .prog-prep-stat-val.r { color: #22C55E; }
      .prog-prep-stat-val.t { color: var(--primary); }
      .prog-prep-stat-lbl {
        font-size: 9px; font-weight: 700;
        text-transform: uppercase; letter-spacing: 0.06em;
        color: var(--text-muted);
      }
      .prog-prep-weak {
        margin-top: 10px; padding: 8px 12px;
        background: var(--bg); border: 1px solid var(--border);
        border-radius: var(--radius-md);
        font-size: 11px; color: var(--text-muted);
        line-height: 1.6;
      }
      .prog-prep-weak i { color: #F59E0B; margin-right: 5px; }
      .prog-prep-weak strong { color: var(--text-secondary); }

      /* ── WEAK TOPICS LIST ── */
      .prog-weak-card {
        background: var(--surface);
        border: 1.5px solid var(--border);
        border-radius: var(--radius-lg);
        overflow: hidden; margin-bottom: 0;
      }
      .prog-weak-row {
        display: flex; align-items: center;
        padding: 12px 16px; gap: 12px;
        border-bottom: 1px solid var(--border);
      }
      .prog-weak-row:last-child { border-bottom: none; }
      .prog-weak-dot {
        width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
      }
      .prog-weak-dot.high   { background: #EF4444; }
      .prog-weak-dot.medium { background: #F59E0B; }
      .prog-weak-dot.low    { background: var(--primary); }
      .prog-weak-info { flex: 1; min-width: 0; }
      .prog-weak-name {
        font-size: 13px; font-weight: 700; color: var(--text);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .prog-weak-subject {
        font-size: 10px; color: var(--text-muted); margin-top: 1px;
      }
      .prog-weak-count {
        font-size: 12px; font-weight: 800;
        color: #EF4444; flex-shrink: 0;
      }

      /* ── INFO NOTE ── */
      .prog-note {
        display: flex; align-items: flex-start; gap: 8px;
        padding: 10px 14px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        font-size: 12px; color: var(--text-muted);
        line-height: 1.6; margin-top: 8px;
      }
      .prog-note i { font-size: 12px; flex-shrink: 0; margin-top: 1px; }
      .prog-note strong { color: var(--text-secondary); }
      .prog-note a {
        color: var(--primary); font-weight: 700;
        text-decoration: none; cursor: pointer;
      }

      /* ── SKELETON ── */
      .prog-skeleton {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        height: 88px; margin-bottom: 10px;
        overflow: hidden; position: relative;
      }
      .prog-skeleton::after {
        content: ''; position: absolute; inset: 0;
        background: linear-gradient(90deg,
          transparent 0%,rgba(255,255,255,0.06) 50%,transparent 100%);
        animation: progShimmer 1.4s infinite;
      }
      [data-theme="dark"] .prog-skeleton::after {
        background: linear-gradient(90deg,
          transparent 0%,rgba(255,255,255,0.04) 50%,transparent 100%);
      }

      /* ── EMPTY ── */
      .prog-empty {
        padding: 48px 24px;
        display: flex; flex-direction: column;
        align-items: center; gap: 12px; text-align: center;
      }
      .prog-empty-icon {
        width: 64px; height: 64px; border-radius: 50%;
        background: var(--primary-light);
        display: flex; align-items: center; justify-content: center;
        font-size: 26px; color: var(--primary); margin-bottom: 4px;
      }
      .prog-empty-title {
        font-size: 16px; font-weight: 800; color: var(--text);
      }
      .prog-empty-sub {
        font-size: 13px; color: var(--text-muted);
        line-height: 1.6; max-width: 280px;
      }
      .prog-empty-btn {
        margin-top: 4px; padding: 12px 24px;
        background: var(--primary); color: #fff;
        border: none; border-radius: var(--radius-md);
        font-family: inherit; font-size: 14px; font-weight: 700;
        cursor: pointer; display: flex; align-items: center; gap: 8px;
        transition: opacity 0.2s;
      }
      .prog-empty-btn:hover { opacity: 0.9; }

      /* ── TENDÊNCIAS ── */
      .prog-tend-pills {
        display: flex; gap: 8px;
        padding: 16px 16px 4px;
        overflow-x: auto; scrollbar-width: none;
        -webkit-overflow-scrolling: touch;
        scroll-snap-type: x mandatory;
      }
      .prog-tend-pills::-webkit-scrollbar { display: none; }

      .prog-subj-pill {
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
      .prog-subj-pill i { font-size: 12px; }
      .prog-subj-pill:active { transform: scale(0.95); }
      .prog-subj-pill.active {
        border-color: var(--primary);
        background: var(--primary-light);
        color: var(--primary);
      }

      .prog-tend-body { padding: 16px 16px 0; }

      /* loading */
      .prog-tend-loading {
        padding: 48px 24px;
        display: flex; flex-direction: column;
        align-items: center; gap: 12px; text-align: center;
      }
      .prog-tend-spin {
        width: 28px; height: 28px;
        border: 3px solid var(--border);
        border-top-color: var(--primary); border-radius: 50%;
        animation: progSpin 0.7s linear infinite;
      }
      .prog-tend-loading-txt {
        font-size: 13px; font-weight: 600; color: var(--text-muted);
      }

      /* choose prompt */
      .prog-tend-choose {
        padding: 48px 24px;
        display: flex; flex-direction: column;
        align-items: center; gap: 10px; text-align: center;
      }
      .prog-tend-choose i {
        font-size: 40px; color: var(--primary); opacity: 0.3;
        margin-bottom: 8px;
      }
      .prog-tend-choose-text {
        font-size: 14px; font-weight: 600;
        color: var(--text-muted); line-height: 1.6;
      }

      /* legend */
      .prog-legend {
        display: flex; flex-wrap: wrap; gap: 10px;
        margin-bottom: 16px;
      }
      .prog-legend-item {
        display: flex; align-items: center; gap: 6px;
        font-size: 11px; font-weight: 600; color: var(--text-muted);
      }
      .prog-legend-dot {
        width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
      }

      /* summary line */
      .prog-tend-summary {
        font-size: 12px; color: var(--text-muted);
        margin-bottom: 16px; line-height: 1.6;
        padding: 10px 14px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
      }
      .prog-tend-summary strong { color: var(--text-secondary); }
      .prog-tend-summary i { color: var(--primary); margin-right: 5px; }

      /* topic card */
      .prog-topic {
        background: var(--surface);
        border: 1.5px solid var(--border);
        border-radius: var(--radius-lg);
        overflow: hidden; margin-bottom: 10px;
        position: relative;
      }
      .prog-topic::before {
        content: '';
        position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
      }
      .prog-topic.critical::before { background: #EF4444; }
      .prog-topic.frequent::before { background: #F59E0B; }
      .prog-topic.normal::before   { background: var(--primary); }

      .prog-topic-inner { padding: 14px 16px 14px 20px; }
      .prog-topic-top {
        display: flex; align-items: flex-start;
        justify-content: space-between; gap: 10px; margin-bottom: 7px;
      }
      .prog-topic-name {
        font-size: 14px; font-weight: 800;
        color: var(--text); line-height: 1.3; flex: 1;
      }
      .prog-topic-badges {
        display: flex; flex-direction: column;
        align-items: flex-end; gap: 4px; flex-shrink: 0;
      }
      .prog-topic-count {
        font-size: 11px; font-weight: 700;
        border-radius: var(--radius-full); padding: 3px 10px;
        white-space: nowrap;
      }
      .prog-topic-count.critical {
        background: rgba(239,68,68,0.1); color: #EF4444;
        border: 1px solid rgba(239,68,68,0.25);
      }
      .prog-topic-count.frequent {
        background: rgba(245,158,11,0.1); color: #F59E0B;
        border: 1px solid rgba(245,158,11,0.25);
      }
      .prog-topic-count.normal {
        background: var(--primary-light); color: var(--primary);
        border: 1px solid rgba(2,132,199,0.2);
      }
      .prog-topic-weak {
        font-size: 10px; font-weight: 700; color: #EF4444;
        background: rgba(239,68,68,0.08);
        border: 1px solid rgba(239,68,68,0.2);
        border-radius: var(--radius-full); padding: 2px 8px;
        display: flex; align-items: center; gap: 4px;
      }
      .prog-topic-weak i { font-size: 9px; }
      .prog-topic-years {
        font-size: 11px; color: var(--text-muted);
        margin-bottom: 8px; line-height: 1.5;
      }
      .prog-topic-years strong { color: var(--text-secondary); }
      .prog-topic-advice {
        font-size: 12px; color: var(--text-muted);
        line-height: 1.55; padding: 8px 12px;
        background: var(--bg);
        border-radius: var(--radius-md);
        border: 1px solid var(--border);
      }
      .prog-topic-advice.critical {
        background: rgba(239,68,68,0.05);
        border-color: rgba(239,68,68,0.15);
        color: #991B1B;
      }
      [data-theme="dark"] .prog-topic-advice.critical { color: #FCA5A5; }

      /* ── DARK ── */
      [data-theme="dark"] .prog-countdown,
      [data-theme="dark"] .prog-prep,
      [data-theme="dark"] .prog-weak-card,
      [data-theme="dark"] .prog-topic,
      [data-theme="dark"] .prog-note,
      [data-theme="dark"] .prog-tend-summary { background: var(--bg-card); }

      /* ── RESPONSIVE ── */
      @media (min-width: 768px) {
        .prog-body       { padding: 24px 24px 0; }
        .prog-tend-pills { padding: 16px 24px 4px; }
        .prog-tend-body  { padding: 20px 24px 0; }
      }
      @media (min-width: 1025px) {
        .prog-wrap { max-width: 760px; margin: 0 auto; }
      }

      @keyframes progShimmer {
        from { transform: translateX(-100%); }
        to   { transform: translateX(100%); }
      }
      @keyframes progSpin { to { transform: rotate(360deg); } }

    </style>`;
  },

  mount() {
    return `
      <div class="prog-wrap">

        <div id="header-mount"></div>

        <div class="prog-strip">
          <i class="fa-solid fa-chart-line" aria-hidden="true"></i>
          <span class="prog-strip-text notranslate" translate="no"
            id="prog-strip-text"></span>
        </div>

        <div class="prog-tabs">
          <button class="prog-tab active notranslate"
            id="prog-tab-prog" translate="no">
            <i class="fa-solid fa-gauge-high" aria-hidden="true"></i>
            Progresso
          </button>
          <button class="prog-tab notranslate"
            id="prog-tab-tend" translate="no">
            <i class="fa-solid fa-arrow-trend-up" aria-hidden="true"></i>
            Tendências
          </button>
        </div>

        <!-- PROGRESSO PANEL -->
        <div class="prog-panel active" id="prog-panel-prog">
          <div class="prog-body" id="prog-prog-body">
            ${_skelHtml(3)}
          </div>
        </div>

        <!-- TENDÊNCIAS PANEL -->
        <div class="prog-panel" id="prog-panel-tend">
          <div class="prog-tend-pills" id="prog-tend-pills"></div>
          <div class="prog-tend-body" id="prog-tend-body">
            <div class="prog-tend-choose">
              <i class="fa-solid fa-magnifying-glass-chart"
                aria-hidden="true"></i>
              <div class="prog-tend-choose-text notranslate" translate="no">
                Seleccione uma disciplina acima<br>
                para ver as tendências dos exames anteriores.
              </div>
            </div>
          </div>
        </div>

      </div>
    `;
  },

  async init(user, userData, params) {
    _user        = user;
    _userData    = userData;
    _subjects    = getStudentSubjects(userData);
    _activeTab   = 'progresso';
    _tendSubject = '';

    ui.renderHeader({
      title:          'Progresso',
      backRoute:      '/panel/dashboard',
      showDarkToggle: true,
      moedasBalance:  moeda.getBalance(userData),
    });

    const strip = document.getElementById('prog-strip-text');
    if (strip) strip.textContent = _profileText();

    document.getElementById('prog-tab-prog')
      ?.addEventListener('click', () => _switchTab('progresso'));
    document.getElementById('prog-tab-tend')
      ?.addEventListener('click', () => _switchTab('tendencias'));

    _buildTendPills();
    _loadProgresso();
  },

  destroy() {
    // Session cache stays alive — intentional
    // It is cleared per-field only when needed
  },
};

// ============================================================
// HELPERS
// ============================================================

function _profileText() {
  const t = _userData?.examType;
  const g = _userData?.grade;
  const r = _userData?.repeating;
  if (t === 'ensino-geral') {
    const grade = g === '9' ? '9ª Classe' : '12ª Classe';
    const mode  = r ? 'Repetente' : 'Normal';
    return `${grade} · ${mode}`;
  }
  if (t === 'admissao') {
    const inst   = _userData?.institution || '';
    const course = _userData?.course      || '';
    return `Admissão · ${(inst || course || '').toUpperCase()}`;
  }
  return '';
}

function _esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function _skelHtml(n) {
  return Array(n).fill('<div class="prog-skeleton"></div>').join('');
}



function _daysUntil(dateStr) {
  if (!dateStr) return null;
  const todayMs  = new Date(_mzToday()).getTime();
  const targetMs = new Date(dateStr).getTime();
  return Math.round((targetMs - todayMs) / 86400000);
}

function _urgencyCls(days) {
  if (days === null) return 'nodate';
  if (days <= 7)     return 'urgent';
  if (days <= 30)    return 'warning';
  return 'safe';
}

function _urgencyIcon(days) {
  if (days === null) return 'fa-calendar-plus';
  if (days <= 0)     return 'fa-triangle-exclamation';
  if (days <= 7)     return 'fa-fire';
  if (days <= 30)    return 'fa-clock';
  return 'fa-circle-check';
}

function _daysLabel(days) {
  if (days === null) return 'Sem data';
  if (days < 0)      return 'Passou';
  if (days === 0)    return 'HOJE!';
  if (days === 1)    return 'AMANHÃ!';
  return `${days} dias`;
}

function _dateLabel(days, dateStr) {
  if (!dateStr)     return 'Defina a data no Perfil.';
  if (days < 0)     return 'O exame já decorreu.';
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-PT', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

// ============================================================
// TAB SWITCHING
// ============================================================

function _switchTab(tab) {
  _activeTab = tab;
  const isProg = tab === 'progresso';
  document.getElementById('prog-tab-prog')
    ?.classList.toggle('active', isProg);
  document.getElementById('prog-tab-tend')
    ?.classList.toggle('active', !isProg);
  document.getElementById('prog-panel-prog')
    ?.classList.toggle('active', isProg);
  document.getElementById('prog-panel-tend')
    ?.classList.toggle('active', !isProg);
}

// ============================================================
// PROGRESSO — LOAD
// ============================================================

async function _loadProgresso() {
  const body = document.getElementById('prog-prog-body');
  if (!body) return;

  try {
    // Try cache first
    let wrongAnswers = _waReadCache(_user.uid);

    if (!wrongAnswers) {
      // Cache miss — fetch from Firestore
      wrongAnswers = await getWrongAnswers(_user.uid, {}, false);
      _waWriteCache(_user.uid, wrongAnswers);
    }

    _renderProgresso(wrongAnswers);

  } catch (e) {
    console.error('[Progresso] load:', e);
    body.innerHTML = `
      <div class="prog-empty">
        <div class="prog-empty-icon">
          <i class="fa-solid fa-circle-exclamation"></i>
        </div>
        <div class="prog-empty-title notranslate" translate="no">
          Erro ao carregar
        </div>
        <div class="prog-empty-sub notranslate" translate="no">
          Verifique a ligação e tente novamente.
        </div>
      </div>`;
  }
}

// ============================================================
// PROGRESSO — RENDER
// ============================================================

function _renderProgresso(wrongAnswers) {
  const body = document.getElementById('prog-prog-body');
  if (!body) return;

  const examDates   = _userData?.examDates || {};
  const totalWrong  = wrongAnswers.length;
  const totalRetried = wrongAnswers.filter(r => r.retried).length;

  // ── Per-subject stats ────────────────────────────────────
  const subStats = {};
  for (const s of _subjects) {
    const dbS     = toDbSubject(s);
    const recs    = wrongAnswers.filter(r => r.subject === dbS);
    const total   = recs.length;
    const retried = recs.filter(r => r.retried).length;

    // Weak topics: unresolved wrongs grouped by topic
    const topicMap = {};
    for (const r of recs) {
      if (!r.retried && r.topic) {
        topicMap[r.topic] = (topicMap[r.topic] || 0) + 1;
      }
    }
    const weakTopics = Object.entries(topicMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([topic, count]) => ({ topic, count }));

    // Prep score
    let score = 0;
    let grade = 'none';
    if (total > 0) {
      score = Math.round((retried / total) * 100);
      grade = score >= 80 ? 'great'
            : score >= 60 ? 'good'
            : score >= 30 ? 'fair'
            : 'low';
    }

    subStats[s] = {
      total, retried, weakTopics, score, grade,
      dateStr: examDates[s] || null,
    };
  }

  // ── All weak topics across subjects ─────────────────────
  const weakMap = {};
  for (const r of wrongAnswers) {
    if (!r.retried && r.topic) {
      const key = `${r.subject}||${r.topic}`;
      if (!weakMap[key]) {
        weakMap[key] = { topic: r.topic, subject: r.subject, count: 0 };
      }
      weakMap[key].count++;
    }
  }
  const allWeak = Object.values(weakMap)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // ── Overall verdict ──────────────────────────────────────
  let minDays = null;
  for (const s of _subjects) {
    if (examDates[s]) {
      const d = _daysUntil(examDates[s]);
      if (minDays === null || d < minDays) minDays = d;
    }
  }
  const verdict = _calcVerdict(totalWrong, totalRetried, minDays);

  // ── Build HTML ───────────────────────────────────────────
  let html = '';

  // Verdict banner
  html += `
    <div class="prog-verdict ${verdict.cls}">
      <i class="fa-solid ${verdict.icon} prog-verdict-icon"
        aria-hidden="true"></i>
      <div class="prog-verdict-body">
        <div class="prog-verdict-title notranslate" translate="no">
          ${_esc(verdict.title)}
        </div>
        <div class="prog-verdict-sub notranslate" translate="no">
          ${_esc(verdict.sub)}
        </div>
      </div>
    </div>
  `;

  // Exam countdowns
  html += `
    <div class="prog-sec notranslate" translate="no">
      <i class="fa-solid fa-calendar-days" aria-hidden="true"></i>
      Os Seus Exames
    </div>
  `;

  const sortedSubjects = [..._subjects].sort((a, b) => {
    const da = examDates[a] ? _daysUntil(examDates[a]) : 9999;
    const db = examDates[b] ? _daysUntil(examDates[b]) : 9999;
    return da - db;
  });

  for (const s of sortedSubjects) {
    const dateStr = examDates[s] || null;
    const days    = _daysUntil(dateStr);
    const cls     = _urgencyCls(days);
    html += `
      <div class="prog-countdown ${cls}">
        <div class="prog-countdown-inner">
          <div class="prog-countdown-icon ${cls}">
            <i class="fa-solid ${_urgencyIcon(days)}"
              aria-hidden="true"></i>
          </div>
          <div class="prog-countdown-body">
            <div class="prog-countdown-name notranslate" translate="no">
              ${_esc(s)}
            </div>
            <div class="prog-countdown-date notranslate" translate="no">
              ${_esc(_dateLabel(days, dateStr))}
            </div>
          </div>
          <div class="prog-countdown-days ${cls} notranslate" translate="no">
            ${_esc(_daysLabel(days))}
          </div>
        </div>
      </div>
    `;
  }

  // Missing dates note
  const missing = _subjects.filter(s => !examDates[s]);
  if (missing.length) {
    html += `
      <div class="prog-note">
        <i class="fa-solid fa-circle-info"
          style="color:var(--primary);" aria-hidden="true"></i>
        <span class="notranslate" translate="no">
          ${missing.length === 1
            ? `<strong>${_esc(missing[0])}</strong> ainda não tem data de exame definida.`
            : `<strong>${missing.length} disciplinas</strong> ainda não têm data de exame definida.`}
          <a id="prog-go-perfil"> Definir no Perfil</a>
        </span>
      </div>
    `;
  }

  // Preparedness per subject
  html += `
    <div class="prog-sec notranslate" translate="no" style="margin-top:28px;">
      <i class="fa-solid fa-gauge-high" aria-hidden="true"></i>
      Nível de Preparação por Disciplina
    </div>
  `;

  if (totalWrong === 0) {
    html += `
      <div class="prog-note" style="margin-bottom:0;">
        <i class="fa-solid fa-circle-info"
          style="color:var(--primary);" aria-hidden="true"></i>
        <span class="notranslate" translate="no">
          Ainda não fez nenhuma simulação. O nível de preparação é calculado
          com base nas simulações concluídas. Faça a primeira simulação
          para ver a sua análise aqui.
        </span>
      </div>
    `;
  } else {
    for (const s of _subjects) {
      html += _prepCardHtml(s, subStats[s], examDates[s]);
    }
  }

  // Weak topics across all subjects
  if (allWeak.length) {
    html += `
      <div class="prog-sec notranslate" translate="no" style="margin-top:28px;">
        <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
        Temas Mais Fracos
      </div>
      <div class="prog-weak-card">
    `;
    for (const w of allWeak) {
      const dotCls = w.count >= 5 ? 'high' : w.count >= 3 ? 'medium' : 'low';
      const displaySubj = _subjects.find(
        s => toDbSubject(s) === w.subject
      ) || w.subject;
      html += `
        <div class="prog-weak-row">
          <div class="prog-weak-dot ${dotCls}"></div>
          <div class="prog-weak-info">
            <div class="prog-weak-name notranslate" translate="no">
              ${_esc(w.topic)}
            </div>
            <div class="prog-weak-subject notranslate" translate="no">
              ${_esc(displaySubj)}
            </div>
          </div>
          <div class="prog-weak-count notranslate" translate="no">
            ${w.count} erro${w.count !== 1 ? 's' : ''}
          </div>
        </div>
      `;
    }
    html += `</div>`;

    html += `
      <div class="prog-note" style="margin-top:8px;">
        <i class="fa-solid fa-lightbulb"
          style="color:#F59E0B;" aria-hidden="true"></i>
        <span class="notranslate" translate="no">
          Estes são os temas onde errou mais questões ainda não resolvidas.
          Veja a tab <strong>Tendências</strong> para saber quais aparecem
          mais frequentemente nos exames nacionais.
        </span>
      </div>
    `;
  }

  body.innerHTML = html;

  document.getElementById('prog-go-perfil')
    ?.addEventListener('click', () => router.navigate('/panel/perfil'));
}

// ── Verdict calculation ───────────────────────────────────────

function _calcVerdict(totalWrong, totalRetried, minDays) {
  if (totalWrong === 0) {
    return {
      cls:   'none',
      icon:  'fa-play-circle',
      title: 'Pronto para Começar',
      sub:   'Ainda não fez simulações. Comece agora para ver a sua análise de preparação.',
    };
  }
  const rate     = totalRetried / totalWrong;
  const isUrgent = minDays !== null && minDays <= 14;

  if (rate >= 0.8) {
    return {
      cls:   'great', icon: 'fa-medal',
      title: 'Excelente Preparação!',
      sub:   'Resolveu a maioria dos seus erros. Vai para o exame confiante.',
    };
  }
  if (rate >= 0.5) {
    return {
      cls:   'good', icon: 'fa-thumbs-up',
      title: 'No Bom Caminho',
      sub:   isUrgent
        ? 'O exame está próximo. Foque-se em resolver os erros que ainda faltam.'
        : 'Está a progredir. Continue a fazer simulações e a rever os erros.',
    };
  }
  if (isUrgent) {
    return {
      cls:   'low', icon: 'fa-fire',
      title: 'O Exame Está Próximo — Prepare-se!',
      sub:   `Faltam ${minDays <= 0 ? 'muito poucos' : minDays} dias. Ainda tem muitos erros por resolver. Reveja urgentemente.`,
    };
  }
  return {
    cls:   'fair', icon: 'fa-triangle-exclamation',
    title: 'Precisa de Mais Preparação',
    sub:   'Tem erros por resolver. Faça mais simulações e use a Revisão de Erros diariamente.',
  };
}

// ── Prep card ─────────────────────────────────────────────────

function _prepCardHtml(subject, st, dateStr) {
  const { total, retried, weakTopics, score, grade } = st;
  const days    = _daysUntil(dateStr);
  const urgency = _urgencyCls(days);

  let verdictText = '';
  if (total === 0) {
    verdictText = 'Ainda não fez simulações desta disciplina.';
  } else if (grade === 'great') {
    verdictText = `Resolveu ${retried} de ${total} erros. Boa preparação!`;
  } else if (grade === 'good') {
    verdictText = `Resolveu ${retried} de ${total} erros. Continue a rever.`;
  } else if (grade === 'fair') {
    verdictText = `Ainda tem <strong>${total - retried}</strong> erros por resolver. Dedique mais tempo a esta disciplina.`;
  } else {
    verdictText = urgency === 'urgent'
      ? `⚠️ O exame está próximo e ainda tem <strong>${total - retried}</strong> erros por resolver!`
      : `Tem <strong>${total - retried}</strong> erros por resolver. Precisa de intensificar o estudo.`;
  }

  return `
    <div class="prog-prep">
      <div class="prog-prep-top">
        <div class="prog-prep-subject notranslate" translate="no">
          <i class="fa-solid ${_icon(subject)}" aria-hidden="true"></i>
          ${_esc(subject)}
        </div>
        <div class="prog-prep-pct notranslate" translate="no">
          ${total === 0 ? '—' : score + '%'}
        </div>
      </div>
      <div class="prog-prep-track">
        <div class="prog-prep-fill ${total === 0 ? 'none' : grade}"
          style="width:${total === 0 ? 0 : score}%"></div>
      </div>
      <div class="prog-prep-verdict notranslate" translate="no">
        ${verdictText}
      </div>
      ${total > 0 ? `
        <div class="prog-prep-stats">
          <div class="prog-prep-stat">
            <div class="prog-prep-stat-val w notranslate" translate="no">
              ${total - retried}
            </div>
            <div class="prog-prep-stat-lbl notranslate" translate="no">
              Por resolver
            </div>
          </div>
          <div class="prog-prep-stat">
            <div class="prog-prep-stat-val r notranslate" translate="no">
              ${retried}
            </div>
            <div class="prog-prep-stat-lbl notranslate" translate="no">
              Resolvidos
            </div>
          </div>
          <div class="prog-prep-stat">
            <div class="prog-prep-stat-val t notranslate" translate="no">
              ${total}
            </div>
            <div class="prog-prep-stat-lbl notranslate" translate="no">
              Total Erros
            </div>
          </div>
        </div>
        ${weakTopics.length ? `
          <div class="prog-prep-weak notranslate" translate="no">
            <i class="fa-solid fa-triangle-exclamation"
              aria-hidden="true"></i>
            Temas fracos: <strong>${weakTopics.map(w => _esc(w.topic)).join(', ')}</strong>
          </div>
        ` : ''}
      ` : ''}
    </div>
  `;
}

// ============================================================
// TENDÊNCIAS — PILLS
// ============================================================

function _buildTendPills() {
  const wrap = document.getElementById('prog-tend-pills');
  if (!wrap || !_subjects.length) return;

  wrap.innerHTML = _subjects.map(s => `
    <button class="prog-subj-pill notranslate" translate="no"
      data-subject="${_esc(s)}">
      <i class="fa-solid ${_icon(s)}" aria-hidden="true"></i>
      ${_esc(s)}
    </button>
  `).join('');

  wrap.querySelectorAll('.prog-subj-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = btn.dataset.subject;
      if (s === _tendSubject) return;
      _tendSubject = s;
      wrap.querySelectorAll('.prog-subj-pill')
        .forEach(b => b.classList.toggle('active', b.dataset.subject === s));
      _loadTendencias(s);
    });
  });
}

// ============================================================
// TENDÊNCIAS — LOAD
// ============================================================

async function _loadTendencias(subject) {
  const body = document.getElementById('prog-tend-body');
  if (!body) return;

  body.innerHTML = `
    <div class="prog-tend-loading">
      <div class="prog-tend-spin"></div>
      <div class="prog-tend-loading-txt notranslate" translate="no">
        A analisar os exames anteriores…
      </div>
    </div>
  `;

  const dbSubject = toDbSubject(subject);
  const dbGrade   = _userData?.grade ? toDbGrade(_userData.grade) : null;
  const isAdm     = _userData?.examType === 'admissao';

  // Try cache first
  const cached = _tendReadCache(dbSubject, dbGrade);
  if (cached) {
    if (_tendSubject !== subject) return;
    _renderTendencias(subject, cached);
    return;
  }

  try {
    const filters = { disciplina: dbSubject };
    if (!isAdm) {
      filters.tipo_exame = 'Ensino Geral';
      if (dbGrade) filters.classe = dbGrade;
    } else {
      filters.tipo_exame = 'Admissão';
      if (_userData?.institution) {
        filters.instituicao = toDbInstitution(_userData.institution);
      }
    }

    const allQ = await exams.fetchQuestions(filters);

    if (_tendSubject !== subject) return;

    // Compute topics with years — store only this, not raw questions
    const freq   = topicFrequency(allQ);
    const topics = freq.map(f => {
      const years = [...new Set(
        f.questions.map(q => getYear(q)).filter(Boolean)
      )].sort((a, b) => Number(b) - Number(a));
      return { topic: f.topic, count: f.count, years };
    });

    const totalQ = allQ.length;

    // Write to cache (computed topics only — saves localStorage space)
    _tendWriteCache(dbSubject, dbGrade, topics, totalQ);

    _renderTendencias(subject, { topics, totalQ });

  } catch (e) {
    console.error('[Progresso] tendencias:', e);
    if (_tendSubject !== subject) return;
    body.innerHTML = `
      <div class="prog-empty">
        <div class="prog-empty-icon">
          <i class="fa-solid fa-circle-exclamation"></i>
        </div>
        <div class="prog-empty-title notranslate" translate="no">
          Erro ao carregar
        </div>
        <div class="prog-empty-sub notranslate" translate="no">
          Verifique a ligação e tente novamente.
        </div>
      </div>
    `;
  }
}

// ============================================================
// TENDÊNCIAS — RENDER
// ============================================================

function _renderTendencias(subject, { topics, totalQ }) {
  const body = document.getElementById('prog-tend-body');
  if (!body) return;

  if (!topics.length) {
    body.innerHTML = `
      <div class="prog-empty">
        <div class="prog-empty-icon">
          <i class="fa-solid fa-magnifying-glass"></i>
        </div>
        <div class="prog-empty-title notranslate" translate="no">
          Sem dados disponíveis
        </div>
        <div class="prog-empty-sub notranslate" translate="no">
          Ainda não há perguntas com temas definidos
          para esta disciplina.
        </div>
      </div>
    `;
    return;
  }

  // Cross-reference with wrongAnswers cache for weak topic flagging
  const waCache   = _waReadCache(_user.uid) || [];
  const dbSubject = toDbSubject(subject);
  const weakSet   = new Set(
    waCache
      .filter(r => r.subject === dbSubject && !r.retried && r.topic)
      .map(r => r.topic)
  );

  // Classify
  const maxCount      = topics[0]?.count || 1;
  const highThreshold = Math.max(3, Math.round(maxCount * 0.6));
  const medThreshold  = Math.max(2, Math.round(maxCount * 0.3));

  let html = '';

  // Summary
  html += `
    <div class="prog-tend-summary notranslate" translate="no">
      <i class="fa-solid fa-database" aria-hidden="true"></i>
      Analisados <strong>${totalQ}</strong> questões de exames anteriores
      de <strong>${_esc(subject)}</strong>.
      ${topics.length} tema${topics.length !== 1 ? 's' : ''} identificado${topics.length !== 1 ? 's' : ''}.
    </div>
  `;

  // Legend
  html += `
    <div class="prog-legend">
      <div class="prog-legend-item">
        <div class="prog-legend-dot" style="background:#EF4444;"></div>
        <span class="notranslate" translate="no">Crítico — frequente + área fraca</span>
      </div>
      <div class="prog-legend-item">
        <div class="prog-legend-dot" style="background:#F59E0B;"></div>
        <span class="notranslate" translate="no">Frequente nos exames</span>
      </div>
      <div class="prog-legend-item">
        <div class="prog-legend-dot" style="background:var(--primary);"></div>
        <span class="notranslate" translate="no">Aparece ocasionalmente</span>
      </div>
    </div>
  `;

  for (const t of topics) {
    const isWeak     = weakSet.has(t.topic);
    const isFrequent = t.count >= highThreshold;
    const isMedium   = t.count >= medThreshold;
    const isCritical = isFrequent && isWeak;

    const cls = isCritical ? 'critical' : isFrequent ? 'frequent' : 'normal';

    const countLabel = t.count === 1 ? '1 questão' : `${t.count} questões`;

    const yearsLabel = t.years.length
      ? `Apareceu nos exames de: <strong>${t.years.join(', ')}</strong>`
      : 'Ano não especificado';

    const advice = isCritical
      ? `Este tema é frequente nos exames <strong>e</strong> ainda tem erros por resolver. <strong>Prioridade máxima.</strong>`
      : isFrequent
      ? `Este tema aparece com muita frequência nos exames anteriores. Estude com atenção.`
      : isMedium
      ? `Este tema aparece com alguma frequência. Vale a pena rever.`
      : `Este tema aparece ocasionalmente. Não ignore — pode surgir no exame.`;

    html += `
      <div class="prog-topic ${cls}">
        <div class="prog-topic-inner">
          <div class="prog-topic-top">
            <div class="prog-topic-name notranslate" translate="no">
              ${_esc(t.topic)}
            </div>
            <div class="prog-topic-badges">
              <span class="prog-topic-count ${cls} notranslate" translate="no">
                ${_esc(countLabel)}
              </span>
              ${isWeak ? `
                <span class="prog-topic-weak notranslate" translate="no">
                  <i class="fa-solid fa-triangle-exclamation"
                    aria-hidden="true"></i>
                  Área fraca
                </span>
              ` : ''}
            </div>
          </div>
          <div class="prog-topic-years notranslate" translate="no">
            ${yearsLabel}
          </div>
          <div class="prog-topic-advice ${isCritical ? 'critical' : ''} notranslate"
            translate="no">
            ${advice}
          </div>
        </div>
      </div>
    `;
  }

  body.innerHTML = html;
}

// ============================================================
// EXPORT
// ============================================================

export default ProgressoScreen;
