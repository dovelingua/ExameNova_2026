// ============================================================
// ExameNova — Dashboard Screen
// File: panel/js/screens/dashboard/dashboard.js
// keepAlive: true — the ONLY screen with keepAlive
//
// ASSUMPTIONS FLAGGED FOR TEACHER DOVE — confirm before relying on these:
// 1. userData.lastDesafioDate ('YYYY-MM-DD' string) — assumed to be
//    written by desafio.js on daily challenge completion. NOT YET
//    CONFIRMED to exist in the users doc. Used here only to show
//    done/not-done state — if missing, card always shows "not done".
// 2. userData.examDates ({ subject: 'YYYY-MM-DD' }) — spec-defined
//    shape, used to compute nearest upcoming exam. If empty/absent,
//    the countdown block is hidden entirely (no placeholder shown).
// 3. Quick-access grid is curated to 4 tiles (Simulação, Revisão,
//    Meu Exame, Bate-papo) — Dashboard/Progresso/Mentor/Perfil
//    already live in the navbar, so they're not duplicated here.
// 4. Motivational quote — static hardcoded array, deterministic by
//    day-of-year (same quote all day). No Worker/AI call.
// 5. No Firestore reads in init() — router's REFRESH_SCREENS already
//    refreshes userData before dashboard.init() runs, so everything
//    here renders straight from the userData argument.
// ============================================================

import { router } from '../../core/router.js';
import { ui }     from '../../core/ui.js';
import {
  getCourseById,
  getInstitutionById,
} from '../../core/app.js';
import { moeda } from '../../core/moeda.js';

// ── Quick access tiles — curated set, see assumption 3 ───────
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
  },
  {
    route: '/panel/bate-papo',
    icon:  'fa-solid fa-comments',
    label: 'Bate-papo',
    bg:    'var(--accent-light)',
    color: 'var(--accent)',
  },
];

// ── Motivational quotes — static, rotates by day-of-year ─────
const QUOTES = [
  'Cada pergunta respondida é um passo mais perto do teu objectivo.',
  'A consistência de hoje é a aprovação de amanhã.',
  'Não precisas de ser perfeito — precisas de continuar a tentar.',
  'O teu futuro está a ser construído agora, questão a questão.',
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

// ── Profile summary line — human-readable exam context ───────
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

// ── Nearest upcoming exam from examDates — see assumption 2 ──
function _nearestExam(examDates) {
  if (!examDates || typeof examDates !== 'object') return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let nearest = null;
  for (const [subject, dateStr] of Object.entries(examDates)) {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) continue;
    d.setHours(0, 0, 0, 0);
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
  const diff = date.getTime() - today.getTime();
  return Math.round(diff / 86400000);
}

// ── Desafio Diário status — see assumption 1 ──────────────────
function _todayStr() {
  return new Date().toISOString().slice(0, 10);
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

      /* ── GREETING BANNER ── */
      .dash-banner {
        background: linear-gradient(135deg, #0044CC 0%, #0057FF 55%, #1976D2 100%);
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

      .dash-greeting-label {
        font-size: 12px;
        font-weight: 600;
        color: rgba(255,255,255,0.65);
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

      .dash-stat-label {
        font-size: 11px;
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

      /* ── EXAM COUNTDOWN ── */
      .countdown-card {
        background: linear-gradient(135deg, rgba(124,58,237,0.08) 0%, rgba(124,58,237,0.03) 100%);
        border: 1px solid rgba(124,58,237,0.25);
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
        font-size: 9px;
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
        color: var(--accent);
        margin-bottom: 10px;
        display: block;
      }

      .quote-text {
        font-size: 13px;
        font-style: italic;
        color: var(--text-secondary);
        line-height: 1.6;
      }

      /* ── DARK MODE ── */
      [data-theme="dark"] .dash-stat-card,
      [data-theme="dark"] .quick-card,
      [data-theme="dark"] .desafio-card,
      [data-theme="dark"] .quote-card {
        background: var(--bg-card);
        border-color: var(--border);
      }

      [data-theme="dark"] .dash-banner::after { background: var(--bg); }

      /* ── RESPONSIVE ── */
      @media (min-width: 768px) {
        .dash-banner  { padding: 28px 28px 38px; }
        .dash-stats-row { padding: 0 24px; }
        .dash-section { padding: 24px 24px 0; }
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
          <div class="dash-banner-dot" style="width:160px;height:160px;top:-60px;right:-40px;"></div>
          <div class="dash-banner-dot" style="width:80px;height:80px;bottom:16px;left:16px;"></div>
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
            <div class="dash-stat-icon" style="background:var(--moeda-light);">
              <i class="fa-solid fa-coins" style="color:var(--moeda);"></i>
            </div>
            <div>
              <div class="dash-stat-label notranslate" translate="no">Moedas</div>
              <div class="dash-stat-value notranslate" translate="no" id="dash-moedas-val">—</div>
            </div>
          </div>
          <div class="dash-stat-card" id="dash-subjects-card">
            <div class="dash-stat-icon" style="background:var(--primary-light);">
              <i class="fa-solid fa-book" style="color:var(--primary);"></i>
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
            <div class="desafio-icon-wrap" id="dash-desafio-icon">
              <i class="fa-solid fa-bolt"></i>
            </div>
            <div class="desafio-body">
              <div class="desafio-title" id="dash-desafio-title">Desafio de hoje</div>
              <div class="desafio-sub" id="dash-desafio-sub">Toca para começar</div>
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
            <div class="countdown-days" id="dash-countdown-days">
              —
              <span class="notranslate" translate="no">dias</span>
            </div>
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

    // 1. Header — wordmark + dark toggle + Moedas pill
    ui.renderHeader({
      showWordmark:   true,
      backRoute:      null,
      showDarkToggle: true,
      moedasBalance:  moeda.getBalance(userData),
    });

    // 2. Navbar
    ui.renderNavbar('dashboard');

    // 3. Greeting
    const firstName = (userData?.fullName || '').split(' ')[0] || 'Estudante';
    const hour      = new Date().getHours();
    const greeting  = hour >= 5 && hour < 12 ? 'Bom dia'
                     : hour >= 12 && hour < 18 ? 'Boa tarde'
                     : 'Boa noite';

    const nameEl = document.getElementById('dash-greeting-name');
    if (nameEl) nameEl.textContent = `${greeting}, ${firstName}!`;

    const profileText = _profileSummary(userData);
    const pillEl = document.getElementById('dash-profile-pill');
    const pillTextEl = document.getElementById('dash-profile-text');
    if (profileText && pillEl && pillTextEl) {
      pillTextEl.textContent = profileText;
      pillEl.style.display = 'inline-flex';
    }

    // 4. Moedas stat
    const moedasVal = document.getElementById('dash-moedas-val');
    if (moedasVal) moedasVal.textContent = moeda.getBalance(userData);

    document.getElementById('dash-moedas-card')?.addEventListener('click', () => {
      moeda.showMoedasSheet(moeda.getBalance(userData));
    }, { once: true });

    // 5. Subjects stat
    const subjectsVal = document.getElementById('dash-subjects-val');
    const subjectCount = Array.isArray(userData?.subjects) ? userData.subjects.length : 0;
    if (subjectsVal) subjectsVal.textContent = subjectCount || '—';

    document.getElementById('dash-subjects-card')?.addEventListener('click', () => {
      router.navigate('/panel/perfil');
    }, { once: true });

    // 6. Desafio Diário card — see assumption 1
    const done = _desafioDoneToday(userData);
    const iconWrap = document.getElementById('dash-desafio-icon');
    const titleEl  = document.getElementById('dash-desafio-title');
    const subEl    = document.getElementById('dash-desafio-sub');

    if (done) {
      iconWrap?.classList.add('done');
      if (iconWrap) iconWrap.innerHTML = '<i class="fa-solid fa-check"></i>';
      if (titleEl) titleEl.textContent = 'Desafio concluído!';
      if (subEl) subEl.textContent = 'Volta amanhã para mais Moedas';
    } else {
      iconWrap?.classList.add('pending');
      if (titleEl) titleEl.textContent = 'Desafio de hoje';
      if (subEl) subEl.textContent = 'Responde e ganha Moedas';
    }

    document.getElementById('dash-desafio-card')?.addEventListener('click', () => {
      router.navigate('/panel/desafio');
    }, { once: true });

    // 7. Exam countdown — see assumption 2
    const nearest = _nearestExam(userData?.examDates);
    if (nearest) {
      const section = document.getElementById('dash-countdown-section');
      const daysEl  = document.getElementById('dash-countdown-days');
      const titleEl2 = document.getElementById('dash-countdown-title');
      const subEl2   = document.getElementById('dash-countdown-sub');

      const days = _daysUntil(nearest.date);

      if (section) section.style.display = 'block';
      if (titleEl2) titleEl2.textContent = `Exame de ${nearest.subject}`;
      if (subEl2) {
        subEl2.textContent = days === 0
          ? 'É hoje!'
          : nearest.date.toLocaleDateString('pt-PT', { day: 'numeric', month: 'long' });
      }
      if (daysEl) {
        daysEl.innerHTML = `${days}<span class="notranslate" translate="no">dias</span>`;
      }
    }

    // 8. Quick actions grid
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

      gridMount.querySelectorAll('.quick-card').forEach(btn => {
        btn.addEventListener('click', () => router.navigate(btn.dataset.route), { once: true });
      });
    }

    // 9. Motivational quote
    const quoteEl = document.getElementById('dash-quote-text');
    if (quoteEl) quoteEl.textContent = _todayQuote();
  },

  // No destroy() — dashboard has keepAlive: true, so it is
  // never destroyed, and it has no timers/listeners that
  // would leak (all listeners use { once: true }).

};

export default DashboardScreen;
