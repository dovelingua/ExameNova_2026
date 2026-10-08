// ============================================================
// EXAMENOVA — COMPLETE TECHNICAL SPECIFICATION v1.0.0
// ============================================================
//
// IMPORTANT FOR AI READING THIS SPEC:
// ============================================================
// - Teacher Dove communicates with AI in ENGLISH
// - The PLATFORM (panel + public site) is entirely in
//   European Portuguese — Mozambique variant
// - All UI text, labels, buttons, messages, errors = Portuguese
// - All code, comments, variable names = English
// - When talking to Teacher Dove = always English
// - When writing UI content = always Portuguese
//
// - Teacher Dove has solid coding knowledge and deep understanding
//   of the Mozambican education system — respect both
// - NEVER rush to write a screen — always discuss the screen's
//   specific features with Teacher Dove before building
// - NEVER generate or create files — write ALL code directly
//   in chat — Teacher Dove copies everything to VS Code manually
// - NEVER write partial code — always write complete, working code
// - NEVER assume — always ask when in doubt
// - ALWAYS request a related approved ProvaNova screen from
//   Teacher Dove before writing any screen — mirror its design
//   patterns, import style, Four-Room structure, and CSS approach
// - ALWAYS think carefully about what each screen may need —
//   flag anything impossible, suggest free alternatives if a
//   better tool exists, propose solutions proactively
// - ALWAYS be responsible for correct import paths — wrong
//   imports cause silent failures that are hard to debug
// - NEVER mention DoveLingua anywhere in the platform UI
// - Credit Teacher Dove as creator only where genuinely necessary
// - WhatsApp for help: 848920143 — only include where relevant
// - If sensitive logic belongs in a Cloudflare Worker, flag it
//   to Teacher Dove BEFORE writing the screen
// - The panel is the PRIORITY — build panel before public site
//
// ============================================================
// 1. PROJECT IDENTITY
// ============================================================
//
// BRAND NAME:        ExameNova
// FULL NAME:         Plataforma ExameNova
// SLOGAN:            (to be defined by Teacher Dove)
// VERSION:           1.0.0
// LANGUAGE:          European Portuguese — Mozambique variant
// TARGET USERS:      Mozambican students preparing for:
//                    - Exames Gerais (9ª and 12ª Classe)
//                    - Exames de Admissão (university/institution entry)
// COUNTRY:           Mozambique 🇲🇿
// CREATOR:           Teacher Dove
//
// WHAT EXAMENOVA IS:
// ExameNova is a Progressive Web App (PWA) and public platform
// that allows Mozambican students to prepare for their national
// exams using real past exam papers, AI-powered simulations,
// personalised study tools, and peer discussion rooms.
//
// The platform is personalized at registration — every student's
// exam type, grade, section, course, or institution determines
// exactly what content, AI, simulations, and chatrooms they
// can access. Nothing outside their profile is ever shown.
//
// WHAT EXAMENOVA IS NOT:
// - Not a school management system
// - Not a platform for teachers (ProvaNova serves teachers)
// - Not a generic chatbot — it is a structured study platform
// - Not a source of official exam papers before exam day
// - Not affiliated with any fraud or exam-theft scheme
//
// IMPORTANT LANGUAGE NOTES FOR AI:
// - UI tone: warm, encouraging, focused, never robotic
// - Never use informal pronouns in UI: Tu, És, Teu, Teu, Tens
// - Use second-person formal: Você (when needed), or imperative
// - Example: "Seleccione a disciplina" not "Selecciona a disciplina"
// - "Moedas" = the platform's coin currency (not Créditos)
// - "Simulação" = exam simulation feature
// - "Mentor" = AI tutor feature
// - "Bate-papo" = group chatroom
// - "Meu Exame" = premium pre-exam simulation feature
//
// ============================================================
// 2. TECHNICAL ARCHITECTURE
// ============================================================
//
// ARCHITECTURE TYPE:
// - SPA (Single Page Application) — panel only
// - PWA (Progressive Web App) — panel only
// - Pure vanilla HTML5, CSS3, JavaScript (ES6+ modules)
// - NO frameworks — no React, Vue, Angular, or any other
// - NO npm packages — vanilla JS only
// - ONE panel/index.html — all screens rendered dynamically
// - Screens are JavaScript objects with four methods (Section 6)
// - Public site = separate static HTML pages (not SPA)
//
// WHY SPA + PWA:
// - The panel must feel like a NATIVE mobile app, not a website
// - Students install it on their phones via Add to Home Screen
// - Navigation must be instant with no page reloads
// - URL bar disappears when installed (standalone PWA behaviour)
// - Transitions between screens feel like a real native app
// - NO APK will be built — PWA only
//
// HOSTING & DEPLOYMENT:
// - Code repository: GitHub
// - Deployment: Vercel (connected to GitHub — auto-deploy on push)
// - Workers: Cloudflare Workers (ALL sensitive backend logic)
// - Media/storage: Cloudinary (PDFs, chat images)
// - Email: Resend (via Cloudflare Worker — never called directly)
//
// VERCEL CONFIGURATION (vercel.json — lives in project root):
// Panel routes always serve panel/index.html.
// Public routes always serve root index.html.
// cleanUrls removes .html from public page URLs.
// No conflicts between panel and public site.
//
// INTERNET REQUIREMENT:
// - ExameNova requires an active internet connection to function
// - PWA is used for installability and native feel, NOT offline use
// - When offline: show a friendly offline screen
// - Student progress and chat are NOT accessible offline
//
// ============================================================
// 2.1 SHARED UI FILE — CRITICAL NAMING NOTE
// ============================================================
//
// The shared UI file is named ui.js — intentional.
// ALWAYS import from ui.js:
//   import { ui } from '../../core/ui.js';
//
// STYLE INJECTION ARCHITECTURE:
// - NO external CSS files are imported by any screen
// - NO screen imports CSS from outside itself
// - ui.js injects ALL shared styles once via injectUIStyles()
//   called automatically at module level when ui.js loads
// - Each screen's css() method injects ONLY its own styles
//   into document.head via the router
// - No screen ever imports a CSS file or calls external
//   style injection — ui.js and router handle everything
// - There is NO styles/ folder for the panel
//   Each screen owns its own styles entirely in css()
//
// ============================================================
// 3. FOLDER STRUCTURE
// ============================================================
//
// examenova/
// │
// ├── index.html                 ← Public website homepage
// │                                Contains: hero, features overview,
// │                                call to action to register,
// │                                SEO meta tags, Open Graph
// │
// ├── manifest.json              ← PWA manifest
// │                                Points to /panel as start_url
// │                                display: standalone
// │                                Hides browser UI when installed
// │
// ├── service-worker.js          ← PWA service worker
// │                                Handles installation
// │                                SPA navigate rule for panel
// │                                No offline caching
// │                                SW_UPDATED message on new version
// │
// ├── vercel.json                ← Deployment rewrite rules
// ├── robots.txt                 ← SEO crawler rules
// ├── sitemap.xml                ← SEO sitemap
// │
// ├── public/                    ← All public website HTML pages
// │   ├── como-funciona.html     ← How the platform works
// │   ├── exames.html            ← Public past exam library
// │   ├── cursos.html            ← Supported courses and institutions
// │   ├── sobre.html             ← About ExameNova
// │   ├── termos.html            ← Terms and privacy policy
// │   └── contacto.html         ← Contact page
// │
// ├── assets/                    ← Shared across public + panel
// │   ├── images/
// │   │   ├── logo.png           ← Main logo (light mode)
// │   │   ├── logo-dark.png      ← Logo for dark mode
// │   │   ├── favicon.png        ← Browser favicon
// │   │   └── og-image.png       ← Open Graph social share image
// │   ├── icons/                 ← PWA icons (all required sizes)
// │   │   ├── icon-72x72.png
// │   │   ├── icon-96x96.png
// │   │   ├── icon-128x128.png
// │   │   ├── icon-144x144.png
// │   │   ├── icon-152x152.png
// │   │   ├── icon-192x192.png
// │   │   ├── icon-384x384.png
// │   │   └── icon-512x512.png
// │   └── fonts/                 ← Local fonts if needed
// │
// └── panel/                     ← Entire SPA PWA lives here
//     │
//     ├── index.html             ← THE ONLY PANEL HTML FILE
//     │                            App shell, meta tags, SEO,
//     │                            favicon, JS module entry point,
//     │                            PWA manifest link,
//     │                            anti-translation meta tags,
//     │                            dark mode applied before paint,
//     │                            #screen-root (router renders here),
//     │                            #nav-loading overlay,
//     │                            nav-loading CSS in shell style
//     │
//     └── js/
//         │
//         ├── core/
//         │   ├── firebase.js    ← Firebase init (SHARED)
//         │   │                    Exports: app, auth, db
//         │   │                    Imported by ALL screens needing Firebase
//         │   │                    Never initialise Firebase anywhere else
//         │   │
//         │   ├── router.js      ← SPA navigation engine
//         │   │                    Brain of the panel
//         │   │                    Full details in Section 5
//         │   │
//         │   ├── ui.js          ← ALL shared UI behaviour (SHARED)
//         │   │                    Full details in Section 7
//         │   │
//         │   ├── app.js         ← Static data + exam logic tree
//         │   │                    Full details in Section 8
//         │   │
//         │   ├── moeda.js       ← Coin economy layer
//         │   │                    Full details in Section 9
//         │   │
//         │   ├── worker.js      ← Cloudflare Worker communication
//         │   │                    Full details in Section 10
//         │   │
//         │   ├── email.js       ← Resend email logic
//         │   │                    Full details in Section 11
//         │   │
//         │   └── exams.js       ← Exam database query layer
//         │                        Full details in Section 12
//         │
//         └── screens/
//             │
//             ├── auth/
//             │   ├── auth.js        ← Login + Register screen
//             │   └── onboarding.js  ← First-time profile setup
//             │
//             ├── dashboard/
//             │   └── dashboard.js   ← Main home screen
//             │
//             ├── simulacao/
//             │   └── simulacao.js   ← Exam simulation setup
//             │
//             ├── revisao/
//             │   └── revisao.js     ← Error review screen
//             │
//             ├── desafio/
//             │   └── desafio.js     ← Daily challenge screen
//             │
//             ├── meu-exame/
//             │   └── meu-exame.js   ← Premium exam mode
//             │
//             ├── mentor/
//             │   └── mentor.js      ← AI tutor chat
//             │
//             ├── progresso/
//             │   └── progresso.js   ← Progress + Trends
//             │
//             ├── bate-papo/
//             │   └── bate-papo.js   ← Group chatroom
//             │
//             ├── perfil/
//             │   └── perfil.js      ← Student profile + settings
//             │
//             ├── moderador/
//             │   └── moderador.js   ← Moderator controls
//             │
//             └── renders/           ← Question/content render screens
//                                      Created as needed during build
//                                      AI must flag when a new render
//                                      screen is required and discuss
//                                      before writing it
//
// IMPORTANT STRUCTURE NOTES:
// - Admin panel is a STANDALONE project — completely separate
//   It is not part of this folder structure at all
// - There is NO components/ folder anywhere
//   All shared UI lives in panel/js/core/ui.js
// - The renders/ folder holds screens that display and render
//   questions for student interaction — one render screen per
//   feature type as needed (not pre-planned — created during build)
// - All JavaScript lives inside panel/js/ — nowhere else
// - assets/ is shared by both public and panel
//
// ============================================================
// 4. IMPORT PATHS (CANONICAL — ALWAYS USE THESE EXACTLY)
// ============================================================
//
// Every screen lives exactly two folder levels deep
// inside panel/js/screens/ — this never changes.
// Therefore the path to core/ is ALWAYS ../../core/
//
// From ANY screen in panel/js/screens/[name]/[name].js:
//
//   import { auth, db }    from '../../core/firebase.js';
//   import { router }      from '../../core/router.js';
//   import { ui }          from '../../core/ui.js';
//   import { app }         from '../../core/app.js';
//   import { moeda }       from '../../core/moeda.js';
//   import { worker }      from '../../core/worker.js';
//   import { email }       from '../../core/email.js';
//   import { exams }       from '../../core/exams.js';
//
// From ANY screen in panel/js/screens/renders/[name].js:
//
//   import { auth, db }    from '../../../core/firebase.js';
//   import { router }      from '../../../core/router.js';
//   import { ui }          from '../../../core/ui.js';
//   import { app }         from '../../../core/app.js';
//   import { moeda }       from '../../../core/moeda.js';
//   import { worker }      from '../../../core/worker.js';
//   import { exams }       from '../../../core/exams.js';
//
// RENDER SCREENS ARE THREE LEVELS DEEP — paths use ../../../
// This is the only exception to the two-level rule.
//
// IMPORT RULES — CRITICAL:
// - Always use relative paths — never absolute paths
// - Never import from a components/ folder — it does not exist
// - Only import what the screen actually uses
// - Wrong import paths cause silent module failures
// - AI is responsible for verifying every import path is correct
//   before writing any screen — check the folder depth first
// - Firebase sub-imports use the CDN path:
//   import { ... } from
//   'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'
//
// ============================================================
// 5. THE ROUTER (panel/js/core/router.js)
// ============================================================
//
// The router is the brain of the panel SPA. It handles auth,
// navigation, screen lifecycle, dark mode, loading feedback,
// prefetching, and update checks.
//
// 5.1 SCREEN REGISTRY
// Every panel screen is registered with a lazy import:
// {
//   'auth':         () => import('../screens/auth/auth.js'),
//   'onboarding':   () => import('../screens/auth/onboarding.js'),
//   'dashboard':    () => import('../screens/dashboard/dashboard.js'),
//   'simulacao':    () => import('../screens/simulacao/simulacao.js'),
//   'revisao':      () => import('../screens/revisao/revisao.js'),
//   'desafio':      () => import('../screens/desafio/desafio.js'),
//   'meu-exame':    () => import('../screens/meu-exame/meu-exame.js'),
//   'mentor':       () => import('../screens/mentor/mentor.js'),
//   'progresso':    () => import('../screens/progresso/progresso.js'),
//   'bate-papo':    () => import('../screens/bate-papo/bate-papo.js'),
//   'perfil':       () => import('../screens/perfil/perfil.js'),
//   'moderador':    () => import('../screens/moderador/moderador.js'),
//   // Render screens added here as they are created during build
// }
//
// 5.2 URL MAP
// '/panel'              → 'auth' (if not logged in)
// '/panel'              → 'dashboard' (if logged in)
// '/panel/auth'         → 'auth'
// '/panel/onboarding'   → 'onboarding'
// '/panel/dashboard'    → 'dashboard'
// '/panel/simulacao'    → 'simulacao'
// '/panel/revisao'      → 'revisao'
// '/panel/desafio'      → 'desafio'
// '/panel/meu-exame'    → 'meu-exame'
// '/panel/mentor'       → 'mentor'
// '/panel/progresso'    → 'progresso'
// '/panel/bate-papo'    → 'bate-papo'
// '/panel/perfil'       → 'perfil'
// '/panel/moderador'    → 'moderador'
//
// 5.3 AUTH GUARD
// The router listens to onAuthStateChanged (it fires on boot AND on
// every sign-in / sign-out). Screens NEVER call onAuthStateChanged.
// Not authenticated → 'auth'
// Authenticated + no examType in Firestore → 'onboarding'
//   (examType is the onboarding gate — set when onboarding completes)
// Role 'admin' → redirected to /admin (standalone project)
// Role 'moderador' on a bare /panel load → 'moderador'
// Guards inside showScreen(): when not signed in only 'auth' is
//   reachable; 'moderador' is reachable only with role 'moderador'.
// Auth + userData live in router memory; screens receive them via
//   init(user, userData, params). router.refreshUserData() re-reads
//   the user document after a Firestore write.
// userData is refreshed before init() on: onboarding, dashboard,
//   perfil, simulacao, meu-exame, mentor, desafio (REFRESH_SCREENS).
// Routes: router.navigate() accepts BOTH '/panel/perfil' and 'perfil'.
// Unknown route → 'dashboard' when signed in, 'auth' otherwise.
// If a screen fails to load or init() throws, the router shows an
//   error toast and keeps running — never a blank frozen screen.
//
//
// 5.4 LAZY LOADING
// Screens load only on first visit — cached in memory after that.
// First visit may have brief delay on slow connections.
// Subsequent visits: instant from memory cache.
//
// 5.5 LOADING FEEDBACK
// nav-loading overlay appears after 300ms on slow loads.
// Shows small spinner with "A carregar..." text.
// Disappears when screen is ready.
// Cached screens show no spinner — instant.
// HTML lives in panel/index.html shell.
// CSS lives in panel/index.html shell style tag.
//
// 5.6 SCREEN TRANSITIONS
// Forward: new screen slides in from right (translateX 16px → 0)
// 220ms ease — no white flash between screens
// Back: current screen slides out to right
// All CSS animations — no JS animation frames
// Handled entirely by router — screens do nothing
//
// 5.7 DARK MODE IN ROUTER
// Router calls ui.applyDarkMode() after every showScreen().
// Screens NEVER call applyDarkMode() themselves.
// Router handles it — always, every navigation.
//
// 5.8 SCREEN CSS INJECTION
// Each screen returns CSS string from its css() method.
// Router injects this into document.head as style tag.
// Router checks if style id already exists before injecting:
//   if (!document.getElementById(styleId)) { inject }
// Prevents duplicate style tags on screen revisit.
// CSS must be in document.head — NOT inside any container div.
// [data-theme="dark"] selectors only work from document root.
//
// 5.9 BACK BUTTON
// Router maintains a history stack.
// Browser back button pops the stack.
// history.pushState keeps URL in sync.
//
// 5.10 KEEPALIVE
// Screens with keepAlive: true are never destroyed by router.
// Dashboard is the ONLY keepAlive screen.
// Router checks: if (!_currentScreen.keepAlive) _currentScreen.destroy()
//
// 5.11 PREDICTIVE PREFETCHING
// After dashboard loads, router prefetches most-visited screens:
// simulacao → progresso → mentor → perfil
// Uses requestIdleCallback — does not compete with main thread.
// Fallback: setTimeout 2500ms if requestIdleCallback unavailable.
// Prefetch loads JS module only — mount() and init() not called.
//
// 5.12 QUERY PARAMS
// Params from URL extracted and passed to screen init().
// /panel/simulacao?subject=matematica → params: { subject: 'matematica' }
// /panel/mentor?subject=historia → screen gets that subject preloaded
//
// 5.13 SERVICE WORKER UPDATE CHECK
// After dashboard loads, router posts { type: 'CHECK_UPDATE' } to SW.
// If SW installs new version, SW posts { type: 'SW_UPDATED' } back.
// Router shows tappable toast: "Nova versão disponível! Toque para actualizar."
// Tapping calls location.reload().
//
// ============================================================
// 6. SCREEN MODULE STRUCTURE (THE FOUR-ROOM PATTERN)
// ============================================================
//
// Every screen is ONE JavaScript object with FOUR methods.
// This is the Four-Room Pattern — no screen ever deviates.
//
// ROOM 1 — css()
// All styles for this screen live here and ONLY here.
// Router injects the returned string into document.head.
// [data-theme="dark"] selectors work because CSS is at root level.
// Checks for existing style id before injecting — no duplicates.
//
// ROOM 2 — mount()
// Draws the screen — returns HTML as a string.
// Pure structure only — no styles, no behaviour, nothing else.
// Never put style tags inside mount().
//
// ROOM 3 — init(user, userData, params)
// Makes everything work.
// Fires after mount() has rendered into the DOM.
// Receives authenticated user and Firestore data from router.
// Never calls onAuthStateChanged — router already did it.
// Uses event listener hygiene (see below).
// Calls ui.renderNavbar() and ui.renderHeader() here.
// Never calls applyDarkMode() — router handles it.
//
// ROOM 4 — destroy()
// Tidies up when student leaves the screen.
// Stops timers, intervals, Firebase listeners, fetch calls.
// Nothing leaks into the next screen.
// Only implement if the screen has ongoing processes.
// Not called on keepAlive screens (dashboard only).
//
// COMPLETE SCREEN TEMPLATE:
//
// const [Name]Screen = {
//
//   // Add ONLY on dashboard.js:
//   // keepAlive: true,
//
//   css() {
//     if (document.getElementById('[name]-styles')) return '';
//     return `<style id="[name]-styles">
//       /* All CSS for this screen */
//       /* Include: resets if needed */
//       /* Include: all component CSS for this screen */
//       /* Include: @keyframes animations */
//       /* Include: [data-theme="dark"] overrides */
//       /* Do NOT include: :root variables — core.css has them */
//       /* Do NOT include: shared component styles in ui.js */
//     </style>`;
//   },
//
//   mount() {
//     return `
//       <!-- All HTML for this screen as a string -->
//       <!-- No script tags -->
//       <!-- No inline styles belonging in css() -->
//     `;
//   },
//
//   async init(user, userData, params) {
//     // 1. Call ui.renderNavbar() and ui.renderHeader() first
//     // 2. Wire all event listeners with hygiene (see below)
//     // 3. Load Firestore data where needed
//     // 4. Handle params passed from router
//   },
//
//   destroy() {
//     // Clear intervals and timeouts
//     // Unsubscribe Firebase onSnapshot listeners
//     // Cancel ongoing fetch calls if needed
//   }
//
// };
//
// export default [Name]Screen;
//
// EVENT LISTENER HYGIENE — CRITICAL:
// init() is called every time a screen is revisited.
// Without hygiene, listeners pile up and fire multiple times.
// Always use one of these three patterns:
//
// Pattern A (use once):
//   el.addEventListener('click', handler, { once: true });
//
// Pattern B (replace element):
//   const fresh = el.cloneNode(true);
//   el.replaceWith(fresh);
//   fresh.addEventListener('click', handler);
//
// Pattern C (guard flag):
//   if (el._wired) return;
//   el._wired = true;
//   el.addEventListener('click', handler);
//
// CSS INJECTION RULE — CRITICAL:
// css() is the ONLY correct place for screen CSS.
// Never put style tags inside mount().
// Never inject CSS into a container div.
// If CSS is inside a div, dark mode breaks silently.
//
// ============================================================
// 7. SHARED UI (panel/js/core/ui.js)
// ============================================================
//
// ui.js handles ALL shared UI behaviour across the entire panel.
// Import it on every screen that needs any UI component.
//
// DARK MODE:
// - Managed entirely in ui.js
// - Implemented via [data-theme="dark"] on html element
// - Student preference saved in localStorage key 'en_theme'
// - applyDarkMode() reads localStorage and applies theme
// - Called by router after every screen load
// - Toggle present on every screen via renderHeader()
// - Activating on any screen applies globally to entire panel
// - On panel load: inline script in panel/index.html applies
//   theme BEFORE any content renders — prevents flash
//
// EXPORTS:
//
// applyDarkMode()
//   Reads localStorage and sets [data-theme] on html element.
//   Called by router only — screens never call this directly.
//
// toggleDarkMode()
//   Flips theme and saves to localStorage key 'en_theme'.
//   Called by toggle button in header.
//
// renderNavbar — lives in panel/js/core/navbar.js (not ui.js)
//   Only dashboard.js imports and calls it.
//
// renderHeader(config)
//   Renders screen header (Sky Blue gradient #0369A1 → #0284C7).
//   config: { title, backRoute, showWordmark, showDarkToggle,
//             actionButton: { id, icon, label }, moedasBalance }
//   backRoute: a route, or 'back' for history.back()
//   showWordmark: shows "ExameNova" instead of the title (dashboard)
//   moedasBalance: number → shows the gold Moedas pill; tapping it
//     opens the Moedas sheet. null → no pill.
//   Injects into #header-mount in screen HTML.
//
// checkOnline()
//   Returns true when online; otherwise renders the offline screen
//   into #screen-root and returns false.
//
// Navbar: scroll-hide listener is replaced on each renderNavbar()
//   call (never piles up across screens).
//
// showToast(message, type)
//   Appears at TOP of screen. Auto-dismisses after 3 seconds.
//   type: 'success' | 'error' | 'info' | 'warning'
//   success = green, error = red, info = sky blue, warning = orange
//   (every toast always carries an icon, never colour alone)
//
// showSkeleton(containerId, type)
//   Animated skeleton placeholder while content loads.
//   NEVER show blank white screen while loading.
//
// hideSkeleton(containerId)
//   Removes skeleton and shows real content.
//
// openBottomSheet(config)
//   Slides up from bottom with dark overlay.
//   config: { title, content, actions }
//   Dismissible by tapping overlay or swiping down.
//   Used for: moedas prompt, confirmations, filters,
//   share options, context menus.
//   Student NEVER navigates away from current screen for these.
//
// closeBottomSheet()
//   Closes the currently open bottom sheet.
//
// showSpinner()
//   Full-screen loading spinner.
//   Used during AI generation only.
//
// hideSpinner()
//   Hides the loading spinner.
//
// lockScroll() / unlockScroll()
//   Prevents/restores background scroll when sheet is open.
//
// ============================================================
// 8. STATIC DATA + EXAM LOGIC TREE (panel/js/core/app.js)
// ============================================================
//
// app.js holds all static data that never changes and never
// requires a Firestore read. Screens import from app.js to
// get provinces, districts, exam types, subjects, courses,
// and institutions — saving enormous numbers of Firestore reads.
//
// MOZAMBICAN PROVINCES AND DISTRICTS:
// All 11 provinces and their districts — same as ProvaNova.
// Used during student registration for location data.
//
// EXAM TYPE LOGIC TREE:
// This is the most important section of app.js.
// It defines exactly what subjects belong to each student type.
// Screens NEVER hardcode exam types or subjects — always import
// helper functions from app.js.
//
// ENSINO GERAL — 9ª CLASSE:
// Normal student → takes ALL subjects (both sections)
// Repeating student → chooses one section only:
//   Secção de Letras: Português, História, Geografia,
//                     Francês/Inglês, Educação Visual
//   Secção de Ciências: Matemática, Física, Química,
//                       Biologia, Educação Visual
// (AI must confirm exact subject list with Teacher Dove
//  before building any screen that uses these)
//
// ENSINO GERAL — 12ª CLASSE:
// Normal student → takes all subjects with exams
// Repeating student → selects only the subjects they failed
// (subject list confirmed by Teacher Dove per screen)
//
// EXAMES DE ADMISSÃO — BY COURSE:
// Each course has exactly two exam subjects.
// Examples (confirm full list with Teacher Dove):
//   Direito:      Português + História
//   Geografia:    Geografia + História
//   Gestão:       Matemática + Português
//   Inglês:       Inglês + Português
// More courses added by Teacher Dove over time.
//
// EXAMES DE ADMISSÃO — BY INSTITUTION:
// Institutions treated separately from courses.
// Have their own subject requirements.
// Examples:
//   ACIPOL:           (Teacher Dove confirms subjects)
//   IFP:              (Teacher Dove confirms subjects)
//   Academia Militar: (Teacher Dove confirms subjects)
//
// EXPORTED HELPER FUNCTIONS:
// app.getSubjectsBySection(section)
//   → returns array of subject names for 'letras' or 'ciencias'
// app.getSubjectsByCourse(course)
//   → returns array of 2 subject names for admissão course
// app.getSubjectsByInstitution(institution)
//   → returns array of subject names for an institution
// app.getAllCourses()
//   → returns array of all supported admissão courses
// app.getAllInstitutions()
//   → returns array of all supported institutions
// app.getProvinces()
//   → returns array of all Mozambican province names
// app.getDistrictsByProvince(province)
//   → returns array of districts for a province
//
// All subject logic is in app.js — never hardcoded in screens.
// Never fetch this data from Firestore — it is static.
//
// ============================================================
// 9. COIN ECONOMY (panel/js/core/moeda.js)
// ============================================================
//
// moeda.js manages the entire Moedas economy.
// All coin pricing, award amounts, balance checks,
// and deduction calls live here — never in screens.
//
// THE MOEDAS SYSTEM:
// Moedas are the platform currency students earn and spend.
// Earned by: completing registration, completing daily challenges,
// inviting friends, admin awards, future: completing milestones.
// Spent by: accessing premium features.
// Cannot go negative — always check before deducting.
//
// MOEDA COSTS (moeda.COSTS):
//   SIMULACAO_ANTERIORES: 6    SIMULACAO_GERADAS: 3
//   MEU_EXAME: 20              MENTOR_SESSION: 5
//   CUSTOM_AI_PROMPT: 3  (added when the student writes custom AI instructions)
//
// MOEDA AWARDS (moeda.AWARDS):
//   REGISTRATION: 30   DAILY_CHALLENGE: 10   INVITE: 50   INVITED: 30
//   REGISTRATION is awarded ONCE per student — see Section 17.
//
// EXPORTED (moeda object):
// moeda.COSTS, moeda.AWARDS
// moeda.getBalance(userData)            → number
// moeda.checkMoedas(userData, amount)   → boolean
// moeda.gate(userData, cost)            → boolean. CHECK ONLY: true = can
//   proceed; false = Moedas sheet already shown. It never deducts.
// moeda.showMoedasSheet(balance, requiredAmount?)
//   → bottom sheet: balance, shortage (if any), how to earn more.
// moeda.deductMoedas(userId, amount)    → { success, newBalance }
//   → call it AFTER the feature succeeds, never before.
// moeda.awardMoedas(userId, amount, reason) → { success, newBalance }
//
// SENSITIVE LOGIC RULE:
// All actual Moedas reads and writes go via Cloudflare Worker.
// moeda.js calls worker.js — never calls Firestore directly
// for balance changes.
// Reading current balance from userData passed by router is fine
// since that data was already fetched securely at auth time.
//
// ============================================================
// 10. WORKER COMMUNICATION (panel/js/core/worker.js)
// ============================================================
//
// worker.js is the ONLY file that communicates with
// Cloudflare Workers. Screens never call Worker URLs directly.
// If a screen needs a sensitive operation, it imports from
// worker.js — which handles the request, secret headers,
// error handling, and response parsing.
//
// ALL SENSITIVE LOGIC GOES TO WORKERS — NEVER IN THE BROWSER:
// - Groq AI API calls (API key never exposed)
// - Moedas deduction and award (balance integrity)
// - Invite code validation (prevent manipulation)
// - Email sending via Resend (API key never exposed)
// - Any future payment processing
// - Any operation that must not be tampered with client-side
//
// WORKER URLS:
// Defined as constants in worker.js — never in screens.
// Teacher Dove provides Worker URLs — AI never assumes them.
//
// EXPORTED FUNCTIONS (examples — Teacher Dove confirms full list):
// worker.callAI(prompt, options)
//   → calls Groq AI Worker, returns generated content
// worker.deductMoedas(userId, amount)
//   → calls Moedas Worker, returns { success, newBalance }
// worker.awardMoedas(userId, amount, reason)
//   → calls Moedas Worker, returns { success, newBalance }
// worker.validateInvite(code)
//   → calls Auth Worker, returns { valid, inviterId }
// worker.saveProgress(userId, progressData)
//   → calls data Worker, returns { success }
//
// SECRET HEADERS:
// All Worker requests include the secret header.
// Secret value lives only in worker.js as a constant.
// Teacher Dove provides the secret value — AI never hardcodes it.
// Screens never see or handle secret values.
//
// ============================================================
// 11. EMAIL LOGIC (panel/js/core/email.js)
// ============================================================
//
// email.js is the ONLY file that triggers email sending.
// All Resend communication goes via a Cloudflare Worker.
// email.js calls worker.js — never calls Resend directly.
//
// DESIGN:
// email.js holds helpers only. NO template IDs and NO pre-registered
// emails: each screen AI adds its own email function when building
// that screen (pattern shown inside email.js).
//
// HELPERS (on the email object):
// _send(toEmail, subject, bodyHtml, preheader?)  → wraps + sends via
//   worker.sendEmail(); never throws — returns { success:false } on error
// _emailHeading / _emailPara / _emailMuted / _emailButton / _wrapEmail
// _esc(value) → HTML-escape. MANDATORY on every user-supplied value.
// Buttons accept https:// links only.
// Emails use fixed hex colours (Header #0284C7, Button #0369A1) —
// email clients do not support CSS variables or gradients.
//
// PLANNED (not yet built / wired):
// welcome email after onboarding, exam reminder (2–4 days before
// Meu Exame), optional daily-challenge reminder (opt-in only).
// All of them go through worker.sendEmail — never fetch or Resend.
//
// ============================================================
// 12. EXAM DATABASE QUERY LAYER (panel/js/core/exams.js)
// ============================================================
//
// exams.js is the ONLY file that queries exam Firestore
// collections. Screens NEVER query exam data directly.
// This keeps queries consistent, efficient, and easy to update.
//
// FIRESTORE READS DISCIPLINE — CRITICAL:
// ExameNova will potentially serve thousands of students.
// Every unnecessary Firestore read costs money and risks limits.
// Rules:
// - Always apply subject filter first — never load all questions
// - Always apply grade filter — never load all grades
// - Use Firestore query limits — never load unbounded results
// - Cache results in memory where reasonable within a session
//
// EXPORTED FUNCTIONS (Teacher Dove confirms exact collection
// structure before any screen using these is built):
// exams.getQuestionsBySubjectAndGrade(subject, grade, filters)
//   → returns array of question objects
// exams.getQuestionsByTopic(subject, grade, topic)
//   → returns array of questions for a specific topic
// exams.getTopicsBySubject(subject, grade)
//   → returns array of unique topic names
// exams.getYearsBySubject(subject, grade)
//   → returns array of available exam years
// exams.getWrongAnswers(userId)
//   → returns student's saved wrong answers from Firestore
// exams.saveWrongAnswer(userId, questionData)
//   → saves a wrong answer to student's record
// exams.getTendencias(subject, grade)
//   → returns topic frequency analysis from database
// exams.getPastExamPdf(subject, grade, year)
//   → returns Cloudinary URL of past exam PDF
//
// ============================================================
// 13. DESIGN SYSTEM
// ============================================================
//
// DESIGN PHILOSOPHY:
// ExameNova must feel like a premium native mobile app.
// Clean, professional, focused, and encouraging.
// Never childish, never loud, never like a website.
// White and light backgrounds dominate — colour is purposeful.
// When in doubt: less colour = more professional and trustworthy.
//
// SIBLING RELATIONSHIP WITH PROVANOVA:
// ExameNova and ProvaNova are sibling products (a teacher uses
// ProvaNova, their student uses ExameNova) but they MUST NOT feel
// like the same app. ExameNova has its own palette — "Maré" —
// fully different from ProvaNova's electric blue. Only the layout
// quality, the Four-Room pattern and the curved hero line are shared.
//
// RESPONSIVENESS — MANDATORY ON ALL SCREENS:
// Every screen must work perfectly on ALL screen sizes.
// Most students will use ExameNova on mobile phones.
// Mobile-first — default styles target mobile (320px+):
//   Small phones:  320px – 375px (common Mozambican phones)
//   Medium phones: 376px – 428px (standard smartphones)
//   Large phones:  429px – 767px (large smartphones)
//   Tablets:       768px – 1024px
//   Desktop:       1025px+
//
// RESPONSIVENESS RULES FOR AI:
// - Always write mobile-first CSS (small screen default)
// - Mentally test every layout at 320px minimum width
// - No horizontal scrolling — ever
// - Touch targets minimum 48x48px on mobile
// - Font sizes scale up on larger screens
// - Grid: 1 column mobile → 2 columns tablet → 3+ desktop
// - Bottom navbar visible on mobile and tablet
// - Max content width on desktop: 1200px centered
// - Screen-specific media queries live in that screen's css()
//
// COLOUR PALETTE — "MARÉ" (final, approved by Teacher Dove):
//
// Primary:     Sky Blue        #0284C7  (dark mode #38BDF8)
//              Main CTAs, primary buttons, active states, links
//              Header and hero gradient: #0369A1 → #0284C7
//
// Secondary:   Violet          #8B5CF6  (dark mode #A78BFA)
//              Revisão, Mentor/AI elements, premium markers,
//              secondary highlights
//
// Accent:      Teal            #14B8A6  (dark mode #2DD4BF)
//              Bate-papo, countdown, pending daily challenge,
//              small icons and badges
//
// Gold:        #FFB300
//              RESERVED exclusively for Moedas (coin balance,
//              coin indicators, premium locked features)
//
// Success:     Green           #22C55E  (always with a check icon)
// Error:       Red             #EF4444  (dark mode #F87171)
//              Wrong answers, errors, destructive actions ONLY
// Warning:     Orange          #F59E0B  (always with icon + label)
//              Never placed beside gold without an icon/label
//
// Background:  Clean White     #FAFAFA  (solid — never blurred)
// Surface:     Pure White      #FFFFFF  (cards, sheets, inputs)
// Text:        Dark Charcoal   #212121
// Subtext:     Medium Grey     #757575
//
// COLOUR USAGE RULE: calm canvas, colour in small places.
// Pages are mostly white; colour appears on buttons, icons,
// active states, thin bars and one gradient banner per screen.
//
//
// COLOUR FLEXIBILITY FOR AI:
// - These are the foundation colours — use them as the base
// - AI may use tints, shades, and opacity variations freely
// - AI may use additional colours where genuinely necessary:
//   error red, warning orange, success green
// - AI may use soft accent borders, backgrounds for section
//   grouping, hover states — keeping it clean and subtle
// - Pages must never feel loud, busy, or colourful for its
//   own sake — restraint is always the right choice
// - Hero sections follow ProvaNova's curved line style
//
// DARK MODE:
// Implemented via [data-theme="dark"] on html element.
// In panel/js/core/ui.js:
// [data-theme="dark"] {
//   --bg:      #121212;
//   --surface: #1E1E1E;
//   --text:    #FAFAFA;
//   --subtext: #AAAAAA;
//   --primary:   #38BDF8;
//   --secondary: #A78BFA;
//   --accent:    #2DD4BF;
//   --danger:    #F87171;
//   --success:   #4ADE80;
//   --warning:   #FBBF24;
//   (buttons and the header use fixed hex gradients so white
//    text stays readable in both themes)
// }
// Screen-specific dark overrides in that screen's css().
// Applied by router after every navigation.
// Toggle on every screen via renderHeader().
// Preference saved in localStorage key 'en_theme'.
//
// TYPOGRAPHY:
// Main Font:   Inter (Google Fonts) — loaded in panel/index.html
//              Minimum body size: 16px
//              Minimum label size: 14px
//
// ICONS:
// Font Awesome — loaded via CDN in panel/index.html
// Used consistently throughout — never mix icon libraries
//
// ============================================================
// 14. NATIVE APP EXPERIENCE (MANDATORY)
// ============================================================
//
// Every screen MUST feel like a native mobile app.
// These rules are required on every screen — not optional.
//
// NAVIGATION:
// Bottom navigation bar — like WhatsApp, like ProvaNova
// Items: Início | Simulação | Progresso | Mentor | Perfil
// (Exact items and icons confirmed with Teacher Dove per screen)
// Present on: all main screens
// Absent on: auth, onboarding, moderador
// Active state clearly visible on current screen item
// Back navigation: back arrow top left via renderHeader()
//
// TRANSITIONS:
// Screens slide in/out horizontally — native app feel
// No white flash between screens
// Smooth 220ms transitions
// Router handles entirely — screens do nothing
//
// LOADING STATES — MANDATORY:
// Skeleton loaders on EVERY screen that loads data
// Skeleton matches the exact shape of the content it replaces
// Never show blank white screen while loading
// Loading spinners on buttons during async actions
// Full spinner (ui.showSpinner) only during AI generation
//
// BOTTOM SHEETS:
// Used for: Moedas prompt, confirmations, filters,
// share options, context menus, feature options
// Slides up from bottom with dark overlay
// Student never navigates away from current screen for these
// Dismissible by tapping overlay
// Managed by ui.openBottomSheet / ui.closeBottomSheet
//
// TOAST NOTIFICATIONS:
// Appear at TOP of screen
// Auto-dismiss after 3 seconds
// success (green) | error (red) | info (sky blue) | warning (orange)
// Managed by ui.showToast(message, type)
//
// FLEXIBLE LAYOUT APPROACH:
// AI should use the layout that best serves the screen's purpose.
// Tabs where content has multiple distinct categories.
// Cards for grouped information.
// Bottom sheets for actions without leaving the screen.
// Modals for confirmations and focused interactions.
// The spec does not prescribe exact layouts per screen —
// AI proposes the layout, discusses with Teacher Dove,
// then builds after approval.
//
// PWA INSTALLATION:
// manifest.json configured for standalone display
// Browser URL bar hidden when installed
// start_url: "/panel"
// Install prompt handled gracefully
// Detect browser and show "Instalar no ecrã inicial" prompt
//
// ANTI-WEBSITE RULES:
// No underlined links that look like website hyperlinks
// No traditional top navigation bars with links
// No page-style layouts (header, content, footer website style)
// No browser-default styled form elements
// All interactive elements look and feel like app components
//
// CLEAN SURFACES — MANDATORY:
// Backgrounds, toasts, sheets and overlays are SOLID.
// No backdrop-filter / blur / frosted glass on them.
// ONE intentional exception, approved by Teacher Dove: the bottom
// navbar keeps its soft blur.
//
// ============================================================
// 15. ANTI-AUTO-TRANSLATION (MANDATORY)
// ============================================================
//
// Many students may have Google Translate auto-translation on.
// Handled once in panel/index.html — covers all SPA screens.
//
// In panel/index.html html tag:
//   <html lang="pt" translate="no" class="notranslate">
//
// In panel/index.html head:
//   <meta name="google" content="notranslate">
//   <meta http-equiv="Content-Language" content="pt">
//
// On critical UI elements in screens:
//   class="notranslate" translate="no"
//
// ============================================================
// 16. MOZAMBICAN EXAM SYSTEM — CRITICAL KNOWLEDGE
// ============================================================
//
// AI must understand this system to build correct screens.
// This knowledge informs registration flow, filtering logic,
// AI prompts, and content access rules.
//
// ENSINO GERAL — 9ª CLASSE:
// National exams at end of basic education.
// Normal student: takes all subjects (full exam round)
// Repeating student: takes only one Secção (section):
//   - Secção de Letras (humanities subjects)
//   - Secção de Ciências (sciences and maths)
// A repeating student may have passed one section previously
// and only needs to pass the remaining one.
// Exact subject lists per section confirmed by Teacher Dove.
//
// ENSINO GERAL — 12ª CLASSE:
// National exams at end of secondary education.
// Normal student: takes all subjects with national exams (~10)
// Repeating student: takes only the subjects they previously failed
// Student selects individual subjects during registration.
//
// EXAMES DE ADMISSÃO — BY COURSE:
// University entry exams organised by degree course.
// Each course requires exactly 2 exam subjects.
// Students select their target course at registration.
// Only their 2 course subjects are accessible on the platform.
// Course list grows as platform expands.
// Full current course list provided by Teacher Dove.
//
// EXAMES DE ADMISSÃO — BY INSTITUTION:
// Some institutions (ACIPOL, IFP, Academia Militar, others)
// run their own entry exams separately from the course system.
// Treated separately in registration and content access.
// Subject requirements per institution confirmed by Teacher Dove.
//
// STUDENT PROFILE DETERMINES EVERYTHING:
// Once registered and profile complete, the student's choices
// control 100% of what they can access:
// - Which subjects appear in every feature
// - Which questions are fetched from database
// - Which AI context is used in Mentor and Simulação
// - Which chatroom (Bate-papo) they join
// - Which Meu Exame dates are relevant
// Nothing outside their profile is ever shown or fetched.
//
// ============================================================
// 17. AUTHENTICATION AND REGISTRATION FLOW
// ============================================================
//
// EVERY TIME THE PANEL OPENS:
// 1. panel/index.html loads → panel/js/core/router.js init
// 2. Router calls Firebase onAuthStateChanged ONCE
// 3. Decision:
//    - Not authenticated → /panel/auth
//    - Authenticated + profile incomplete → /panel/onboarding
//    - Authenticated + profile complete → /panel/dashboard
//    - Role = moderador → can access /panel/moderador
//
// REGISTRATION FLOW:
// 1. Student fills: full name, email, password
// 2. On successful registration:
//    - Firebase Auth account created
//    - Firestore user document created immediately
//    - AWARD_REGISTRATION Moedas awarded via Worker
//    - If invite code used: invitedBy field set,
//      AWARD_INVITED Moedas awarded to invited student
//    - Router navigates to /panel/onboarding
//
// SENSITIVE LOGIC — ALERT TEACHER DOVE:
// Moedas award on registration → Cloudflare Worker
// Invite code validation → Cloudflare Worker
// These must never run in browser code
//
// ONBOARDING FLOW (runs ONCE — cannot be skipped):
// Profile is what personalises the entire platform experience.
// Steps (exact order and fields confirmed with Teacher Dove):
//   Step 1: Province and district selection
//   Step 2: School name (text input)
//   Step 3: Exam type selection (Ensino Geral or Admissão)
//   Step 4: If Ensino Geral → grade (9 or 12)
//              If 9 + Repeating → section choice
//              If 12 + Repeating → subject selection
//   Step 5: If Admissão → course or institution selection
//   Step 6: Exam date setting (optional — can set later in Perfil)
// On completion:
//    - All fields saved to Firestore user document
//    - Router navigates to /panel/dashboard
//    - Welcome email sent via email.js
//
// ============================================================
// 18. FIRESTORE DATABASE STRUCTURE
// ============================================================
//
// COLLECTION: users
// Document ID: Firebase Auth UID
// {
//   fullName:           string    — student's full name
//   email:              string
//   whatsapp:           string    — '+258…' (onboarding step 1)
//   province:           string
//   district:           string
//   school:             string    — school name
//   schoolType:         string    — 'Escola Secundária' | 'Instituto' |
//                                   'Universidade' | 'Outra'
//   examType:           string    — 'ensino-geral' | 'admissao'
//                                   (its presence = onboarding gate)
//   grade:              string    — '9' | '12' (ensino geral only)
//   status:             string    — 'normal' | 'repetente'
//   section:            string    — 'letras' | 'ciencias' | 'all' (9ª repetente)
//   subjects:           array     — resolved subject names the student can access
//   course:             string    — admissão course ID (not the label)
//   institution:        string    — institution ID (not the label)
//   pairIndex:          number    — which subject pair (admissão)
//   groupId:            string    — chatroom group (from app.getGroupId)
//   moedas:             number    — balance (writable only via Worker)
//   inviteCode:         string    — own code, format ENV-0000
//   invitedBy:          string    — inviter UID (null if none)
//   examDates:          object    — { subject: 'YYYY-MM-DD' } LOCAL dates
//   lastDesafioDate:    string    — 'YYYY-MM-DD' LOCAL date (Mozambique
//                                   is UTC+2 — never use toISOString())
//   onboardingComplete: boolean
//   joinedAt:           timestamp
//   lastActive:         timestamp
//   role:               string    — 'student' | 'moderador' | 'admin'
// }
//
// COLLECTION: progress
// Document ID: auto-generated
// {
//   userId:         string    — student UID
//   subject:        string    — subject name
//   feature:        string    — which feature generated this
//   score:          number    — percentage score
//   totalQuestions: number
//   correctAnswers: number
//   wrongAnswers:   array     — question IDs answered wrong
//   duration:       number    — seconds taken
//   completedAt:    timestamp
// }
//
// COLLECTION: wrongAnswers
// Document ID: auto-generated
// {
//   userId:         string    — student UID
//   questionId:     string    — question ID from exam database
//   subject:        string
//   topic:          string
//   questionData:   object    — full question snapshot
//   savedAt:        timestamp
//   retried:        boolean   — has student retried this
//   retriedAt:      timestamp
// }
//
// COLLECTION: chat / [groupId] / messages
// Document ID: auto-generated
// {
//   senderId:       string    — student UID
//   senderName:     string    — student display name
//   text:           string    — message text (empty if image)
//   imageUrl:       string    — Cloudinary URL (empty if text)
//   sentAt:         timestamp
//   deleted:        boolean   — moderator deleted
// }
//
// COLLECTION: chatGroups
// Document ID: groupId
// {
//   groupId:        string
//   label:          string    — e.g. "12ª Classe — Ciências"
//   locked:         boolean   — moderator locked the chat
//   moderatorId:    string    — UID of assigned moderator
//   topic:          string    — current discussion topic (optional)
//   createdAt:      timestamp
// }
//
// COLLECTION: invite_codes
// Document ID: the code itself, e.g. 'ENV-4821'
// {
//   code:       string
//   ownerId:    string    — UID of the student who owns the code
//   ownerName:  string
//   createdAt:  timestamp
//   usedCount:  number
// }
//
// COLLECTION: invites
// Document ID: the INVITED student's UID
// {
//   inviterCode:  string
//   invitedEmail: string
//   invitedName:  string
//   status:       string    — 'completed'
//   createdAt:    timestamp
// }
//
//
// EXAM DATABASE COLLECTIONS:
// Structure confirmed by Teacher Dove before exams.js is built.
// AI must request exact collection and field names before
// writing any screen that queries exam data.
// Exam data is READ ONLY — never write to exam collections
// from the panel. All exam data managed via admin panel.
//
// ============================================================
// 19. SCREEN-BY-SCREEN REFERENCE
// ============================================================
//
// This section defines the PURPOSE of each screen.
// It does NOT prescribe exact layouts, exact tabs, or exact
// component arrangements — AI proposes those during building
// after discussing with Teacher Dove.
// AI should always request a related ProvaNova screen to mirror
// design quality and consistency before building any screen.
//
// ── 01. auth.js ──────────────────────────────────────────
// PURPOSE: Entry point. Login and registration in one screen.
// Two states that switch without navigation or reload.
// keepAlive: false | Navbar: absent | Header: absent (logo)
//
// ── 02. onboarding.js ────────────────────────────────────
// PURPOSE: First-time profile setup. Multi-step flow.
// Collects all data that personalises the entire platform.
// Runs ONCE — cannot be skipped or bypassed by URL.
// Steps follow the exam type branching logic from app.js.
// keepAlive: false | Navbar: absent | Header: absent
//
// ── 03. dashboard.js ─────────────────────────────────────
// PURPOSE: Main home screen. First screen after login.
// Personalised welcome, quick access to all features,
// Moedas balance, today's Desafio Diário status,
// days until next exam (if dates set), motivational element.
// keepAlive: TRUE — only this screen has keepAlive
// Navbar: present (active: dashboard) — DASHBOARD ONLY
// Navbar lives in panel/js/core/navbar.js
// Only dashboard.js imports and calls renderNavbar().
// No other screen ever calls renderNavbar().
//
// ── 04. simulacao.js ─────────────────────────────────────
// PURPOSE: Exam simulation setup and execution.
// Student selects subject first — nothing loads before this.
// Two modes: Exames Anteriores (real past questions) and
// Perguntas Geradas (AI-generated new questions).
// Questions are presented interactively for student to answer.
// May require a render screen in renders/ for question display.
// AI flags if a separate render screen is needed.
// keepAlive: false | back button only
//
// ── 05. revisao.js ───────────────────────────────────────
// PURPOSE: Error review — all wrong answers in one place.
// Organised by subject and date.
// Student can filter, retry questions, track improvement.
// Shows improvement over time when questions are retried.
// keepAlive: false
//
// ── 06. desafio.js ───────────────────────────────────────
// PURPOSE: Daily challenge — short, daily, earns Moedas.
// Random subject, 5–10 questions, timer running.
// One challenge per day — system knows if already completed.
// On completion: Moedas awarded, result shown.
// keepAlive: false
//
// ── 07. meu-exame.js ─────────────────────────────────────
// PURPOSE: Premium feature — full exam simulation under
// strict conditions, unlocked 2–4 days before a set exam date.
// Student sets exam dates in Perfil per subject.
// When the date approaches, this feature activates for that subject.
// Strict mode: timed, no feedback during, real exam policies.
// Final verdict at the end: would you have passed?
// Costs Moedas — premium.
// keepAlive: false
//
// ── 08. mentor.js ────────────────────────────────────────
// PURPOSE: AI tutor — conversational study help.
// Student selects subject first, then chats with AI.
// AI knows only the student's subjects — stays in boundaries.
// Explains concepts, discusses past exam questions, solves
// step by step, in European Portuguese.
// Chat history saved per session.
// Groq API called via Cloudflare Worker — never directly.
// keepAlive: false (active: mentor)
//
// ── 09. progresso.js ─────────────────────────────────────
// PURPOSE: Progress tracking and topic trends — two distinct views.
// Progresso view: personal performance over time — scores,
// subjects, simulations completed, time studied, weak topics.
// Tendências view: topic frequency from exam database —
// which topics appear most across years for each subject.
// Subject filter first — student selects subject before data loads.
// keepAlive: false (active: progresso)
//
// ── 10. bate-papo.js ─────────────────────────────────────
// PURPOSE: Group chatroom — filtered by student's groupId.
// Students only see and chat with their own group.
// Real-time via Firebase Firestore onSnapshot.
// Students can share images — uploaded to Cloudinary directly
// from browser, Cloudinary URL saved in Firestore message.
// Moderator controls visible only to moderator role.
// keepAlive: false
//
// ── 11. perfil.js ────────────────────────────────────────
// PURPOSE: Student profile and settings.
// Personal information, exam type and subjects displayed.
// Exam date setting per subject (used by Meu Exame).
// Moedas balance and earn history.
// Invite friends and earn Moedas.
// Change password, dark mode toggle, sign out.
// keepAlive: false (active: perfil)
//
// ── 12. moderador.js ─────────────────────────────────────
// PURPOSE: Moderator controls for assigned chatroom.
// Accessible only to users with role = 'moderador'.
// Can lock/unlock chat, remove or ban users, pin topics,
// delete messages, set discussion topic.
// keepAlive: false | Navbar: absent
//
// ── renders/ ─────────────────────────────────────────────
// PURPOSE: Screens that display questions for student interaction.
// Created as needed during build — not pre-planned.
// Examples of what may be needed:
//   simulacao-render.js — displays and handles question answering
//   desafio-render.js   — daily challenge question display
//   meu-exame-render.js — strict exam mode question display
// When AI determines a render screen is needed, it MUST:
//   1. Flag it to Teacher Dove immediately
//   2. Explain exactly why it is needed
//   3. Propose its purpose and structure
//   4. Wait for Teacher Dove's approval before writing it
// Render screens live in renders/ and are three levels deep —
// import paths use ../../../core/ (see Section 4)
//
// ============================================================
// 20. SECURITY ARCHITECTURE
// ============================================================
//
// CLOUDFLARE WORKERS — ALL SENSITIVE LOGIC LIVES HERE:
// - Groq AI API calls (API key never in browser)
// - Moedas deduction and award (balance integrity)
// - Invite code validation (prevent manipulation)
// - Email sending via Resend (API key never in browser)
// - Future payment processing
// - Any backend operation that must not be tampered with
//
// AI RESPONSIBILITY FOR SECURITY:
// - Proactively identify any logic that belongs in a Worker
// - Alert Teacher Dove BEFORE writing the screen
// - Never leave API keys or Worker secrets in client code
// - Never write sensitive operations directly in screen files
// - worker.js is the ONLY bridge to Cloudflare Workers
//
// FIREBASE SECURITY RULES:
// - Students read/write only their own user document
// - Students read only their own progress and wrongAnswers
// - Chat messages readable by students in the same group only
// - Exam database collections: read only, never write from panel
// - Moedas balance: readable by student, writable only via Worker
//
// ============================================================
// 21. TOOL RECOMMENDATIONS AND ALTERNATIVES
// ============================================================
//
// AI RESPONSIBILITY — TOOLS:
// If during building any screen a better free tool or platform
// exists for a specific problem, AI should recommend it clearly.
// Examples of how this works in practice:
// - Firebase Storage permission issues → Cloudinary (already chosen)
// - Email deliverability/spam issues → Resend (already chosen)
// - Real-time chat alternatives → Firebase Realtime Database
//   or Supabase Realtime if Firestore proves insufficient
// - Image compression before Cloudinary upload → browser Canvas API
//   (free, no library needed)
//
// AI should always:
// - Flag the problem clearly before suggesting a tool change
// - Explain why the current tool is problematic
// - Suggest the free alternative with clear reasoning
// - Wait for Teacher Dove's approval before changing approach
//
// ============================================================
// 22. AI RESPONSIBILITIES PER SCREEN (MANDATORY)
// ============================================================
//
// BEFORE WRITING ANY SCREEN, AI MUST:
//
// 1. REQUEST a related approved ProvaNova screen from Teacher Dove
//    to mirror design, import patterns, and code style
//
// 2. DISCUSS the specific screen features with Teacher Dove —
//    never assume what the screen should contain
//    Ask: what does the student see? what can they do?
//    what are the edge cases? what data loads and from where?
//
// 3. PROPOSE the layout approach (tabs, cards, sheets, etc.)
//    and wait for Teacher Dove's feedback before writing
//
// 4. IDENTIFY any sensitive logic and alert Teacher Dove
//    before writing — never leave sensitive code in screens
//
// 5. VERIFY all import paths before writing — check folder depth
//    Screens: ../../core/ | Render screens: ../../../core/
//
// 6. ENSURE every screen has:
//    - Four-Room Pattern (css, mount, init, destroy)
//    - Event listener hygiene in init()
//    - CSS only in css() — never in mount()
//    - Anti-translation attributes on critical elements
//    - Dark mode support via [data-theme="dark"] in css()
//    - Skeleton loaders on any data load
//    - Accessible font sizes and touch targets (min 48x48px)
//    - Native app feel — no website patterns
//    - Formal, encouraging Portuguese UI copy
//    - Correct Moedas logic where applicable
//    - Mobile-first CSS — no horizontal scroll ever
//    - Fully responsive: mobile → tablet → desktop
//    - Subject filter first on any feature that loads exam data
//
// WHAT AI MUST NEVER DO:
// - Never generate or create files — write code in chat only
// - Never write partial code — always complete and working
// - Never put CSS inside mount()
// - Never call onAuthStateChanged inside a screen
// - Never query exam Firestore collections directly in screens
// - Never call Worker URLs directly in screens — use worker.js
// - Never call Resend directly — use email.js → worker.js
// - Never call Groq API directly — use worker.js
// - Never leave API keys, Worker secrets, or sensitive values
//   in any screen file or in any client-side code
// - Never assume Firebase or Groq details — always ask
// - Never skip discussing a screen before building it
// - Never hardcode subjects, grades, or exam logic in screens —
//   always import from app.js
// - Never mention DoveLingua in any UI element
// - Never use backdrop-filter or blur on any surface
// - Never use gold for anything except Moedas
// - Never use red for anything except errors and wrong answers
// - Never write a colour as a hex inside a screen when a
//   CSS variable exists (banner gradients are the only exception)
// - Never use Tu, És, Teu, or Tens in any UI text
// - Never build a render screen without flagging and
//   discussing it with Teacher Dove first
//
// ============================================================
// 23. BUILDING ORDER (PHASE BY PHASE)
// ============================================================
//
// PANEL IS PRIORITY — build panel completely before public site.
//
// PHASE 1 — FOUNDATION (build before any screen):
// 01. panel/index.html
// 02. panel/js/core/firebase.js
// 03. panel/js/core/router.js
// 04. panel/js/core/ui.js
// 05. panel/js/core/app.js
// 06. panel/js/core/moeda.js
// 07. panel/js/core/worker.js
// 08. panel/js/core/email.js
// 09. panel/js/core/exams.js
// 10. manifest.json
// 11. service-worker.js
// 12. vercel.json
//
// PHASE 2 — AUTHENTICATION:
// 13. panel/js/screens/auth/auth.js
// 14. panel/js/screens/auth/onboarding.js
//
// PHASE 3 — DASHBOARD:
// 15. panel/js/screens/dashboard/dashboard.js
//
// PHASE 4 — CORE LEARNING FEATURES:
// 16. panel/js/screens/simulacao/simulacao.js
//     (+ render screens in renders/ as needed)
// 17. panel/js/screens/revisao/revisao.js
// 18. panel/js/screens/desafio/desafio.js
//     (+ render screen as needed)
//
// PHASE 5 — PREMIUM + AI FEATURES:
// 19. panel/js/screens/meu-exame/meu-exame.js
//     (+ render screen as needed)
// 20. panel/js/screens/mentor/mentor.js
//
// PHASE 6 — PROGRESS AND SOCIAL:
// 21. panel/js/screens/progresso/progresso.js
// 22. panel/js/screens/bate-papo/bate-papo.js
//
// PHASE 7 — PROFILE AND MODERATION:
// 23. panel/js/screens/perfil/perfil.js
// 24. panel/js/screens/moderador/moderador.js
//
// PHASE 8 — CLOUDFLARE WORKERS:
// (Built alongside screens as needed — never after)
// Workers are planned and discussed with Teacher Dove
// before any screen that needs them is written.
//
// PHASE 9 — PUBLIC SITE:
// After panel is complete and tested.
// 25. index.html (public homepage)
// 26. public/como-funciona.html
// 27. public/exames.html
// 28. public/cursos.html
// 29. public/sobre.html
// 30. public/termos.html
// 31. public/contacto.html
//
// PHASE 10 — ADMIN PANEL:
// Completely separate project — discussed separately
// when panel and public site are complete.
//
// ============================================================
// END OF EXAMENOVA SPECIFICATION v1.0.0
// ============================================================
//
// This document is the single source of truth for ExameNova.
// Any AI working on this project must read this spec completely
// before writing a single line of code.
// When in doubt — ask Teacher Dove. Never assume.
// ============================================================
