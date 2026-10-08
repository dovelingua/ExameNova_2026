// ============================================================
// ExameNova — Dashboard Screen
// File: panel/js/screens/dashboard/dashboard.js
// keepAlive: true — the ONLY screen with keepAlive
//
// PALETTE: "Maré" — Primary Sky Blue #0284C7, Secondary Violet
// #8B5CF6, Accent Teal #14B8A6, Moedas gold #FFB300.
// All colours come from CSS variables defined in ui.js.
// Only the banner gradient uses fixed hex values.
//
// ASSUMPTIONS FLAGGED FOR TEACHER DOVE — confirm before relying on these:
// 1. userData.lastDesafioDate ('YYYY-MM-DD' string, LOCAL date) —
//    assumed to be written by desafio.js on completion, using the
//    SAME local-date format as _todayStr() below. NOT YET CONFIRMED.
//    If missing, the card always shows "not done".
// 2. userData.examDates ({ subject: 'YYYY-MM-DD' }) — spec-defined
//    shape. If empty/absent, the countdown block is hidden entirely.
// 3. Quick-access grid is curated to 4 tiles (Simulação, Revisão,
//    Meu Exame, Bate-papo) — the others live in the navbar.
// 4. Motivational quote — static array, deterministic by day-of-year.
// 5. No Firestore reads in init() — router refreshes userData first.
// 6. app.js must export getCourseById and getInstitutionById as
//    named exports. If it does not, this screen fails silently.
// ============================================================

import { router } from '../../core/router.js';
import { ui }     from '../../core/ui.js';
import {
  getCourseById,
  getInstitutionById,
} from '../../core/app.js';
import { moeda } from '../../core/moeda.js';
import { renderNavbar } from '../../core/navbar.js';

// Latest userData — updated on every init(), read by click handlers
// so handlers wired once never use stale data.
let _userData = null;

// ── Quick access tiles ───────────────────────────────────────
const QUICK_ACTIONS = [
  {
    route: '/panel/simulacao',
    icon:  'fa-solid fa-file-pen',
    label: 'Simulação',
    bg:    'var(--primary-light)',
    color: 'var(--primary)',
  },
  {
    route: '/panel/revisao',
    icon:  'fa-solid fa-rotate',
    label: 'Revisão de Erros',
    bg:    'var(--secondary-light)',
    color: 'var(--secondary)',
  },
  {
    route: '/panel/meu-exame',
    icon:  'fa-solid fa-graduation-cap',
    label: 'Meu Exame',
    bg:    'var(--moeda-light)',
    color: 'var(--moeda-dark)',
    badge: '🎓',
  },
  {
    route: '/panel/bate-papo',
    icon:  'fa-solid fa-comments',
    label: 'Bate-papo',
    bg:    'var(--accent-light)',
    color: 'var(--accent)',
  },
];

// ── Motivational quotes — formal Portuguese only ─────────────
const QUOTES = [
  'Cada pergunta respondida é um passo mais perto do seu objectivo.',
  'A consistência de hoje é a aprovação de amanhã.',
  'Não precisa de ser perfeito — precisa de continuar a tentar.',
  'O seu futuro está a ser construído agora, questão a questão.',
  'Quem estuda um pouco todos os dias, chega longe.',
  'A disciplina de hoje é o orgulho de amanhã.',
  'Grandes resultados começam com pequenos hábitos diários.',
];

function _dayOfYear(d) {
  const start = new Date(d.getFullYear(), 0, 0);
  const diff  = d - start;
  return Math.floor(diff / 86400000);
}

function _todayQuote() {
  const idx = _dayOfYear(new Date()) % QUOTES.length;
  return QUOTES[idx];
}

// Pattern C (guard flag) — wire an element only once, ever
function _wireOnce(el, event, handler) {
  if (!el || el._wired) return;
  el._wired = true;
  el.addEventListener(event, handler);
}

// ── Profile summary line ─────────────────────────────────────
function _profileSummary(userData) {
  if (!userData) return '';

  if (userData.examType === 'ensino-geral') {
    const grade  = userData.grade || '';
    const status = userData.status === 'repetente' ? 'Repetente' : 'Normal';
    let extra = '';
    if (grade === '9' && userData.status === 'repetente') {
      const sectionLabel = userData.section === 'letras' ? 'Secção de Letras'
        : userData.section === 'ciencias' ? 'Secção de Ciências'
        : 'Todas as disciplinas';
      extra = ` · ${sectionLabel}`;
    }
    return `${grade}ª Classe · ${status}${extra}`;
  }

  if (userData.examType === 'admissao') {
    if (userData.course) {
      const course = getCourseById(userData.course);
      return course ? `Admissão · ${course.label}` : 'Exame de Admissão';
    }
    if (userData.institution) {
      const inst = getInstitutionById(userData.institution);
      return inst ? `Admissão · ${inst.label}` : 'Exame de Admissão';
    }
  }

  return '';
}

// ── Date helpers — all LOCAL time (Mozambique is UTC+2) ──────
function _parseLocalDate(dateStr) {
  // 'YYYY-MM-DD' → local midnight (avoids UTC day-shift)
  const parts = String(dateStr).split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function _todayStr() {
  const d  = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function _nearestExam(examDates) {
  if (!examDates || typeof examDates !== 'object') return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let nearest = null;
  for (const [subject, dateStr] of Object.entries(examDates)) {
    const d = _parseLocalDate(dateStr);
    if (!d || isNaN(d.getTime())) continue;
    if (d < today) continue;
    if (!nearest || d < nearest.date) {
      nearest = { subject, date: d };
    }
  }
  return nearest;
}

function _daysUntil(date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - today.getTime()) / 86400000);
}

function _desafioDoneToday(userData) {
  return userData?.lastDesafioDate === _todayStr();
}

const DashboardScreen = {

  keepAlive: true,

  // ----------------------------------------------------------
  // CSS
  // ----------------------------------------------------------
  css() {
    if (document.getElementById('dashboard-styles')) return '';
    return `<style id="dashboard-styles">

      .dash-wrap {
        min-height: 100dvh;
        background: var(--bg);
        padding-bottom: calc(var(--navbar-height) + 20px);
      }

      /* ── GREETING BANNER (Maré gradient) ── */
      .dash-banner {
        background: linear-gradient(135deg, #0369A1 0%, #0284C7 55%, #0E9AA7 100%);
        padding: 20px 20px 30px;
        position: relative;
        overflow: hidden;
      }

      .dash-banner::after {
        content: '';
        position: absolute;
        bottom: -20px; left: 0; right: 0;
        height: 40px;
        background: var(--bg);
        border-radius: 50% 50% 0 0 / 100% 100% 0 0;
      }

      .dash-banner-dot {
        position: absolute;
        border-radius: 50%;
        opacity: 0.08;
        background: #fff;
      }

      .dash-banner-dot--a { width: 160px; height: 160px; top: -60px; right: -40px; }
      .dash-banner-dot--b { width: 80px;  height: 80px;  bottom: 16px; left: 16px; }

      .dash-greeting-label {
        font-size: 12px;
        font-weight: 600;
        color: rgba(255,255,255,0.9);
        text-transform: uppercase;
        letter-spacing: 0.1em;
        margin-bottom: 4px;
        position: relative; z-index: 1;
      }

      .dash-greeting-name {
        font-size: 23px;
        font-weight: 800;
        color: #fff;
        line-height: 1.25;
        margin-bottom: 6px;
        letter-spacing: -0.4px;
        position: relative; z-index: 1;
      }

      .dash-profile-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: rgba(255,255,255,0.15);
        border: 1px solid rgba(255,255,255,0.25);
        border-radius: var(--radius-full);
        padding: 5px 12px;
        font-size: 12px;
        font-weight: 600;
        color: #fff;
        position: relative; z-index: 1;
      }

      /* ── STATS ROW ── */
      .dash-stats-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        padding: 0 16px;
        margin-top: 8px;
        position: relative;
        z-index: 1;
      }

      .dash-stat-card {
        background: var(--bg-card);
        border-radius: var(--radius-lg);
        padding: 14px 16px;
        border: 1px solid var(--border);
        box-shadow: var(--shadow-sm);
        display: flex;
        align-items: center;
        gap: 12px;
        cursor: pointer;
        min-height: 64px;
      }

      .dash-stat-icon {
        width: 38px; height: 38px;
        border-radius: var(--radius-md);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        flex-shrink: 0;
      }

      .dash-stat-icon--moeda   { background: var(--moeda-light); }
      .dash-stat-icon--moeda i { color: var(--moeda); }
      .dash-stat-icon--book    { background: var(--primary-light); }
      .dash-stat-icon--book i  { color: var(--primary); }

      .dash-stat-label {
        font-size: 12px;
        font-weight: 600;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        margin-bottom: 2px;
      }

      .dash-stat-value {
        font-size: 19px;
        font-weight: 800;
        color: var(--text);
        line-height: 1;
        letter-spacing: -0.4px;
      }

      /* ── SECTIONS ── */
      .dash-section { padding: 20px 16px 0; }

      .dash-section-title {
        font-size: 15px;
        font-weight: 700;
        color: var(--text);
        position: relative;
        padding-left: 10px;
        margin-bottom: 12px;
      }

      .dash-section-title::before {
        content: '';
        position: absolute;
        left: 0; top: 50%;
        transform: translateY(-50%);
        width: 3px; height: 16px;
        background: var(--primary);
        border-radius: var(--radius-full);
      }

      /* ── DESAFIO CARD ── */
      .desafio-card {
        display: flex;
        align-items: center;
        gap: 14px;
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        padding: 16px;
        box-shadow: var(--shadow-sm);
        cursor: pointer;
        width: 100%;
        text-align: left;
        transition: transform 0.15s ease;
      }

      .desafio-card:active { transform: scale(0.98); }

      .desafio-icon-wrap {
        width: 46px; height: 46px;
        border-radius: var(--radius-md);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 19px;
        flex-shrink: 0;
      }

      .desafio-icon-wrap.pending {
        background: var(--accent-light);
        color: var(--accent);
      }

      .desafio-icon-wrap.done {
        background: var(--success-light);
        color: var(--success);
      }

      .desafio-body { flex: 1; min-width: 0; }

      .desafio-title {
        font-size: 14px;
        font-weight: 700;
        color: var(--text);
        margin-bottom: 2px;
      }

      .desafio-sub {
        font-size: 12px;
        color: var(--text-secondary);
      }

      .desafio-arrow {
        color: var(--text-muted);
        font-size: 13px;
        flex-shrink: 0;
      }

      /* ── EXAM COUNTDOWN (teal accent) ── */
      .countdown-card {
        background: var(--accent-light);
        border: 1px solid var(--border);
        border-left: 3px solid var(--accent);
        border-radius: var(--radius-lg);
        padding: 14px 16px;
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .countdown-icon {
        font-size: 18px;
        color: var(--accent);
        flex-shrink: 0;
      }

      .countdown-body { flex: 1; min-width: 0; }

      .countdown-title {
        font-size: 13px;
        font-weight: 700;
        color: var(--text);
        margin-bottom: 2px;
      }

      .countdown-sub {
        font-size: 12px;
        color: var(--text-secondary);
      }

      .countdown-days {
        font-size: 22px;
        font-weight: 800;
        color: var(--accent);
        line-height: 1;
        flex-shrink: 0;
      }

      .countdown-days span {
        display: block;
        font-size: 12px;
        font-weight: 600;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        margin-top: 2px;
        text-align: center;
      }

      /* ── QUICK ACTIONS GRID ── */
      .quick-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 10px;
      }

      @media (min-width: 480px)  { .quick-grid { grid-template-columns: repeat(4, 1fr); } }
      @media (min-width: 1025px) { .quick-grid { gap: 14px; } }

      .quick-card {
        background: var(--bg-card);
        border-radius: var(--radius-lg);
        padding: 14px 12px;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
        cursor: pointer;
        border: 1px solid var(--border);
        box-shadow: var(--shadow-sm);
        transition: transform 0.15s ease, box-shadow 0.15s ease;
        min-height: 88px;
        text-align: left;
        width: 100%;
      }

      .quick-card:hover  { transform: translateY(-2px); box-shadow: var(--shadow-md); }
      .quick-card:active { transform: scale(0.96); }

      .quick-card-icon {
        width: 36px; height: 36px;
        border-radius: var(--radius-md);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 15px;
        flex-shrink: 0;
      }

      .quick-card-label {
        font-size: 12px;
        font-weight: 700;
        color: var(--text);
        line-height: 1.3;
      }

      /* ── MOTIVATIONAL QUOTE ── */
      .quote-card {
        background: var(--bg-card);
        border: 1px dashed var(--border);
        border-radius: var(--radius-lg);
        padding: 18px 20px;
        text-align: center;
      }

      .quote-icon {
        font-size: 16px;
        color: var(--secondary);
        margin-bottom: 10px;
        display: block;
      }

      .quote-text {
        font-size: 13px;
        font-style: italic;
        color: var(--text-secondary);
        line-height: 1.6;
      }

      /* ── DESAFIO EMOJI ANIMATIONS ── */
      @keyframes dashFireFlicker {
        from { transform: scale(1) rotate(-4deg); }
        to   { transform: scale(1.18) rotate(4deg); }
      }
      @keyframes dashTrophyBounce {
        0%, 100% { transform: translateY(0) scale(1); }
        40%      { transform: translateY(-6px) scale(1.12); }
        60%      { transform: translateY(-3px) scale(1.06); }
      }

      /* ── DARK MODE ── */
      [data-theme="dark"] .dash-banner {
        background: linear-gradient(135deg, #075985 0%, #0369A1 55%, #0F766E 100%);
      }

      /* ── RESPONSIVE ── */
      @media (min-width: 768px) {
        .dash-banner    { padding: 28px 28px 38px; }
        .dash-stats-row { padding: 0 24px; }
        .dash-section   { padding: 24px 24px 0; }
      }

      @media (min-width: 1025px) {
        .dash-wrap   { max-width: 800px; margin: 0 auto; }
        .dash-banner { border-radius: 0 0 var(--radius-xl) var(--radius-xl); }
      }

    </style>`;
  },

  // ----------------------------------------------------------
  // MOUNT
  // ----------------------------------------------------------
  mount() {
    return `
      <div class="dash-wrap">

        <div id="header-mount"></div>

        <!-- GREETING BANNER -->
        <div class="dash-banner">
          <div class="dash-banner-dot dash-banner-dot--a"></div>
          <div class="dash-banner-dot dash-banner-dot--b"></div>
          <div class="dash-greeting-label notranslate" translate="no">Bem-vindo de volta</div>
          <div class="dash-greeting-name notranslate" translate="no" id="dash-greeting-name">Estudante</div>
          <div class="dash-profile-pill notranslate" translate="no" id="dash-profile-pill" style="display:none;">
            <i class="fa-solid fa-graduation-cap"></i>
            <span id="dash-profile-text"></span>
          </div>
        </div>

        <!-- STATS ROW -->
        <div class="dash-stats-row">
          <div class="dash-stat-card" id="dash-moedas-card">
            <div class="dash-stat-icon dash-stat-icon--moeda">
              <i class="fa-solid fa-coins"></i>
            </div>
            <div>
              <div class="dash-stat-label notranslate" translate="no">Moedas</div>
              <div class="dash-stat-value notranslate" translate="no" id="dash-moedas-val">—</div>
            </div>
          </div>
          <div class="dash-stat-card" id="dash-subjects-card">
            <div class="dash-stat-icon dash-stat-icon--book">
              <i class="fa-solid fa-book"></i>
            </div>
            <div>
              <div class="dash-stat-label notranslate" translate="no">Disciplinas</div>
              <div class="dash-stat-value notranslate" translate="no" id="dash-subjects-val">—</div>
            </div>
          </div>
        </div>

        <!-- DESAFIO DIÁRIO -->
        <div class="dash-section">
          <h2 class="dash-section-title notranslate" translate="no">Desafio Diário</h2>
          <button class="desafio-card notranslate" translate="no" id="dash-desafio-card">
            <div class="desafio-icon-wrap pending" id="dash-desafio-icon">
              <i class="fa-solid fa-bolt"></i>
            </div>
            <div class="desafio-body">
              <div class="desafio-title" id="dash-desafio-title">Desafio de hoje</div>
              <div class="desafio-sub" id="dash-desafio-sub">Toque para começar</div>
            </div>
            <i class="fa-solid fa-chevron-right desafio-arrow"></i>
          </button>
        </div>

        <!-- EXAM COUNTDOWN (hidden unless examDates has a future entry) -->
        <div class="dash-section" id="dash-countdown-section" style="display:none;">
          <div class="countdown-card">
            <i class="fa-solid fa-hourglass-half countdown-icon"></i>
            <div class="countdown-body">
              <div class="countdown-title notranslate" translate="no" id="dash-countdown-title"></div>
              <div class="countdown-sub notranslate" translate="no" id="dash-countdown-sub"></div>
            </div>
            <div class="countdown-days notranslate" translate="no" id="dash-countdown-days"></div>
          </div>
        </div>

        <!-- QUICK ACTIONS -->
        <div class="dash-section">
          <h2 class="dash-section-title notranslate" translate="no">Acesso Rápido</h2>
          <div class="quick-grid" id="quick-grid-mount"></div>
        </div>

        <!-- MOTIVATIONAL QUOTE -->
        <div class="dash-section" style="padding-bottom:8px;">
          <div class="quote-card">
            <i class="fa-solid fa-quote-left quote-icon"></i>
            <div class="quote-text notranslate" translate="no" id="dash-quote-text"></div>
          </div>
        </div>

      </div>
    `;
  },

  // ----------------------------------------------------------
  // INIT
  // ----------------------------------------------------------
  async init(user, userData, params) {

    // Keep the latest data for handlers wired only once
    _userData = userData;

    // 1. Header — wordmark + dark toggle + Moedas pill
    ui.renderHeader({
      showWordmark:   true,
      backRoute:      null,
      showDarkToggle: true,
      moedasBalance:  moeda.getBalance(userData),
      actionButton:   {
        id:    'dash-help-btn',
        icon:  'fa-solid fa-headset',
        label: 'Ajuda e Suporte',
      },
    });

    // 2. Navbar
    renderNavbar('dashboard');

    // 3. Help button
    _wireOnce(document.getElementById('dash-help-btn'), 'click', () => {
      _openHelpSheet(_userData);
    });

    // 4. Greeting
    const firstName = (userData?.fullName || '').split(' ')[0] || 'Estudante';
    const hour      = new Date().getHours();
    const greeting  = hour >= 5 && hour < 12 ? 'Bom dia'
                     : hour >= 12 && hour < 18 ? 'Boa tarde'
                     : 'Boa noite';

    const nameEl = document.getElementById('dash-greeting-name');
    if (nameEl) nameEl.textContent = `${greeting}, ${firstName}!`;

    const profileText = _profileSummary(userData);
    const pillEl     = document.getElementById('dash-profile-pill');
    const pillTextEl = document.getElementById('dash-profile-text');
    if (pillEl && pillTextEl) {
      if (profileText) {
        pillTextEl.textContent = profileText;
        pillEl.style.display = 'inline-flex';
      } else {
        pillEl.style.display = 'none';
      }
    }

    // 4. Moedas stat — handler reads the latest userData on every tap
    const moedasVal = document.getElementById('dash-moedas-val');
    if (moedasVal) moedasVal.textContent = moeda.getBalance(userData);

    _wireOnce(document.getElementById('dash-moedas-card'), 'click', () => {
      moeda.showMoedasSheet(moeda.getBalance(_userData));
    });

    // 5. Subjects stat
    const subjectsVal  = document.getElementById('dash-subjects-val');
    const subjectCount = Array.isArray(userData?.subjects) ? userData.subjects.length : 0;
    if (subjectsVal) subjectsVal.textContent = subjectCount || '—';

    _wireOnce(document.getElementById('dash-subjects-card'), 'click', () => {
      router.navigate('/panel/perfil');
    });

    // 6. Desafio Diário card
    const done     = _desafioDoneToday(userData);
    const iconWrap = document.getElementById('dash-desafio-icon');
    const titleEl  = document.getElementById('dash-desafio-title');
    const subEl    = document.getElementById('dash-desafio-sub');

    if (iconWrap) {
      iconWrap.className = `desafio-icon-wrap ${done ? 'done' : 'pending'}`;
      iconWrap.style.background = 'none';
      iconWrap.style.fontSize = '24px';
      iconWrap.style.animation = done
        ? 'none'
        : 'dashFireFlicker 1.4s ease-in-out infinite alternate';
      iconWrap.innerHTML = done ? '🏆' : '🔥';
    }
    if (titleEl) titleEl.textContent = done ? 'Desafio concluído!' : 'Desafio de hoje';
    if (subEl) {
      subEl.textContent = done
        ? 'Volte amanhã para ganhar mais Moedas'
        : 'Responda e ganhe Moedas';
    }

    _wireOnce(document.getElementById('dash-desafio-card'), 'click', () => {
      router.navigate('/panel/desafio');
    });

    // 7. Exam countdown
    const section = document.getElementById('dash-countdown-section');
    const nearest = _nearestExam(userData?.examDates);

    if (nearest && section) {
      const days     = _daysUntil(nearest.date);
      const titleEl2 = document.getElementById('dash-countdown-title');
      const subEl2   = document.getElementById('dash-countdown-sub');
      const daysEl   = document.getElementById('dash-countdown-days');

      section.style.display = 'block';
      if (titleEl2) titleEl2.textContent = `Exame de ${nearest.subject}`;
      if (subEl2) {
        subEl2.textContent = days === 0
          ? 'É hoje!'
          : nearest.date.toLocaleDateString('pt-PT', { day: 'numeric', month: 'long' });
      }
      if (daysEl) {
        daysEl.innerHTML = `${days}<span>${days === 1 ? 'dia' : 'dias'}</span>`;
      }
    } else if (section) {
      section.style.display = 'none';
    }

    // 8. Quick actions grid — one delegated listener, wired once
    const gridMount = document.getElementById('quick-grid-mount');
    if (gridMount) {
      gridMount.innerHTML = QUICK_ACTIONS.map(action => `
        <button class="quick-card notranslate" translate="no" data-route="${action.route}">
          <div class="quick-card-icon" style="background:${action.bg};">
            <i class="${action.icon}" style="color:${action.color};"></i>
          </div>
          <span class="quick-card-label">${action.label}</span>
        </button>
      `).join('');

      _wireOnce(gridMount, 'click', (e) => {
        const btn = e.target.closest('[data-route]');
        if (btn) router.navigate(btn.dataset.route);
      });
    }

    // 9. Motivational quote
    const quoteEl = document.getElementById('dash-quote-text');
    if (quoteEl) quoteEl.textContent = _todayQuote();
  },

  // No destroy() — keepAlive screen. All listeners are wired once
  // with a guard flag, so nothing piles up or leaks.

};

// ============================================================
// HELP SHEET
// ============================================================

function _buildHelpMessage(userData) {
  if (!userData) return 'Olá, preciso de ajuda com o ExameNova.';
  if (userData.examType === 'ensino-geral') {
    const grade  = userData.grade ? `${userData.grade}ª Classe` : '';
    const status = userData.status === 'repetente' ? ' (Repetente)' : '';
    return `Olá, sou estudante da ${grade}${status} e preciso de ajuda com o ExameNova.`;
  }
  if (userData.examType === 'admissao') {
    if (userData.course)      return `Olá, sou estudante de Admissão — ${userData.course} — e preciso de ajuda com o ExameNova.`;
    if (userData.institution) return `Olá, sou estudante de Admissão — ${userData.institution} — e preciso de ajuda com o ExameNova.`;
    return 'Olá, sou estudante de Exame de Admissão e preciso de ajuda com o ExameNova.';
  }
  return 'Olá, preciso de ajuda com o ExameNova.';
}

function _openHelpSheet(userData) {
  const msg     = encodeURIComponent(_buildHelpMessage(userData));
  const waLink  = `https://wa.me/258848920143?text=${msg}`;
  const grpLink = 'https://chat.whatsapp.com/BWVRe4OMBdD9nwpAc2Jo0O';
  const chnLink = 'https://whatsapp.com/channel/0029Vazz6iMGzzKLDWc0aY0V';
  const telLink = 'tel:258865804379';

  ui.openBottomSheet({
    title: 'Ajuda e Suporte',
    content: `
      <div style="display:flex;flex-direction:column;gap:10px;">

        <button
          onclick="document.querySelector('.sheet-overlay')?.click()"
          style="position:absolute;top:16px;right:16px;
                 width:32px;height:32px;border-radius:50%;
                 background:var(--bg);
                 border:1.5px solid var(--border-subtle);
                 color:var(--text-muted);font-size:13px;
                 display:flex;align-items:center;justify-content:center;
                 cursor:pointer;z-index:10;">
          <i class="fa-solid fa-xmark"></i>
        </button>

        <a href="${waLink}" target="_blank" rel="noopener"
          style="display:flex;align-items:center;gap:14px;
                 padding:14px 16px;background:var(--bg);
                 border:1.5px solid var(--border);
                 border-radius:var(--radius-md);
                 text-decoration:none;color:var(--text);">
          <div style="width:44px;height:44px;border-radius:50%;
                      background:#25D366;flex-shrink:0;
                      display:flex;align-items:center;justify-content:center;
                      box-shadow:0 4px 12px rgba(37,211,102,0.35);">
            <i class="fa-brands fa-whatsapp" style="color:#fff;font-size:20px;"></i>
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:2px;">WhatsApp Directo</div>
            <div style="font-size:12px;color:var(--text-muted);">Fale connosco em privado</div>
          </div>
          <div style="width:28px;height:28px;border-radius:50%;
                      background:rgba(37,211,102,0.12);flex-shrink:0;
                      display:flex;align-items:center;justify-content:center;">
            <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:10px;color:#25D366;"></i>
          </div>
        </a>

        <a href="${telLink}"
          style="display:flex;align-items:center;gap:14px;
                 padding:14px 16px;background:var(--bg);
                 border:1.5px solid var(--border);
                 border-radius:var(--radius-md);
                 text-decoration:none;color:var(--text);">
          <div style="width:44px;height:44px;border-radius:50%;
                      background:var(--primary);flex-shrink:0;
                      display:flex;align-items:center;justify-content:center;
                      box-shadow:0 4px 12px rgba(2,132,199,0.35);">
            <i class="fa-solid fa-phone" style="color:#fff;font-size:18px;"></i>
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:2px;">Ligar</div>
            <div style="font-size:12px;color:var(--text-muted);">Chamada directa de voz</div>
          </div>
          <div style="width:28px;height:28px;border-radius:50%;
                      background:var(--primary-light);flex-shrink:0;
                      display:flex;align-items:center;justify-content:center;">
            <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:10px;color:var(--primary);"></i>
          </div>
        </a>

        <a href="${grpLink}" target="_blank" rel="noopener"
          style="display:flex;align-items:center;gap:14px;
                 padding:14px 16px;background:var(--bg);
                 border:1.5px solid var(--border);
                 border-radius:var(--radius-md);
                 text-decoration:none;color:var(--text);">
          <div style="width:44px;height:44px;border-radius:50%;
                      background:#25D366;flex-shrink:0;
                      display:flex;align-items:center;justify-content:center;
                      box-shadow:0 4px 12px rgba(37,211,102,0.35);">
            <i class="fa-brands fa-whatsapp" style="color:#fff;font-size:20px;"></i>
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:2px;">Grupo WhatsApp</div>
            <div style="font-size:12px;color:var(--text-muted);">Comunidade de estudantes</div>
          </div>
          <div style="width:28px;height:28px;border-radius:50%;
                      background:rgba(37,211,102,0.12);flex-shrink:0;
                      display:flex;align-items:center;justify-content:center;">
            <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:10px;color:#25D366;"></i>
          </div>
        </a>

        <a href="${chnLink}" target="_blank" rel="noopener"
          style="display:flex;align-items:center;gap:14px;
                 padding:14px 16px;background:var(--bg);
                 border:1.5px solid var(--border);
                 border-radius:var(--radius-md);
                 text-decoration:none;color:var(--text);">
          <div style="width:44px;height:44px;border-radius:50%;
                      background:var(--secondary);flex-shrink:0;
                      display:flex;align-items:center;justify-content:center;
                      box-shadow:0 4px 12px rgba(139,92,246,0.35);">
            <i class="fa-solid fa-satellite-dish" style="color:#fff;font-size:16px;"></i>
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:2px;">Canal WhatsApp</div>
            <div style="font-size:12px;color:var(--text-muted);">Novidades e actualizações</div>
          </div>
          <div style="width:28px;height:28px;border-radius:50%;
                      background:var(--secondary-light);flex-shrink:0;
                      display:flex;align-items:center;justify-content:center;">
            <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:10px;color:var(--secondary);"></i>
          </div>
        </a>

      </div>
    `,
    actions: [
      { label: 'Fechar', dismiss: true },
    ],
  });
}

export default DashboardScreen;
