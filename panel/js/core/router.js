// ============================================================
// ExameNova — SPA Router
// File: panel/js/core/router.js
//
// The brain of the ExameNova panel. Handles:
// - Firebase auth guard (runs ONCE on boot)
// - Screen registry + lazy loading
// - URL mapping + query params
// - Screen lifecycle (css → mount → init → destroy)
// - Dark mode application after every navigation
// - Nav-loading overlay (shows after 300ms on slow loads)
// - Screen transitions (slide in/out)
// - History stack + browser back button
// - keepAlive support (dashboard.js only)
// - Predictive prefetching after dashboard loads
// - Service worker update check
//
// RULES:
// - This file is the ONLY entry point — loaded by panel/index.html
// - Screens NEVER call onAuthStateChanged themselves
// - Screens NEVER call applyDarkMode() — router handles it
// - Dark mode key: 'en_theme' (not 'pn_theme')
// - All URLs are under /panel/ prefix
// - Onboarding gate: student must have examType set in Firestore
// - chatDb is imported but NOT used here — only in bate-papo.js
//   and moderador.js which import it directly from firebase.js
// ============================================================

import { auth, db }             from './firebase.js';
import { injectUIStyles, showToast } from './ui.js';
import { onAuthStateChanged }    from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { doc, getDoc }           from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ============================================================
// SCREEN REGISTRY
// Every panel screen registered with a lazy import.
// Loads only on first visit — cached in _cache after that.
// Render screens in renders/ are registered here as needed
// during the build — added by AI after discussing with
// Teacher Dove. Never add a render screen without that discussion.
// ============================================================
const SCREENS = {
  'auth':        () => import('../screens/auth/auth.js'),
  'onboarding':  () => import('../screens/auth/onboarding.js'),
  'dashboard':   () => import('../screens/dashboard/dashboard.js'),
  'simulacao':   () => import('../screens/simulacao/simulacao.js'),
  'revisao':     () => import('../screens/revisao/revisao.js'),
  'desafio':     () => import('../screens/desafio/desafio.js'),
  'meu-exame':   () => import('../screens/meu-exame/meu-exame.js'),
  'mentor':      () => import('../screens/mentor/mentor.js'),
  'progresso':   () => import('../screens/progresso/progresso.js'),
  'bate-papo':   () => import('../screens/bate-papo/bate-papo.js'),
  'perfil':      () => import('../screens/perfil/perfil.js'),
  'moderador':   () => import('../screens/moderador/moderador.js'),
  // ── Render screens added here during build as needed ──────
  // ── Render screens added here during build as needed ──────
  'renders/simulacao-render': () => import('../screens/renders/simulacao-render.js'),
  // 'renders/desafio-render':   () => import('../screens/renders/desafio-render.js'),
  'renders/meu-exame-render': () => import('../screens/renders/meu-exame-render.js'),
};

// ============================================================
// URL MAP
// Maps /panel/* URL pathnames to screen keys.
// All panel routes begin with /panel/.
// Navigating to /panel or /panel/ → auth or dashboard.
// ============================================================
const URL_MAP = {
  '/panel':              'auth',
  '/panel/':             'auth',
  '/panel/auth':         'auth',
  '/panel/onboarding':   'onboarding',
  '/panel/dashboard':    'dashboard',
  '/panel/simulacao':    'simulacao',
  '/panel/revisao':      'revisao',
  '/panel/desafio':      'desafio',
  '/panel/meu-exame':    'meu-exame',
  '/panel/mentor':       'mentor',
  '/panel/progresso':    'progresso',
  '/panel/bate-papo':    'bate-papo',
  '/panel/perfil':       'perfil',
  '/panel/moderador':    'moderador',
  // Render screens added here during build as needed:
  // Render screens added here during build as needed:
  '/panel/renders/simulacao-render': 'renders/simulacao-render',
  // '/panel/renders/desafio-render':   'renders/desafio-render',
  '/panel/renders/meu-exame-render': 'renders/meu-exame-render',
};

// ============================================================
// SCREENS WHERE THE NAVBAR IS SHOWN
// All main student-facing feature screens.
// Absent on: auth, onboarding, moderador.
// ============================================================
const NAVBAR_SCREENS = new Set([
  'dashboard',
]);

// ============================================================
// SCREENS WHERE USERDATA IS REFRESHED BEFORE INIT
// Screens where fresh Moedas balance and profile data matters.
// ============================================================
const REFRESH_SCREENS = new Set([
  'onboarding',   // fresh document right after registration (avoids stale/null userData)
  'dashboard',
  'perfil',
  'simulacao',
 'progresso',
  'meu-exame',
  'mentor',
  'desafio',
]);

// ============================================================
// ROUTER STATE
// ============================================================
let _currentScreen = null;  // Active screen object
let _currentKey    = null;  // Active screen key string
let _cache         = {};    // Loaded modules: key → module.default
let _historyStack  = [];    // Internal navigation history
let _user          = null;  // Firebase Auth user
let _userData      = null;  // Firestore users/{uid} document data
let _navLoadTimer  = null;  // Timer for nav-loading overlay

// ============================================================
// DOM REFERENCES
// Both elements live in panel/index.html shell.
// ============================================================
const screenRoot = document.getElementById('screen-root');
const navLoading = document.getElementById('nav-loading');

// ============================================================
// NAV-LOADING OVERLAY
// Shows only when navigation takes longer than 300ms.
// Prevents flicker on fast cached loads.
// ============================================================
function showNavLoading() {
  _navLoadTimer = setTimeout(() => {
    if (navLoading) navLoading.classList.add('visible');
  }, 300);
}

function hideNavLoading() {
  clearTimeout(_navLoadTimer);
  _navLoadTimer = null;
  if (navLoading) navLoading.classList.remove('visible');
}

// ============================================================
// DARK MODE
// Applied after every screen navigation.
// Key: 'en_theme' — separate from ProvaNova's 'pn_theme'.
// Screens never call this — only the router calls it.
// ============================================================
function applyDarkMode() {
  try {
    const saved = localStorage.getItem('en_theme');
    if (saved === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  } catch (e) {}
}

// ============================================================
// PARSE QUERY PARAMS
// /panel/simulacao?subject=matematica → { subject: 'matematica' }
// ============================================================
function parseParams(search) {
  const params = {};
  if (!search) return params;
  new URLSearchParams(search).forEach((value, key) => {
    params[key] = value;
  });
  return params;
}

// ============================================================
// RESOLVE SCREEN KEY FROM PATHNAME
// Looks up the URL_MAP. Falls back to 'auth' if not found.
// ============================================================
function resolveKey(pathname) {
  // Ignore a trailing slash, e.g. /panel/dashboard/
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return URL_MAP[clean] || URL_MAP[pathname] || (_user ? 'dashboard' : 'auth');
}

// ============================================================
// INJECT SCREEN CSS
// Takes the string from screen.css() and puts it into
// document.head. Skips if already there — idempotent.
// CSS must be in document.head for [data-theme="dark"]
// selectors to work. Never inject into a container div.
// ============================================================
function injectCSS(screen, key) {
  const styleId = `${key.replace(/\//g, '-')}-styles`;
  if (document.getElementById(styleId)) return;
  const css = screen.css ? screen.css() : '';
  if (!css) return;
  const temp = document.createElement('div');
  temp.innerHTML = css;
  const styleEl = temp.firstElementChild;
  if (styleEl) document.head.appendChild(styleEl);
}

// ============================================================
// SHOW SCREEN
// Core mounting logic. Called by navigate() and boot.
// ============================================================
async function showScreen(key, params = {}, pushHistory = true) {

  // 0. Guards
  // Not signed in → only the auth screen is reachable
  if (!_user && key !== 'auth') key = 'auth';
  // The moderator screen is for moderators only (students could type the URL)
  if (key === 'moderador' && _userData?.role !== 'moderador') key = 'dashboard';

  // 1. Load module or get from cache
  if (!_cache[key]) {
    if (!SCREENS[key]) {
      console.warn(`[Router] Unknown screen key: "${key}". Falling back.`);
      return showScreen(_user ? 'dashboard' : 'auth', {}, pushHistory);
    }
    try {
      const module = await SCREENS[key]();
      _cache[key] = module.default;
    } catch (err) {
      // e.g. screen file not built yet, or a network failure
      console.error(`[Router] Could not load screen "${key}":`, err);
      showToast('Não foi possível abrir esta secção.', 'error');
      return;
    }
  }
  const screen = _cache[key];

  // 2. Destroy previous screen unless it is keepAlive
  if (_currentScreen && _currentScreen !== screen) {
    if (!_currentScreen.keepAlive && typeof _currentScreen.destroy === 'function') {
      try { _currentScreen.destroy(); } catch (e) {}
    }
  }

  // 3. Inject this screen's CSS into document.head
  injectCSS(screen, key);

  // 4. Mount screen HTML into #screen-root
  const html = screen.mount ? screen.mount() : '';
  if (screenRoot) {
    screenRoot.innerHTML = html;
  }
  window.scrollTo(0, 0);

  // 5. Trigger slide-in animation
  if (screenRoot) {
    screenRoot.classList.remove('screen-enter');
    void screenRoot.offsetWidth; // Force reflow
    screenRoot.classList.add('screen-enter');
  }

  // 6. Apply dark mode after every navigation
  applyDarkMode();

  // 7. Push to history
  if (pushHistory) {
    const url = `/panel/${key}${
      params && Object.keys(params).length
        ? '?' + new URLSearchParams(params).toString()
        : ''
    }`;
    if (key === _currentKey) {
      history.replaceState({ key, params }, '', url);
    } else {
      history.pushState({ key, params }, '', url);
      _historyStack.push({ key, params });
    }
  }

  // 8. Update current screen references
  _currentScreen = screen;
  _currentKey    = key;

  // 9. Show or hide navbar mount based on current screen
  const navbarMount = document.getElementById('navbar-mount');
  if (navbarMount) {
    navbarMount.style.display = NAVBAR_SCREENS.has(key) ? '' : 'none';
    navbarMount.innerHTML = NAVBAR_SCREENS.has(key) ? navbarMount.innerHTML : '';
  }

  // 10. Sync active state on navbar items (if navbar is rendered)
  document.querySelectorAll('.navbar-item').forEach(btn => {
    const route   = btn.dataset.route || '';
    const isActive = route === `/panel/${key}`;
    btn.classList.toggle('active', isActive);
    if (isActive) {
      btn.setAttribute('aria-current', 'page');
    } else {
      btn.removeAttribute('aria-current');
    }
  });

  // 11. Refresh userData on key screens so Moedas balance
  //     and profile changes are always current
  if (_user && REFRESH_SCREENS.has(key)) {
    try {
      const snap = await getDoc(doc(db, 'users', _user.uid));
      if (snap.exists()) _userData = snap.data();
    } catch (e) {
      console.warn('[Router] userData refresh failed:', e);
    }
  }

  // 12. Initialise screen — passes user, userData, params
  if (typeof screen.init === 'function') {
    try {
      await screen.init(_user, _userData, params);
    } catch (err) {
      console.error(`[Router] init() failed on "${key}":`, err);
      showToast('Ocorreu um erro ao carregar o ecrã. Tente novamente.', 'error');
    }
  }

  // 13. Dismiss PWA splash once first screen is ready
  if (typeof window.dismissPWASplash === 'function') {
    window.dismissPWASplash();
  }

  // 14. After dashboard loads — prefetch + SW update check
  if (key === 'dashboard') {
    _prefetchAfterDashboard();
    _checkForUpdate();
  }
}

// ============================================================
// NAVIGATE (public API)
// Called by screens: router.navigate('/panel/dashboard')
// or with params:    router.navigate('/panel/simulacao', { subject: 'matematica' })
// The path can be full (/panel/simulacao) or key-only (simulacao).
// Both forms work — resolveKey handles the lookup.
// ============================================================
async function navigate(path, params = {}) {
  showNavLoading();
  try {
    // Normalise: accept both '/panel/simulacao' and 'simulacao'
    let pathname = path.startsWith('/') ? path : `/panel/${path}`;
    const key = resolveKey(pathname);
    await showScreen(key, params);
  } finally {
    hideNavLoading();
  }
}

// ============================================================
// BACK (public API)
// Pops history or falls back to dashboard.
// ============================================================
function back() {
  if (_historyStack.length > 1) {
    history.back();
  } else {
    navigate('/panel/dashboard');
  }
}

// ============================================================
// BROWSER BACK BUTTON
// ============================================================
window.addEventListener('popstate', async (e) => {
  showNavLoading();
  try {
    const state = e.state;
    if (state && state.key) {
      _historyStack.pop();
      await showScreen(state.key, state.params || {}, false);
    } else {
      const key    = resolveKey(window.location.pathname);
      const params = parseParams(window.location.search);
      await showScreen(key, params, false);
    }
  } finally {
    hideNavLoading();
  }
});

// ============================================================
// PREDICTIVE PREFETCHING
// After dashboard loads, silently prefetch the most-visited
// screens in idle time. Loads JS module only — does NOT
// call mount() or init(). Also injects CSS for zero-delay
// first visits.
// ============================================================
function _prefetchAfterDashboard() {
  // Order: most visited first
  const toPrefetch = ['simulacao', 'progresso', 'mentor', 'perfil'];

  const prefetchOne = async (key) => {
    if (_cache[key] || !SCREENS[key]) return;
    try {
      const module = await SCREENS[key]();
      _cache[key] = module.default;
      injectCSS(_cache[key], key);
    } catch (e) {}
  };

  const run = () => {
    toPrefetch.reduce(
      (chain, key) => chain.then(() => prefetchOne(key)),
      Promise.resolve()
    );
  };

  if ('requestIdleCallback' in window) {
    requestIdleCallback(run, { timeout: 3000 });
  } else {
    setTimeout(run, 2500);
  }
}

// ============================================================
// SERVICE WORKER UPDATE CHECK
// Posts CHECK_UPDATE to SW after dashboard loads.
// SW replies SW_UPDATED when a new version is installed.
// Router shows a tappable toast to reload.
// ============================================================
let _swListenerAdded = false;

function _checkForUpdate() {
  if (!navigator.serviceWorker || !navigator.serviceWorker.controller) return;

  // One permanent listener — never "used up" by an unrelated message
  if (!_swListenerAdded) {
    _swListenerAdded = true;
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'SW_UPDATED') {
        _showUpdateToast();
      }
    });
  }

  navigator.serviceWorker.controller.postMessage({ type: 'CHECK_UPDATE' });
}

function _showUpdateToast() {
  document.getElementById('en-update-toast')?.remove();

  const toast = document.createElement('div');
  toast.id = 'en-update-toast';
  toast.setAttribute('role', 'alert');
  // Centred with auto margins (not transform), so the slide animation
  // cannot knock it off-centre. Fixed hex keeps white text readable
  // in both light and dark mode.
  toast.style.cssText = `
    position: fixed;
    top: 16px;
    left: 16px;
    right: 16px;
    margin: 0 auto;
    width: max-content;
    max-width: calc(100vw - 32px);
    z-index: 10000;
    background: linear-gradient(135deg, #0369A1 0%, #0284C7 100%);
    color: #fff;
    font-family: 'Inter', sans-serif;
    font-size: 14px;
    font-weight: 600;
    padding: 12px 20px;
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    cursor: pointer;
    text-align: center;
    line-height: 1.4;
    animation: screenSlideIn 220ms ease backwards;
  `;
  toast.textContent = 'Nova versão disponível! Toque para actualizar.';
  toast.addEventListener('click', () => location.reload(), { once: true });
  document.body.appendChild(toast);
}

// ============================================================
// AUTH GUARD + BOOT
// onAuthStateChanged fires ONCE on app load.
// Router decides the first screen based on auth state.
// Never called again — state changes handled by navigate().
//
// ONBOARDING GATE:
// A student is considered fully registered when their Firestore
// document has the 'examType' field set ('ensino-geral' or
// 'admissao'). Without it, they are sent to /panel/onboarding
// no matter what URL they tried to visit.
//
// ROLE GUARD:
// Only students and moderators can use the panel.
// Admin role redirects to the standalone admin project.
// ============================================================
async function _boot() {

  // Preserve query params on page refresh
  const currentParams = parseParams(window.location.search);
  if (Object.keys(currentParams).length) {
    history.replaceState(
      { key: resolveKey(window.location.pathname), params: currentParams },
      '',
      window.location.href
    );
  }

  onAuthStateChanged(auth, async (user) => {

    // Not authenticated → show login/register screen
    if (!user) {
      _user     = null;
      _userData = null;
      if (_currentKey !== 'auth') {
        showNavLoading();
        try {
          await showScreen('auth', parseParams(window.location.search), true);
        } finally {
          hideNavLoading();
        }
      }
      return;
    }

    // Authenticated — load Firestore user document
    _user = user;
    try {
      const userSnap = await getDoc(doc(db, 'users', user.uid));
      _userData = userSnap.exists() ? userSnap.data() : null;
    } catch (e) {
      console.error('[Router] Failed to load user document:', e);
      _userData = null;
    }

    showNavLoading();
    try {

      // Guard 1: Profile incomplete → onboarding
      // examType is set at the end of onboarding flow.
      // Without it, nothing in the panel works correctly.
      if (!_userData || !_userData.examType) {
        await showScreen('onboarding', {}, true);
        return;
      }

      // Guard 2: Admin → standalone admin project (outside panel)
      if (_userData.role === 'admin') {
        window.location.href = '/admin';
        return;
      }

      // Guard 3: Moderator trying to access student screens
      // Moderators go to their dedicated screen.
      // They can still visit student screens if needed —
      // this only applies on first load at /panel or /panel/.
      const isRootLoad =
        window.location.pathname === '/panel' ||
        window.location.pathname === '/panel/';

      if (_userData.role === 'moderador' && isRootLoad) {
        await showScreen('moderador', {}, true);
        return;
      }

      // Fully registered student → intended screen or dashboard
      const intendedKey    = resolveKey(window.location.pathname);
      const intendedParams = parseParams(window.location.search);

      // If student refreshed on auth or onboarding → go to dashboard
      const gatedScreens = ['auth', 'onboarding'];
      const targetKey = gatedScreens.includes(intendedKey)
        ? 'dashboard'
        : intendedKey;

      await showScreen(targetKey, intendedParams, true);

    } finally {
      hideNavLoading();
    }
  });
}

// ============================================================
// PUBLIC ROUTER API
// Exported so screens can call router.navigate() and
// router.back() without importing internal state.
// ============================================================
export const router = {
  navigate,
  back,

  // Get the currently authenticated user
  // Screens rarely need this — they receive user via init()
  getUser:     () => _user,
  getUserData: () => _userData,

  // Call after a Firestore write to keep userData current
  // Example: after saving exam dates in perfil.js
  refreshUserData: async () => {
    if (!_user) return null;
    try {
      const snap = await getDoc(doc(db, 'users', _user.uid));
      _userData = snap.exists() ? snap.data() : null;
      return _userData;
    } catch (e) {
      return _userData;
    }
  },
};

// ============================================================
// START THE APP
// injectUIStyles() ensures shared CSS is in document.head
// before the first screen mounts.
// _boot() starts the auth listener and shows the first screen.
// ============================================================
injectUIStyles();
_boot();
