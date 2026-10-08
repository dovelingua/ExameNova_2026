// ============================================================
// ExameNova — Shared UI
// File: panel/js/core/ui.js
//
// Self-contained — no external CSS dependencies.
// All shared styles injected once into document.head.
// All shared UI behaviour exported from this file.
//
// RULES:
// - This file is imported by EVERY screen
// - injectUIStyles() is called automatically at module level
// - Screens never call applyDarkMode() — router handles it
// - Dark mode key is 'en_theme' (not 'pn_theme')
// - Navbar items are student-focused (not teacher-focused)
// - Palette "Maré": Primary Sky Blue #0284C7, Secondary Violet
//   #8B5CF6, Accent Teal #14B8A6
// - Gold #FFB300 is reserved for Moedas only
// - Navbar keeps a soft blur (intentional). Toasts, sheets and
//   overlays are solid.
// ============================================================

import { router } from './router.js';

// Navbar scroll-listener state (module level — one listener at a time)

// ============================================================
// INJECT SHARED STYLES — once, on first import
// ============================================================

export function injectUIStyles() {
  if (document.getElementById('en-ui-styles')) return;
  const style = document.createElement('style');
  style.id = 'en-ui-styles';
  style.textContent = `

    /* ── RESET & BASE ── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    html, body {
      height: 100%;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      font-size: 16px;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      overflow-x: hidden;
    }

    body {
      background: var(--bg);
      color: var(--text);
    }

    button { font-family: inherit; cursor: pointer; border: none; background: none; }
    input, select, textarea { font-family: inherit; }
    a { text-decoration: none; color: inherit; }

    /* ── CSS VARIABLES — LIGHT MODE ── */
    :root {
      /* Brand colours — palette "Maré" */
      --primary:          #0284C7;
      --primary-dark:     #0369A1;
      --primary-light:    #E8F4FB;
      --secondary:        #8B5CF6;
      --secondary-light:  #F3EEFF;
      --accent:           #14B8A6;
      --accent-light:     #E6F7F5;
      --accent-soft:      rgba(20,184,166,0.1);

      /* Gold — Moedas ONLY — never decorative */
      --moeda:            #FFB300;
      --moeda-light:      #FFF8E1;
      --moeda-dark:       #FF8F00;

      /* Semantic */
      --danger:           #EF4444;
      --danger-light:     #FEF2F2;
      --success:          #22C55E;
      --success-light:    #E8F9EF;
      --warning:          #F59E0B;
      --warning-light:    #FFFBEB;

      /* Backgrounds */
      --bg:               #FAFAFA;
      --bg-card:          #FFFFFF;
      --bg-input:         #F3F5F7;
      --surface:          #FFFFFF;

      /* Text */
      --text:             #212121;
      --text-secondary:   #5A6478;
      --text-muted:       #9AA3B5;

      /* Borders */
      --border:           rgba(2,132,199,0.12);
      --border-subtle:    rgba(0,0,0,0.06);

      /* Shadows */
      --shadow-sm:        0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
      --shadow-md:        0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04);
      --shadow-lg:        0 8px 32px rgba(0,0,0,0.12), 0 4px 8px rgba(0,0,0,0.06);
      --shadow-blue:      0 4px 20px rgba(2,132,199,0.25);
      --shadow-purple:    0 4px 20px rgba(139,92,246,0.2);

      /* Radii */
      --radius-sm:        8px;
      --radius-md:        12px;
      --radius-lg:        16px;
      --radius-xl:        22px;
      --radius-full:      999px;

      /* Layout */
      --navbar-height:    64px;
      --header-height:    60px;
    }

    /* ── CSS VARIABLES — DARK MODE ── */
    [data-theme="dark"] {
      --primary:          #38BDF8;
      --primary-light:    rgba(56,189,248,0.14);
      --secondary:        #A78BFA;
      --secondary-light:  rgba(167,139,250,0.14);
      --accent:           #2DD4BF;
      --accent-light:     rgba(45,212,191,0.14);
      --accent-soft:      rgba(45,212,191,0.08);

      --moeda-light:      rgba(255,179,0,0.12);

      --danger:           #F87171;
      --danger-light:     rgba(248,113,113,0.14);
      --success:          #4ADE80;
      --success-light:    rgba(74,222,128,0.14);
      --warning:          #FBBF24;
      --warning-light:    rgba(251,191,36,0.14);

      --bg:               #121212;
      --bg-card:          #1E1E1E;
      --bg-input:         #2A2A2A;
      --surface:          #1E1E1E;

      --text:             #FAFAFA;
      --text-secondary:   #AAAAAA;
      --text-muted:       #666666;

      --border:           rgba(56,189,248,0.15);
      --border-subtle:    rgba(255,255,255,0.06);

      --shadow-sm:        0 1px 3px rgba(0,0,0,0.3);
      --shadow-md:        0 4px 12px rgba(0,0,0,0.4);
      --shadow-lg:        0 8px 32px rgba(0,0,0,0.5);
      --shadow-blue:      0 4px 20px rgba(2,132,199,0.3);
      --shadow-purple:    0 4px 20px rgba(139,92,246,0.25);
    }

    /* ── SCREEN ROOT ── */
    #screen-root {
      min-height: 100dvh;
      min-height: 100vh;
      position: relative;
    }

    /* ── SCREEN TRANSITION ── */
    .screen-enter {
      animation: screenSlideIn 220ms ease both;
    }
    @keyframes screenSlideIn {
      from { opacity: 0; transform: translateX(16px); }
      to   { opacity: 1; transform: translateX(0); }
    }

    /* ══════════════════════════════════════════════
       HEADER
    ══════════════════════════════════════════════ */
    .screen-header {
      position: sticky;
      top: 0;
      z-index: 100;
      height: var(--header-height);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      background: linear-gradient(135deg, #0369A1 0%, #0284C7 100%);
      box-shadow: 0 2px 12px rgba(2,132,199,0.3);
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1;
      min-width: 0;
    }

    .header-back {
      width: 36px;
      height: 36px;
      border-radius: var(--radius-full);
      background: rgba(255,255,255,0.15);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 15px;
      flex-shrink: 0;
      transition: background 0.2s;
      border: none;
      cursor: pointer;
    }
    .header-back:hover  { background: rgba(255,255,255,0.25); }
    .header-back:active { transform: scale(0.93); }

    .header-wordmark {
      font-size: 18px;
      font-weight: 900;
      color: #fff;
      letter-spacing: -0.5px;
      white-space: nowrap;
    }

    .header-title {
      font-size: 16px;
      font-weight: 700;
      color: #fff;
      letter-spacing: -0.2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    /* Moedas pill — gold, reserved for coin balance only */
    .moedas-pill {
      display: flex;
      align-items: center;
      gap: 5px;
      background: rgba(255,179,0,0.2);
      border: 1px solid rgba(255,179,0,0.4);
      border-radius: var(--radius-full);
      padding: 5px 12px;
      color: #FFD54F;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      transition: background 0.2s;
      white-space: nowrap;
      min-height: 32px;
    }
    .moedas-pill i { font-size: 12px; }
    .moedas-pill:hover { background: rgba(255,179,0,0.3); }

    /* Dark mode toggle switch */
    .dark-toggle-wrap {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .dark-toggle-icon {
      font-size: 12px;
      color: rgba(255,255,255,0.8);
    }
    .dark-toggle-switch {
      position: relative;
      width: 40px;
      height: 22px;
      flex-shrink: 0;
    }
    .dark-toggle-switch input {
      opacity: 0;
      width: 0;
      height: 0;
      position: absolute;
    }
    .dark-toggle-track {
      position: absolute;
      inset: 0;
      border-radius: var(--radius-full);
      background: rgba(255,255,255,0.2);
      border: 1px solid rgba(255,255,255,0.3);
      cursor: pointer;
      transition: background 0.25s;
    }
    .dark-toggle-track::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #fff;
      transition: transform 0.25s cubic-bezier(0.34,1.56,0.64,1);
      box-shadow: 0 1px 4px rgba(0,0,0,0.2);
    }
    .dark-toggle-switch input:checked + .dark-toggle-track {
      background: rgba(139,92,246,0.55);
      border-color: rgba(139,92,246,0.75);
    }
    .dark-toggle-switch input:checked + .dark-toggle-track::after {
      transform: translateX(18px);
      background: #C4B5FD;
    }

    /* ══════════════════════════════════════════════
       BOTTOM NAVBAR (soft blur — intentional)
    ══════════════════════════════════════════════ */
    .navbar {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 200;
      height: var(--navbar-height);
      background: rgba(250,250,250,0.85);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      display: flex;
      align-items: stretch;
      border-top: 1px solid rgba(2,132,199,0.10);
      padding-bottom: env(safe-area-inset-bottom, 0px);
      will-change: transform;
      transform: translateZ(0);
      -webkit-transform: translateZ(0);
      transition: transform 0.25s ease;
    }

    [data-theme="dark"] .navbar {
      background: rgba(18,18,18,0.92);
      border-top-color: rgba(56,189,248,0.12);
      box-shadow: 0 -4px 24px rgba(0,0,0,0.35);
    }

    .navbar-item {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      color: var(--text-muted);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.02em;
      border: none;
      background: none;
      cursor: pointer;
      position: relative;
      transition: color 0.2s;
      padding: 0;
      text-transform: uppercase;
      -webkit-tap-highlight-color: transparent;
    }

    .navbar-item i {
      font-size: 18px;
      display: block;
      transition: transform 0.2s, color 0.2s;
    }

    .navbar-item span {
      display: block;
      line-height: 1;
    }

    .navbar-item.active {
      color: var(--primary);
    }

    .navbar-item.active i {
      transform: translateY(-1px);
    }

    /* Active indicator — primary bar on top of the item */
    .navbar-item.active::before {
      content: '';
      position: absolute;
      top: 0;
      left: 50%;
      transform: translateX(-50%);
      width: 28px;
      height: 3px;
      background: var(--primary);
      border-radius: 0 0 var(--radius-full) var(--radius-full);
    }

    .navbar-item:active i { transform: scale(0.88); }

    /* ══════════════════════════════════════════════
       TOAST (solid)
    ══════════════════════════════════════════════ */
    .toast-container {
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 9000;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      width: calc(100% - 32px);
      max-width: 400px;
      pointer-events: none;
    }

    .toast {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      border-radius: var(--radius-md);
      font-size: 14px;
      font-weight: 600;
      color: var(--text);
      width: 100%;
      pointer-events: all;
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-left-width: 4px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06);
      animation: toastIn 0.3s cubic-bezier(0.34,1.56,0.64,1) both;
    }

    .toast i { font-size: 16px; flex-shrink: 0; }

    .toast-success { border-left-color: var(--success); }
    .toast-success i { color: var(--success); }

    .toast-error { border-left-color: var(--danger); }
    .toast-error i { color: var(--danger); }

    .toast-info { border-left-color: var(--primary); }
    .toast-info i { color: var(--primary); }

    .toast-warning { border-left-color: var(--warning); }
    .toast-warning i { color: var(--warning); }

    [data-theme="dark"] .toast {
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    }

    .toast.hiding {
      animation: toastOut 0.25s ease both;
    }

    @keyframes toastIn {
      from { opacity: 0; transform: translateY(-12px) scale(0.95); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes toastOut {
      from { opacity: 1; transform: translateY(0) scale(1); }
      to   { opacity: 0; transform: translateY(-8px) scale(0.95); }
    }

    /* ══════════════════════════════════════════════
       SKELETON
    ══════════════════════════════════════════════ */
    .skeleton {
      background: linear-gradient(90deg,
        rgba(2,132,199,0.05) 25%,
        rgba(2,132,199,0.10) 50%,
        rgba(2,132,199,0.05) 75%
      );
      background-size: 200% 100%;
      animation: shimmer 1.4s ease infinite;
      border-radius: var(--radius-md);
    }

    [data-theme="dark"] .skeleton {
      background: linear-gradient(90deg,
        rgba(255,255,255,0.04) 25%,
        rgba(255,255,255,0.08) 50%,
        rgba(255,255,255,0.04) 75%
      );
      background-size: 200% 100%;
      animation: shimmer 1.4s ease infinite;
    }

    @keyframes shimmer {
      from { background-position: 200% center; }
      to   { background-position: -200% center; }
    }

    .skeleton-card   { height: 90px; width: 100%; }
    .skeleton-avatar { width: 42px; height: 42px; border-radius: 50%; flex-shrink: 0; }
    .skeleton-title  { height: 22px; width: 55%; border-radius: var(--radius-sm); }
    .skeleton-text   { height: 14px; border-radius: var(--radius-sm); }
    .skeleton-text.full   { width: 100%; }
    .skeleton-text.medium { width: 70%; }
    .skeleton-text.short  { width: 40%; }

    /* ══════════════════════════════════════════════
       BOTTOM SHEET
    ══════════════════════════════════════════════ */
    .sheet-overlay {
      position: fixed;
      inset: 0;
      z-index: 800;
      background: rgba(0,0,0,0);
      transition: background 0.28s ease;
    }
    .sheet-overlay.visible { background: rgba(0,0,0,0.5); }

    .sheet {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 801;
      background: var(--bg-card);
      border-radius: var(--radius-xl) var(--radius-xl) 0 0;
      padding: 12px 20px 32px;
      transform: translateY(100%);
      transition: transform 0.28s cubic-bezier(0.34,1.2,0.64,1);
      box-shadow: 0 -8px 40px rgba(0,0,0,0.2);
      border-top: 1px solid var(--border);
      max-height: 85dvh;
      max-height: 85vh;
      overflow-y: auto;
    }
    .sheet.visible { transform: translateY(0); }

    .sheet-handle {
      width: 36px;
      height: 4px;
      background: var(--border-subtle);
      border-radius: var(--radius-full);
      margin: 0 auto 16px;
    }

    .sheet-title {
      font-size: 17px;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 16px;
    }

    .sheet-content {
      font-size: 14px;
      color: var(--text-secondary);
      line-height: 1.6;
      margin-bottom: 20px;
    }

    .sheet-actions {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    /* ══════════════════════════════════════════════
       BUTTONS (shared)
    ══════════════════════════════════════════════ */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      height: 50px;
      padding: 0 20px;
      border-radius: var(--radius-md);
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      border: none;
      transition: filter 0.2s, transform 0.15s;
      letter-spacing: 0.01em;
      font-family: inherit;
      -webkit-tap-highlight-color: transparent;
    }
    .btn:active  { transform: scale(0.97); }
    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
      filter: none;
    }

    .btn-full { width: 100%; }

    .btn-primary {
      background: linear-gradient(135deg, #0369A1 0%, #0284C7 100%);
      color: #fff;
      box-shadow: var(--shadow-blue);
    }
    .btn-primary:hover { filter: brightness(1.08); }

    /* .btn-accent keeps its name but now draws the violet (secondary) button */
    .btn-accent {
      background: linear-gradient(135deg, #7C3AED 0%, #8B5CF6 100%);
      color: #fff;
      box-shadow: var(--shadow-purple);
    }
    .btn-accent:hover { filter: brightness(1.08); }

    .btn-secondary {
      background: var(--secondary-light);
      color: var(--secondary);
    }

    .btn-neutral {
      background: var(--bg);
      color: var(--text-secondary);
      border: 1px solid var(--border-subtle);
    }

    .btn-danger {
      background: var(--danger-light);
      color: var(--danger);
    }

    /* ══════════════════════════════════════════════
       SPINNER (solid overlay)
    ══════════════════════════════════════════════ */
    .spinner-overlay {
      position: fixed;
      inset: 0;
      z-index: 9500;
      background: rgba(0,0,0,0.6);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
    }

    .spinner-ring {
      width: 48px;
      height: 48px;
      border: 3px solid rgba(255,255,255,0.15);
      border-top-color: #fff;
      border-radius: 50%;
      animation: spinRing 0.8s linear infinite;
    }

    .spinner-label {
      font-size: 14px;
      font-weight: 600;
      color: #fff;
      letter-spacing: 0.02em;
    }

    @keyframes spinRing {
      to { transform: rotate(360deg); }
    }

    /* ══════════════════════════════════════════════
       OFFLINE SCREEN
    ══════════════════════════════════════════════ */
    .offline-screen {
      min-height: 100dvh;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 40px 24px;
      background: var(--bg);
    }
    .offline-icon {
      font-size: 48px;
      color: var(--text-muted);
      margin-bottom: 20px;
    }
    .offline-title {
      font-size: 20px;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 10px;
    }
    .offline-text {
      font-size: 14px;
      color: var(--text-secondary);
      line-height: 1.6;
      max-width: 300px;
      margin-bottom: 24px;
    }

    /* ══════════════════════════════════════════════
       SCROLLBAR
    ══════════════════════════════════════════════ */
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb {
      background: rgba(2,132,199,0.25);
      border-radius: var(--radius-full);
    }

  `;
  document.head.appendChild(style);
}

// Auto-inject on module load
injectUIStyles();

// ============================================================
// DARK MODE
// Key: 'en_theme' — separate from ProvaNova's 'pn_theme'
// ============================================================

export function applyDarkMode() {
  try {
    const saved = localStorage.getItem('en_theme');
    if (saved === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    _syncAllToggles();
  } catch (e) {}
}

export function toggleDarkMode() {
  try {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (isDark) {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('en_theme', 'light');
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('en_theme', 'dark');
    }
    _syncAllToggles();
  } catch (e) {}
}

function _syncAllToggles() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  document.querySelectorAll('.js-dark-toggle-input').forEach(input => {
    input.checked = isDark;
  });
}

// ============================================================
// NAVBAR
// Student-focused items — different from ProvaNova's teacher navbar
// ============================================================

// ============================================================
// HEADER
// ============================================================

export function renderHeader(config = {}) {
  const mount = document.getElementById('header-mount');
  if (!mount) return;

  const {
    title          = '',
    backRoute      = null,
    showWordmark   = false,
    showDarkToggle = true,
    actionButton   = null,
    moedasBalance  = null,
  } = config;

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  mount.innerHTML = `
    <header class="screen-header" role="banner">

      <div class="header-left">
        ${backRoute ? `
          <button class="header-back js-header-back" aria-label="Voltar">
            <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>
          </button>
        ` : ''}
        ${showWordmark ? `
          <span class="header-wordmark notranslate" translate="no">ExameNova</span>
        ` : `
          <span class="header-title notranslate" translate="no">${title}</span>
        `}
      </div>

      <div class="header-right">

        ${actionButton ? `
          <button
            class="header-back js-header-action"
            id="${actionButton.id || 'header-action-btn'}"
            aria-label="${actionButton.label || ''}"
          >
            <i class="${actionButton.icon}" aria-hidden="true"></i>
          </button>
        ` : ''}

        ${moedasBalance !== null ? `
          <button
            class="moedas-pill js-moedas-pill notranslate"
            translate="no"
            aria-label="Moedas disponíveis"
          >
            <i class="fa-solid fa-coins" aria-hidden="true"></i>
            <span class="js-moedas-value">${moedasBalance}</span>
          </button>
        ` : ''}

        ${showDarkToggle ? `
          <div class="dark-toggle-wrap" title="Alternar tema">
            <i class="fa-solid fa-sun dark-toggle-icon" aria-hidden="true"></i>
            <label class="dark-toggle-switch" aria-label="Alternar tema escuro">
              <input
                type="checkbox"
                class="js-dark-toggle-input"
                ${isDark ? 'checked' : ''}
                aria-checked="${isDark}"
              >
              <span class="dark-toggle-track"></span>
            </label>
            <i class="fa-solid fa-moon dark-toggle-icon" aria-hidden="true"></i>
          </div>
        ` : ''}

      </div>
    </header>
  `;

  // Back button (element is recreated on every render — no pile-up)
  if (backRoute) {
    mount.querySelector('.js-header-back')?.addEventListener('click', () => {
      if (backRoute === 'back') {
        history.back();
      } else {
        router.navigate(backRoute);
      }
    });
  }

  // Dark toggle
  if (showDarkToggle) {
    const input = mount.querySelector('.js-dark-toggle-input');
    if (input) {
      input.addEventListener('change', () => {
        toggleDarkMode();
      });
    }
  }

  // Moedas pill — opens moedas info sheet (works on every tap)
  if (moedasBalance !== null) {
    mount.querySelector('.js-moedas-pill')?.addEventListener('click', () => {
      openBottomSheet({
        title:   'As suas Moedas',
        content: `Tem <strong style="color:var(--moeda);">${moedasBalance} Moedas</strong> disponíveis.<br><br>As Moedas permitem-lhe aceder a funcionalidades premium como o Meu Exame e o Mentor. Ganhe mais ao completar o Desafio Diário, convidar amigos e ser um estudante activo.`,
        actions: [
          { label: 'Convidar amigos e ganhar Moedas', route: '/panel/perfil' },
          { label: 'Fechar', dismiss: true },
        ],
      });
    });
  }
}

// ============================================================
// TOAST
// ============================================================

let _toastContainer = null;

function _getToastContainer() {
  if (!_toastContainer || !document.body.contains(_toastContainer)) {
    _toastContainer = document.createElement('div');
    _toastContainer.className = 'toast-container';
    _toastContainer.setAttribute('aria-live', 'polite');
    document.body.appendChild(_toastContainer);
  }
  return _toastContainer;
}

const TOAST_ICONS = {
  success: 'fa-solid fa-circle-check',
  error:   'fa-solid fa-circle-xmark',
  info:    'fa-solid fa-circle-info',
  warning: 'fa-solid fa-triangle-exclamation',
};

export function showToast(message, type = 'info') {
  const container = _getToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'alert');
  toast.innerHTML = `
    <i class="${TOAST_ICONS[type] || TOAST_ICONS.info}" aria-hidden="true"></i>
    <span>${message}</span>
  `;
  container.appendChild(toast);

  const dismiss = () => {
    toast.classList.add('hiding');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };

  // Spec: auto-dismiss after 3 seconds
  const timer = setTimeout(dismiss, 3000);
  toast.addEventListener('click', () => {
    clearTimeout(timer);
    dismiss();
  }, { once: true });
}

// ============================================================
// SKELETON
// ============================================================

export function showSkeleton(containerId, type = 'cards') {
  const container = document.getElementById(containerId);
  if (!container) return;

  const templates = {
    cards: [1,2,3].map(() =>
      `<div class="skeleton skeleton-card" style="margin-bottom:12px;"></div>`
    ).join(''),

    list: [1,2,3,4].map(() => `
      <div style="display:flex;gap:12px;align-items:center;margin-bottom:16px;">
        <div class="skeleton skeleton-avatar"></div>
        <div style="flex:1;display:flex;flex-direction:column;gap:8px;">
          <div class="skeleton skeleton-text medium"></div>
          <div class="skeleton skeleton-text short"></div>
        </div>
      </div>
    `).join(''),

    text: `
      <div class="skeleton skeleton-title" style="margin-bottom:12px;"></div>
      <div class="skeleton skeleton-text full"   style="margin-bottom:8px;"></div>
      <div class="skeleton skeleton-text medium" style="margin-bottom:8px;"></div>
      <div class="skeleton skeleton-text short"></div>
    `,

    profile: `
      <div style="display:flex;flex-direction:column;align-items:center;gap:16px;padding:24px 0;">
        <div class="skeleton skeleton-avatar" style="width:72px;height:72px;"></div>
        <div class="skeleton skeleton-text medium" style="height:20px;"></div>
        <div class="skeleton skeleton-text short"></div>
      </div>
      ${[1,2,3].map(() =>
        `<div class="skeleton skeleton-card" style="height:56px;margin-bottom:12px;"></div>`
      ).join('')}
    `,

    questions: [1,2,3].map(() => `
      <div style="margin-bottom:16px;">
        <div class="skeleton skeleton-text full"   style="margin-bottom:8px;height:18px;"></div>
        <div class="skeleton skeleton-text medium" style="margin-bottom:6px;height:14px;"></div>
        ${[1,2,3,4].map(() =>
          `<div class="skeleton" style="height:40px;margin-bottom:6px;border-radius:var(--radius-md);"></div>`
        ).join('')}
      </div>
    `).join(''),
  };

  container.innerHTML = templates[type] || templates.cards;
}

export function hideSkeleton(containerId) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = '';
}

// ============================================================
// BOTTOM SHEET
// ============================================================

let _sheetOverlay = null;
let _sheet        = null;
let _sheetOpen    = false;

export function openBottomSheet(config = {}) {
  if (_sheetOpen) closeBottomSheet();

  const { title = '', content = '', actions = [] } = config;

  _sheetOverlay = document.createElement('div');
  _sheetOverlay.className = 'sheet-overlay';
  _sheetOverlay.addEventListener('click', closeBottomSheet, { once: true });

  _sheet = document.createElement('div');
  _sheet.className = 'sheet';
  _sheet.setAttribute('role', 'dialog');
  _sheet.setAttribute('aria-modal', 'true');
  _sheet.setAttribute('aria-label', title);

  _sheet.innerHTML = `
    <div class="sheet-handle" aria-hidden="true"></div>
    ${title   ? `<h2 class="sheet-title notranslate" translate="no">${title}</h2>` : ''}
    ${content ? `<div class="sheet-content">${content}</div>` : ''}
    <div class="sheet-actions">
      ${actions.map((a, i) => `
        <button
          class="btn btn-full ${a.danger ? 'btn-danger' : (a.dismiss && !a.route) ? 'btn-neutral' : 'btn-primary'} notranslate"
          translate="no"
          data-action-index="${i}"
        >${a.label}</button>
      `).join('')}
    </div>
  `;

  document.body.appendChild(_sheetOverlay);
  document.body.appendChild(_sheet);
  lockScroll();
  _sheetOpen = true;

  requestAnimationFrame(() => {
    _sheetOverlay.classList.add('visible');
    _sheet.classList.add('visible');
  });

  _sheet.querySelectorAll('[data-action-index]').forEach(btn => {
    const action = actions[parseInt(btn.dataset.actionIndex)];
    btn.addEventListener('click', () => {
      if (typeof action.onClick === 'function') action.onClick();
      closeBottomSheet();
      if (action.route) router.navigate(action.route);
    }, { once: true });
  });
}

export function closeBottomSheet() {
  if (!_sheetOpen) return;
  _sheetOpen = false;
  _sheetOverlay?.classList.remove('visible');
  _sheet?.classList.remove('visible');
  setTimeout(() => {
    _sheetOverlay?.remove();
    _sheet?.remove();
    _sheetOverlay = null;
    _sheet        = null;
    unlockScroll();
  }, 280);
}

// ============================================================
// SPINNER
// Used during AI generation only — not for data loading
// ============================================================

let _spinnerEl = null;

export function showSpinner(label = 'A gerar...') {
  if (_spinnerEl) return;
  _spinnerEl = document.createElement('div');
  _spinnerEl.className = 'spinner-overlay';
  _spinnerEl.setAttribute('role', 'status');
  _spinnerEl.setAttribute('aria-label', label);
  _spinnerEl.innerHTML = `
    <div class="spinner-ring" aria-hidden="true"></div>
    <span class="spinner-label notranslate" translate="no">${label}</span>
  `;
  document.body.appendChild(_spinnerEl);
  lockScroll();
}

export function hideSpinner() {
  if (!_spinnerEl) return;
  _spinnerEl.remove();
  _spinnerEl = null;
  unlockScroll();
}

// ============================================================
// SCROLL LOCK
// ============================================================

let _scrollLockCount = 0;
let _savedScrollY    = 0;

export function lockScroll() {
  _scrollLockCount++;
  if (_scrollLockCount === 1) {
    _savedScrollY = window.scrollY;
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top      = `-${_savedScrollY}px`;
    document.body.style.width    = '100%';
  }
}

export function unlockScroll() {
  if (_scrollLockCount > 0) _scrollLockCount--;
  if (_scrollLockCount === 0) {
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.top      = '';
    document.body.style.width    = '';
    window.scrollTo(0, _savedScrollY);
  }
}

// ============================================================
// ONLINE CHECK
// ============================================================

export function checkOnline() {
  if (navigator.onLine) return true;
  const root = document.getElementById('screen-root');
  if (root) {
    root.innerHTML = `
      <div class="offline-screen">
        <i class="fa-solid fa-wifi offline-icon" aria-hidden="true"></i>
        <h2 class="offline-title notranslate" translate="no">
          Sem ligação à internet
        </h2>
        <p class="offline-text notranslate" translate="no">
          O ExameNova precisa de uma ligação activa para funcionar.
          Verifique a sua ligação à internet e tente novamente.
        </p>
        <button class="btn btn-primary js-retry-online" style="margin-top:8px;">
          Tentar novamente
        </button>
      </div>
    `;
    root.querySelector('.js-retry-online')?.addEventListener('click', () => {
      window.location.reload();
    }, { once: true });
  }
  return false;
}

// ============================================================
// DEFAULT EXPORT
// ============================================================

export const ui = {
  injectUIStyles,
  applyDarkMode,
  toggleDarkMode,
  renderHeader,
  showToast,
  showSkeleton,
  hideSkeleton,
  openBottomSheet,
  closeBottomSheet,
  showSpinner,
  hideSpinner,
  lockScroll,
  unlockScroll,
  checkOnline,
};
