// ============================================================
// panel/js/screens/auth/onboarding.js
// ExameNova — Onboarding Screen
// First-time profile setup. Runs ONCE — cannot be skipped.
// 3 steps — all branching handled in step 2.
// keepAlive: false | Navbar: absent | Header: absent
// ============================================================

import { auth, db }        from '../../core/firebase.js';
import { router }          from '../../core/router.js';
import { ui }              from '../../core/ui.js';
import { worker }          from '../../core/worker.js';
import { AWARDS }          from '../../core/moeda.js';
import {
  getProvinces,
  getDistrictsByProvince,
  getGrade9Subjects,
  getGrade12Subjects,
  getGroupId,
  getAllCourses,
  getAllInstitutions,
  GRADE12_ALL,
} from '../../core/app.js';

import {
  doc,
  setDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ============================================================
// CONSTANTS
// ============================================================

const TOTAL_STEPS = 3;

// Today as YYYY-MM-DD in LOCAL time (Mozambique is UTC+2)
function _todayLocal() {
  const d  = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// ============================================================
// SCREEN
// ============================================================

const OnboardingScreen = {

  // Internal state — reset on every init()
  _step:      1,
  _user:      null,
  _userData:  null,
  _firstName: '',
  _redirectTimer:  null,
  _countdownTimer: null,

  _data: {
    whatsapp:    '',
    province:    '',
    district:    '',
    schoolType:  '',
    school:      '',
    examType:    '',      // 'ensino-geral' | 'admissao'
    grade:       '',      // '9' | '12'
    status:      '',      // 'normal' | 'repetente'
    section:     '',      // 'letras' | 'ciencias' | 'all'
    subjects:    [],      // 12ª repetente selected subjects
    admissaoType:'',      // 'curso' | 'instituicao'
    course:      '',      // course id
    institution: '',      // institution id
    pairIndex:   0,       // 0 | 1
    examDates:   {},      // { subject: 'YYYY-MM-DD' }
  },

  // ── ROOM 1 — CSS ────────────────────────────────────────
  css() {
    if (document.getElementById('ob-styles')) return '';
    return `<style id="ob-styles">

      /* ── ROOT ── */
      .ob-root {
        min-height: 100dvh;
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        background: var(--bg);
        overflow-x: hidden;
        position: relative;
      }

      /* ── HERO ── */
      .ob-hero {
        width: 100%;
        background: linear-gradient(135deg, #0369A1 0%, #0284C7 60%, #0E9AA7 100%);
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 44px 24px 40px;
        position: relative;
        overflow: hidden;
        flex-shrink: 0;
      }

      .ob-hero-dot {
        position: absolute;
        border-radius: 50%;
        opacity: 0.07;
        background: #fff;
        pointer-events: none;
      }

      .ob-hero::after {
        content: '';
        position: absolute;
        bottom: -20px;
        left: 0; right: 0;
        height: 40px;
        background: var(--bg);
        border-radius: 50% 50% 0 0 / 100% 100% 0 0;
      }

      .ob-logo-img {
        width: min(180px, 50vw);
        height: auto;
        object-fit: contain;
        animation: obFadeDown 0.5s ease both;
      }

      /* ── PROGRESS ── */
      .ob-progress-wrap {
        margin-top: 18px;
        width: 100%;
        max-width: 320px;
        position: relative;
        z-index: 1;
        animation: obFadeDown 0.5s ease 0.06s both;
      }

      .ob-progress-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
      }

      .ob-progress-label {
        font-size: 0.68rem;
        font-weight: 700;
        color: rgba(255,255,255,0.7);
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .ob-progress-pill {
        font-size: 0.68rem;
        font-weight: 700;
        color: rgba(255,255,255,0.9);
        background: rgba(255,255,255,0.15);
        border: 1px solid rgba(255,255,255,0.25);
        border-radius: var(--radius-full);
        padding: 3px 10px;
      }

      .ob-progress-track {
        width: 100%;
        height: 4px;
        background: rgba(255,255,255,0.2);
        border-radius: var(--radius-full);
        overflow: hidden;
      }

      .ob-progress-fill {
        height: 100%;
        background: #fff;
        border-radius: var(--radius-full);
        transition: width 0.4s cubic-bezier(0.34,1.56,0.64,1);
      }

      /* Step dots */
      .ob-dots-row {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0;
        margin-top: 12px;
      }

      .ob-dot {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.62rem;
        font-weight: 800;
        flex-shrink: 0;
        transition: all 0.3s;
        border: 2px solid transparent;
      }
      .ob-dot.done    { background: rgba(255,255,255,0.25); border-color: rgba(255,255,255,0.4); color: #fff; }
      .ob-dot.active  { background: #fff; color: #0284C7; box-shadow: 0 0 0 4px rgba(255,255,255,0.2); }
      .ob-dot.pending { background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.2); color: rgba(255,255,255,0.4); }

      .ob-dot-line {
        flex: 1;
        max-width: 48px;
        height: 2px;
        background: rgba(255,255,255,0.2);
        transition: background 0.3s;
      }
      .ob-dot-line.done { background: rgba(255,255,255,0.5); }

      /* ── DARK TOGGLE ── */
      .ob-dark-toggle {
        position: fixed;
        top: 12px;
        right: 12px;
        z-index: 50;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: rgba(255,255,255,0.15);
        border: 1px solid rgba(255,255,255,0.25);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font-size: 14px;
        color: rgba(255,255,255,0.9);
        transition: background 0.2s;
        min-width: 36px;
        min-height: 36px;
      }
      .ob-dark-toggle:hover { background: rgba(255,255,255,0.25); }

      /* ── CARD AREA ── */
      .ob-card-area {
        width: 100%;
        max-width: 480px;
        padding: 28px 16px 60px;
        animation: obFadeUp 0.45s ease 0.1s both;
      }

      /* ── CARD ── */
      .ob-card {
        background: var(--bg-card);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-xl);
        padding: 22px 20px 24px;
        box-shadow: var(--shadow-lg);
      }
      [data-theme="dark"] .ob-card {
        border-color: rgba(255,255,255,0.06);
      }

      /* Card header */
      .ob-card-hdr {
        margin-bottom: 20px;
        padding-bottom: 16px;
        border-bottom: 1px solid var(--border-subtle);
      }

      .ob-eyebrow {
        font-size: 0.62rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--primary);
        margin-bottom: 5px;
        opacity: 0.85;
      }

      .ob-card-title {
        font-size: 1.1rem;
        font-weight: 800;
        color: var(--text);
        line-height: 1.3;
        margin-bottom: 4px;
        letter-spacing: -0.3px;
      }

      .ob-card-title .ob-hi { color: var(--primary); }

      .ob-card-sub {
        font-size: 0.78rem;
        color: var(--text-muted);
        line-height: 1.6;
      }

      /* ── FIELDS ── */
      .ob-field { margin-bottom: 14px; }

      .ob-field label {
        display: block;
        font-size: 0.72rem;
        font-weight: 700;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.07em;
        margin-bottom: 6px;
      }

      .ob-input {
        width: 100%;
        background: var(--bg-input);
        border: 1.5px solid var(--border);
        border-radius: var(--radius-md);
        padding: 13px 16px;
        font-family: inherit;
        font-size: 0.95rem;
        color: var(--text);
        outline: none;
        transition: border-color 0.2s, box-shadow 0.2s;
        -webkit-appearance: none;
        box-sizing: border-box;
      }
      .ob-input::placeholder { color: var(--text-muted); }
      .ob-input:focus {
        border-color: var(--primary);
        box-shadow: 0 0 0 3px rgba(2,132,199,0.15);
        background: var(--bg-card);
      }
      .ob-input.ob-err { border-color: var(--danger) !important; }

      /* Select */
      .ob-select {
        width: 100%;
        background: var(--bg-input);
        border: 1.5px solid var(--border);
        border-radius: var(--radius-md);
        padding: 13px 40px 13px 16px;
        font-family: inherit;
        font-size: 0.95rem;
        color: var(--text);
        outline: none;
        cursor: pointer;
        -webkit-appearance: none;
        appearance: none;
        box-sizing: border-box;
        transition: border-color 0.2s, box-shadow 0.2s;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%230057FF' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 14px center;
      }
      [data-theme="dark"] .ob-select {
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2338BDF8' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
      }
      .ob-select:focus {
        border-color: var(--primary);
        box-shadow: 0 0 0 3px rgba(2,132,199,0.15);
        background-color: var(--bg-card);
      }
      .ob-select:disabled { opacity: 0.45; cursor: not-allowed; }
      .ob-select.ob-err { border-color: var(--danger) !important; }
      [data-theme="dark"] .ob-select option { background: var(--bg-card); }

      /* Phone row */
      .ob-phone-row {
        display: flex;
        gap: 8px;
        align-items: stretch;
      }

      .ob-phone-prefix {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 0 14px;
        background: var(--primary-light);
        border: 1.5px solid var(--border);
        border-radius: var(--radius-md);
        font-size: 0.88rem;
        font-weight: 700;
        color: var(--primary);
        white-space: nowrap;
        flex-shrink: 0;
        height: 50px;
        min-width: 82px;
        justify-content: center;
      }

      /* Field error */
      .ob-ferr {
        font-size: 0.75rem;
        color: var(--danger);
        margin-top: 5px;
        font-weight: 500;
        display: none;
      }
      .ob-ferr.show { display: block; }

      /* ── CHIPS ── */
      .ob-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .ob-chip {
        padding: 10px 16px;
        background: var(--bg-input);
        border: 1.5px solid var(--border);
        border-radius: var(--radius-md);
        cursor: pointer;
        font-family: inherit;
        font-size: 0.85rem;
        font-weight: 700;
        color: var(--text-muted);
        transition: all 0.2s;
        user-select: none;
        white-space: nowrap;
        min-height: 44px;
        display: flex;
        align-items: center;
        gap: 7px;
      }
      .ob-chip:hover {
        border-color: var(--primary);
        color: var(--primary);
        background: var(--primary-light);
      }
      .ob-chip.selected {
        border-color: var(--primary);
        background: var(--primary-light);
        color: var(--primary);
        box-shadow: 0 0 0 3px rgba(2,132,199,0.12);
      }
      .ob-chip.ob-chip-full { flex: 1; justify-content: center; }

      /* Subject multi-select chips */
      .ob-subject-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .ob-subject-chip {
        padding: 8px 14px;
        background: var(--bg-input);
        border: 1.5px solid var(--border);
        border-radius: var(--radius-full);
        cursor: pointer;
        font-family: inherit;
        font-size: 0.78rem;
        font-weight: 600;
        color: var(--text-muted);
        transition: all 0.2s;
        user-select: none;
        min-height: 36px;
        display: flex;
        align-items: center;
      }
      .ob-subject-chip:hover {
        border-color: var(--primary);
        color: var(--primary);
      }
      .ob-subject-chip.selected {
        border-color: var(--primary);
        background: var(--primary-light);
        color: var(--primary);
      }

      /* Pair card */
      .ob-pair-card {
        padding: 12px 16px;
        background: var(--bg-input);
        border: 1.5px solid var(--border);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: all 0.2s;
        margin-bottom: 8px;
      }
      .ob-pair-card:hover { border-color: var(--primary); }
      .ob-pair-card.selected {
        border-color: var(--primary);
        background: var(--primary-light);
        box-shadow: 0 0 0 3px rgba(2,132,199,0.12);
      }
      .ob-pair-card-label {
        font-size: 0.82rem;
        font-weight: 700;
        color: var(--text);
        margin-bottom: 2px;
      }
      .ob-pair-card.selected .ob-pair-card-label { color: var(--primary); }
      .ob-pair-card-sub {
        font-size: 0.72rem;
        color: var(--text-muted);
      }

      /* Section divider */
      .ob-section-divider {
        height: 1px;
        background: var(--border-subtle);
        margin: 16px 0;
      }

      /* Date field row */
      .ob-date-row {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-bottom: 4px;
      }

      .ob-date-subject-label {
        font-size: 0.82rem;
        font-weight: 700;
        color: var(--text);
        margin-bottom: 4px;
      }

      .ob-date-input {
        width: 100%;
        background: var(--bg-input);
        border: 1.5px solid var(--border);
        border-radius: var(--radius-md);
        padding: 13px 16px;
        font-family: inherit;
        font-size: 0.9rem;
        color: var(--text);
        outline: none;
        transition: border-color 0.2s;
        box-sizing: border-box;
        -webkit-appearance: none;
      }
      .ob-date-input:focus {
        border-color: var(--primary);
        box-shadow: 0 0 0 3px rgba(2,132,199,0.15);
      }

      /* Info box */
      .ob-info-box {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        background: var(--primary-light);
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        padding: 12px 14px;
        margin-bottom: 14px;
      }
      .ob-info-box i {
        color: var(--primary);
        font-size: 0.9rem;
        margin-top: 2px;
        flex-shrink: 0;
      }
      .ob-info-box p {
        font-size: 0.75rem;
        color: var(--text-secondary);
        line-height: 1.6;
        margin: 0;
      }

      /* ── BUTTONS ── */
      .ob-btn-primary {
        width: 100%;
        padding: 15px;
        background: linear-gradient(135deg, #0369A1 0%, #0284C7 100%);
        color: #fff;
        font-family: inherit;
        font-size: 0.95rem;
        font-weight: 700;
        border: none;
        border-radius: var(--radius-md);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        transition: transform 0.2s, box-shadow 0.2s, opacity 0.2s;
        margin-bottom: 10px;
        min-height: 52px;
        box-shadow: var(--shadow-blue);
      }
      .ob-btn-primary:hover:not(:disabled) {
        transform: translateY(-1px);
        box-shadow: 0 6px 24px rgba(2,132,199,0.4);
      }
      .ob-btn-primary:active:not(:disabled) { transform: scale(0.98); }
      .ob-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none; }

      .ob-btn-back {
        width: 100%;
        padding: 13px;
        background: transparent;
        border: 1.5px solid var(--border-subtle);
        border-radius: var(--radius-md);
        color: var(--text-muted);
        font-family: inherit;
        font-size: 0.88rem;
        font-weight: 600;
        cursor: pointer;
        display: none;
        align-items: center;
        justify-content: center;
        gap: 8px;
        transition: all 0.2s;
        min-height: 48px;
        margin-bottom: 8px;
      }
      .ob-btn-back:hover { border-color: var(--primary); color: var(--primary); }

      .ob-btn-skip {
        width: 100%;
        padding: 12px;
        background: transparent;
        border: none;
        color: var(--text-muted);
        font-family: inherit;
        font-size: 0.85rem;
        font-weight: 600;
        cursor: pointer;
        text-align: center;
        transition: color 0.2s;
        min-height: 44px;
      }
      .ob-btn-skip:hover { color: var(--primary); }

      /* Spinner */
      .ob-spinner {
        width: 18px;
        height: 18px;
        border: 2.5px solid rgba(255,255,255,0.3);
        border-top-color: #fff;
        border-radius: 50%;
        animation: obSpin 0.7s linear infinite;
        display: none;
        flex-shrink: 0;
      }
      .ob-loading .ob-spinner  { display: block; }
      .ob-loading .ob-btn-lbl  { display: none; }

      /* ── SUCCESS SCREEN ── */
      .ob-success {
        display: none;
        position: fixed;
        inset: 0;
        z-index: 500;
        background: var(--bg);
        flex-direction: column;
        align-items: center;
        overflow-y: auto;
      }
      .ob-success.show { display: flex; }

      .ob-success-hero {
        width: 100%;
        background: linear-gradient(135deg, #0369A1 0%, #0284C7 60%, #0E9AA7 100%);
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 56px 24px 72px;
        position: relative;
        overflow: hidden;
        flex-shrink: 0;
        text-align: center;
      }

      .ob-success-hero-dot {
        position: absolute;
        border-radius: 50%;
        opacity: 0.07;
        background: #fff;
        pointer-events: none;
      }

      .ob-success-hero::after {
        content: '';
        position: absolute;
        bottom: -20px;
        left: 0; right: 0;
        height: 40px;
        background: var(--bg);
        border-radius: 50% 50% 0 0 / 100% 100% 0 0;
      }

      .ob-success-icon {
        width: 80px;
        height: 80px;
        border-radius: 50%;
        background: rgba(255,255,255,0.15);
        border: 2px solid rgba(255,255,255,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 16px;
        position: relative;
        z-index: 1;
        animation: obPop 0.6s cubic-bezier(0.34,1.56,0.64,1) both;
      }
      .ob-success-icon i { font-size: 2rem; color: #fff; }

      .ob-success-title {
        font-size: 1.5rem;
        font-weight: 900;
        color: #fff;
        line-height: 1.2;
        margin-bottom: 6px;
        position: relative;
        z-index: 1;
        letter-spacing: -0.4px;
        animation: obFadeDown 0.5s ease 0.1s both;
      }

      .ob-success-sub {
        font-size: 0.82rem;
        color: rgba(255,255,255,0.75);
        line-height: 1.6;
        max-width: 280px;
        position: relative;
        z-index: 1;
        animation: obFadeDown 0.5s ease 0.15s both;
      }

      .ob-success-card-area {
        width: 100%;
        max-width: 480px;
        padding: 28px 16px 48px;
        animation: obFadeUp 0.45s ease 0.2s both;
      }

      .ob-success-card {
        background: var(--bg-card);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-xl);
        padding: 24px 20px 28px;
        box-shadow: var(--shadow-lg);
      }
      [data-theme="dark"] .ob-success-card {
        border-color: rgba(255,255,255,0.06);
      }

      /* Moedas banner */
      .ob-moedas-banner {
        display: flex;
        align-items: center;
        gap: 14px;
        background: var(--moeda-light);
        border: 1.5px solid rgba(255,179,0,0.3);
        border-radius: var(--radius-lg);
        padding: 16px;
        margin-bottom: 16px;
      }

      .ob-moedas-icon {
        width: 52px;
        height: 52px;
        border-radius: var(--radius-md);
        background: rgba(255,179,0,0.15);
        border: 1.5px solid rgba(255,179,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .ob-moedas-icon i { font-size: 1.4rem; color: var(--moeda); }

      .ob-moedas-amount {
        font-size: 1.8rem;
        font-weight: 900;
        color: var(--moeda);
        line-height: 1;
        letter-spacing: -0.5px;
      }

      .ob-moedas-desc {
        font-size: 0.75rem;
        color: var(--text-muted);
        margin-top: 3px;
        font-weight: 500;
      }

      /* Unlock rows */
      .ob-unlocks {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 20px;
      }

      .ob-unlock-row {
        display: flex;
        align-items: center;
        gap: 12px;
        background: var(--bg);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-md);
        padding: 11px 14px;
      }

      .ob-unlock-icon {
        width: 34px;
        height: 34px;
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.95rem;
        flex-shrink: 0;
      }

      .ob-unlock-body { flex: 1; }

      .ob-unlock-title {
        font-size: 0.82rem;
        font-weight: 700;
        color: var(--text);
        line-height: 1.2;
      }

      .ob-unlock-sub {
        font-size: 0.68rem;
        color: var(--text-muted);
        margin-top: 1px;
      }

      .ob-unlock-check {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: var(--success-light);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .ob-unlock-check i { font-size: 0.62rem; color: var(--success); }

      /* Countdown */
      .ob-countdown-label {
        font-size: 0.72rem;
        color: var(--text-muted);
        font-weight: 600;
        text-align: center;
        margin-bottom: 6px;
      }

      .ob-countdown-track {
        height: 3px;
        background: var(--border-subtle);
        border-radius: var(--radius-full);
        overflow: hidden;
        margin-bottom: 16px;
      }

      .ob-countdown-fill {
        height: 100%;
        width: 100%;
        background: linear-gradient(90deg, #0369A1, #0284C7);
        border-radius: var(--radius-full);
        transition: width 0.1s linear;
      }

      /* ── ANIMATIONS ── */
      @keyframes obFadeDown {
        from { opacity: 0; transform: translateY(-12px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @keyframes obFadeUp {
        from { opacity: 0; transform: translateY(20px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @keyframes obSpin { to { transform: rotate(360deg); } }
      @keyframes obPop {
        from { transform: scale(0) rotate(-10deg); opacity: 0; }
        to   { transform: scale(1) rotate(0); opacity: 1; }
      }

      /* ── RESPONSIVE ── */
      @media (min-width: 480px) {
        .ob-hero { padding: 52px 32px 48px; }
        .ob-card { padding: 28px 28px 32px; }
        .ob-success-hero { padding: 64px 32px 80px; }
        .ob-success-card { padding: 28px 28px 32px; }
      }
      @media (max-width: 360px) {
        .ob-hero { padding: 36px 16px 36px; }
        .ob-logo-img { width: min(150px, 48vw); }
        .ob-card { padding: 18px 14px 20px; }
        .ob-card-area { padding: 20px 12px 48px; }
      }

    </style>`;
  },

  // ── ROOM 2 — MOUNT ──────────────────────────────────────
  mount() {
    return `
      <div class="ob-root" translate="no">

        <!-- Dark mode toggle -->
        <button
          class="ob-dark-toggle notranslate"
          id="obDarkToggle"
          aria-label="Alternar tema"
          translate="no"
        >
          <i class="fa-solid fa-moon" id="obDarkIcon" aria-hidden="true"></i>
        </button>

        <!-- Hero -->
        <div class="ob-hero">
          <div class="ob-hero-dot" style="width:200px;height:200px;top:-80px;right:-60px;"></div>
          <div class="ob-hero-dot" style="width:100px;height:100px;bottom:20px;left:10px;"></div>

          <img
            class="ob-logo-img notranslate"
            src="/assets/images/logo.png"
            alt="ExameNova"
            onerror="this.style.display='none'"
          >

          <div class="ob-progress-wrap">
            <div class="ob-progress-row">
              <span class="ob-progress-label notranslate" translate="no">Configuração do perfil</span>
              <span class="ob-progress-pill notranslate" translate="no" id="ob-pill">Passo 1 de 3</span>
            </div>
            <div class="ob-progress-track">
              <div class="ob-progress-fill" id="ob-fill" style="width:33%;"></div>
            </div>
            <div class="ob-dots-row">
              <div class="ob-dot active" id="ob-dot-1">
                <i class="fa-solid fa-user" style="font-size:0.6rem;"></i>
              </div>
              <div class="ob-dot-line" id="ob-line-1"></div>
              <div class="ob-dot pending" id="ob-dot-2">
                <i class="fa-solid fa-graduation-cap" style="font-size:0.6rem;"></i>
              </div>
              <div class="ob-dot-line" id="ob-line-2"></div>
              <div class="ob-dot pending" id="ob-dot-3">
                <i class="fa-solid fa-calendar" style="font-size:0.6rem;"></i>
              </div>
            </div>
          </div>
        </div>

        <!-- Card area -->
        <div class="ob-card-area">
          <div class="ob-card">
            <div class="ob-card-hdr">
              <div class="ob-eyebrow notranslate" translate="no" id="ob-eyebrow">
                <i class="fa-solid fa-user" aria-hidden="true"></i>&nbsp; Dados pessoais
              </div>
              <div class="ob-card-title notranslate" translate="no" id="ob-title">
                Bem-vindo(a), <span class="ob-hi" id="ob-name">Estudante</span>!
              </div>
              <div class="ob-card-sub notranslate" translate="no" id="ob-sub">
                Vamos configurar o seu perfil para personalizar toda a experiência.
              </div>
            </div>
            <div id="ob-body"></div>
            <div style="margin-top:8px;">
              <button class="ob-btn-back notranslate" translate="no" id="ob-back">
                <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>
                Voltar
              </button>
              <button class="ob-btn-primary notranslate" translate="no" id="ob-next">
                <div class="ob-spinner"></div>
                <span class="ob-btn-lbl">
                  Continuar&nbsp;<i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
                </span>
              </button>
              <button class="ob-btn-skip notranslate" translate="no" id="ob-skip" style="display:none;">
                Definir mais tarde
              </button>
            </div>
          </div>
        </div>

      </div>

      <!-- SUCCESS SCREEN -->
      <div class="ob-success" id="ob-success" translate="no">
        <div class="ob-success-hero">
          <div class="ob-success-hero-dot" style="width:200px;height:200px;top:-80px;right:-60px;"></div>
          <div class="ob-success-hero-dot" style="width:100px;height:100px;bottom:20px;left:10px;"></div>
          <div class="ob-success-icon">
            <i class="fa-solid fa-circle-check" aria-hidden="true"></i>
          </div>
          <div class="ob-success-title notranslate" translate="no">
            Tudo pronto,<br><span id="ob-success-name">Estudante</span>!
          </div>
          <div class="ob-success-sub notranslate" translate="no">
            O seu perfil está completo. As suas Moedas de boas-vindas já estão disponíveis.
          </div>
        </div>
        <div class="ob-success-card-area">
          <div class="ob-success-card">

            <!-- Moedas banner -->
            <div class="ob-moedas-banner">
              <div class="ob-moedas-icon">
                <i class="fa-solid fa-coins" aria-hidden="true"></i>
              </div>
              <div>
                <div class="ob-moedas-amount notranslate" translate="no">
                  +${AWARDS.REGISTRATION}
                </div>
                <div class="ob-moedas-desc notranslate" translate="no">
                  Moedas de boas-vindas adicionadas
                </div>
              </div>
            </div>

            <!-- Unlocks -->
            <div class="ob-unlocks">
              <div class="ob-unlock-row">
                <div class="ob-unlock-icon" style="background:var(--primary-light);">
                  <i class="fa-solid fa-file-pen" style="color:var(--primary);" aria-hidden="true"></i>
                </div>
                <div class="ob-unlock-body">
                  <div class="ob-unlock-title notranslate" translate="no">Simulação de Exame</div>
                  <div class="ob-unlock-sub notranslate" translate="no">Pratique com exames anteriores reais</div>
                </div>
                <div class="ob-unlock-check">
                  <i class="fa-solid fa-check" aria-hidden="true"></i>
                </div>
              </div>
              <div class="ob-unlock-row">
                <div class="ob-unlock-icon" style="background:var(--secondary-light);">
                  <i class="fa-solid fa-brain" style="color:var(--secondary);" aria-hidden="true"></i>
                </div>
                <div class="ob-unlock-body">
                  <div class="ob-unlock-title notranslate" translate="no">Mentor IA</div>
                  <div class="ob-unlock-sub notranslate" translate="no">O seu tutor pessoal de IA</div>
                </div>
                <div class="ob-unlock-check">
                  <i class="fa-solid fa-check" aria-hidden="true"></i>
                </div>
              </div>
              <div class="ob-unlock-row">
                <div class="ob-unlock-icon" style="background:var(--accent-light);">
                  <i class="fa-solid fa-fire" style="color:var(--accent);" aria-hidden="true"></i>
                </div>
                <div class="ob-unlock-body">
                  <div class="ob-unlock-title notranslate" translate="no">Desafio Diário</div>
                  <div class="ob-unlock-sub notranslate" translate="no">Ganhe Moedas todos os dias</div>
                </div>
                <div class="ob-unlock-check">
                  <i class="fa-solid fa-check" aria-hidden="true"></i>
                </div>
              </div>
            </div>

            <!-- Countdown -->
            <div class="ob-countdown-label notranslate" translate="no" id="ob-cd-label">
              A redirecionar em 5 segundos...
            </div>
            <div class="ob-countdown-track">
              <div class="ob-countdown-fill" id="ob-cd-fill"></div>
            </div>

            <!-- CTA -->
            <button class="ob-btn-primary notranslate" translate="no" id="ob-success-btn">
              <i class="fa-solid fa-rocket" aria-hidden="true"></i>
              Começar a estudar
            </button>

          </div>
        </div>
      </div>
    `;
  },

  // ── ROOM 3 — INIT ───────────────────────────────────────
  async init(user, userData, params) {

    this._user      = user;
    this._userData  = userData;
    this._step      = 1;
    this._firstName = '';
    this._redirectTimer  = null;
    this._countdownTimer = null;
    this._data = {
      whatsapp:     '',
      province:     '',
      district:     '',
      schoolType:   '',
      school:       '',
      examType:     '',
      grade:        '',
      status:       '',
      section:      '',
      subjects:     [],
      admissaoType: '',
      course:       '',
      institution:  '',
      pairIndex:    0,
      examDates:    {},
    };

    // Pre-fill from partial userData
    if (userData) {
      if (userData.whatsapp)   this._data.whatsapp   = userData.whatsapp;
      if (userData.province)   this._data.province   = userData.province;
      if (userData.district)   this._data.district   = userData.district;
      if (userData.school)     this._data.school     = userData.school;
      if (userData.examType)   this._data.examType   = userData.examType;
      if (userData.grade)      this._data.grade      = userData.grade;
      if (userData.status)     this._data.status     = userData.status;
      if (userData.section)    this._data.section    = userData.section;
      if (userData.subjects?.length) this._data.subjects = [...userData.subjects];
      if (userData.course)     this._data.course     = userData.course;
      if (userData.institution) this._data.institution = userData.institution;
    }

    // First name
    const fullName  = userData?.fullName || user?.displayName || '';
    this._firstName = fullName.split(' ')[0] || 'Estudante';

    const nameEl = document.getElementById('ob-name');
    if (nameEl) nameEl.textContent = this._firstName;

    // Dark toggle
    {
      const btn  = document.getElementById('obDarkToggle');
      const icon = document.getElementById('obDarkIcon');
      const syncIcon = () => {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        if (icon) icon.className = isDark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
      };
      syncIcon();
      if (btn && !btn._wired) {
        btn._wired = true;
        btn.addEventListener('click', () => { ui.toggleDarkMode(); syncIcon(); });
      }
    }

    // Wire nav buttons
    const nextBtn = document.getElementById('ob-next');
    const backBtn = document.getElementById('ob-back');
    const skipBtn = document.getElementById('ob-skip');

    if (nextBtn && !nextBtn._wired) {
      nextBtn._wired = true;
      nextBtn.addEventListener('click', () => this._handleNext());
    }
    if (backBtn && !backBtn._wired) {
      backBtn._wired = true;
      backBtn.addEventListener('click', () => this._handleBack());
    }
    if (skipBtn && !skipBtn._wired) {
      skipBtn._wired = true;
      skipBtn.addEventListener('click', () => this._completeOnboarding(true));
    }

    // Wire success button
    const successBtn = document.getElementById('ob-success-btn');
    if (successBtn && !successBtn._wired) {
      successBtn._wired = true;
      successBtn.addEventListener('click', () => {
        clearTimeout(this._redirectTimer);
        clearInterval(this._countdownTimer);
        router.navigate('dashboard');
      });
    }

    this._renderStep(1);
  },

  // ── ROOM 4 — DESTROY ────────────────────────────────────
  destroy() {
    clearTimeout(this._redirectTimer);
    clearInterval(this._countdownTimer);
  },

  // ── INTERNAL: Update header + dots + buttons ─────────────
  _updateChrome(step) {
    const pill    = document.getElementById('ob-pill');
    const fill    = document.getElementById('ob-fill');
    const eyebrow = document.getElementById('ob-eyebrow');
    const title   = document.getElementById('ob-title');
    const sub     = document.getElementById('ob-sub');
    const backBtn = document.getElementById('ob-back');
    const nextBtn = document.getElementById('ob-next');
    const skipBtn = document.getElementById('ob-skip');

    if (pill) pill.textContent = `Passo ${step} de ${TOTAL_STEPS}`;
    if (fill) fill.style.width = (step / TOTAL_STEPS * 100) + '%';

    // Dots
    const dotIcons = [
      '<i class="fa-solid fa-user" style="font-size:0.6rem;"></i>',
      '<i class="fa-solid fa-graduation-cap" style="font-size:0.6rem;"></i>',
      '<i class="fa-solid fa-calendar" style="font-size:0.6rem;"></i>',
    ];
    for (let i = 1; i <= TOTAL_STEPS; i++) {
      const dot  = document.getElementById(`ob-dot-${i}`);
      const line = document.getElementById(`ob-line-${i}`);
      if (!dot) continue;
      if (i < step) {
        dot.className = 'ob-dot done';
        dot.innerHTML = '<i class="fa-solid fa-check" style="font-size:0.6rem;"></i>';
        if (line) line.className = 'ob-dot-line done';
      } else if (i === step) {
        dot.className = 'ob-dot active';
        dot.innerHTML = dotIcons[i - 1];
        if (line) line.className = 'ob-dot-line';
      } else {
        dot.className = 'ob-dot pending';
        dot.innerHTML = dotIcons[i - 1];
        if (line) line.className = 'ob-dot-line';
      }
    }

    // Back button
    if (backBtn) backBtn.style.display = step > 1 ? 'flex' : 'none';

    // Skip button — only on step 3
    if (skipBtn) skipBtn.style.display = step === 3 ? 'block' : 'none';

    // Next button label
    if (nextBtn) {
      const lbl = nextBtn.querySelector('.ob-btn-lbl');
      if (lbl) {
        lbl.innerHTML = step === TOTAL_STEPS
          ? '<i class="fa-solid fa-check" aria-hidden="true"></i>&nbsp; Concluir'
          : 'Continuar&nbsp;<i class="fa-solid fa-arrow-right" aria-hidden="true"></i>';
      }
    }

    // Card header per step
    if (step === 1) {
      if (eyebrow) eyebrow.innerHTML = '<i class="fa-solid fa-user" aria-hidden="true"></i>&nbsp; Dados pessoais';
      if (title)   title.innerHTML   = `Bem-vindo(a), <span class="ob-hi" id="ob-name">${this._firstName}</span>!`;
      if (sub)     sub.textContent   = 'Vamos configurar o seu perfil para personalizar toda a experiência.';
    } else if (step === 2) {
      if (eyebrow) eyebrow.innerHTML = '<i class="fa-solid fa-graduation-cap" aria-hidden="true"></i>&nbsp; O seu exame';
      if (title)   title.textContent = 'Qual é o seu exame?';
      if (sub)     sub.textContent   = 'Seleccione o tipo de exame e as suas disciplinas.';
    } else if (step === 3) {
      if (eyebrow) eyebrow.innerHTML = '<i class="fa-solid fa-calendar" aria-hidden="true"></i>&nbsp; Data do exame';
      if (title)   title.textContent = 'Quando é o seu exame?';
      if (sub)     sub.textContent   = 'Defina a data do exame por disciplina. Pode actualizar mais tarde no perfil.';
    }
  },

  // ── INTERNAL: Render step ────────────────────────────────
  _renderStep(step) {
    this._updateChrome(step);
    const body = document.getElementById('ob-body');
    if (!body) return;

    if (step === 1) this._renderStep1(body);
    if (step === 2) this._renderStep2(body);
    if (step === 3) this._renderStep3(body);

    // Scroll card to top
    body.closest('.ob-card-area')?.scrollTo({ top: 0, behavior: 'smooth' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  // ── STEP 1 — Personal + Location ─────────────────────────
  _renderStep1(body) {
    const provinces = getProvinces();
    const districts = this._data.province
      ? getDistrictsByProvince(this._data.province)
      : [];

    body.innerHTML = `

      <div class="ob-info-box">
        <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
        <p class="notranslate" translate="no">
          Os seus dados são usados apenas para
          personalizar a sua experiência na plataforma.
        </p>
      </div>

      <!-- WhatsApp -->
      <div class="ob-field">
        <label>
          <i class="fa-brands fa-whatsapp" aria-hidden="true"></i>
          &nbsp;Número de WhatsApp
        </label>
        <div class="ob-phone-row">
          <div class="ob-phone-prefix notranslate" translate="no">🇲🇿 +258</div>
          <input
            class="ob-input"
            type="tel"
            id="ob-wa"
            placeholder="84 000 0000"
            inputmode="tel"
            maxlength="12"
            autocomplete="tel"
            value="${this._data.whatsapp.replace(/^\+258/, '').trim()}"
          />
        </div>
        <div class="ob-ferr" id="ob-wa-err">
          <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
          Introduza um número válido (mínimo 8 dígitos).
        </div>
      </div>

      <!-- Province -->
      <div class="ob-field">
        <label>
          <i class="fa-solid fa-map" aria-hidden="true"></i>
          &nbsp;Província
        </label>
        <select class="ob-select" id="ob-province">
          <option value="">Seleccione a sua província...</option>
          ${provinces.map(p => `
            <option value="${p}" ${this._data.province === p ? 'selected' : ''}>${p}</option>
          `).join('')}
        </select>
        <div class="ob-ferr" id="ob-prov-err">
          <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
          Seleccione a sua província.
        </div>
      </div>

      <!-- District -->
      <div class="ob-field">
        <label>
          <i class="fa-solid fa-location-dot" aria-hidden="true"></i>
          &nbsp;Distrito
        </label>
        <select class="ob-select" id="ob-district" ${!districts.length ? 'disabled' : ''}>
          <option value="">
            ${!this._data.province
              ? 'Seleccione primeiro a província...'
              : 'Seleccione o seu distrito...'}
          </option>
          ${districts.map(d => `
            <option value="${d}" ${this._data.district === d ? 'selected' : ''}>${d}</option>
          `).join('')}
        </select>
        <div class="ob-ferr" id="ob-dist-err">
          <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
          Seleccione o seu distrito.
        </div>
      </div>

      <!-- School type chips -->
      <div class="ob-field">
        <label>
          <i class="fa-solid fa-school" aria-hidden="true"></i>
          &nbsp;Tipo de escola
        </label>
        <div class="ob-chips" id="ob-school-type-chips">
          ${['Escola Secundária', 'Instituto', 'Universidade', 'Outra'].map(t => `
            <div
              class="ob-chip ${this._data.schoolType === t ? 'selected' : ''}"
              data-school-type="${t}"
            >${t}</div>
          `).join('')}
        </div>
        <div class="ob-ferr" id="ob-type-err">
          <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
          Seleccione o tipo de escola.
        </div>
      </div>

      <!-- School name — shown after type selected -->
      <div class="ob-field" id="ob-school-field" style="${this._data.schoolType ? '' : 'display:none;'}">
        <label>
          <i class="fa-solid fa-chalkboard" aria-hidden="true"></i>
          &nbsp;Nome da escola
        </label>
        <input
          class="ob-input"
          type="text"
          id="ob-school"
          placeholder="Escola Secundária de..."
          autocomplete="organization"
          value="${this._data.school}"
        />
        <div class="ob-ferr" id="ob-school-err">
          <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
          Introduza o nome da sua escola.
        </div>
      </div>
    `;

    // Province → district cascade
    const provEl  = document.getElementById('ob-province');
    const distEl  = document.getElementById('ob-district');

    provEl.addEventListener('change', () => {
      this._data.province = provEl.value;
      this._data.district = '';
      document.getElementById('ob-prov-err').classList.remove('show');
      provEl.classList.remove('ob-err');

      const newDistricts = getDistrictsByProvince(provEl.value);
      distEl.innerHTML = `
        <option value="">Seleccione o seu distrito...</option>
        ${newDistricts.map(d => `<option value="${d}">${d}</option>`).join('')}
      `;
      distEl.disabled = !newDistricts.length;
    });

    distEl.addEventListener('change', () => {
      this._data.district = distEl.value;
      document.getElementById('ob-dist-err').classList.remove('show');
      distEl.classList.remove('ob-err');
    });

    // School type chips
    document.getElementById('ob-school-type-chips')
      .querySelectorAll('.ob-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          document.querySelectorAll('#ob-school-type-chips .ob-chip')
            .forEach(c => c.classList.remove('selected'));
          chip.classList.add('selected');
          this._data.schoolType = chip.dataset.schoolType;
          document.getElementById('ob-type-err').classList.remove('show');

          // Show school name field
          const schoolField = document.getElementById('ob-school-field');
          schoolField.style.display = '';

          // Pre-fill school name with prefix if empty
          const schoolInput = document.getElementById('ob-school');
          if (!this._data.school) {
            const prefix = this._data.schoolType === 'Escola Secundária'
              ? 'Escola Secundária de '
              : '';
            schoolInput.value = prefix;
            schoolInput.focus();
            schoolInput.setSelectionRange(prefix.length, prefix.length);
          }
        });
      });

    // School input
    const _schoolEl = document.getElementById('ob-school');
    _schoolEl?.addEventListener('input', () => {
      this._data.school = _schoolEl.value;
      document.getElementById('ob-school-err')?.classList.remove('show');
      _schoolEl.classList.remove('ob-err');
    });

    // WhatsApp input
    document.getElementById('ob-wa')?.addEventListener('input', function() {
      document.getElementById('ob-wa-err').classList.remove('show');
      this.classList.remove('ob-err');
    });

    // Enter key
    document.getElementById('ob-wa')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') this._handleNext();
    });
  },

  // ── STEP 2 — Exam type + subjects ────────────────────────
  _renderStep2(body) {
    body.innerHTML = `

      <!-- Exam type -->
      <div class="ob-field">
        <label>Tipo de exame</label>
        <div class="ob-chips" id="ob-exam-chips">
          <div
            class="ob-chip ob-chip-full ${this._data.examType === 'ensino-geral' ? 'selected' : ''}"
            data-exam="ensino-geral"
          >
            <i class="fa-solid fa-school" aria-hidden="true"></i>
            Ensino Geral
          </div>
          <div
            class="ob-chip ob-chip-full ${this._data.examType === 'admissao' ? 'selected' : ''}"
            data-exam="admissao"
          >
            <i class="fa-solid fa-university" aria-hidden="true"></i>
            Exame de Admissão
          </div>
        </div>
        <div class="ob-ferr" id="ob-exam-err">
          <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
          Seleccione o tipo de exame.
        </div>
      </div>

      <!-- Ensino Geral branch -->
      <div id="ob-ensino-branch" style="${this._data.examType === 'ensino-geral' ? '' : 'display:none;'}">
        <div class="ob-section-divider"></div>

        <!-- Grade -->
        <div class="ob-field">
          <label>Classe</label>
          <div class="ob-chips" id="ob-grade-chips">
            <div
              class="ob-chip ob-chip-full ${this._data.grade === '9' ? 'selected' : ''}"
              data-grade="9"
            >9ª Classe</div>
            <div
              class="ob-chip ob-chip-full ${this._data.grade === '12' ? 'selected' : ''}"
              data-grade="12"
            >12ª Classe</div>
          </div>
          <div class="ob-ferr" id="ob-grade-err">
            <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
            Seleccione a sua classe.
          </div>
        </div>

        <!-- Status -->
        <div class="ob-field" id="ob-status-field" style="${this._data.grade ? '' : 'display:none;'}">
          <label>Situação</label>
          <div class="ob-chips" id="ob-status-chips">
            <div
              class="ob-chip ob-chip-full ${this._data.status === 'normal' ? 'selected' : ''}"
              data-status="normal"
            >
              <i class="fa-solid fa-user-check" aria-hidden="true"></i>
              Normal
            </div>
            <div
              class="ob-chip ob-chip-full ${this._data.status === 'repetente' ? 'selected' : ''}"
              data-status="repetente"
            >
              <i class="fa-solid fa-rotate-left" aria-hidden="true"></i>
              Repetente
            </div>
          </div>
          <div class="ob-ferr" id="ob-status-err">
            <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
            Seleccione a sua situação.
          </div>
        </div>

        <!-- 9ª section (only for 9ª + repetente) -->
        <div class="ob-field" id="ob-section-field" style="display:none;">
          <label>Secção</label>
          <div class="ob-chips" id="ob-section-chips">
            <div
              class="ob-chip ${this._data.section === 'letras' ? 'selected' : ''}"
              data-section="letras"
            >
              <i class="fa-solid fa-book" aria-hidden="true"></i>
              Letras
            </div>
            <div
              class="ob-chip ${this._data.section === 'ciencias' ? 'selected' : ''}"
              data-section="ciencias"
            >
              <i class="fa-solid fa-flask" aria-hidden="true"></i>
              Ciências
            </div>
            <div
              class="ob-chip ${this._data.section === 'all' ? 'selected' : ''}"
              data-section="all"
            >
              <i class="fa-solid fa-layer-group" aria-hidden="true"></i>
              Retomar tudo
            </div>
          </div>
          <div class="ob-ferr" id="ob-section-err">
            <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
            Seleccione a sua secção.
          </div>
        </div>

        <!-- 12ª subject multi-select (only for 12ª + repetente) -->
        <div class="ob-field" id="ob-subjects-field" style="display:none;">
          <label>Disciplinas que vai repetir</label>
          <div class="ob-subject-chips" id="ob-subject-chips">
            ${GRADE12_ALL.map(s => `
              <div
                class="ob-subject-chip ${this._data.subjects.includes(s) ? 'selected' : ''}"
                data-subject="${s}"
              >${s}</div>
            `).join('')}
          </div>
          <div class="ob-ferr" id="ob-subjects-err">
            <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
            Seleccione pelo menos uma disciplina.
          </div>
        </div>
      </div>

      <!-- Admissão branch -->
      <div id="ob-admissao-branch" style="${this._data.examType === 'admissao' ? '' : 'display:none;'}">
        <div class="ob-section-divider"></div>

        <!-- Sub-type -->
        <div class="ob-field">
          <label>Acesso por</label>
          <div class="ob-chips" id="ob-admissao-type-chips">
            <div
              class="ob-chip ob-chip-full ${this._data.admissaoType === 'curso' ? 'selected' : ''}"
              data-admissao-type="curso"
            >
              <i class="fa-solid fa-graduation-cap" aria-hidden="true"></i>
              Curso
            </div>
            <div
              class="ob-chip ob-chip-full ${this._data.admissaoType === 'instituicao' ? 'selected' : ''}"
              data-admissao-type="instituicao"
            >
              <i class="fa-solid fa-building-columns" aria-hidden="true"></i>
              Instituição
            </div>
          </div>
          <div class="ob-ferr" id="ob-admissao-type-err">
            <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
            Seleccione o tipo de acesso.
          </div>
        </div>

        <!-- Course select -->
        <div class="ob-field" id="ob-course-field" style="${this._data.admissaoType === 'curso' ? '' : 'display:none;'}">
          <label>Curso</label>
          <select class="ob-select" id="ob-course">
            <option value="">Seleccione o seu curso...</option>
            ${getAllCourses().map(c => `
              <option value="${c.id}" ${this._data.course === c.id ? 'selected' : ''}>${c.label}</option>
            `).join('')}
          </select>
          <div class="ob-ferr" id="ob-course-err">
            <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
            Seleccione o seu curso.
          </div>
        </div>

        <!-- Institution select -->
        <div class="ob-field" id="ob-inst-field" style="${this._data.admissaoType === 'instituicao' ? '' : 'display:none;'}">
          <label>Instituição</label>
          <select class="ob-select" id="ob-institution">
            <option value="">Seleccione a instituição...</option>
            ${getAllInstitutions().map(i => `
              <option value="${i.id}" ${this._data.institution === i.id ? 'selected' : ''}>${i.label}</option>
            `).join('')}
          </select>
          <div class="ob-ferr" id="ob-inst-err">
            <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
            Seleccione a instituição.
          </div>
        </div>

        <!-- Pair picker — shown when course/institution has 2 pairs -->
        <div class="ob-field" id="ob-pair-field" style="display:none;">
          <label>Par de disciplinas</label>
          <div id="ob-pair-cards"></div>
          <div class="ob-ferr" id="ob-pair-err">
            <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
            Seleccione o par de disciplinas.
          </div>
        </div>

      </div>
    `;

    this._wireStep2();
  },

  // ── Wire step 2 interactivity ────────────────────────────
  _wireStep2() {

    // ── Exam type chips ──────────────────────────────────
    document.getElementById('ob-exam-chips')
      ?.querySelectorAll('.ob-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          document.querySelectorAll('#ob-exam-chips .ob-chip')
            .forEach(c => c.classList.remove('selected'));
          chip.classList.add('selected');
          this._data.examType = chip.dataset.exam;
          document.getElementById('ob-exam-err').classList.remove('show');

          // Show correct branch
          const ensinoBranch   = document.getElementById('ob-ensino-branch');
          const admissaoBranch = document.getElementById('ob-admissao-branch');
          if (this._data.examType === 'ensino-geral') {
            ensinoBranch.style.display   = '';
            admissaoBranch.style.display = 'none';
          } else {
            ensinoBranch.style.display   = 'none';
            admissaoBranch.style.display = '';
          }
        });
      });

    // ── Grade chips ──────────────────────────────────────
    document.getElementById('ob-grade-chips')
      ?.querySelectorAll('.ob-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          document.querySelectorAll('#ob-grade-chips .ob-chip')
            .forEach(c => c.classList.remove('selected'));
          chip.classList.add('selected');
          this._data.grade   = chip.dataset.grade;
          this._data.status  = '';
          this._data.section = '';
          this._data.subjects = [];
          document.getElementById('ob-grade-err').classList.remove('show');

          // Show status field
          document.getElementById('ob-status-field').style.display = '';
          document.querySelectorAll('#ob-status-chips .ob-chip')
            .forEach(c => c.classList.remove('selected'));

          // Hide downstream
          document.getElementById('ob-section-field').style.display  = 'none';
          document.getElementById('ob-subjects-field').style.display = 'none';
        });
      });

    // ── Status chips ─────────────────────────────────────
    document.getElementById('ob-status-chips')
      ?.querySelectorAll('.ob-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          document.querySelectorAll('#ob-status-chips .ob-chip')
            .forEach(c => c.classList.remove('selected'));
          chip.classList.add('selected');
          this._data.status  = chip.dataset.status;
          this._data.section = '';
          this._data.subjects = [];
          document.getElementById('ob-status-err').classList.remove('show');

          const sectionField  = document.getElementById('ob-section-field');
          const subjectsField = document.getElementById('ob-subjects-field');

          if (this._data.status === 'repetente') {
            if (this._data.grade === '9') {
              sectionField.style.display  = '';
              subjectsField.style.display = 'none';
              document.querySelectorAll('#ob-section-chips .ob-chip')
                .forEach(c => c.classList.remove('selected'));
            } else if (this._data.grade === '12') {
              sectionField.style.display  = 'none';
              subjectsField.style.display = '';
              document.querySelectorAll('#ob-subject-chips .ob-subject-chip')
                .forEach(c => c.classList.remove('selected'));
              this._data.subjects = [];
            }
          } else {
            sectionField.style.display  = 'none';
            subjectsField.style.display = 'none';
          }
        });
      });

    // ── Section chips ────────────────────────────────────
    document.getElementById('ob-section-chips')
      ?.querySelectorAll('.ob-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          document.querySelectorAll('#ob-section-chips .ob-chip')
            .forEach(c => c.classList.remove('selected'));
          chip.classList.add('selected');
          this._data.section = chip.dataset.section;
          document.getElementById('ob-section-err').classList.remove('show');
        });
      });

    // ── 12ª subject chips (multi-select) ─────────────────
    document.getElementById('ob-subject-chips')
      ?.querySelectorAll('.ob-subject-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          chip.classList.toggle('selected');
          const subj = chip.dataset.subject;
          if (chip.classList.contains('selected')) {
            if (!this._data.subjects.includes(subj)) this._data.subjects.push(subj);
          } else {
            this._data.subjects = this._data.subjects.filter(s => s !== subj);
          }
          document.getElementById('ob-subjects-err').classList.remove('show');
        });
      });

    // ── Admissão sub-type chips ──────────────────────────
    document.getElementById('ob-admissao-type-chips')
      ?.querySelectorAll('.ob-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          document.querySelectorAll('#ob-admissao-type-chips .ob-chip')
            .forEach(c => c.classList.remove('selected'));
          chip.classList.add('selected');
          this._data.admissaoType = chip.dataset.admissaoType;
          this._data.course       = '';
          this._data.institution  = '';
          this._data.pairIndex    = 0;
          document.getElementById('ob-admissao-type-err').classList.remove('show');

          const courseField = document.getElementById('ob-course-field');
          const instField   = document.getElementById('ob-inst-field');
          const pairField   = document.getElementById('ob-pair-field');

          if (this._data.admissaoType === 'curso') {
            courseField.style.display = '';
            instField.style.display   = 'none';
          } else {
            courseField.style.display = 'none';
            instField.style.display   = '';
          }
          pairField.style.display = 'none';
        });
      });

    // ── Course select ────────────────────────────────────
    document.getElementById('ob-course')?.addEventListener('change', (e) => {
      this._data.course    = e.target.value;
      this._data.pairIndex = 0;
      document.getElementById('ob-course-err').classList.remove('show');
      this._renderPairPicker('course');
    });

    // ── Institution select ───────────────────────────────
    document.getElementById('ob-institution')?.addEventListener('change', (e) => {
      this._data.institution = e.target.value;
      this._data.pairIndex   = 0;
      document.getElementById('ob-inst-err').classList.remove('show');
      this._renderPairPicker('institution');
    });
  },

  // ── Render pair picker ───────────────────────────────────
  _renderPairPicker(type) {
    const pairField = document.getElementById('ob-pair-field');
    const pairCards = document.getElementById('ob-pair-cards');
    if (!pairField || !pairCards) return;

    let pairs = [];
    if (type === 'course') {
      const course = getAllCourses().find(c => c.id === this._data.course);
      pairs = course?.pairs || [];
    } else {
      const inst = getAllInstitutions().find(i => i.id === this._data.institution);
      pairs = inst?.pairs || [];
    }

    if (pairs.length <= 1) {
      pairField.style.display = 'none';
      return;
    }

    pairField.style.display = '';
    pairCards.innerHTML = pairs.map((pair, idx) => `
      <div
        class="ob-pair-card ${this._data.pairIndex === idx ? 'selected' : ''}"
        data-pair-index="${idx}"
      >
        <div class="ob-pair-card-label">${pair.join(' + ')}</div>
        <div class="ob-pair-card-sub">Opção ${idx + 1}</div>
      </div>
    `).join('');

    pairCards.querySelectorAll('.ob-pair-card').forEach(card => {
      card.addEventListener('click', () => {
        pairCards.querySelectorAll('.ob-pair-card')
          .forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        this._data.pairIndex = parseInt(card.dataset.pairIndex);
        document.getElementById('ob-pair-err').classList.remove('show');
      });
    });
  },

  // ── STEP 3 — Exam dates ──────────────────────────────────
  _renderStep3(body) {
    // Get subjects from profile data
    const subjects = this._getResolvedSubjects();

    if (!subjects.length) {
      body.innerHTML = `
        <div class="ob-info-box">
          <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
          <p class="notranslate" translate="no">
            Não foi possível determinar as disciplinas. Pode definir datas mais tarde no Perfil.
          </p>
        </div>
      `;
      return;
    }

    body.innerHTML = `
      <div class="ob-info-box">
        <i class="fa-solid fa-calendar-check" aria-hidden="true"></i>
        <p class="notranslate" translate="no">
          Defina a data do seu exame por disciplina.
          Receberá lembretes à medida que a data se aproximar.
          Pode actualizar mais tarde no Perfil.
        </p>
      </div>

      <div class="ob-date-row">
        ${subjects.map(subject => `
          <div>
            <div class="ob-date-subject-label notranslate" translate="no">${subject}</div>
            <input
              class="ob-date-input"
              type="date"
              id="ob-date-${subject.replace(/\s+/g, '-').toLowerCase()}"
              data-subject="${subject}"
              value="${this._data.examDates[subject] || ''}"
              min="${_todayLocal()}"
            />
          </div>
        `).join('')}
      </div>
    `;

    // Wire date inputs
    body.querySelectorAll('.ob-date-input').forEach(input => {
      input.addEventListener('change', () => {
        this._data.examDates[input.dataset.subject] = input.value;
      });
    });
  },

  // ── Resolve final subjects from choices ──────────────────
  _getResolvedSubjects() {
    if (this._data.examType === 'ensino-geral') {
      if (this._data.grade === '9') {
        return getGrade9Subjects(this._data.status, this._data.section);
      }
      if (this._data.grade === '12') {
        return getGrade12Subjects(this._data.status, this._data.subjects);
      }
    }

    if (this._data.examType === 'admissao') {
      if (this._data.admissaoType === 'curso' && this._data.course) {
        const course = getAllCourses().find(c => c.id === this._data.course);
        return course?.pairs?.[this._data.pairIndex] || course?.pairs?.[0] || [];
      }
      if (this._data.admissaoType === 'instituicao' && this._data.institution) {
        const inst = getAllInstitutions().find(i => i.id === this._data.institution);
        return inst?.pairs?.[this._data.pairIndex] || inst?.pairs?.[0] || [];
      }
    }

    return [];
  },

  // ── Validate step ────────────────────────────────────────
  _validateStep(step) {
    if (step === 1) {
      let ok = true;

      const waVal = document.getElementById('ob-wa')?.value.replace(/\D/g, '') || '';
      if (waVal.length < 8) {
        document.getElementById('ob-wa-err').classList.add('show');
        document.getElementById('ob-wa').classList.add('ob-err');
        if (ok) ui.showToast('Introduza um número de WhatsApp válido.', 'error');
        ok = false;
      }

      const prov = document.getElementById('ob-province')?.value || '';
      if (!prov) {
        document.getElementById('ob-prov-err').classList.add('show');
        document.getElementById('ob-province').classList.add('ob-err');
        if (ok) ui.showToast('Seleccione a sua província.', 'error');
        ok = false;
      }

      const dist = document.getElementById('ob-district')?.value || '';
      if (!dist) {
        document.getElementById('ob-dist-err').classList.add('show');
        document.getElementById('ob-district').classList.add('ob-err');
        if (ok) ui.showToast('Seleccione o seu distrito.', 'error');
        ok = false;
      }

      const schoolInput = document.getElementById('ob-school');
      const schoolVal   = schoolInput?.value.trim() || '';
      if (this._data.schoolType && !schoolVal) {
        document.getElementById('ob-school-err')?.classList.add('show');
        schoolInput?.classList.add('ob-err');
        if (ok) ui.showToast('Introduza o nome da sua escola.', 'error');
        ok = false;
      } else if (!this._data.schoolType) {
        document.getElementById('ob-type-err')?.classList.add('show');
        if (ok) ui.showToast('Seleccione o tipo de escola.', 'error');
        ok = false;
      }

      // Save step 1 data from DOM
      if (ok) {
        const waRaw = document.getElementById('ob-wa').value.replace(/\D/g, '');
        this._data.whatsapp   = `+258${waRaw}`;
        this._data.province   = prov;
        this._data.district   = dist;
        this._data.school     = document.getElementById('ob-school').value.trim();
      }

      return ok;
    }

    if (step === 2) {
      if (!this._data.examType) {
        document.getElementById('ob-exam-err').classList.add('show');
        ui.showToast('Seleccione o tipo de exame.', 'error');
        return false;
      }

      if (this._data.examType === 'ensino-geral') {
        if (!this._data.grade) {
          document.getElementById('ob-grade-err').classList.add('show');
          ui.showToast('Seleccione a sua classe.', 'error');
          return false;
        }
        if (!this._data.status) {
          document.getElementById('ob-status-err').classList.add('show');
          ui.showToast('Seleccione a sua situação.', 'error');
          return false;
        }
        if (this._data.status === 'repetente' && this._data.grade === '9' && !this._data.section) {
          document.getElementById('ob-section-err').classList.add('show');
          ui.showToast('Seleccione a sua secção.', 'error');
          return false;
        }
        if (this._data.status === 'repetente' && this._data.grade === '12' && !this._data.subjects.length) {
          document.getElementById('ob-subjects-err').classList.add('show');
          ui.showToast('Seleccione pelo menos uma disciplina.', 'error');
          return false;
        }
      }

      if (this._data.examType === 'admissao') {
        if (!this._data.admissaoType) {
          document.getElementById('ob-admissao-type-err').classList.add('show');
          ui.showToast('Seleccione o tipo de acesso.', 'error');
          return false;
        }
        if (this._data.admissaoType === 'curso' && !this._data.course) {
          document.getElementById('ob-course-err').classList.add('show');
          ui.showToast('Seleccione o seu curso.', 'error');
          return false;
        }
        if (this._data.admissaoType === 'instituicao' && !this._data.institution) {
          document.getElementById('ob-inst-err').classList.add('show');
          ui.showToast('Seleccione a sua instituição.', 'error');
          return false;
        }
      }

      return true;
    }

    // Step 3 is optional — always valid
    return true;
  },

  // ── Handle next ──────────────────────────────────────────
  async _handleNext() {
    if (!this._validateStep(this._step)) return;

    if (this._step < TOTAL_STEPS) {
      this._step++;
      this._renderStep(this._step);
    } else {
      await this._completeOnboarding(false);
    }
  },

  // ── Handle back ──────────────────────────────────────────
  _handleBack() {
    if (this._step <= 1) return;
    this._step--;
    this._renderStep(this._step);
  },

  // ── Complete onboarding ──────────────────────────────────
  async _completeOnboarding(skippedDates) {
    const nextBtn = document.getElementById('ob-next');
    const skipBtn = document.getElementById('ob-skip');
    if (nextBtn) { nextBtn.disabled = true; nextBtn.classList.add('ob-loading'); }
    if (skipBtn)   skipBtn.disabled = true;

    try {
      const resolvedSubjects = this._getResolvedSubjects();
      const groupId          = getGroupId(this._data);

      // Build Firestore payload
      const payload = {
        // Safe fallbacks — only take effect if the Firestore user
        // document was never created at registration. If it already
        // exists, setDoc+merge leaves these untouched at their real values.
        role:               this._userData?.role || 'student',
        moedas:             typeof this._userData?.moedas === 'number' ? this._userData.moedas : 0,
        email:              this._user?.email || this._userData?.email || '',
        fullName:           this._userData?.fullName || this._user?.displayName || '',

        whatsapp:           this._data.whatsapp,
        province:           this._data.province,
        district:           this._data.district,
        school:             this._data.school,
        schoolType:         this._data.schoolType,
        examType:           this._data.examType,
        grade:              this._data.grade    || null,
        status:             this._data.status   || null,
        section:            this._data.section  || null,
        subjects:           resolvedSubjects,
        course:             this._data.course       || null,
        institution:        this._data.institution  || null,
        pairIndex:          this._data.pairIndex,
        groupId,
        examDates:          skippedDates ? {} : this._data.examDates,
        onboardingComplete: true,
        lastActive:         serverTimestamp(),
      };

      // merge:true creates the doc if it's missing (fixes "No document
      // to update") and safely merges onto it if it already exists.
      await setDoc(doc(db, 'users', this._user.uid), payload, { merge: true });

      // Set custom claims for chat rules — silently
      try {
        await worker.setCustomClaims(
          this._user.uid,
          groupId,
          this._userData?.role || 'student'
        );
      } catch (claimsErr) {
        console.warn('[Onboarding] Custom claims failed — non-critical:', claimsErr);
      }

      // Award registration Moedas — non-critical like custom claims above.
      // If the Worker is down, the student's profile is already saved;
      // don't block onboarding completion on this.
      try {
        await worker.awardMoedas(
          this._user.uid,
          AWARDS.REGISTRATION,
          'registration'
        );
      } catch (moedasErr) {
        console.warn('[Onboarding] Award Moedas failed — non-critical:', moedasErr);
      }

      // Show success screen
      const successNameEl = document.getElementById('ob-success-name');
      if (successNameEl) successNameEl.textContent = this._firstName;

      const successEl = document.getElementById('ob-success');
      if (successEl) successEl.classList.add('show');

      // Countdown — 5 seconds
      let secs = 5;
      const cdLabel = document.getElementById('ob-cd-label');
      const cdFill  = document.getElementById('ob-cd-fill');
      if (cdFill) cdFill.style.width = '100%';

      this._countdownTimer = setInterval(() => {
        secs--;
        if (cdLabel) {
          cdLabel.textContent = secs > 0
            ? `A redirecionar em ${secs} segundo${secs !== 1 ? 's' : ''}...`
            : 'A entrar no ExameNova...';
        }
        if (cdFill) cdFill.style.width = (secs / 5 * 100) + '%';
        if (secs <= 0) clearInterval(this._countdownTimer);
      }, 1000);

      this._redirectTimer = setTimeout(() => {
        clearInterval(this._countdownTimer);
        router.navigate('dashboard');
      }, 5000);

    } catch (err) {
      console.error('[Onboarding] Save failed:', err);
      if (nextBtn) { nextBtn.disabled = false; nextBtn.classList.remove('ob-loading'); }
      if (skipBtn)   skipBtn.disabled = false;
      ui.showToast('Não foi possível guardar os dados. Verifique a ligação e tente novamente.', 'error');
    }
  },

};

export default OnboardingScreen;
