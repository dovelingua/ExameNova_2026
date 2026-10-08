// ============================================================
// panel/js/screens/progresso/progresso.js
// ExameNova — Progresso & Tendências Screen v1.0
//
// TWO TABS:
//   Tab 1 — Progresso: how prepared is the student?
//     - Exam countdown per subject (from userData.examDates)
//     - Wrong answer analysis per subject
//     - Weak topics (topics with most wrong answers)
//     - Urgency: motivate student to prepare
//
//   Tab 2 — Tendências: what topics should they focus on?
//     - Student selects a subject
//     - Fetches ALL questions for that subject from exam DB
//     - topicFrequency() ranks topics by how often they appear
//     - Shows which years each topic appeared in
//     - Cross-references with student's weak topics (wrongAnswers)
//     - Flags critical topics: frequent in exams + student is weak
//
// DATA SOURCES:
//   - userData.examDates  — { 'Língua Portuguesa': 'YYYY-MM-DD' }
//   - wrongAnswers collection (via exams.getWrongAnswers)
//   - exams_questions collection (via exams.fetchQuestions)
//   - getStudentSubjects(userData) — profile subjects
//
// NO progress collection exists — all analysis from wrongAnswers
//
// MOZAMBIQUE: UTC+2. Never use toISOString() for local dates.
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

// ── Module state ──────────────────────────────────────────────
let _user        = null;
let _userData    = null;
let _subjects    = [];
let _activeTab   = 'progresso';
let _wrongCache  = null;  // all wrong answers, loaded once
let _tendSubject = '';    // selected subject in Tendências tab
let _tendCache   = {};    // { subjectName: { topics, allQ } }

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

      /* ── SECTION TITLE ── */
      .prog-sec {
        font-size: 11px; font-weight: 700;
        text-transform: uppercase; letter-spacing: 0.08em;
        color: var(--text-muted);
        margin: 24px 0 10px;
        display: flex; align-items: center; gap: 6px;
      }
      .prog-sec i { font-size: 10px; color: var(--primary); }
      .prog-sec:first-child { margin-top: 0; }

      /* ── CARDS ── */
      .prog-card {
        background: var(--surface);
        border: 1.5px solid var(--border);
        border-radius: var(--radius-lg);
        overflow: hidden;
        margin-bottom: 10px;
      }

      /* ── SUBJECT COUNTDOWN CARD ── */
      .prog-countdown-card {
        background: var(--surface);
        border: 1.5px solid var(--border);
        border-radius: var(--radius-lg);
        overflow: hidden;
        margin-bottom: 10px;
        position: relative;
      }
      .prog-countdown-card::before {
        content: '';
        position: absolute;
        left: 0; top: 0; bottom: 0; width: 4px;
      }
      .prog-countdown-card.urgent::before   { background: #EF4444; }
      .prog-countdown-card.warning::before  { background: #F59E0B; }
      .prog-countdown-card.safe::before     { background: #22C55E; }
      .prog-countdown-card.nodate::before   { background: var(--border); }

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
      .prog-countdown-icon.urgent  { background: rgba(239,68,68,0.1);  color: #EF4444; }
      .prog-countdown-icon.warning { background: rgba(245,158,11,0.1); color: #F59E0B; }
      .prog-countdown-icon.safe    { background: rgba(34,197,94,0.1);  color: #22C55E; }
      .prog-countdown-icon.nodate  { background: var(--bg); color: var(--text-muted); }

      .prog-countdown-body { flex: 1; min-width: 0; }
      .prog-countdown-subject {
        font-size: 14px; font-weight: 800;
        color: var(--text); margin-bottom: 3px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .prog-countdown-sub {
        font-size: 12px; color: var(--text-muted);
        line-height: 1.4;
      }
      .prog-countdown-days {
        font-size: 13px; font-weight: 800;
        text-align: right; flex-shrink: 0;
        line-height: 1.2;
      }
      .prog-countdown-days.urgent  { color: #EF4444; }
      .prog-countdown-days.warning { color: #F59E0B; }
      .prog-countdown-days.safe    { color: #22C55E; }
      .prog-countdown-days.nodate  { color: var(--text-muted); font-size: 11px; font-weight: 600; }

      /* ── PREPAREDNESS BAR ── */
      .prog-prep-card {
        background: var(--surface);
        border: 1.5px solid var(--border);
        border-radius: var(--radius-lg);
        padding: 16px;
        margin-bottom: 10px;
      }
      .prog-prep-header {
        display: flex; align-items: center;
        justify-content: space-between; margin-bottom: 14px;
      }
      .prog-prep-subject {
        font-size: 14px; font-weight: 800; color: var(--text);
      }
      .prog-prep-pct {
        font-size: 13px; font-weight: 800; color: var(--primary);
      }
      .prog-prep-bar-track {
        height: 8px; background: var(--bg);
        border-radius: 99px; overflow: hidden; margin-bottom: 8px;
        border: 1px solid var(--border);
      }
      .prog-prep-bar-fill {
        height: 100%; border-radius: 99px;
        transition: width 0.6s ease;
      }
      .prog-prep-bar-fill.great   { background: #22C55E; }
      .prog-prep-bar-fill.good    { background: var(--primary); }
      .prog-prep-bar-fill.fair    { background: #F59E0B; }
      .prog-prep-bar-fill.low     { background: #EF4444; }
      .prog-prep-bar-fill.none    { background: var(--border); }
      .prog-prep-verdict {
        font-size: 12px; color: var(--text-muted);
        line-height: 1.5;
      }
      .prog-prep-verdict strong { color: var(--text-secondary); }

      .prog-prep-stats {
        display: flex; gap: 6px; margin-top: 10px;
      }
      .prog-prep-stat {
        flex: 1; text-align: center;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        padding: 8px 4px;
      }
      .prog-prep-stat-val {
        font-size: 18px; font-weight: 900;
        line-height: 1; margin-bottom: 3px;
      }
      .prog-prep-stat-val.wrong { color: #EF4444; }
      .prog-prep-stat-val.retry { color: #22C55E; }
      .prog-prep-stat-val.total { color: var(--primary); }
      .prog-prep-stat-lbl {
        font-size: 9px; font-weight: 700;
        text-transform: uppercase; letter-spacing: 0.06em;
        color: var(--text-muted);
      }

      /* ── WEAK TOPICS ── */
      .prog-weak-item {
        display: flex; align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        border-bottom: 1px solid var(--border);
        gap: 10px;
      }
      .prog-weak-item:last-child { border-bottom: none; }
      .prog-weak-left {
        display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0;
      }
      .prog-weak-dot {
        width: 8px; height: 8px; border-radius: 50%;
        flex-shrink: 0;
      }
      .prog-weak-dot.high   { background: #EF4444; }
      .prog-weak-dot.medium { background: #F59E0B; }
      .prog-weak-dot.low    { background: var(--primary); }
      .prog-weak-name {
        font-size: 13px; font-weight: 600; color: var(--text);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .prog-weak-subject {
        font-size: 10px; color: var(--text-muted);
        margin-top: 1px;
      }
      .prog-weak-count {
        font-size: 12px; font-weight: 800;
        color: #EF4444; flex-shrink: 0;
      }

      /* ── EMPTY / NO DATA ── */
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

      /* ── OVERALL VERDICT BANNER ── */
      .prog-verdict-banner {
        border-radius: var(--radius-lg);
        padding: 16px 18px;
        margin-bottom: 20px;
        display: flex; align-items: flex-start; gap: 13px;
        border: 1.5px solid;
      }
      .prog-verdict-banner.great {
        background: rgba(34,197,94,0.07);
        border-color: rgba(34,197,94,0.3);
      }
      .prog-verdict-banner.good {
        background: rgba(2,132,199,0.07);
        border-color: rgba(2,132,199,0.25);
      }
      .prog-verdict-banner.fair {
        background: rgba(245,158,11,0.08);
        border-color: rgba(245,158,11,0.3);
      }
      .prog-verdict-banner.low {
        background: rgba(239,68,68,0.07);
        border-color: rgba(239,68,68,0.25);
      }
      .prog-verdict-banner.none {
        background: var(--surface);
        border-color: var(--border);
      }
      .prog-verdict-icon {
        font-size: 22px; flex-shrink: 0; margin-top: 1px;
      }
      .prog-verdict-banner.great .prog-verdict-icon { color: #22C55E; }
      .prog-verdict-banner.good  .prog-verdict-icon { color: var(--primary); }
      .prog-verdict-banner.fair  .prog-verdict-icon { color: #F59E0B; }
      .prog-verdict-banner.low   .prog-verdict-icon { color: #EF4444; }
      .prog-verdict-banner.none  .prog-verdict-icon { color: var(--text-muted); }
      .prog-verdict-text { flex: 1; }
      .prog-verdict-title {
        font-size: 14px; font-weight: 800; color: var(--text);
        margin-bottom: 4px;
      }
      .prog-verdict-sub {
        font-size: 12px; color: var(--text-muted); line-height: 1.6;
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
          transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%);
        animation: progShimmer 1.4s infinite;
      }
      [data-theme="dark"] .prog-skeleton::after {
        background: linear-gradient(90deg,
          transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%);
      }

      /* ── TENDÊNCIAS ── */
      .prog-tend-content { padding: 16px 16px 0; }

      .prog-subject-scroll {
        display: flex; gap: 8px;
        padding: 16px 16px 4px;
        overflow-x: auto; scrollbar-width: none;
        -webkit-overflow-scrolling: touch;
        scroll-snap-type: x mandatory;
      }
      .prog-subject-scroll::-webkit-scrollbar { display: none; }

      .prog-subject-pill {
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
      .prog-subject-pill i { font-size: 12px; }
      .prog-subject-pill:active { transform: scale(0.95); }
      .prog-subject-pill.active {
        border-color: var(--primary);
        background: var(--primary-light);
        color: var(--primary);
      }

      /* ── TOPIC CARD (Tendências) ── */
      .prog-topic-card {
        background: var(--surface);
        border: 1.5px solid var(--border);
        border-radius: var(--radius-lg);
        overflow: hidden; margin-bottom: 10px;
        position: relative;
      }
      .prog-topic-card.critical::before {
        content: '';
        position: absolute; left: 0; top: 0; bottom: 0;
        width: 4px; background: #EF4444;
      }
      .prog-topic-card.frequent::before {
        content: '';
        position: absolute; left: 0; top: 0; bottom: 0;
        width: 4px; background: #F59E0B;
      }
      .prog-topic-card.normal::before {
        content: '';
        position: absolute; left: 0; top: 0; bottom: 0;
        width: 4px; background: var(--primary);
      }

      .prog-topic-inner {
        padding: 13px 16px 13px 20px;
      }
      .prog-topic-top {
        display: flex; align-items: flex-start;
        justify-content: space-between; gap: 10px;
        margin-bottom: 8px;
      }
      .prog-topic-name {
        font-size: 14px; font-weight: 800;
        color: var(--text); line-height: 1.3; flex: 1;
      }
      .prog-topic-badges {
        display: flex; flex-direction: column;
        align-items: flex-end; gap: 4px; flex-shrink: 0;
      }
      .prog-topic-count-badge {
        font-size: 11px; font-weight: 700;
        border-radius: var(--radius-full); padding: 3px 10px;
        white-space: nowrap;
      }
      .prog-topic-count-badge.critical {
        background: rgba(239,68,68,0.1); color: #EF4444;
        border: 1px solid rgba(239,68,68,0.25);
      }
      .prog-topic-count-badge.frequent {
        background: rgba(245,158,11,0.1); color: #F59E0B;
        border: 1px solid rgba(245,158,11,0.25);
      }
      .prog-topic-count-badge.normal {
        background: var(--primary-light); color: var(--primary);
        border: 1px solid rgba(2,132,199,0.2);
      }
      .prog-topic-weak-badge {
        font-size: 10px; font-weight: 700;
        color: #EF4444;
        background: rgba(239,68,68,0.08);
        border: 1px solid rgba(239,68,68,0.2);
        border-radius: var(--radius-full); padding: 2px 8px;
      }
      .prog-topic-years {
        font-size: 11px; color: var(--text-muted);
        line-height: 1.5; margin-bottom: 6px;
      }
      .prog-topic-years strong { color: var(--text-secondary); }
      .prog-topic-advice {
        font-size: 12px; color: var(--text-muted);
        line-height: 1.55;
        padding: 8px 12px;
        background: var(--bg);
        border-radius: var(--radius-md);
        border: 1px solid var(--border);
      }
      .prog-topic-advice.critical {
        background: rgba(239,68,68,0.05);
        border-color: rgba(239,68,68,0.15);
        color: #991B1B;
      }
      [data-theme="dark"] .prog-topic-advice.critical {
        color: #FCA5A5;
      }

      /* ── TEND LOADING ── */
      .prog-tend-loading {
        padding: 48px 24px;
        display: flex; flex-direction: column;
        align-items: center; gap: 12px;
      }
      .prog-tend-spin {
        width: 28px; height: 28px;
        border: 3px solid var(--border);
        border-top-color: var(--primary);
        border-radius: 50%;
        animation: progSpin 0.7s linear infinite;
      }
      .prog-tend-loading-txt {
        font-size: 13px; font-weight: 600;
        color: var(--text-muted);
      }

      /* ── TEND LEGEND ── */
      .prog-tend-legend {
        display: flex; flex-wrap: wrap; gap: 10px;
        margin-bottom: 16px;
      }
      .prog-tend-legend-item {
        display: flex; align-items: center; gap: 6px;
        font-size: 11px; font-weight: 600; color: var(--text-muted);
      }
      .prog-tend-legend-dot {
        width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
      }

      /* ── TEND CHOOSE ── */
      .prog-tend-choose {
        padding: 48px 24px;
        display: flex; flex-direction: column;
        align-items: center; gap: 10px; text-align: center;
      }
      .prog-tend-choose-icon {
        font-size: 40px; color: var(--primary); opacity: 0.35;
        margin-bottom: 8px;
      }
      .prog-tend-choose-text {
        font-size: 14px; font-weight: 600;
        color: var(--text-muted); line-height: 1.6;
      }

      /* ── DARK ── */
      [data-theme="dark"] .prog-card,
      [data-theme="dark"] .prog-countdown-card,
      [data-theme="dark"] .prog-prep-card,
      [data-theme="dark"] .prog-topic-card { background: var(--bg-card); }

      /* ── RESPONSIVE ── */
      @media (min-width: 768px) {
        .prog-tend-content { padding: 20px 24px 0; }
        .prog-subject-scroll { padding: 16px 24px 4px; }
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
          <button class="prog-tab active notranslate" id="prog-tab-prog"
            translate="no">
            <i class="fa-solid fa-gauge-high" aria-hidden="true"></i>
            Progresso
          </button>
          <button class="prog-tab notranslate" id="prog-tab-tend"
            translate="no">
            <i class="fa-solid fa-arrow-trend-up" aria-hidden="true"></i>
            Tendências
          </button>
        </div>

        <!-- PROGRESSO PANEL -->
        <div class="prog-panel active" id="prog-panel-prog">
          <div style="padding:20px 16px 0;" id="prog-prog-body">
            ${_skeletonHtml(3)}
          </div>
        </div>

        <!-- TENDÊNCIAS PANEL -->
        <div class="prog-panel" id="prog-panel-tend">
          <div class="prog-subject-scroll" id="prog-tend-pills"></div>
          <div class="prog-tend-content" id="prog-tend-body">
            <div class="prog-tend-choose">
              <div class="prog-tend-choose-icon">
                <i class="fa-solid fa-magnifying-glass-chart"></i>
              </div>
              <div class="prog-tend-choose-text notranslate" translate="no">
                Seleccione uma disciplina acima<br>para ver as tendências dos exames.
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
    _activeTab   = 'progresso';
    _wrongCache  = null;
    _tendSubject = '';
    _tendCache   = {};
    _subjects    = getStudentSubjects(userData);

    ui.renderHeader({
      title:          'Progresso',
      backRoute:      '/panel/dashboard',
      showDarkToggle: true,
      moedasBalance:  moeda.getBalance(userData),
    });

    // Profile strip
    const strip = document.getElementById('prog-strip-text');
    if (strip) strip.textContent = _profileBadgeText();

    // Tabs
    document.getElementById('prog-tab-prog')
      ?.addEventListener('click', () => _switchTab('progresso'));
    document.getElementById('prog-tab-tend')
      ?.addEventListener('click', () => _switchTab('tendencias'));

    // Build Tendências subject pills
    _buildTendPills();

    // Load Progresso
    _loadProgresso();
  },

  destroy() {
    _wrongCache  = null;
    _tendCache   = {};
    _tendSubject = '';
  },
};

// ============================================================
// HELPERS
// ============================================================

function _profileBadgeText() {
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

function _skeletonHtml(n) {
  return Array(n).fill('<div class="prog-skeleton"></div>').join('');
}

// Mozambique local date — UTC+2 — never toISOString()
function _mzToday() {
  const now = new Date();
  const mz  = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const y   = mz.getUTCFullYear();
  const m   = String(mz.getUTCMonth() + 1).padStart(2, '0');
  const d   = String(mz.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function _daysUntil(dateStr) {
  if (!dateStr) return null;
  const today    = _mzToday();
  const todayMs  = new Date(today).getTime();
  const targetMs = new Date(dateStr).getTime();
  return Math.round((targetMs - todayMs) / 86400000);
}

function _urgencyClass(days) {
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

function _urgencyDaysLabel(days) {
  if (days === null)  return 'Sem data definida';
  if (days < 0)       return 'Exame passou!';
  if (days === 0)     return 'HOJE!';
  if (days === 1)     return 'AMANHÃ!';
  return `${days} dias`;
}

function _urgencySubLabel(days, dateStr) {
  if (!dateStr) return 'Defina a data do exame no seu Perfil.';
  if (days < 0)  return 'O exame já decorreu.';
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-PT', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

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
    // Load all wrong answers once — cache for reuse
    if (!_wrongCache) {
      const all = await getWrongAnswers(_user.uid, {}, true);
      _wrongCache = all;
    }

    _renderProgresso(_wrongCache);

  } catch (e) {
    console.error('[Progresso] load:', e);
    if (body) {
      body.innerHTML = `
        <div class="prog-empty">
          <div class="prog-empty-icon">
            <i class="fa-solid fa-circle-exclamation"></i>
          </div>
          <div class="prog-empty-title notranslate" translate="no">
            Erro ao carregar
          </div>
          <div class="prog-empty-sub notranslate" translate="no">
            Verifique a sua ligação e tente novamente.
          </div>
        </div>`;
    }
  }
}

function _renderProgresso(wrongAnswers) {
  const body = document.getElementById('prog-prog-body');
  if (!body) return;

  const examDates = _userData?.examDates || {};

  // ── Build per-subject stats ──────────────────────────────
  const subjectStats = {};
  for (const s of _subjects) {
    const dbS   = toDbSubject(s);
    const recs  = wrongAnswers.filter(r => r.subject === dbS);
    const total = recs.length;
    const retried = recs.filter(r => r.retried).length;

    // Topic weakness — topics with most unresolved wrongs
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

    // Preparedness score: 0–100
    // Based on: retried proportion of wrongs found
    // 0 wrongs = no data (not 100%), treated as unknown
    let prepScore  = 0;
    let prepLabel  = 'none';
    if (total > 0) {
      prepScore = Math.round((retried / total) * 100);
      if (prepScore >= 80)      prepLabel = 'great';
      else if (prepScore >= 60) prepLabel = 'good';
      else if (prepScore >= 30) prepLabel = 'fair';
      else                      prepLabel = 'low';
    }

    subjectStats[s] = {
      total, retried, weakTopics,
      prepScore, prepLabel,
      dateStr: examDates[s] || null,
    };
  }

  // ── Overall verdict ──────────────────────────────────────
  const totalWrong   = wrongAnswers.length;
  const totalRetried = wrongAnswers.filter(r => r.retried).length;
  const overallVerdict = _overallVerdict(totalWrong, totalRetried, examDates);

  // ── All weak topics across subjects ─────────────────────
  const allWeakMap = {};
  for (const r of wrongAnswers) {
    if (!r.retried && r.topic) {
      const key = `${r.subject}||${r.topic}`;
      if (!allWeakMap[key]) {
        allWeakMap[key] = { topic: r.topic, subject: r.subject, count: 0 };
      }
      allWeakMap[key].count++;
    }
  }
  const allWeak = Object.values(allWeakMap)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // ── Render HTML ──────────────────────────────────────────
  let html = '';

  // Overall verdict banner
  html += _verdictBannerHtml(overallVerdict);

  // Exam countdowns
  html += `<div class="prog-sec notranslate" translate="no">
    <i class="fa-solid fa-calendar-days" aria-hidden="true"></i>
    Os Seus Exames
  </div>`;

  if (!_subjects.length) {
    html += `<div class="prog-empty">
      <div class="prog-empty-sub notranslate" translate="no">
        Nenhuma disciplina encontrada no seu perfil.
      </div>
    </div>`;
  } else {
    // Sort by urgency — closest date first, no date last
    const sorted = [..._subjects].sort((a, b) => {
      const da = examDates[a] ? _daysUntil(examDates[a]) : 9999;
      const db = examDates[b] ? _daysUntil(examDates[b]) : 9999;
      return da - db;
    });

    for (const s of sorted) {
      const dateStr = examDates[s] || null;
      const days    = _daysUntil(dateStr);
      const cls     = _urgencyClass(days);
      html += `
        <div class="prog-countdown-card ${cls}">
          <div class="prog-countdown-inner">
            <div class="prog-countdown-icon ${cls}">
              <i class="fa-solid ${_urgencyIcon(days)}" aria-hidden="true"></i>
            </div>
            <div class="prog-countdown-body">
              <div class="prog-countdown-subject notranslate" translate="no">
                ${_esc(s)}
              </div>
              <div class="prog-countdown-sub notranslate" translate="no">
                ${_esc(_urgencySubLabel(days, dateStr))}
              </div>
            </div>
            <div class="prog-countdown-days ${cls} notranslate" translate="no">
              ${_esc(_urgencyDaysLabel(days))}
            </div>
          </div>
        </div>
      `;
    }

    // Link to set dates if any missing
    const missingDates = _subjects.filter(s => !examDates[s]);
    if (missingDates.length) {
      html += `
        <div style="font-size:12px;color:var(--text-muted);
          padding:8px 4px 0;line-height:1.5;" class="notranslate" translate="no">
          <i class="fa-solid fa-circle-info" style="color:var(--primary);margin-right:5px;"></i>
          ${missingDates.length === 1
            ? `<strong>${_esc(missingDates[0])}</strong> ainda não tem data definida.`
            : `${missingDates.length} disciplinas ainda não têm data de exame definida.`}
          <span style="color:var(--primary);font-weight:700;cursor:pointer;"
            id="prog-go-perfil"> Ir para o Perfil</span>
        </div>
      `;
    }
  }

  // Preparedness per subject
  html += `<div class="prog-sec notranslate" translate="no" style="margin-top:28px;">
    <i class="fa-solid fa-gauge-high" aria-hidden="true"></i>
    Nível de Preparação por Disciplina
  </div>`;

  if (totalWrong === 0) {
    html += `
      <div class="prog-card" style="padding:20px 16px;">
        <div style="font-size:13px;color:var(--text-muted);line-height:1.6;"
          class="notranslate" translate="no">
          <i class="fa-solid fa-circle-info"
            style="color:var(--primary);margin-right:6px;"></i>
          Ainda não fez nenhuma simulação. O nível de preparação é calculado
          com base nas simulações concluídas. Faça a primeira simulação
          para ver a sua análise aqui.
        </div>
      </div>`;
  } else {
    for (const s of _subjects) {
      const st = subjectStats[s];
      html += _prepCardHtml(s, st);
    }
  }

  // Weak topics across all subjects
  if (allWeak.length) {
    html += `<div class="prog-sec notranslate" translate="no" style="margin-top:28px;">
      <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
      Temas Mais Fracos
    </div>
    <div class="prog-card">`;

    for (const w of allWeak) {
      const dotCls = w.count >= 5 ? 'high' : w.count >= 3 ? 'medium' : 'low';
      // Convert DB subject name back to display name for showing
      const displaySubject = _subjects.find(
        s => toDbSubject(s) === w.subject
      ) || w.subject;
      html += `
        <div class="prog-weak-item">
          <div class="prog-weak-left">
            <div class="prog-weak-dot ${dotCls}"></div>
            <div>
              <div class="prog-weak-name notranslate" translate="no">
                ${_esc(w.topic)}
              </div>
              <div class="prog-weak-subject notranslate" translate="no">
                ${_esc(displaySubject)}
              </div>
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
      <div style="font-size:12px;color:var(--text-muted);
        padding:6px 4px 0;line-height:1.6;"
        class="notranslate" translate="no">
        <i class="fa-solid fa-lightbulb"
          style="color:#F59E0B;margin-right:5px;"></i>
        Estes são os temas onde errou mais questões ainda não resolvidas.
        Veja a tab <strong>Tendências</strong> para saber quais aparecem mais nos exames.
      </div>
    `;
  }

  body.innerHTML = html;

  // Wire go-to-perfil link
  document.getElementById('prog-go-perfil')
    ?.addEventListener('click', () => router.navigate('/panel/perfil'));
}

function _overallVerdict(totalWrong, totalRetried, examDates) {
  // Find most urgent exam
  let minDays = null;
  for (const s of _subjects) {
    if (examDates[s]) {
      const d = _daysUntil(examDates[s]);
      if (minDays === null || d < minDays) minDays = d;
    }
  }

  if (totalWrong === 0) {
    return {
      cls:   'none',
      icon:  'fa-play-circle',
      title: 'Pronto para Começar',
      sub:   'Ainda não fez simulações. Comece agora para ver a sua análise de preparação.',
    };
  }

  const retryRate = totalWrong > 0 ? totalRetried / totalWrong : 0;
  const isUrgent  = minDays !== null && minDays <= 14;

  if (retryRate >= 0.8) {
    return {
      cls:   'great',
      icon:  'fa-medal',
      title: 'Excelente Preparação!',
      sub:   'Resolveu a maioria dos seus erros. Continue assim e vai para o exame confiante.',
    };
  }
  if (retryRate >= 0.5) {
    return {
      cls:  'good',
      icon: 'fa-thumbs-up',
      title: 'No Bom Caminho',
      sub:  isUrgent
        ? 'O seu exame está próximo. Foque-se em resolver os erros que ainda faltam.'
        : 'Está a progredir. Continue a fazer simulações e a rever os seus erros.',
    };
  }
  if (isUrgent) {
    return {
      cls:   'low',
      icon:  'fa-fire',
      title: 'O Exame Está Próximo — Prepare-se!',
      sub:   `Faltam ${minDays <= 0 ? 'muito poucos' : minDays} dias. Ainda tem muitos erros por resolver. Reveja urgentemente.`,
    };
  }
  return {
    cls:   'fair',
    icon:  'fa-triangle-exclamation',
    title: 'Precisa de Mais Preparação',
    sub:   'Tem erros por resolver. Faça mais simulações e use a Revisão de Erros diariamente.',
  };
}

function _verdictBannerHtml(v) {
  return `
    <div class="prog-verdict-banner ${v.cls}">
      <i class="fa-solid ${v.icon} prog-verdict-icon" aria-hidden="true"></i>
      <div class="prog-verdict-text">
        <div class="prog-verdict-title notranslate" translate="no">
          ${_esc(v.title)}
        </div>
        <div class="prog-verdict-sub notranslate" translate="no">
          ${_esc(v.sub)}
        </div>
      </div>
    </div>
  `;
}

function _prepCardHtml(subject, st) {
  const { total, retried, weakTopics, prepScore, prepLabel, dateStr } = st;
  const days     = _daysUntil(dateStr);
  const urgency  = _urgencyClass(days);

  let verdictText = '';
  if (total === 0) {
    verdictText = 'Ainda não fez simulações desta disciplina.';
  } else if (prepLabel === 'great') {
    verdictText = `Resolveu ${retried} de ${total} erros. Boa preparação!`;
  } else if (prepLabel === 'good') {
    verdictText = `Resolveu ${retried} de ${total} erros. Continue a rever.`;
  } else if (prepLabel === 'fair') {
    verdictText = `Ainda tem <strong>${total - retried}</strong> erros por resolver. Dedique mais tempo a esta disciplina.`;
  } else if (prepLabel === 'low') {
    verdictText = `Tem <strong>${total - retried}</strong> erros por resolver e pouca revisão feita. Precisa de intensificar o estudo.`;
    if (urgency === 'urgent') {
      verdictText = `⚠️ Atenção: o exame está próximo e ainda tem <strong>${total - retried}</strong> erros por resolver!`;
    }
  } else {
    verdictText = 'Sem dados suficientes.';
  }

  const barWidth = total === 0 ? 0 : prepScore;

  return `
    <div class="prog-prep-card">
      <div class="prog-prep-header">
        <div class="prog-prep-subject notranslate" translate="no">
          <i class="fa-solid ${_icon(subject)}"
            style="color:var(--primary);margin-right:7px;font-size:13px;"></i>
          ${_esc(subject)}
        </div>
        <div class="prog-prep-pct notranslate" translate="no">
          ${total === 0 ? '—' : prepScore + '%'}
        </div>
      </div>
      <div class="prog-prep-bar-track">
        <div class="prog-prep-bar-fill ${total === 0 ? 'none' : prepLabel}"
          style="width:${barWidth}%"></div>
      </div>
      <div class="prog-prep-verdict notranslate" translate="no">
        ${verdictText}
      </div>
      ${total > 0 ? `
        <div class="prog-prep-stats">
          <div class="prog-prep-stat">
            <div class="prog-prep-stat-val wrong notranslate" translate="no">
              ${total - retried}
            </div>
            <div class="prog-prep-stat-lbl notranslate" translate="no">
              Por resolver
            </div>
          </div>
          <div class="prog-prep-stat">
            <div class="prog-prep-stat-val retry notranslate" translate="no">
              ${retried}
            </div>
            <div class="prog-prep-stat-lbl notranslate" translate="no">
              Resolvidos
            </div>
          </div>
          <div class="prog-prep-stat">
            <div class="prog-prep-stat-val total notranslate" translate="no">
              ${total}
            </div>
            <div class="prog-prep-stat-lbl notranslate" translate="no">
              Total Erros
            </div>
          </div>
        </div>
        ${weakTopics.length ? `
          <div style="margin-top:10px;font-size:11px;
            color:var(--text-muted);font-weight:600;"
            class="notranslate" translate="no">
            <i class="fa-solid fa-triangle-exclamation"
              style="color:#F59E0B;margin-right:5px;"></i>
            Temas fracos: ${weakTopics.map(w => _esc(w.topic)).join(', ')}
          </div>
        ` : ''}
      ` : ''}
    </div>
  `;
}

// ============================================================
// TENDÊNCIAS — SUBJECT PILLS
// ============================================================

function _buildTendPills() {
  const scroll = document.getElementById('prog-tend-pills');
  if (!scroll || !_subjects.length) return;

  scroll.innerHTML = _subjects.map(s => `
    <button class="prog-subject-pill notranslate" translate="no"
      data-subject="${_esc(s)}">
      <i class="fa-solid ${_icon(s)}" aria-hidden="true"></i>
      ${_esc(s)}
    </button>
  `).join('');

  scroll.querySelectorAll('.prog-subject-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = btn.dataset.subject;
      if (s === _tendSubject) return;
      _tendSubject = s;
      scroll.querySelectorAll('.prog-subject-pill')
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

  // Cache hit
  if (_tendCache[subject]) {
    _renderTendencias(subject, _tendCache[subject]);
    return;
  }

  try {
    const dbSubject = toDbSubject(subject);
    const dbGrade   = _userData?.grade ? toDbGrade(_userData.grade) : null;
    const isAdm     = _userData?.examType === 'admissao';

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

    // Ensure subject is still selected (user may have changed)
    if (_tendSubject !== subject) return;

    // Topic frequency with year data
    const freq   = topicFrequency(allQ);
    const result = freq.map(f => {
      const years = [...new Set(
        f.questions.map(q => getYear(q)).filter(Boolean)
      )].sort((a, b) => Number(b) - Number(a));
      return { ...f, years };
    });

    _tendCache[subject] = { topics: result, totalQ: allQ.length };
    _renderTendencias(subject, _tendCache[subject]);

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
          Ainda não há perguntas suficientes com temas definidos
          para esta disciplina.
        </div>
      </div>
    `;
    return;
  }

  // Cross-reference with student's weak topics from wrongAnswers
  const dbSubject = toDbSubject(subject);
  const weakTopicSet = new Set(
    (_wrongCache || [])
      .filter(r => r.subject === dbSubject && !r.retried && r.topic)
      .map(r => r.topic)
  );

  // Classify topics
  // critical = appears in many exams AND student is weak
  // frequent = appears in many exams
  // normal   = appears in fewer exams
  const maxCount = topics[0]?.count || 1;
  const highThreshold  = Math.max(3, Math.round(maxCount * 0.6));
  const medThreshold   = Math.max(2, Math.round(maxCount * 0.3));

  let html = '';

  // Summary line
  html += `
    <div style="font-size:12px;color:var(--text-muted);
      margin-bottom:16px;line-height:1.6;"
      class="notranslate" translate="no">
      <i class="fa-solid fa-database"
        style="color:var(--primary);margin-right:5px;"></i>
      Analisados <strong>${totalQ}</strong> questões de exames anteriores
      de <strong>${_esc(subject)}</strong>.
      ${topics.length} tema${topics.length !== 1 ? 's' : ''} identificado${topics.length !== 1 ? 's' : ''}.
    </div>
  `;

  // Legend
  html += `
    <div class="prog-tend-legend">
      <div class="prog-tend-legend-item">
        <div class="prog-tend-legend-dot" style="background:#EF4444;"></div>
        <span class="notranslate" translate="no">Crítico — frequente + fraco</span>
      </div>
      <div class="prog-tend-legend-item">
        <div class="prog-tend-legend-dot" style="background:#F59E0B;"></div>
        <span class="notranslate" translate="no">Frequente nos exames</span>
      </div>
      <div class="prog-tend-legend-item">
        <div class="prog-tend-legend-dot" style="background:var(--primary);"></div>
        <span class="notranslate" translate="no">Aparece ocasionalmente</span>
      </div>
    </div>
  `;

  for (const t of topics) {
    const isWeak     = weakTopicSet.has(t.topic);
    const isFrequent = t.count >= highThreshold;
    const isMedium   = t.count >= medThreshold;
    const isCritical = isFrequent && isWeak;

    const cls = isCritical ? 'critical' : isFrequent ? 'frequent' : 'normal';

    const countLabel = t.count === 1
      ? '1 questão'
      : `${t.count} questões`;

    const yearsLabel = t.years.length
      ? `Apareceu nos exames de: <strong>${t.years.join(', ')}</strong>`
      : 'Ano não especificado';

    const frequencyMsg = isCritical
      ? `Este tema é frequente nos exames E ainda tem erros por resolver. <strong>Prioridade máxima.</strong>`
      : isFrequent
      ? `Este tema aparece com muita frequência nos exames de anos anteriores. Estude com atenção.`
      : isMedium
      ? `Este tema aparece com alguma frequência. Vale a pena rever.`
      : `Este tema aparece ocasionalmente. Não ignore — pode surgir no exame.`;

    const adviceClass = isCritical ? 'critical' : '';

    html += `
      <div class="prog-topic-card ${cls}">
        <div class="prog-topic-inner">
          <div class="prog-topic-top">
            <div class="prog-topic-name notranslate" translate="no">
              ${_esc(t.topic)}
            </div>
            <div class="prog-topic-badges">
              <span class="prog-topic-count-badge ${cls} notranslate"
                translate="no">
                ${_esc(countLabel)}
              </span>
              ${isWeak ? `
                <span class="prog-topic-weak-badge notranslate" translate="no">
                  <i class="fa-solid fa-triangle-exclamation"
                    style="font-size:9px;margin-right:3px;"></i>
                  Área fraca
                </span>
              ` : ''}
            </div>
          </div>
          <div class="prog-topic-years notranslate" translate="no">
            ${yearsLabel}
          </div>
          <div class="prog-topic-advice ${adviceClass} notranslate" translate="no">
            ${frequencyMsg}
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
