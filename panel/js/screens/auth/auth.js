// ============================================================
// panel/js/screens/auth/auth.js
// ExameNova — Authentication Screen
// Login + Registration in one screen — two tabs, no reload
// No navbar — no header — logo only
// keepAlive: false
// ============================================================

import { auth, db }    from '../../core/firebase.js';
import { router }      from '../../core/router.js';
import { ui }          from '../../core/ui.js';
import { worker }      from '../../core/worker.js';
import { moeda, AWARDS } from '../../core/moeda.js';

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  updateProfile,
  sendPasswordResetEmail,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ============================================================
// HELPERS
// ============================================================

function generateInviteCode() {
  const digits = Math.floor(1000 + Math.random() * 9000).toString();
  return 'ENV-' + digits;
}

async function createUniqueInviteCode() {
  // Try up to 10 times — with 9000 possible codes (ENV-1000 to ENV-9999)
  // collision probability is negligible at launch scale
  for (let i = 0; i < 10; i++) {
    const code = generateInviteCode();
    const snap = await getDoc(doc(db, 'invite_codes', code));
    if (!snap.exists()) return code;
  }
  // Absolute fallback — extend to 5 digits to avoid collision
  return 'ENV-' + Math.floor(10000 + Math.random() * 90000).toString();
}

function isValidInviteCode(str) {
  return typeof str === 'string' && /^ENV-\d{4}$/.test(str.trim().toUpperCase());
}

const ERR = {
  'auth/email-already-in-use':    'Este email já está registado. Tente iniciar sessão.',
  'auth/invalid-email':           'O formato do email não é válido.',
  'auth/weak-password':           'Use pelo menos 6 caracteres na palavra-passe.',
  'auth/network-request-failed':  'Sem ligação à internet. Verifique a sua ligação.',
  'auth/user-not-found':          'Não encontrámos nenhuma conta com este email.',
  'auth/wrong-password':          'Palavra-passe incorrecta.',
  'auth/too-many-requests':       'Demasiadas tentativas. Aguarde alguns minutos.',
  'auth/invalid-credential':      'Email ou palavra-passe incorrectos.',
  'auth/user-disabled':           'Esta conta foi desactivada. Contacte o suporte.',
  'auth/operation-not-allowed':   'Este método de acesso não está activado.',
  'auth/popup-blocked':           'O popup foi bloqueado. Permita popups para este site.',
  'auth/account-exists-with-different-credential':
    'Já existe uma conta com este email. Tente iniciar sessão com outro método.',
};

function getErrMsg(code) {
  if (!code) return 'Ocorreu um erro inesperado. Tente novamente.';
  return ERR[code] || 'Ocorreu um erro. Tente novamente.';
}

// ============================================================
// SCREEN
// ============================================================

const AuthScreen = {

  // ── ROOM 1 — CSS ────────────────────────────────────────
  css() {
    if (document.getElementById('auth-styles')) return '';
    return `<style id="auth-styles">

      /* ── ROOT ── */
      .auth-root {
        min-height: 100dvh;
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        background: var(--bg);
        overflow-x: hidden;
        position: relative;
      }

      /* ── HERO BAND ── */
      .auth-hero {
        width: 100%;
        background: linear-gradient(135deg, #0369A1 0%, #0284C7 60%, #0E9AA7 100%);
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 48px 24px 40px;
        position: relative;
        overflow: hidden;
        flex-shrink: 0;
      }

      .auth-hero-dot {
        position: absolute;
        border-radius: 50%;
        opacity: 0.07;
        background: #fff;
        pointer-events: none;
      }

      /* Curved bottom edge */
      .auth-hero::after {
        content: '';
        position: absolute;
        bottom: -20px;
        left: 0;
        right: 0;
        height: 40px;
        background: var(--bg);
        border-radius: 50% 50% 0 0 / 100% 100% 0 0;
      }

      /* ── LOGO ── */
      .auth-logo-img {
        width: min(200px, 55vw);
        height: auto;
        object-fit: contain;
        animation: authFadeDown 0.5s ease both;
      }

      .auth-hero-title {
        margin-top: 10px;
        font-size: 1.1rem;
        font-weight: 800;
        color: #fff;
        text-align: center;
        letter-spacing: -0.3px;
        line-height: 1.2;
        animation: authFadeDown 0.5s ease 0.05s both;
      }

      .auth-hero-subtitle {
        margin-top: 4px;
        font-size: 0.75rem;
        color: rgba(255,255,255,0.65);
        text-align: center;
        max-width: 260px;
        line-height: 1.5;
        font-weight: 500;
        animation: authFadeDown 0.5s ease 0.1s both;
      }

      /* ── DARK MODE TOGGLE ── */
      .auth-dark-toggle {
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
      .auth-dark-toggle:hover { background: rgba(255,255,255,0.25); }

      /* ── CARD AREA ── */
      .auth-card-area {
        width: 100%;
        max-width: 480px;
        padding: 28px 16px 60px;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        margin-top: 4px;
        position: relative;
        z-index: 1;
        animation: authFadeUp 0.45s ease 0.1s both;
      }

      /* ── CARD ── */
      .auth-card {
        background: var(--bg-card);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-xl);
        padding: 20px 20px 24px;
        box-shadow: var(--shadow-lg);
      }
      [data-theme="dark"] .auth-card {
        border-color: rgba(255,255,255,0.06);
      }

      /* ── TABS ── */
      .auth-tabs {
        display: flex;
        background: var(--primary-light);
        border-radius: var(--radius-full);
        padding: 4px;
        margin-bottom: 24px;
        gap: 2px;
      }
      [data-theme="dark"] .auth-tabs {
        background: rgba(255,255,255,0.06);
      }

      .auth-tab {
        flex: 1;
        padding: 10px;
        font-family: inherit;
        font-size: 0.875rem;
        font-weight: 700;
        color: var(--text-muted);
        background: transparent;
        border: none;
        border-radius: var(--radius-full);
        cursor: pointer;
        transition: all 0.2s;
        min-height: 40px;
      }
      .auth-tab.active {
        background: var(--primary);
        color: #fff;
        box-shadow: var(--shadow-blue);
      }

      /* ── SECTIONS ── */
      .auth-section { display: none; }
      .auth-section.active { display: block; }

      /* ── FIELDS ── */
      .auth-field { margin-bottom: 14px; }

      .auth-field label {
        display: block;
        font-size: 0.72rem;
        font-weight: 700;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.07em;
        margin-bottom: 6px;
      }

      .auth-field input {
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
      .auth-field input::placeholder { color: var(--text-muted); }
      .auth-field input:focus {
        border-color: var(--primary);
        box-shadow: 0 0 0 3px rgba(2,132,199,0.15);
        background: var(--bg-card);
      }
      .auth-field input.err {
        border-color: var(--danger) !important;
        background: var(--danger-light);
      }
      [data-theme="dark"] .auth-field input.err {
        background: rgba(248,113,113,0.14);
      }

      .auth-field-error {
        display: none;
        font-size: 0.75rem;
        color: var(--danger);
        margin-top: 5px;
        font-weight: 500;
      }
      .auth-field-error.show { display: block; }

      /* ── PASSWORD WRAP ── */
      .auth-pw-wrap { position: relative; }
      .auth-pw-wrap input { padding-right: 48px; }

      .auth-pw-toggle {
        position: absolute;
        right: 12px;
        top: 50%;
        transform: translateY(-50%);
        background: none;
        border: none;
        cursor: pointer;
        font-size: 1rem;
        color: var(--text-muted);
        padding: 0;
        min-width: 44px;
        min-height: 44px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: color 0.2s;
      }
      .auth-pw-toggle:hover { color: var(--primary); }

      /* ── FORGOT ── */
      .auth-forgot {
        display: block;
        text-align: right;
        font-size: 0.75rem;
        color: var(--primary);
        cursor: pointer;
        margin-top: -4px;
        margin-bottom: 4px;
        background: none;
        border: none;
        font-family: inherit;
        font-weight: 600;
        padding: 4px 0;
        min-height: 28px;
      }
      .auth-forgot:hover { text-decoration: underline; }

      /* ── DIVIDER ── */
      .auth-divider {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 16px 0;
      }
      .auth-divider::before,
      .auth-divider::after {
        content: '';
        flex: 1;
        height: 1px;
        background: var(--border-subtle);
      }
      .auth-divider span {
        font-size: 0.72rem;
        color: var(--text-muted);
        white-space: nowrap;
        font-weight: 500;
      }

      /* ── PRIMARY BUTTON ── */
      .auth-btn-primary {
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
        margin-bottom: 12px;
        min-height: 52px;
        box-shadow: var(--shadow-blue);
      }
      .auth-btn-primary:hover:not(:disabled) {
        transform: translateY(-1px);
        box-shadow: 0 6px 24px rgba(2,132,199,0.4);
      }
      .auth-btn-primary:active:not(:disabled) { transform: scale(0.98); }
      .auth-btn-primary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
        box-shadow: none;
      }

      /* ── GOOGLE BUTTON ── */
      .auth-btn-google {
        width: 100%;
        padding: 14px;
        background: var(--bg-card);
        border: 1.5px solid var(--border-subtle);
        border-radius: var(--radius-md);
        color: var(--text);
        font-family: inherit;
        font-size: 0.88rem;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        transition: background 0.2s, border-color 0.2s, box-shadow 0.2s;
        margin-bottom: 4px;
        min-height: 52px;
        box-shadow: var(--shadow-sm);
      }
      .auth-btn-google:hover:not(:disabled) {
        border-color: var(--primary);
        box-shadow: var(--shadow-blue);
      }
      .auth-btn-google:disabled { opacity: 0.55; cursor: not-allowed; }

      .auth-google-icon { width: 20px; height: 20px; flex-shrink: 0; }

      /* ── INVITE TRIGGER ── */
      .auth-btn-invite-trigger {
        width: 100%;
        padding: 13px;
        background: var(--moeda-light);
        border: 1.5px dashed rgba(255,179,0,0.5);
        border-radius: var(--radius-md);
        color: var(--moeda-dark);
        font-family: inherit;
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        transition: all 0.2s;
        margin-bottom: 12px;
        min-height: 52px;
      }
      .auth-btn-invite-trigger:hover {
        background: rgba(255,179,0,0.15);
        border-color: var(--moeda);
      }
      [data-theme="dark"] .auth-btn-invite-trigger {
        color: var(--moeda);
      }

      /* ── APPLIED CODE PILL ── */
      .auth-code-applied {
        display: none;
        align-items: center;
        justify-content: space-between;
        background: var(--success-light);
        border: 1.5px solid rgba(34,197,94,0.3);
        border-radius: var(--radius-md);
        padding: 12px 16px;
        margin-bottom: 12px;
        font-size: 0.82rem;
        color: var(--success);
        font-weight: 600;
        gap: 8px;
      }
      .auth-code-applied.show { display: flex; }

      .auth-code-remove {
        background: none;
        border: none;
        cursor: pointer;
        color: inherit;
        font-size: 0.75rem;
        opacity: 0.7;
        padding: 4px 8px;
        border-radius: var(--radius-sm);
        font-family: inherit;
        transition: opacity 0.2s;
        min-height: 36px;
        flex-shrink: 0;
      }
      .auth-code-remove:hover { opacity: 1; }

      /* ── SWITCH ROW ── */
      .auth-switch-row {
        text-align: center;
        margin-bottom: 12px;
      }
      .auth-switch-row span {
        font-size: 0.8rem;
        color: var(--text-muted);
      }
      .auth-switch-link {
        background: none;
        border: none;
        font-size: 0.8rem;
        font-weight: 700;
        color: var(--primary);
        cursor: pointer;
        padding: 4px 6px;
        font-family: inherit;
        transition: opacity 0.2s;
      }
      .auth-switch-link:hover { opacity: 0.75; }

      /* ── LOADING STATE ── */
      .auth-spinner {
        width: 18px;
        height: 18px;
        border: 2.5px solid rgba(255,255,255,0.3);
        border-top-color: #fff;
        border-radius: 50%;
        animation: authSpin 0.7s linear infinite;
        display: none;
        flex-shrink: 0;
      }
      .auth-loading .auth-spinner  { display: block; }
      .auth-loading .auth-btn-label { display: none; }

      /* ── BOTTOM SHEET OVERLAY ── */
      .auth-sheet-overlay {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.55);
        z-index: 900;
        align-items: flex-end;
        justify-content: center;
      }
      .auth-sheet-overlay.show {
        display: flex;
        animation: authFadeIn 0.25s ease;
      }

      .auth-sheet {
        background: var(--bg-card);
        border-top-left-radius: var(--radius-xl);
        border-top-right-radius: var(--radius-xl);
        border-top: 1px solid var(--border-subtle);
        padding: 16px 24px 48px;
        width: 100%;
        max-width: 480px;
        animation: authSlideUp 0.32s cubic-bezier(0.34,1.1,0.64,1);
      }

      .auth-sheet-handle {
        width: 40px;
        height: 4px;
        background: var(--border-subtle);
        border-radius: var(--radius-full);
        margin: 0 auto 20px;
      }

      .auth-sheet-title {
        font-size: 1.05rem;
        font-weight: 800;
        color: var(--text);
        margin-bottom: 6px;
      }

      .auth-sheet-sub {
        font-size: 0.82rem;
        color: var(--text-muted);
        margin-bottom: 20px;
        line-height: 1.55;
      }

      /* Inline sheet banners */
      .auth-sheet-error {
        display: none;
        background: var(--danger-light);
        border: 1px solid rgba(239,68,68,0.3);
        border-radius: var(--radius-md);
        padding: 11px 14px;
        font-size: 0.82rem;
        color: var(--danger);
        margin-bottom: 14px;
        line-height: 1.55;
      }
      .auth-sheet-error.show { display: block; }

      .auth-sheet-success {
        display: none;
        background: var(--success-light);
        border: 1px solid rgba(34,197,94,0.3);
        border-radius: var(--radius-md);
        padding: 11px 14px;
        font-size: 0.82rem;
        color: var(--success);
        margin-bottom: 14px;
        line-height: 1.55;
      }
      .auth-sheet-success.show { display: block; }

      /* ── CODE ROW ── */
      .auth-code-row {
        display: flex;
        gap: 8px;
        align-items: flex-start;
      }
      .auth-code-row input {
        flex: 1;
        letter-spacing: 3px;
        text-transform: uppercase;
        font-weight: 700;
        font-size: 1rem;
      }

      .auth-btn-verify {
        padding: 13px 16px;
        background: var(--primary);
        color: #fff;
        border: none;
        border-radius: var(--radius-md);
        font-family: inherit;
        font-size: 0.82rem;
        font-weight: 700;
        cursor: pointer;
        white-space: nowrap;
        transition: opacity 0.2s;
        min-height: 50px;
        flex-shrink: 0;
      }
      .auth-btn-verify:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      .auth-invite-status {
        font-size: 0.8rem;
        margin-top: 8px;
        min-height: 20px;
        font-weight: 600;
        line-height: 1.5;
      }
      .auth-invite-status.valid   { color: var(--success); }
      .auth-invite-status.invalid { color: var(--danger);  }

      .auth-sheet-actions {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-top: 20px;
      }

      .auth-btn-sheet-cancel {
        width: 100%;
        padding: 14px;
        background: transparent;
        border: 1.5px solid var(--border-subtle);
        border-radius: var(--radius-md);
        color: var(--text-muted);
        font-family: inherit;
        font-size: 0.88rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
        min-height: 52px;
      }
      .auth-btn-sheet-cancel:hover {
        border-color: var(--primary);
        color: var(--primary);
      }

      /* ── ANIMATIONS ── */
      @keyframes authFadeDown {
        from { opacity: 0; transform: translateY(-12px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @keyframes authFadeUp {
        from { opacity: 0; transform: translateY(20px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @keyframes authFadeIn {
        from { opacity: 0; } to { opacity: 1; }
      }
      @keyframes authSpin {
        to { transform: rotate(360deg); }
      }
      @keyframes authSlideUp {
        from { transform: translateY(100%); }
        to   { transform: translateY(0); }
      }

      /* ── RESPONSIVE ── */
      @media (min-width: 480px) {
        .auth-hero  { padding: 56px 32px 48px; }
        .auth-card  { padding: 28px 28px 32px; }
        .auth-logo-img { width: 220px; }
      }
      @media (max-width: 360px) {
        .auth-logo-img { width: min(160px, 52vw); }
        .auth-card { padding: 16px 14px 20px; }
        .auth-hero { padding: 40px 16px 36px; }
      }

    </style>`;
  },

  // ── ROOM 2 — MOUNT ──────────────────────────────────────
  mount() {
    return `
      <div class="auth-root" translate="no">

        <!-- Dark mode toggle -->
        <button
          class="auth-dark-toggle notranslate"
          id="authDarkToggle"
          aria-label="Alternar tema escuro"
          translate="no"
        >
          <i class="fa-solid fa-moon" id="authDarkIcon" aria-hidden="true"></i>
        </button>

        <!-- Hero -->
        <div class="auth-hero">
          <div class="auth-hero-dot" style="width:200px;height:200px;top:-80px;right:-60px;"></div>
          <div class="auth-hero-dot" style="width:100px;height:100px;bottom:20px;left:10px;"></div>
          <img
            class="auth-logo-img notranslate"
            src="/assets/images/logo.png"
            alt="ExameNova"
            width="200"
            height="72"
            onerror="this.style.display='none'"
          >
          <div class="auth-hero-title notranslate" translate="no">
            Plataforma ExameNova
          </div>
          <div class="auth-hero-subtitle notranslate" translate="no">
            Preparação para Exames em Moçambique
          </div>
        </div>

        <!-- Card area -->
        <div class="auth-card-area">
          <div class="auth-card">

            <!-- Tabs -->
            <div class="auth-tabs">
              <button class="auth-tab active notranslate" id="authTabLogin" translate="no">
                Iniciar Sessão
              </button>
              <button class="auth-tab notranslate" id="authTabRegister" translate="no">
                Criar Conta
              </button>
            </div>

            <!-- ══ LOGIN ══ -->
            <div class="auth-section active" id="authSectionLogin">

              <!-- Google -->
              <button class="auth-btn-google notranslate" id="authBtnGoogleLogin" translate="no">
                <svg class="auth-google-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                <span class="auth-btn-label notranslate" translate="no">Continuar com o Google</span>
                <div class="auth-spinner"></div>
              </button>

              <div class="auth-divider">
                <span class="notranslate" translate="no">ou entre com email</span>
              </div>

              <div class="auth-field">
                <label>Email</label>
                <input
                  type="email"
                  id="loginEmail"
                  placeholder="o.seu@email.com"
                  autocomplete="email"
                />
                <div class="auth-field-error" id="errLoginEmail"></div>
              </div>

              <div class="auth-field">
                <label>Palavra-passe</label>
                <div class="auth-pw-wrap">
                  <input
                    type="password"
                    id="loginPassword"
                    placeholder="A sua palavra-passe"
                    autocomplete="current-password"
                  />
                  <button
                    class="auth-pw-toggle"
                    id="toggleLoginPw"
                    type="button"
                    aria-label="Mostrar palavra-passe"
                  >
                    <i class="fa-regular fa-eye"></i>
                  </button>
                </div>
                <div class="auth-field-error" id="errLoginPassword"></div>
              </div>

              <button class="auth-forgot notranslate" id="authForgotBtn" type="button" translate="no">
                Esqueceu a palavra-passe?
              </button>

              <div class="auth-switch-row">
                <span>Não tem conta?</span>
                <button class="auth-switch-link notranslate" id="authSwitchToRegister" translate="no">
                  Criar conta aqui
                </button>
              </div>

              <button class="auth-btn-primary notranslate" id="authBtnEmailLogin" translate="no">
                <div class="auth-spinner"></div>
                <span class="auth-btn-label">
                  <i class="fa-solid fa-right-to-bracket" aria-hidden="true"></i>
                  Entrar
                </span>
              </button>

            </div>
            <!-- end login -->

            <!-- ══ REGISTER ══ -->
            <div class="auth-section" id="authSectionRegister">

              <!-- Google -->
              <button class="auth-btn-google notranslate" id="authBtnGoogleRegister" translate="no">
                <svg class="auth-google-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                <span class="auth-btn-label notranslate" translate="no">Continuar com o Google</span>
                <div class="auth-spinner"></div>
              </button>

              <div class="auth-divider">
                <span class="notranslate" translate="no">ou registe-se com email</span>
              </div>

              <div class="auth-field">
                <label>Nome completo</label>
                <input
                  type="text"
                  id="regName"
                  placeholder="O seu nome completo"
                  autocomplete="name"
                />
                <div class="auth-field-error" id="errRegName"></div>
              </div>

              <div class="auth-field">
                <label>Email</label>
                <input
                  type="email"
                  id="regEmail"
                  placeholder="o.seu@email.com"
                  autocomplete="email"
                />
                <div class="auth-field-error" id="errRegEmail"></div>
              </div>

              <div class="auth-field">
                <label>Palavra-passe</label>
                <div class="auth-pw-wrap">
                  <input
                    type="password"
                    id="regPassword"
                    placeholder="Mínimo 6 caracteres"
                    autocomplete="new-password"
                  />
                  <button
                    class="auth-pw-toggle"
                    id="toggleRegPw"
                    type="button"
                    aria-label="Mostrar palavra-passe"
                  >
                    <i class="fa-regular fa-eye"></i>
                  </button>
                </div>
                <div class="auth-field-error" id="errRegPassword"></div>
              </div>

              <div class="auth-field">
                <label>Confirmar Palavra-passe</label>
                <div class="auth-pw-wrap">
                  <input
                    type="password"
                    id="regConfirm"
                    placeholder="Repita a palavra-passe"
                    autocomplete="new-password"
                  />
                  <button
                    class="auth-pw-toggle"
                    id="toggleRegConfirm"
                    type="button"
                    aria-label="Mostrar palavra-passe"
                  >
                    <i class="fa-regular fa-eye"></i>
                  </button>
                </div>
                <div class="auth-field-error" id="errRegConfirm"></div>
              </div>

              <!-- Applied code pill -->
              <div class="auth-code-applied notranslate" id="authCodeApplied" translate="no">
                <span>
                  <i class="fa-solid fa-gift" aria-hidden="true"></i>
                  Código <strong id="authCodeAppliedValue"></strong> aplicado
                  — +<strong>${AWARDS.INVITED}</strong> Moedas de bónus
                </span>
                <button class="auth-code-remove notranslate" id="authCodeRemoveBtn" translate="no">
                  Remover
                </button>
              </div>

              <!-- Invite trigger -->
              <button
                class="auth-btn-invite-trigger notranslate"
                id="authInviteTriggerBtn"
                translate="no"
              >
                <i class="fa-solid fa-gift" aria-hidden="true"></i>
                Tenho um Código de Convite
              </button>

              <div class="auth-switch-row">
                <span>Já tem conta?</span>
                <button class="auth-switch-link notranslate" id="authSwitchToLogin" translate="no">
                  Entrar aqui
                </button>
              </div>

              <button class="auth-btn-primary notranslate" id="authBtnEmailRegister" translate="no">
                <div class="auth-spinner"></div>
                <span class="auth-btn-label">
                  <i class="fa-solid fa-user-plus" aria-hidden="true"></i>
                  Criar Conta
                </span>
              </button>

            </div>
            <!-- end register -->

          </div><!-- end auth-card -->
        </div><!-- end auth-card-area -->

      </div><!-- end auth-root -->

      <!-- ══ BOTTOM SHEET — Password Reset ══ -->
      <div class="auth-sheet-overlay" id="authResetOverlay">
        <div class="auth-sheet">
          <div class="auth-sheet-handle"></div>
          <div class="auth-sheet-title notranslate" translate="no">
            <i class="fa-solid fa-key" aria-hidden="true"></i>
            Recuperar Palavra-passe
          </div>
          <div class="auth-sheet-sub notranslate" translate="no">
            Introduza o seu email e enviaremos um link de recuperação.
          </div>
          <div class="auth-sheet-error"   id="resetError"></div>
          <div class="auth-sheet-success" id="resetSuccess"></div>
          <div class="auth-field">
            <label>Email da conta</label>
            <input
              type="email"
              id="resetEmail"
              placeholder="o.seu@email.com"
              autocomplete="email"
            />
          </div>
          <div class="auth-sheet-actions">
            <button class="auth-btn-primary notranslate" id="authBtnSendReset" translate="no">
              <div class="auth-spinner"></div>
              <span class="auth-btn-label">Enviar Link de Recuperação</span>
            </button>
            <button class="auth-btn-sheet-cancel notranslate" id="authResetCloseBtn" translate="no">
              Cancelar
            </button>
          </div>
        </div>
      </div>

      <!-- ══ BOTTOM SHEET — Invite Code ══ -->
      <div class="auth-sheet-overlay" id="authInviteOverlay">
        <div class="auth-sheet">
          <div class="auth-sheet-handle"></div>
          <div class="auth-sheet-title notranslate" translate="no">
            <i class="fa-solid fa-gift" style="color:var(--moeda);" aria-hidden="true"></i>
            Código de Convite
          </div>
          <div class="auth-sheet-sub notranslate" translate="no">
            Introduza o código que recebeu de um colega.
            Ambos receberão Moedas de bónus ao criar a conta.
          </div>
          <div class="auth-sheet-error" id="inviteError"></div>
          <div class="auth-field">
            <label>Código de Convite</label>
            <div class="auth-code-row">
              <input
                type="text"
                id="inviteCodeInput"
                placeholder="ENV-0000"
                maxlength="8"
                autocomplete="off"
                inputmode="numeric"
              />
              <button
                class="auth-btn-verify notranslate"
                id="authBtnVerify"
                disabled
                translate="no"
              >
                Verificar
              </button>
            </div>
            <div class="auth-invite-status" id="authInviteStatus"></div>
          </div>
          <div class="auth-sheet-actions">
            <button class="auth-btn-sheet-cancel notranslate" id="authInviteCloseBtn" translate="no">
              Fechar
            </button>
          </div>
        </div>
      </div>
    `;
  },

  // ── ROOM 3 — INIT ───────────────────────────────────────
  async init(user, userData, params) {

    // ── State ──────────────────────────────────────────
    let _verifiedInviterUid = null;
    let _verifiedCode       = null;
    const _googleProvider   = new GoogleAuthProvider();
    _googleProvider.setCustomParameters({ prompt: 'select_account' });

    // ── Shorthand ──────────────────────────────────────
    const $ = id => document.getElementById(id);

    // ── Field error helpers ────────────────────────────
    function showFieldErr(id, msg) {
      const el = $(id);
      if (!el) return;
      el.textContent = msg;
      el.classList.add('show');
    }

    function clearFieldErrs() {
      document.querySelectorAll('.auth-field-error')
        .forEach(e => { e.textContent = ''; e.classList.remove('show'); });
      document.querySelectorAll('.auth-field input')
        .forEach(e => e.classList.remove('err'));
    }

    // ── Sheet banner helpers ───────────────────────────
    function showSheetError(id, msg) {
      const el = $(id);
      if (!el) return;
      el.textContent = msg;
      el.classList.add('show');
    }
    function hideSheetBanner(id) { $(id)?.classList.remove('show'); }

    function showSheetSuccess(id, msg) {
      const el = $(id);
      if (!el) return;
      el.textContent = msg;
      el.classList.add('show');
    }

    // ── Loading state ──────────────────────────────────
    function setLoading(btnId, on) {
      const b = $(btnId);
      if (!b) return;
      b.disabled = on;
      b.classList.toggle('auth-loading', on);
    }

    // ── Password toggle ────────────────────────────────
    function togglePw(inputId, btn) {
      const inp  = $(inputId);
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      btn.innerHTML = show
        ? '<i class="fa-regular fa-eye-slash"></i>'
        : '<i class="fa-regular fa-eye"></i>';
    }

    // ── Tab switching ──────────────────────────────────
    function switchTab(tab) {
      clearFieldErrs();
      $('authSectionLogin').classList.toggle('active',    tab === 'login');
      $('authSectionRegister').classList.toggle('active', tab === 'register');
      $('authTabLogin').classList.toggle('active',    tab === 'login');
      $('authTabRegister').classList.toggle('active', tab === 'register');
    }

    // ── Bottom sheet helpers ───────────────────────────
    function openSheet(id) {
      $(id)?.classList.add('show');
      document.body.style.overflow = 'hidden';
    }
    function closeSheet(id) {
      $(id)?.classList.remove('show');
      document.body.style.overflow = '';
    }

    // ── Create user document ───────────────────────────
    async function createUserDoc(uid, fullName, email, invitedByUid, inviteCode) {
      const myCode = await createUniqueInviteCode();

      // Create Firestore user document
      await setDoc(doc(db, 'users', uid), {
        fullName,
        email,
        province:    null,
        district:    null,
        school:      null,
        examType:    null,
        grade:       null,
        status:      null,
        section:     null,
        subjects:    [],
        course:      null,
        institution: null,
        groupId:     null,
        moedas:      0,
        inviteCode:  myCode,
        invitedBy:   invitedByUid || null,
        examDates:   {},
        joinedAt:    serverTimestamp(),
        lastActive:  serverTimestamp(),
        role:        'student',
      });

      // Register this student's invite code
      await setDoc(doc(db, 'invite_codes', myCode), {
        code:      myCode,
        ownerId:   uid,
        ownerName: fullName,
        createdAt: serverTimestamp(),
        usedCount: 0,
      });

      // Award registration Moedas via Worker — after doc created
      await worker.awardMoedas(uid, AWARDS.REGISTRATION, 'registration');

      // Award invited bonus to new student
      if (invitedByUid) {
        await worker.awardMoedas(uid, AWARDS.INVITED, 'invited');
      }

      // Record invite + award inviter
      if (invitedByUid && inviteCode) {
        await setDoc(doc(db, 'invites', uid), {
          inviterCode:  inviteCode,
          invitedEmail: email,
          invitedName:  fullName,
          status:       'completed',
          createdAt:    serverTimestamp(),
        });
        await worker.awardMoedas(invitedByUid, AWARDS.INVITE, 'invite');
      }
    }

    // ── Pre-fill invite from URL param ────────────────
    {
      const urlParams = new URLSearchParams(window.location.search);

      // Switch to register tab if requested
      if (urlParams.get('tab') === 'register') switchTab('register');

      const codeParam = (urlParams.get('code') || '').toUpperCase().trim();
      if (isValidInviteCode(codeParam)) {
        try {
          const result = await worker.validateInvite(codeParam);
          if (result.valid) {
            _verifiedInviterUid = result.inviterId;
            _verifiedCode       = codeParam;
            $('authCodeAppliedValue').textContent = codeParam;
            $('authCodeApplied').classList.add('show');
            $('authInviteTriggerBtn').style.display = 'none';
            switchTab('register');
          }
        } catch (e) {
          console.warn('[Auth] Could not pre-verify invite code:', e);
        }
      }
    }

    // ── Dark mode toggle ───────────────────────────────
    {
      const btn  = $('authDarkToggle');
      const icon = $('authDarkIcon');
      const updateIcon = () => {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        if (icon) icon.className = isDark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
      };
      updateIcon();
      if (btn && !btn._wired) {
        btn._wired = true;
        btn.addEventListener('click', () => {
          ui.toggleDarkMode();
          updateIcon();
        });
      }
    }

    // ── Tabs ───────────────────────────────────────────
    ['authTabLogin', 'authTabRegister', 'authSwitchToLogin', 'authSwitchToRegister']
      .forEach(id => {
        const el = $(id);
        if (!el) return;
        const fresh = el.cloneNode(true);
        el.replaceWith(fresh);
      });

    $('authTabLogin').addEventListener('click',        () => switchTab('login'));
    $('authTabRegister').addEventListener('click',     () => switchTab('register'));
    $('authSwitchToLogin').addEventListener('click',   () => switchTab('login'));
    $('authSwitchToRegister').addEventListener('click',() => switchTab('register'));

    // ── Password toggles ───────────────────────────────
    ['toggleLoginPw', 'toggleRegPw', 'toggleRegConfirm'].forEach(id => {
      const el = $(id);
      if (!el) return;
      const fresh = el.cloneNode(true);
      el.replaceWith(fresh);
    });
    $('toggleLoginPw').addEventListener('click',    function() { togglePw('loginPassword', this); });
    $('toggleRegPw').addEventListener('click',      function() { togglePw('regPassword',   this); });
    $('toggleRegConfirm').addEventListener('click', function() { togglePw('regConfirm',    this); });

    // ── Auto-capitalise name ───────────────────────────
    $('regName')?.addEventListener('input', function() {
      const pos = this.selectionStart;
      this.value = this.value.replace(/(?:^|\s)\S/g, c => c.toUpperCase());
      this.setSelectionRange(pos, pos);
    });

    // ── Bottom sheet overlays — click outside to close ─
    ['authResetOverlay', 'authInviteOverlay'].forEach(id => {
      const el = $(id);
      if (!el) return;
      const fresh = el.cloneNode(true);
      el.replaceWith(fresh);
      $(id).addEventListener('click', function(e) {
        if (e.target === this) closeSheet(id);
      });
    });

    // ── Forgot password ────────────────────────────────
    {
      const el = $('authForgotBtn');
      if (el) {
        const fresh = el.cloneNode(true);
        el.replaceWith(fresh);
        $('authForgotBtn').addEventListener('click', () => {
          hideSheetBanner('resetError');
          hideSheetBanner('resetSuccess');
          const email = $('loginEmail').value.trim();
          if (email) $('resetEmail').value = email;
          openSheet('authResetOverlay');
        });
      }
    }
    {
      const el = $('authResetCloseBtn');
      if (el) {
        const fresh = el.cloneNode(true);
        el.replaceWith(fresh);
        $('authResetCloseBtn').addEventListener('click', () => closeSheet('authResetOverlay'));
      }
    }

    // ── Send password reset ────────────────────────────
    {
      const el = $('authBtnSendReset');
      if (el) {
        const fresh = el.cloneNode(true);
        el.replaceWith(fresh);
        $('authBtnSendReset').addEventListener('click', async () => {
          hideSheetBanner('resetError');
          hideSheetBanner('resetSuccess');
          const email = $('resetEmail').value.trim();
          if (!email) {
            showSheetError('resetError', 'Introduza o seu email.');
            return;
          }
          setLoading('authBtnSendReset', true);
          try {
            await sendPasswordResetEmail(auth, email);
            showSheetSuccess(
              'resetSuccess',
              '✅ Email enviado! Verifique a sua caixa de entrada.'
            );
          } catch (e) {
            showSheetError('resetError', getErrMsg(e.code));
          } finally {
            setLoading('authBtnSendReset', false);
          }
        });
      }
    }

    // ── Invite code trigger ────────────────────────────
    {
      const el = $('authInviteTriggerBtn');
      if (el) {
        const fresh = el.cloneNode(true);
        el.replaceWith(fresh);
        $('authInviteTriggerBtn').addEventListener('click', () => {
          hideSheetBanner('inviteError');
          $('inviteCodeInput').value = 'ENV-';
          $('authBtnVerify').disabled = true;
          $('authInviteStatus').textContent = '';
          $('authInviteStatus').className = 'auth-invite-status';
          openSheet('authInviteOverlay');
        });
      }
    }
    {
      const el = $('authInviteCloseBtn');
      if (el) {
        const fresh = el.cloneNode(true);
        el.replaceWith(fresh);
        $('authInviteCloseBtn').addEventListener('click', () => closeSheet('authInviteOverlay'));
      }
    }

    // ── Remove applied code ────────────────────────────
    {
      const el = $('authCodeRemoveBtn');
      if (el) {
        const fresh = el.cloneNode(true);
        el.replaceWith(fresh);
        $('authCodeRemoveBtn').addEventListener('click', () => {
          _verifiedInviterUid = null;
          _verifiedCode       = null;
          $('authCodeApplied').classList.remove('show');
          $('authInviteTriggerBtn').style.display = '';
        });
      }
    }

    // ── Invite code input — formatter ─────────────────
    // Format: ENV-XXXX (digits only after dash)
    {
      const inp = $('inviteCodeInput');
      if (inp) {
        const fresh = inp.cloneNode(true);
        inp.replaceWith(fresh);
        $('inviteCodeInput').addEventListener('input', function() {
          let raw = this.value.toUpperCase().replace(/[^ENV0-9\-]/g, '');

          // Always keep ENV- prefix
          if (!raw.startsWith('ENV-')) {
            const digits = raw.replace(/[^0-9]/g, '').slice(0, 4);
            raw = 'ENV-' + digits;
          } else {
            const digits = raw.slice(4).replace(/[^0-9]/g, '').slice(0, 4);
            raw = 'ENV-' + digits;
          }

          this.value = raw;
          const len  = raw.length;
          this.setSelectionRange(len, len);

          const valid = isValidInviteCode(raw);
          $('authBtnVerify').disabled = !valid;

          if (!valid) {
            $('authInviteStatus').textContent = '';
            $('authInviteStatus').className   = 'auth-invite-status';
          }
        });
      }
    }

    // ── Verify invite code via Worker ──────────────────
    {
      const el = $('authBtnVerify');
      if (el) {
        const fresh = el.cloneNode(true);
        el.replaceWith(fresh);
        $('authBtnVerify').addEventListener('click', async () => {
          const code = $('inviteCodeInput').value.trim().toUpperCase();
          if (!isValidInviteCode(code)) return;

          $('authBtnVerify').disabled    = true;
          $('authBtnVerify').textContent = '...';
          hideSheetBanner('inviteError');

          try {
            const result = await worker.validateInvite(code);

            if (result.valid) {
              _verifiedInviterUid = result.inviterId;
              _verifiedCode       = code;

              $('authInviteStatus').textContent = `✅ Código válido! Bónus de ${AWARDS.INVITED} Moedas aplicado.`;
              $('authInviteStatus').className   = 'auth-invite-status valid';

              setTimeout(() => {
                closeSheet('authInviteOverlay');
                $('authCodeAppliedValue').textContent = code;
                $('authCodeApplied').classList.add('show');
                $('authInviteTriggerBtn').style.display = 'none';
              }, 800);

            } else {
              $('authInviteStatus').textContent = '❌ Código inválido. Verifique e tente novamente.';
              $('authInviteStatus').className   = 'auth-invite-status invalid';
              $('authBtnVerify').disabled       = false;
              $('authBtnVerify').textContent    = 'Verificar';
            }

          } catch (e) {
            showSheetError('inviteError', 'Erro ao verificar o código. Tente novamente.');
            $('authBtnVerify').disabled    = false;
            $('authBtnVerify').textContent = 'Verificar';
          }
        });
      }
    }

    // ── Register with email ────────────────────────────
    {
      const el = $('authBtnEmailRegister');
      if (el) {
        const fresh = el.cloneNode(true);
        el.replaceWith(fresh);
        $('authBtnEmailRegister').addEventListener('click', async () => {
          clearFieldErrs();

          const fullName = ($('regName').value.trim())
            .replace(/(?:^|\s)\S/g, c => c.toUpperCase());
          const email    = $('regEmail').value.trim();
          const pwd      = $('regPassword').value;
          const confirm  = $('regConfirm').value;
          const parts    = fullName.split(' ').filter(p => p.length > 0);
          let hasErr     = false;

          if (!fullName) {
            showFieldErr('errRegName', '⚠️ Escreva o seu nome completo.');
            $('regName').classList.add('err'); hasErr = true;
          } else if (parts.length < 2) {
            showFieldErr('errRegName', '⚠️ Escreva o nome e apelido. Ex: "Ana Machava".');
            $('regName').classList.add('err'); hasErr = true;
          }
          if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            showFieldErr('errRegEmail', '⚠️ Introduza um email válido.');
            $('regEmail').classList.add('err'); hasErr = true;
          }
          if (!pwd || pwd.length < 6) {
            showFieldErr('errRegPassword', '⚠️ A palavra-passe deve ter pelo menos 6 caracteres.');
            $('regPassword').classList.add('err'); hasErr = true;
          }
          if (!confirm) {
            showFieldErr('errRegConfirm', '⚠️ Confirme a sua palavra-passe.');
            $('regConfirm').classList.add('err'); hasErr = true;
          } else if (pwd !== confirm) {
            showFieldErr('errRegConfirm', '⚠️ As palavras-passe não coincidem.');
            $('regConfirm').classList.add('err'); hasErr = true;
          }
          if (hasErr) return;

          setLoading('authBtnEmailRegister', true);
          try {
            const cred = await createUserWithEmailAndPassword(auth, email, pwd);
            await updateProfile(cred.user, { displayName: fullName });
            await createUserDoc(
              cred.user.uid,
              fullName,
              email,
              _verifiedInviterUid,
              _verifiedCode
            );
            ui.showToast('Conta criada com sucesso! Bem-vindo(a) ao ExameNova. 🎉', 'success');
            router.navigate('onboarding');
          } catch (e) {
            ui.showToast(getErrMsg(e.code), 'error');
          } finally {
            setLoading('authBtnEmailRegister', false);
          }
        });
      }
    }

    // ── Login with email ───────────────────────────────
    {
      const el = $('authBtnEmailLogin');
      if (el) {
        const fresh = el.cloneNode(true);
        el.replaceWith(fresh);
        $('authBtnEmailLogin').addEventListener('click', async () => {
          clearFieldErrs();
          const email = $('loginEmail').value.trim();
          const pwd   = $('loginPassword').value;
          let hasErr  = false;

          if (!email) {
            showFieldErr('errLoginEmail', '⚠️ Introduza o seu email.');
            $('loginEmail').classList.add('err'); hasErr = true;
          }
          if (!pwd) {
            showFieldErr('errLoginPassword', '⚠️ Introduza a sua palavra-passe.');
            $('loginPassword').classList.add('err'); hasErr = true;
          }
          if (hasErr) return;

          setLoading('authBtnEmailLogin', true);
          try {
            const cred = await signInWithEmailAndPassword(auth, email, pwd);
            // Safety net — if user doc missing, create it
            const snap = await getDoc(doc(db, 'users', cred.user.uid));
            if (!snap.exists()) {
              const name = cred.user.displayName || email.split('@')[0];
              await createUserDoc(cred.user.uid, name, email, null, null);
            }
            // Router onAuthStateChanged handles all routing
          } catch (e) {
            ui.showToast(getErrMsg(e.code), 'error');
          } finally {
            setLoading('authBtnEmailLogin', false);
          }
        });
      }
    }

    // ── Google login ───────────────────────────────────
    {
      const el = $('authBtnGoogleLogin');
      if (el) {
        const fresh = el.cloneNode(true);
        el.replaceWith(fresh);
        $('authBtnGoogleLogin').addEventListener('click', async () => {
          setLoading('authBtnGoogleLogin', true);
          try {
            await signInWithPopup(auth, _googleProvider);
            // Router handles routing
          } catch (e) {
            if (
              e.code !== 'auth/popup-closed-by-user' &&
              e.code !== 'auth/cancelled-popup-request'
            ) ui.showToast(getErrMsg(e.code), 'error');
          } finally {
            setLoading('authBtnGoogleLogin', false);
          }
        });
      }
    }

    // ── Google register ────────────────────────────────
    {
      const el = $('authBtnGoogleRegister');
      if (el) {
        const fresh = el.cloneNode(true);
        el.replaceWith(fresh);
        $('authBtnGoogleRegister').addEventListener('click', async () => {
          setLoading('authBtnGoogleRegister', true);
          try {
            const result = await signInWithPopup(auth, _googleProvider);
            const gUser  = result.user;
            const snap   = await getDoc(doc(db, 'users', gUser.uid));

            if (snap.exists() && snap.data().inviteCode) {
              // Already registered — router handles routing
              return;
            }

            const fullName = gUser.displayName || gUser.email.split('@')[0];
            await createUserDoc(
              gUser.uid,
              fullName,
              gUser.email,
              _verifiedInviterUid,
              _verifiedCode
            );
            ui.showToast('Conta criada! Bem-vindo(a) ao ExameNova. 🎉', 'success');
            router.navigate('onboarding');
          } catch (e) {
            if (
              e.code !== 'auth/popup-closed-by-user' &&
              e.code !== 'auth/cancelled-popup-request'
            ) ui.showToast(getErrMsg(e.code), 'error');
          } finally {
            setLoading('authBtnGoogleRegister', false);
          }
        });
      }
    }

    // ── Enter key shortcuts ────────────────────────────
    $('loginPassword')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') $('authBtnEmailLogin')?.click();
    });
    $('regConfirm')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') $('authBtnEmailRegister')?.click();
    });
    $('inviteCodeInput')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !$('authBtnVerify')?.disabled) $('authBtnVerify')?.click();
    });
    $('resetEmail')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') $('authBtnSendReset')?.click();
    });

  },

  // ── ROOM 4 — DESTROY ────────────────────────────────────
  destroy() {
    document.body.style.overflow = '';
  }

};

export default AuthScreen;
