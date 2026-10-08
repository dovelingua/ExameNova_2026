// ============================================================
// panel/js/screens/meu-exame/meu-exame.js
// ExameNova — Meu Exame Lobby Screen v1.0
//
// PURPOSE:
//   Shows the student which subjects have an active Meu Exame,
//   which are coming soon, which are expired, and which are
//   already completed. Student taps an active subject to begin.
//
// ACTIVATION WINDOW:
//   Active: exam date is between 1 and 3 days away (inclusive).
//   Expires: at 12:00 local time on the exam date itself.
//   Coming soon: exam date is more than 3 days away.
//   Expired: exam date has passed 12:00 on that day.
//   Completed: student already submitted this subject's exam.
//
// DATA SOURCES:
//   userData.examDates   — { subjectProfileName: 'YYYY-MM-DD' }
//   userData.subjects    — array of profile subject names
//   Firestore meuExame   — { userId_dbSubject } docs for completion check
//
// MOEDAS:
//   Cost: moeda.COSTS.MEU_EXAME (20)
//   Deducted at session start in the render screen — not here.
//   Lobby only checks and displays the cost.
//
// keepAlive: false | Navbar: absent | Header: back to dashboard
// ============================================================

import { router }   from '../../core/router.js';
import { ui }       from '../../core/ui.js';
import { moeda }    from '../../core/moeda.js';
import { db }       from '../../core/firebase.js';
import { session }  from '../../core/session.js';
import { getStudentSubjects } from '../../core/app.js';
import { toDbSubject }        from '../../core/exams.js';

import {
  collection,
  query,
  where,
  getDocs,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ── Constants ─────────────────────────────────────────────────
const ACTIVATION_DAYS_BEFORE = 3;   // exam activates this many days before
const EXPIRY_HOUR             = 12;  // expires at 12:00 on exam day (local)

// ── Module state ───────────────────────────────────────────────
let _user     = null;
let _userData = null;

// ── Helpers ────────────────────────────────────────────────────

function _esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

// Parse 'YYYY-MM-DD' as local midnight — avoids UTC day shift
function _parseLocal(dateStr) {
  if (!dateStr) return null;
  const parts = String(dateStr).split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

// Local today as midnight
function _today() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Days until a date (negative = past)
function _daysUntil(date) {
  const diff = date.getTime() - _today().getTime();
  return Math.ceil(diff / 86400000);
}

// Exam expiry: 12:00 local time on the exam date
function _expiryDateTime(examDate) {
  return new Date(
    examDate.getFullYear(),
    examDate.getMonth(),
    examDate.getDate(),
    EXPIRY_HOUR, 0, 0, 0
  );
}

// Status for a subject given its exam date and completion record
function _getStatus(examDate, isCompleted) {
  if (!examDate) return 'no-date';
  if (isCompleted) return 'completed';

  const now     = new Date();
  const expiry  = _expiryDateTime(examDate);
  const days    = _daysUntil(examDate);

  if (now >= expiry)                            return 'expired';
  if (days >= 0 && days <= ACTIVATION_DAYS_BEFORE) return 'active';
  if (days > ACTIVATION_DAYS_BEFORE)            return 'upcoming';
  return 'expired'; // days < 0 and not yet expired by hour
}

// Format exam date for display
function _formatDate(date) {
  return date.toLocaleDateString('pt-PT', {
    weekday: 'long',
    day:     'numeric',
    month:   'long',
  });
}

// Subject icon (reused from simulacao pattern)
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
// SCREEN OBJECT
// ============================================================

const MeuExameScreen = {

  css() {
    if (document.getElementById('me-styles')) return '';
    return `<style id="me-styles">

      /* ── BASE ── */
      .me-wrap {
        min-height: 100dvh;
        background: var(--bg);
        padding-bottom: 48px;
      }

      /* ── HERO ── */
      .me-hero {
        background: linear-gradient(135deg, #0369A1 0%, #0284C7 60%, #0E9AA7 100%);
        padding: 24px 20px 36px;
        position: relative;
        overflow: hidden;
      }
      .me-hero::after {
        content: '';
        position: absolute;
        bottom: -20px; left: 0; right: 0;
        height: 40px;
        background: var(--bg);
        border-radius: 50% 50% 0 0 / 100% 100% 0 0;
      }
      .me-hero-blob {
        position: absolute; border-radius: 50%;
        opacity: 0.07; background: #fff;
      }
      .me-hero-badge {
        display: inline-flex; align-items: center; gap: 6px;
        background: rgba(255,179,0,0.18);
        border: 1px solid rgba(255,179,0,0.35);
        border-radius: var(--radius-full);
        padding: 4px 12px;
        font-size: 11px; font-weight: 700;
        color: #FFD54F;
        margin-bottom: 12px;
        position: relative; z-index: 1;
      }
      .me-hero-title {
        font-size: 22px; font-weight: 900; color: #fff;
        letter-spacing: -0.4px; line-height: 1.25;
        margin-bottom: 6px;
        position: relative; z-index: 1;
      }
      .me-hero-sub {
        font-size: 13px; color: rgba(255,255,255,0.65);
        line-height: 1.55; max-width: 340px;
        position: relative; z-index: 1;
      }

      /* ── COST STRIP ── */
      .me-cost-strip {
        background: var(--surface);
        border-bottom: 1px solid var(--border);
        padding: 10px 16px;
        display: flex; align-items: center; gap: 10px;
      }
      .me-cost-strip-icon {
        width: 32px; height: 32px;
        border-radius: var(--radius-md);
        background: var(--moeda-light);
        display: flex; align-items: center; justify-content: center;
        font-size: 14px; color: var(--moeda);
        flex-shrink: 0;
      }
      .me-cost-strip-text {
        font-size: 12px; font-weight: 600;
        color: var(--text-secondary); flex: 1; line-height: 1.4;
      }
      .me-cost-strip-text strong { color: var(--moeda); }

      /* ── SECTION LABEL ── */
      .me-sec-label {
        font-size: 11px; font-weight: 800;
        text-transform: uppercase; letter-spacing: 0.08em;
        color: var(--text-muted);
        padding: 20px 16px 8px;
        display: flex; align-items: center; gap: 7px;
      }
      .me-sec-label i { font-size: 10px; color: var(--primary); }

      /* ── SUBJECT CARD ── */
      .me-card {
        margin: 0 16px 10px;
        background: var(--surface);
        border: 1.5px solid var(--border);
        border-radius: var(--radius-lg);
        overflow: hidden;
        transition: border-color 0.18s, transform 0.12s;
      }
      .me-card.active {
        border-color: var(--moeda);
        box-shadow: 0 4px 20px rgba(255,179,0,0.12);
      }
      .me-card.active:active { transform: scale(0.984); }
      .me-card-inner {
        padding: 14px 16px;
        display: flex; align-items: flex-start; gap: 13px;
        cursor: default;
      }
      .me-card.active .me-card-inner { cursor: pointer; }

      .me-card-icon {
        width: 44px; height: 44px;
        border-radius: var(--radius-md);
        display: flex; align-items: center; justify-content: center;
        font-size: 18px; flex-shrink: 0; margin-top: 1px;
        background: var(--bg);
        color: var(--text-muted);
      }
      .me-card.active .me-card-icon {
        background: rgba(255,179,0,0.1);
        color: var(--moeda);
      }
      .me-card.completed .me-card-icon {
        background: rgba(34,197,94,0.09);
        color: #22C55E;
      }
      .me-card.upcoming .me-card-icon {
        background: rgba(2,132,199,0.08);
        color: var(--primary);
      }
      .me-card.expired .me-card-icon {
        background: rgba(239,68,68,0.07);
        color: #EF4444;
      }
      .me-card.no-date .me-card-icon {
        background: var(--bg);
        color: var(--text-muted);
      }

      .me-card-body { flex: 1; min-width: 0; }
      .me-card-subject {
        font-size: 15px; font-weight: 800;
        color: var(--text); margin-bottom: 3px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .me-card-date {
        font-size: 12px; font-weight: 600;
        color: var(--text-muted); margin-bottom: 6px;
        display: flex; align-items: center; gap: 5px;
      }
      .me-card-date i { font-size: 10px; }

      /* Status badge */
      .me-status-badge {
        display: inline-flex; align-items: center; gap: 5px;
        font-size: 10px; font-weight: 700;
        border-radius: var(--radius-full);
        padding: 3px 10px;
      }
      .me-status-badge.active {
        background: rgba(255,179,0,0.12);
        color: #92400E;
        border: 1px solid rgba(255,179,0,0.3);
      }
      [data-theme="dark"] .me-status-badge.active { color: #FDE68A; }
      .me-status-badge.completed {
        background: rgba(34,197,94,0.09);
        color: #16A34A;
        border: 1px solid rgba(34,197,94,0.2);
      }
      .me-status-badge.upcoming {
        background: rgba(2,132,199,0.08);
        color: var(--primary);
        border: 1px solid rgba(2,132,199,0.18);
      }
      .me-status-badge.expired {
        background: rgba(239,68,68,0.07);
        color: #DC2626;
        border: 1px solid rgba(239,68,68,0.18);
      }
      .me-status-badge.no-date {
        background: var(--bg);
        color: var(--text-muted);
        border: 1px solid var(--border);
      }

      /* Countdown pill for active cards */
      .me-countdown {
        display: flex; align-items: center; gap: 5px;
        font-size: 11px; font-weight: 700;
        color: #92400E; margin-top: 6px;
      }
      [data-theme="dark"] .me-countdown { color: #FDE68A; }
      .me-countdown i { font-size: 10px; color: var(--moeda); }

      /* Arrow for active cards */
      .me-card-arrow {
        font-size: 13px; color: var(--moeda);
        flex-shrink: 0; margin-top: 12px;
        display: none;
      }
      .me-card.active .me-card-arrow { display: block; }

      /* ── ACTIVE CTA BANNER ── */
      .me-active-banner {
        margin: 0 16px 16px;
        background: linear-gradient(135deg, rgba(255,179,0,0.08), rgba(255,179,0,0.04));
        border: 1.5px solid rgba(255,179,0,0.25);
        border-radius: var(--radius-lg);
        padding: 14px 16px;
        display: flex; align-items: flex-start; gap: 10px;
      }
      .me-active-banner i {
        font-size: 16px; color: var(--moeda);
        flex-shrink: 0; margin-top: 1px;
      }
      .me-active-banner-text {
        font-size: 12px; font-weight: 600;
        color: var(--text-secondary); line-height: 1.55;
      }
      .me-active-banner-text strong { color: var(--text); }

      /* ── NO DATES STATE ── */
      .me-no-dates {
        padding: 60px 24px;
        display: flex; flex-direction: column;
        align-items: center; gap: 12px; text-align: center;
      }
      .me-no-dates-icon {
        width: 64px; height: 64px; border-radius: 50%;
        background: rgba(2,132,199,0.08);
        display: flex; align-items: center; justify-content: center;
        font-size: 26px; color: var(--primary); margin-bottom: 4px;
      }
      .me-no-dates-title {
        font-size: 16px; font-weight: 800; color: var(--text);
      }
      .me-no-dates-sub {
        font-size: 13px; color: var(--text-muted);
        line-height: 1.6; max-width: 280px;
      }
      .me-btn-perfil {
        margin-top: 4px;
        padding: 13px 28px;
        background: linear-gradient(135deg, #0369A1, #0284C7);
        color: #fff; border: none; border-radius: var(--radius-full);
        font-family: inherit; font-size: 14px; font-weight: 700;
        cursor: pointer; display: inline-flex; align-items: center; gap: 8px;
        box-shadow: 0 4px 16px rgba(2,132,199,0.28);
        transition: opacity 0.18s, transform 0.15s;
        -webkit-tap-highlight-color: transparent;
      }
      .me-btn-perfil:hover  { opacity: 0.9; }
      .me-btn-perfil:active { transform: scale(0.97); }

      /* ── SKELETON ── */
      .me-skeleton { margin: 20px 16px 0; }
      .me-skeleton-card {
        height: 88px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        margin-bottom: 10px; overflow: hidden; position: relative;
      }
      .me-skeleton-card::after {
        content: ''; position: absolute; inset: 0;
        background: linear-gradient(90deg,
          transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%);
        animation: meShimmer 1.4s infinite;
      }
      [data-theme="dark"] .me-skeleton-card::after {
        background: linear-gradient(90deg,
          transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%);
      }
      @keyframes meShimmer {
        from { transform: translateX(-100%); }
        to   { transform: translateX(100%); }
      }

      /* ── RULES CARD ── */
      .me-rules {
        margin: 0 16px 20px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        overflow: hidden;
      }
      .me-rules-head {
        padding: 12px 16px;
        background: var(--bg);
        border-bottom: 1px solid var(--border);
        font-size: 12px; font-weight: 800;
        color: var(--text);
        display: flex; align-items: center; gap: 8px;
      }
      .me-rules-head i { font-size: 12px; color: var(--primary); }
      .me-rules-body { padding: 14px 16px; }
      .me-rule {
        display: flex; align-items: flex-start; gap: 10px;
        margin-bottom: 10px; font-size: 12px;
        color: var(--text-secondary); line-height: 1.55;
      }
      .me-rule:last-child { margin-bottom: 0; }
      .me-rule-dot {
        width: 6px; height: 6px; border-radius: 50%;
        background: var(--primary); flex-shrink: 0; margin-top: 5px;
      }

      /* ── DARK MODE ── */
      [data-theme="dark"] .me-card { background: var(--bg-card); }
      [data-theme="dark"] .me-rules { background: var(--bg-card); }
      [data-theme="dark"] .me-rules-head { background: var(--bg); }

      /* ── RESPONSIVE ── */
      @media (min-width: 768px) {
        .me-wrap { max-width: 680px; margin: 0 auto; }
        .me-hero  { padding: 28px 28px 40px; }
      }

    </style>`;
  },

  mount() {
    return `
      <div class="me-wrap">
        <div id="header-mount"></div>

        <div class="me-hero">
          <div class="me-hero-blob" style="width:200px;height:200px;top:-80px;right:-60px;"></div>
          <div class="me-hero-blob" style="width:90px;height:90px;bottom:20px;left:10px;"></div>
          <div class="me-hero-badge notranslate" translate="no">
            <i class="fa-solid fa-graduation-cap" aria-hidden="true"></i>
            Pré-Exame Oficial
          </div>
          <div class="me-hero-title notranslate" translate="no">
            Meu Exame
          </div>
          <div class="me-hero-sub notranslate" translate="no">
            Simule o exame real com as mesmas condições. Descubra se está preparado.
          </div>
        </div>

        <div class="me-cost-strip">
          <div class="me-cost-strip-icon">
            <i class="fa-solid fa-coins" aria-hidden="true"></i>
          </div>
          <div class="me-cost-strip-text notranslate" translate="no">
            Cada exame custa <strong>20 Moedas</strong> ·
            Uma tentativa por disciplina · Resultado imediato
          </div>
        </div>

        <div id="me-content"></div>

      </div>
    `;
  },

  async init(user, userData, params) {
    _user     = user;
    _userData = userData;

    ui.renderHeader({
      title:          'Meu Exame',
      backRoute:      '/panel/dashboard',
      showDarkToggle: true,
      moedasBalance:  moeda.getBalance(userData),
    });

    _renderSkeleton();
    await _loadAndRender();
  },

  destroy() {
    _user     = null;
    _userData = null;
  },
};

// ============================================================
// SKELETON
// ============================================================

function _renderSkeleton() {
  const el = document.getElementById('me-content');
  if (!el) return;
  el.innerHTML = `
    <div class="me-skeleton">
      ${Array(3).fill('<div class="me-skeleton-card"></div>').join('')}
    </div>`;
}

// ============================================================
// LOAD AND RENDER
// ============================================================

async function _loadAndRender() {
  const el = document.getElementById('me-content');
  if (!el) return;

  const subjects   = getStudentSubjects(_userData);
  const examDates  = _userData?.examDates || {};

  if (!subjects.length) {
    el.innerHTML = _noSubjectsHtml();
    return;
  }

  // Check Firestore for completed exams
  let completedSet = new Set();
  try {
    const snap = await getDocs(
      query(
        collection(db, 'meuExame'),
        where('userId', '==', _user.uid),
        where('status', '==', 'completed')
      )
    );
    snap.forEach(d => {
      completedSet.add(d.data().dbSubject || '');
    });
  } catch (e) {
    console.warn('[MeuExame] completedSet fetch:', e);
  }

  // Build subject info objects
  const subjectItems = subjects.map(subject => {
    const dbSubject  = toDbSubject(subject);
    const dateStr    = examDates[subject] || examDates[dbSubject] || null;
    const examDate   = _parseLocal(dateStr);
    const isComplete = completedSet.has(dbSubject);
    const status     = _getStatus(examDate, isComplete);
    const days       = examDate ? _daysUntil(examDate) : null;

    return { subject, dbSubject, examDate, isComplete, status, days };
  });

  // Sort: active first, then upcoming (by days), then completed, expired, no-date
  const order = { active: 0, upcoming: 1, completed: 2, expired: 3, 'no-date': 4 };
  subjectItems.sort((a, b) => {
    const od = (order[a.status] ?? 5) - (order[b.status] ?? 5);
    if (od !== 0) return od;
    if (a.days !== null && b.days !== null) return a.days - b.days;
    return 0;
  });

  const activeItems   = subjectItems.filter(i => i.status === 'active');
  const upcomingItems = subjectItems.filter(i => i.status === 'upcoming');
  const otherItems    = subjectItems.filter(i =>
    i.status === 'completed' || i.status === 'expired' || i.status === 'no-date'
  );

  let html = '';

  // Active banner
  if (activeItems.length) {
    html += `
      <div class="me-active-banner notranslate" translate="no">
        <i class="fa-solid fa-circle-check" aria-hidden="true"></i>
        <div class="me-active-banner-text">
          <strong>${activeItems.length === 1
            ? `O Meu Exame de ${_esc(activeItems[0].subject)} está disponível`
            : `${activeItems.length} exames estão disponíveis agora`
          }.</strong>
          Toque no cartão para iniciar. O exame expira às 12h00 do dia do exame.
        </div>
      </div>`;
  }

  // Active subjects
  if (activeItems.length) {
    html += `<div class="me-sec-label notranslate" translate="no">
      <i class="fa-solid fa-bolt" aria-hidden="true"></i>
      Disponível agora
    </div>`;
    activeItems.forEach(item => { html += _cardHtml(item); });
  }

  // Upcoming
  if (upcomingItems.length) {
    html += `<div class="me-sec-label notranslate" translate="no">
      <i class="fa-solid fa-clock" aria-hidden="true"></i>
      Em breve
    </div>`;
    upcomingItems.forEach(item => { html += _cardHtml(item); });
  }

  // Others
  if (otherItems.length) {
    html += `<div class="me-sec-label notranslate" translate="no">
      <i class="fa-solid fa-list" aria-hidden="true"></i>
      Outras disciplinas
    </div>`;
    otherItems.forEach(item => { html += _cardHtml(item); });
  }

  // No exam dates set at all
  if (!activeItems.length && !upcomingItems.length) {
    html += _noActiveDatesHtml(subjectItems);
  }

  // Rules card
  html += _rulesHtml();

  el.innerHTML = html;

  // Wire active card taps
  el.querySelectorAll('.me-card.active').forEach(card => {
    card.querySelector('.me-card-inner')
      ?.addEventListener('click', () => {
        const subject   = card.dataset.subject;
        const dbSubject = card.dataset.dbsubject;
        _startExam(subject, dbSubject);
      });
  });

  // No-date cards — tap goes to Perfil
  el.querySelectorAll('.me-card.no-date').forEach(card => {
    card.querySelector('.me-card-inner')
      ?.addEventListener('click', () => {
        router.navigate('/panel/perfil');
      });
  });
}

// ============================================================
// CARD HTML
// ============================================================

function _cardHtml(item) {
  const { subject, examDate, status, days } = item;

  const statusLabels = {
    active:    '<i class="fa-solid fa-bolt"></i> Disponível',
    upcoming:  '<i class="fa-solid fa-clock"></i> Em breve',
    completed: '<i class="fa-solid fa-check"></i> Concluído',
    expired:   '<i class="fa-solid fa-lock"></i> Expirado',
    'no-date': '<i class="fa-solid fa-calendar-plus"></i> Definir data',
  };

  const dateLabel = examDate
    ? `<i class="fa-solid fa-calendar-day"></i> ${_esc(_formatDate(examDate))}`
    : '<i class="fa-solid fa-calendar-xmark"></i> Sem data definida';

  let countdownHtml = '';
  if (status === 'active' && days !== null) {
    const expiryTime = _expiryDateTime(examDate);
    const hoursLeft  = Math.max(0, Math.round((expiryTime - new Date()) / 3600000));
    if (days === 0) {
      countdownHtml = `
        <div class="me-countdown notranslate" translate="no">
          <i class="fa-solid fa-hourglass-half"></i>
          Expira em ${hoursLeft}h — dia do exame
        </div>`;
    } else {
      countdownHtml = `
        <div class="me-countdown notranslate" translate="no">
          <i class="fa-solid fa-hourglass-half"></i>
          Disponível por mais ${days} dia${days !== 1 ? 's' : ''}
        </div>`;
    }
  }

  if (status === 'upcoming' && days !== null) {
    countdownHtml = `
      <div class="me-countdown notranslate" translate="no" style="color:var(--primary);">
        <i class="fa-solid fa-clock" style="color:var(--primary);"></i>
        Disponível em ${days} dia${days !== 1 ? 's' : ''}
      </div>`;
  }

  const isClickable = status === 'active' || status === 'no-date';

  return `
    <div class="me-card ${_esc(status)} notranslate" translate="no"
      data-subject="${_esc(subject)}"
      data-dbsubject="${_esc(String(item.dbSubject))}">
      <div class="me-card-inner">
        <div class="me-card-icon">
          <i class="fa-solid ${_icon(subject)}" aria-hidden="true"></i>
        </div>
        <div class="me-card-body">
          <div class="me-card-subject">${_esc(subject)}</div>
          <div class="me-card-date">${dateLabel}</div>
          <span class="me-status-badge ${_esc(status)}">${statusLabels[status] || status}</span>
          ${countdownHtml}
        </div>
        <i class="fa-solid fa-chevron-right me-card-arrow" aria-hidden="true"></i>
      </div>
    </div>`;
}

// ============================================================
// NO SUBJECTS STATE
// ============================================================

function _noSubjectsHtml() {
  return `
    <div class="me-no-dates">
      <div class="me-no-dates-icon">
        <i class="fa-solid fa-book-open" aria-hidden="true"></i>
      </div>
      <div class="me-no-dates-title notranslate" translate="no">
        Sem disciplinas no perfil
      </div>
      <div class="me-no-dates-sub notranslate" translate="no">
        Complete o perfil para activar o Meu Exame nas suas disciplinas.
      </div>
      <button class="me-btn-perfil notranslate" translate="no"
        onclick="import('/panel/js/core/router.js').then(m=>m.router.navigate('/panel/perfil'))">
        <i class="fa-solid fa-user" aria-hidden="true"></i>
        Ir para o Perfil
      </button>
    </div>`;
}

// ============================================================
// NO ACTIVE DATES STATE (subjects exist but no dates set)
// ============================================================

function _noActiveDatesHtml(items) {
  const hasAnyDate = items.some(i => i.examDate);
  if (hasAnyDate) return ''; // dates exist but none active — cards already shown above

  return `
    <div class="me-no-dates">
      <div class="me-no-dates-icon">
        <i class="fa-solid fa-calendar-plus" aria-hidden="true"></i>
      </div>
      <div class="me-no-dates-title notranslate" translate="no">
        Defina as datas dos exames
      </div>
      <div class="me-no-dates-sub notranslate" translate="no">
        O Meu Exame fica disponível 3 dias antes de cada exame.
        Defina as datas no Perfil para activar esta funcionalidade.
      </div>
      <button class="me-btn-perfil notranslate" translate="no"
        onclick="import('/panel/js/core/router.js').then(m=>m.router.navigate('/panel/perfil'))">
        <i class="fa-solid fa-calendar-plus" aria-hidden="true"></i>
        Definir Datas no Perfil
      </button>
    </div>`;
}

// ============================================================
// RULES CARD
// ============================================================

function _rulesHtml() {
  return `
    <div class="me-rules">
      <div class="me-rules-head notranslate" translate="no">
        <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
        Condições do Meu Exame
      </div>
      <div class="me-rules-body">
        <div class="me-rule">
          <div class="me-rule-dot"></div>
          <span class="notranslate" translate="no">
            Uma única tentativa por disciplina — sem excepções.
          </span>
        </div>
        <div class="me-rule">
          <div class="me-rule-dot"></div>
          <span class="notranslate" translate="no">
            Disponível 3 dias antes do exame. Expira às 12h00 do dia do exame.
          </span>
        </div>
        <div class="me-rule">
          <div class="me-rule-dot"></div>
          <span class="notranslate" translate="no">
            Custo: 20 Moedas por disciplina. Deduzidas ao iniciar.
          </span>
        </div>
        <div class="me-rule">
          <div class="me-rule-dot"></div>
          <span class="notranslate" translate="no">
            Resultados imediatos com PDF descarregável após submissão.
          </span>
        </div>
        <div class="me-rule">
          <div class="me-rule-dot"></div>
          <span class="notranslate" translate="no">
            O sistema regista saídas do ecrã durante o exame.
          </span>
        </div>
      </div>
    </div>`;
}

// ============================================================
// START EXAM — Moedas check + session handoff
// ============================================================

function _startExam(subject, dbSubject) {
  const balance = moeda.getBalance(_userData);
  const cost    = moeda.COSTS.MEU_EXAME;

  if (balance < cost) {
    moeda.showMoedasSheet(balance, cost);
    return;
  }

  // Confirm before starting — one attempt only
  ui.openBottomSheet({
    title: 'Iniciar Meu Exame',
    content: `
      <div style="font-size:14px;color:var(--text-secondary);line-height:1.7;margin-bottom:16px;">
        Está prestes a iniciar o Meu Exame de
        <strong style="color:var(--text);">${_esc(subject)}</strong>.
      </div>
      <div style="background:rgba(255,179,0,0.08);border:1px solid rgba(255,179,0,0.25);
        border-radius:var(--radius-md);padding:12px 14px;margin-bottom:16px;
        font-size:12px;color:#92400E;line-height:1.6;">
        <i class="fa-solid fa-triangle-exclamation" style="margin-right:6px;"></i>
        <strong>Atenção:</strong> esta é a sua única tentativa.
        Serão deduzidas <strong>20 Moedas</strong> ao iniciar.
        Uma vez iniciado, o exame não pode ser pausado.
      </div>
      <div style="font-size:12px;color:var(--text-muted);line-height:1.6;">
        Certifique-se de estar num local calmo, com boa ligação à internet
        e tempo suficiente para completar o exame sem interrupções.
      </div>
    `,
    actions: [
      {
        label:   'Iniciar Agora',
        primary: true,
        onClick: () => {
          _launchRender(subject, dbSubject);
        },
      },
      {
        label:    'Cancelar',
        dismiss:  true,
        onClick:  () => ui.closeBottomSheet(),
      },
    ],
  });
}

function _launchRender(subject, dbSubject) {
  session.meuExame = {
    subject,
    dbSubject,
    userId:   _user.uid,
    userData: _userData,
    cost:     moeda.COSTS.MEU_EXAME,
  };
  router.navigate('/panel/renders/meu-exame-render');
}

// ============================================================
// EXPORT
// ============================================================

export default MeuExameScreen;
