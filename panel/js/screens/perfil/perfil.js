// ============================================================
// panel/js/screens/perfil/perfil.js
// ExameNova — Student Profile Screen
// Tabs: Perfil | Moedas | Mais
// Palette: Maré (Sky Blue #0284C7, Violet #8B5CF6, Teal #14B8A6)
// keepAlive: false | Navbar: present (active: perfil)
// ============================================================

import { auth, db }          from '../../core/firebase.js';
import { router }             from '../../core/router.js';
import { ui }                 from '../../core/ui.js';
import { moeda }              from '../../core/moeda.js';
import { worker }             from '../../core/worker.js';
import {
  getProvinces,
  getDistrictsByProvince,
  getStudentSubjects,
} from '../../core/app.js';

import {
  doc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

import {
  signOut,
  GoogleAuthProvider,
  reauthenticateWithPopup,
  reauthenticateWithCredential,
  EmailAuthProvider,
  updatePassword,
  sendPasswordResetEmail,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// ============================================================
// MODULE STATE
// ============================================================
let _activeTab  = 'perfil';
let _photoURL   = '';
let _photoEmoji = '';

const EMOJI_LIST = [
  '😊','😎','🤓','🧐','📚','✏️','📝','🎓',
  '🏆','⭐','🚀','💡','🔬','🧮','📐','📏',
  '🌍','🇲🇿','💪','🎯','🔥','⚡','🌟','💎',
  '🦁','🐯','🦅','🌺','🌴','☀️','🌙','❤️',
  '💙','💜','💚','🤝','✊','👊','🙏','😄',
];

const CLOUDINARY_CLOUD  = 'hmuaxaza';
const CLOUDINARY_PRESET = 'ProvaNova - Profile';

// ============================================================
// SCREEN
// ============================================================
const PerfilScreen = {

  // ── ROOM 1 — CSS ────────────────────────────────────────
  css() {
    if (document.getElementById('perfil-styles')) return '';
    return `<style id="perfil-styles">

      .perfil-wrap {
        min-height: 100dvh;
        min-height: 100vh;
        background: var(--bg);
        padding-bottom: calc(var(--navbar-height) + 24px);
      }

      /* ── HERO ── */
      .perfil-hero {
        background: linear-gradient(135deg, #0369A1 0%, #0284C7 100%);
        padding: 24px 20px 56px;
        position: relative;
        overflow: hidden;
        text-align: center;
      }

      .perfil-hero::after {
        content: '';
        position: absolute;
        bottom: -24px;
        left: 0; right: 0;
        height: 48px;
        background: var(--bg);
        border-radius: 50% 50% 0 0 / 100% 100% 0 0;
      }

      .perfil-hero-dot {
        position: absolute;
        border-radius: 50%;
        opacity: 0.07;
        background: #fff;
        pointer-events: none;
      }

      /* Avatar */
      .perfil-avatar-wrap {
        position: relative;
        display: inline-block;
        margin: 0 auto 12px;
      }

      .perfil-avatar {
        width: 76px;
        height: 76px;
        border-radius: 50%;
        background: rgba(255,255,255,0.2);
        border: 3px solid rgba(255,255,255,0.4);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 28px;
        font-weight: 800;
        color: #fff;
        letter-spacing: -1px;
        overflow: hidden;
        position: relative;
        z-index: 1;
      }

      .perfil-avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 50%;
      }

      .perfil-avatar-edit {
        position: absolute;
        bottom: 0;
        right: 0;
        width: 26px;
        height: 26px;
        border-radius: 50%;
        background: #fff;
        border: 2px solid rgba(255,255,255,0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        color: #0284C7;
        cursor: pointer;
        z-index: 2;
        box-shadow: 0 2px 6px rgba(0,0,0,0.2);
        transition: transform 0.15s;
      }
      .perfil-avatar-edit:active { transform: scale(0.9); }

      .perfil-hero-name {
        font-size: 20px;
        font-weight: 800;
        color: #fff;
        margin-bottom: 4px;
        position: relative;
        z-index: 1;
        letter-spacing: -0.3px;
      }

      .perfil-hero-sub {
        font-size: 13px;
        color: rgba(255,255,255,0.7);
        position: relative;
        z-index: 1;
      }

      .perfil-hero-badge {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        margin-top: 10px;
        background: rgba(255,255,255,0.15);
        border: 1px solid rgba(255,255,255,0.25);
        border-radius: var(--radius-full);
        padding: 4px 12px;
        font-size: 11px;
        font-weight: 600;
        color: rgba(255,255,255,0.9);
        position: relative;
        z-index: 1;
      }

      /* ── TABS ── */
      .perfil-tabs {
        display: flex;
        margin: 8px 16px 0;
        background: var(--bg-card);
        border-radius: var(--radius-lg);
        border: 1px solid var(--border-subtle);
        padding: 4px;
        gap: 4px;
        position: relative;
        z-index: 2;
        box-shadow: var(--shadow-sm);
      }

      .perfil-tab {
        flex: 1;
        padding: 10px 4px;
        border-radius: calc(var(--radius-lg) - 3px);
        font-size: 12px;
        font-weight: 600;
        color: var(--text-muted);
        border: none;
        background: transparent;
        cursor: pointer;
        transition: all 0.2s;
        text-align: center;
        font-family: inherit;
        min-height: 40px;
      }

      .perfil-tab.active {
        background: #0284C7;
        color: #fff;
        box-shadow: 0 2px 8px rgba(2,132,199,0.35);
      }

      /* ── CONTENT ── */
      .perfil-content {
        padding: 16px 16px 0;
      }

      /* ── GROUP ── */
      .perfil-group {
        background: var(--bg-card);
        border-radius: var(--radius-lg);
        border: 1px solid var(--border-subtle);
        box-shadow: var(--shadow-sm);
        overflow: hidden;
        margin-bottom: 12px;
      }

      .perfil-group-title {
        font-size: 11px;
        font-weight: 700;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        padding: 12px 16px 8px;
        border-bottom: 1px solid var(--border-subtle);
      }

      /* ── FIELD ROW ── */
      .perfil-field {
        padding: 13px 16px;
        border-bottom: 1px solid var(--border-subtle);
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .perfil-field:last-child { border-bottom: none; }

      .perfil-field-icon {
        width: 32px;
        height: 32px;
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
        flex-shrink: 0;
      }

      .perfil-field-body { flex: 1; min-width: 0; }

      .perfil-field-label {
        font-size: 11px;
        font-weight: 600;
        color: var(--text-muted);
        margin-bottom: 2px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .perfil-field-value {
        font-size: 14px;
        font-weight: 600;
        color: var(--text);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .perfil-field-action {
        font-size: 12px;
        font-weight: 600;
        color: #0284C7;
        cursor: pointer;
        flex-shrink: 0;
        padding: 4px 0;
        background: none;
        border: none;
        font-family: inherit;
        min-height: 36px;
      }

      .perfil-field-locked {
        font-size: 11px;
        color: var(--text-muted);
        flex-shrink: 0;
      }

      /* Exam date row */
      .perfil-date-row {
        padding: 12px 16px;
        border-bottom: 1px solid var(--border-subtle);
        display: flex;
        align-items: center;
        gap: 12px;
        cursor: pointer;
        transition: background 0.15s;
      }
      .perfil-date-row:last-child { border-bottom: none; }
      .perfil-date-row:active { background: var(--bg); }

      .perfil-date-subject {
        font-size: 14px;
        font-weight: 600;
        color: var(--text);
        flex: 1;
      }

      .perfil-date-value {
        font-size: 13px;
        font-weight: 600;
        color: #0284C7;
        flex-shrink: 0;
      }

      .perfil-date-empty {
        font-size: 13px;
        color: var(--text-muted);
        flex-shrink: 0;
      }

      /* ── MOEDAS TAB ── */
      .moedas-balance-card {
        background: var(--moeda-light);
        border: 1.5px solid rgba(255,179,0,0.3);
        border-radius: var(--radius-lg);
        padding: 20px;
        text-align: center;
        margin-bottom: 12px;
      }

      .moedas-balance-icon {
        font-size: 2rem;
        margin-bottom: 8px;
        display: block;
      }

      .moedas-balance-amount {
        font-size: 3rem;
        font-weight: 900;
        color: var(--moeda);
        line-height: 1;
        letter-spacing: -2px;
        margin-bottom: 4px;
      }

      .moedas-balance-label {
        font-size: 13px;
        color: var(--text-muted);
        font-weight: 500;
      }

      /* Earn rows */
      .moedas-earn-row {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        border-bottom: 1px solid var(--border-subtle);
      }
      .moedas-earn-row:last-child { border-bottom: none; }

      .moedas-earn-icon {
        width: 34px;
        height: 34px;
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 15px;
        flex-shrink: 0;
      }

      .moedas-earn-body { flex: 1; }

      .moedas-earn-title {
        font-size: 14px;
        font-weight: 600;
        color: var(--text);
      }

      .moedas-earn-sub {
        font-size: 12px;
        color: var(--text-muted);
        margin-top: 1px;
      }

      .moedas-earn-amount {
        font-size: 14px;
        font-weight: 800;
        color: var(--moeda);
        flex-shrink: 0;
      }

      /* Invite code */
      .invite-code-box {
        background: linear-gradient(135deg,
          rgba(2,132,199,0.06) 0%,
          rgba(2,132,199,0.02) 100%);
        border: 1.5px dashed rgba(2,132,199,0.3);
        border-radius: var(--radius-lg);
        padding: 20px 16px;
        text-align: center;
        margin-bottom: 12px;
      }

      .invite-code-label {
        font-size: 11px;
        font-weight: 700;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.1em;
        margin-bottom: 8px;
      }

      .invite-code-value {
        font-size: 28px;
        font-weight: 800;
        color: #0284C7;
        letter-spacing: 6px;
        margin-bottom: 6px;
        font-family: monospace;
      }

      .invite-code-sub {
        font-size: 12px;
        color: var(--text-muted);
        margin-bottom: 16px;
        line-height: 1.5;
      }

      .invite-share-row {
        display: flex;
        gap: 8px;
        justify-content: center;
      }

      .invite-btn {
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 10px 16px;
        border-radius: var(--radius-md);
        font-size: 13px;
        font-weight: 700;
        border: none;
        cursor: pointer;
        transition: transform 0.15s, opacity 0.15s;
        flex: 1;
        justify-content: center;
        max-width: 160px;
        font-family: inherit;
        min-height: 44px;
      }
      .invite-btn:active { transform: scale(0.96); }
      .invite-btn-wa    { background: #25D366; color: #fff; }
      .invite-btn-copy  { background: #0284C7; color: #fff; }

      /* Invite stats */
      .invite-stats-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-bottom: 12px;
      }

      .invite-stat-card {
        background: var(--bg-card);
        border-radius: var(--radius-lg);
        border: 1px solid var(--border-subtle);
        box-shadow: var(--shadow-sm);
        padding: 14px 12px;
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .invite-stat-icon {
        width: 36px;
        height: 36px;
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 15px;
        flex-shrink: 0;
      }

      .invite-stat-value {
        font-size: 20px;
        font-weight: 800;
        color: var(--text);
        line-height: 1;
        letter-spacing: -0.5px;
      }

      .invite-stat-label {
        font-size: 10px;
        font-weight: 600;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-top: 2px;
      }

      /* ── SETTINGS ROW ── */
      .settings-row {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 15px 16px;
        border-bottom: 1px solid var(--border-subtle);
        cursor: pointer;
        transition: background 0.15s;
        width: 100%;
        text-align: left;
        background: transparent;
        border-left: none;
        border-right: none;
        border-top: none;
        font-family: inherit;
        min-height: 56px;
      }
      .settings-row:last-child { border-bottom: none; }
      .settings-row:active { background: var(--bg); }

      .settings-row-icon {
        width: 34px;
        height: 34px;
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        flex-shrink: 0;
      }

      .settings-row-body { flex: 1; min-width: 0; }

      .settings-row-title {
        font-size: 14px;
        font-weight: 600;
        color: var(--text);
      }

      .settings-row-sub {
        font-size: 12px;
        color: var(--text-muted);
        margin-top: 1px;
      }

      .settings-row-right {
        color: var(--text-muted);
        font-size: 12px;
        flex-shrink: 0;
      }

      .settings-row-danger .settings-row-title { color: var(--danger); }
      .settings-row-danger .settings-row-icon  { background: var(--danger-light); color: var(--danger); }
      .settings-row-warning .settings-row-title { color: var(--warning); }
      .settings-row-warning .settings-row-icon  { background: var(--warning-light); color: var(--warning); }

      /* ── EDIT INPUTS ── */
      .pf-input-group { margin-bottom: 14px; }

      .pf-input-label {
        font-size: 12px;
        font-weight: 700;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        margin-bottom: 6px;
        display: block;
      }

      .pf-input {
        width: 100%;
        padding: 13px 14px;
        border-radius: var(--radius-md);
        border: 1.5px solid var(--border);
        background: var(--bg-input);
        color: var(--text);
        font-size: 15px;
        font-family: inherit;
        outline: none;
        box-sizing: border-box;
        transition: border-color 0.2s;
        -webkit-appearance: none;
      }
      .pf-input:focus { border-color: #0284C7; box-shadow: 0 0 0 3px rgba(2,132,199,0.12); }

      .pf-select {
        width: 100%;
        padding: 13px 36px 13px 14px;
        border-radius: var(--radius-md);
        border: 1.5px solid var(--border);
        background: var(--bg-input);
        color: var(--text);
        font-size: 15px;
        font-family: inherit;
        outline: none;
        box-sizing: border-box;
        -webkit-appearance: none;
        appearance: none;
        cursor: pointer;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%230284C7' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 14px center;
        transition: border-color 0.2s;
      }
      .pf-select:focus { border-color: #0284C7; }
      .pf-select:disabled { opacity: 0.45; cursor: not-allowed; }
      [data-theme="dark"] .pf-select option { background: var(--bg-card); }

      .pf-phone-row {
        display: flex;
        gap: 8px;
        align-items: stretch;
      }

      .pf-phone-prefix {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 0 14px;
        background: rgba(2,132,199,0.08);
        border: 1.5px solid var(--border);
        border-radius: var(--radius-md);
        font-size: 0.88rem;
        font-weight: 700;
        color: #0284C7;
        white-space: nowrap;
        flex-shrink: 0;
        height: 50px;
        min-width: 82px;
        justify-content: center;
      }

      /* Emoji grid */
      .pf-emoji-grid {
        display: grid;
        grid-template-columns: repeat(8, 1fr);
        gap: 6px;
        margin-top: 4px;
      }

      .pf-emoji-btn {
        width: 100%;
        padding: 6px 2px;
        border-radius: var(--radius-sm);
        border: 1.5px solid var(--border-subtle);
        background: var(--bg);
        font-size: 20px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s;
        line-height: 1;
        min-height: 40px;
      }
      .pf-emoji-btn:active { transform: scale(0.88); }
      .pf-emoji-btn.selected {
        border-color: #0284C7;
        background: rgba(2,132,199,0.08);
      }

      .pf-avatar-tabs {
        display: flex;
        gap: 8px;
        margin-bottom: 14px;
      }

      .pf-avatar-tab {
        flex: 1;
        padding: 9px;
        border-radius: var(--radius-md);
        border: 1.5px solid var(--border-subtle);
        background: var(--bg);
        font-size: 12px;
        font-weight: 700;
        color: var(--text-muted);
        cursor: pointer;
        text-align: center;
        transition: all 0.2s;
        font-family: inherit;
        min-height: 40px;
      }
      .pf-avatar-tab.active {
        background: #0284C7;
        border-color: #0284C7;
        color: #fff;
      }

      .pf-upload-area {
        border: 2px dashed var(--border);
        border-radius: var(--radius-lg);
        padding: 24px 20px;
        text-align: center;
        cursor: pointer;
        transition: border-color 0.2s;
        margin-bottom: 8px;
      }
      .pf-upload-area:hover { border-color: #0284C7; }

      .pf-upload-icon { font-size: 28px; color: var(--text-muted); margin-bottom: 8px; }
      .pf-upload-label { font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 4px; }
      .pf-upload-sub   { font-size: 11px; color: var(--text-muted); }

      /* ── EXAM INFO CARD (read-only) ── */
      .pf-exam-info-card {
        background: rgba(2,132,199,0.05);
        border: 1px solid rgba(2,132,199,0.15);
        border-radius: var(--radius-md);
        padding: 12px 14px;
        margin-bottom: 14px;
        display: flex;
        align-items: flex-start;
        gap: 10px;
      }
      .pf-exam-info-card i { color: #0284C7; font-size: 14px; margin-top: 2px; flex-shrink: 0; }
      .pf-exam-info-card p { font-size: 12px; color: var(--text-muted); line-height: 1.6; margin: 0; }
      .pf-exam-info-card a {
        color: #0284C7;
        font-weight: 600;
        text-decoration: none;
        cursor: pointer;
      }

      /* ── DARK MODE ── */
      [data-theme="dark"] .perfil-hero::after { background: var(--bg); }
      [data-theme="dark"] .perfil-group,
      [data-theme="dark"] .perfil-tabs,
      [data-theme="dark"] .invite-stat-card { background: var(--bg-card); border-color: rgba(255,255,255,0.06); }
      [data-theme="dark"] .invite-code-box  { background: rgba(2,132,199,0.08); border-color: rgba(2,132,199,0.25); }
      [data-theme="dark"] .pf-emoji-btn     { background: var(--bg-card); }
      [data-theme="dark"] .pf-avatar-tab    { background: var(--bg-card); border-color: rgba(255,255,255,0.06); }
      [data-theme="dark"] .pf-upload-area   { border-color: rgba(255,255,255,0.1); }
      [data-theme="dark"] .settings-row:active { background: var(--bg-card); }
      [data-theme="dark"] .perfil-date-row:active { background: var(--bg-card); }
      [data-theme="dark"] .pf-exam-info-card { background: rgba(2,132,199,0.08); border-color: rgba(2,132,199,0.2); }

      /* ── RESPONSIVE ── */
      @media (min-width: 768px) {
        .perfil-hero    { padding: 32px 28px 64px; }
        .perfil-content { padding: 20px 24px 0; }
      }
      @media (min-width: 1025px) {
        .perfil-wrap { max-width: 680px; margin: 0 auto; }
        .perfil-hero { border-radius: 0 0 var(--radius-xl) var(--radius-xl); }
      }
      @media (max-width: 360px) {
        .pf-emoji-grid { grid-template-columns: repeat(7, 1fr); }
      }

    </style>`;
  },

  // ── ROOM 2 — MOUNT ──────────────────────────────────────
  mount() {
    return `
      <div class="perfil-wrap" translate="no">

        <div id="header-mount"></div>

        <!-- HERO -->
        <div class="perfil-hero">
          <div class="perfil-hero-dot" style="width:180px;height:180px;top:-70px;right:-50px;"></div>
          <div class="perfil-hero-dot" style="width:90px;height:90px;bottom:30px;left:10px;"></div>

          <div class="perfil-avatar-wrap">
            <div class="perfil-avatar notranslate" translate="no" id="pf-avatar">?</div>
            <button class="perfil-avatar-edit notranslate" translate="no" id="btn-avatar-edit" aria-label="Alterar foto">
              <i class="fa-solid fa-camera" aria-hidden="true"></i>
            </button>
          </div>

          <div class="perfil-hero-name notranslate" translate="no" id="pf-hero-name">—</div>
          <div class="perfil-hero-sub notranslate" translate="no" id="pf-hero-email">—</div>
          <div class="perfil-hero-badge notranslate" translate="no" id="pf-hero-badge">
            <i class="fa-solid fa-graduation-cap" aria-hidden="true"></i>
            ExameNova
          </div>
        </div>

        <!-- TABS -->
        <div class="perfil-tabs" role="tablist">
          <button class="perfil-tab active notranslate" translate="no" data-tab="perfil" role="tab" aria-selected="true">
            <i class="fa-solid fa-user" aria-hidden="true"></i>&nbsp;Perfil
          </button>
          <button class="perfil-tab notranslate" translate="no" data-tab="moedas" role="tab" aria-selected="false">
            <i class="fa-solid fa-coins" aria-hidden="true"></i>&nbsp;Moedas
          </button>
          <button class="perfil-tab notranslate" translate="no" data-tab="mais" role="tab" aria-selected="false">
            <i class="fa-solid fa-ellipsis" aria-hidden="true"></i>&nbsp;Mais
          </button>
        </div>

        <!-- ══ PERFIL TAB ══ -->
        <div id="tab-perfil" class="perfil-content">
          <div style="height:16px;"></div>

          <!-- Personal info -->
          <div class="perfil-group">
            <div class="perfil-group-title notranslate" translate="no">Informação Pessoal</div>
            <div class="perfil-field">
              <div class="perfil-field-icon" style="background:rgba(2,132,199,0.1);">
                <i class="fa-solid fa-user" style="color:#0284C7;" aria-hidden="true"></i>
              </div>
              <div class="perfil-field-body">
                <div class="perfil-field-label notranslate" translate="no">Nome completo</div>
                <div class="perfil-field-value notranslate" translate="no" id="pf-name">—</div>
              </div>
              <button class="perfil-field-action notranslate" translate="no" id="btn-edit-name">Editar</button>
            </div>
            <div class="perfil-field">
              <div class="perfil-field-icon" style="background:rgba(20,184,166,0.1);">
                <i class="fa-solid fa-envelope" style="color:#14B8A6;" aria-hidden="true"></i>
              </div>
              <div class="perfil-field-body">
                <div class="perfil-field-label notranslate" translate="no">Email</div>
                <div class="perfil-field-value notranslate" translate="no" id="pf-email">—</div>
              </div>
            </div>
            <div class="perfil-field">
              <div class="perfil-field-icon" style="background:rgba(34,197,94,0.1);">
                <i class="fa-brands fa-whatsapp" style="color:#22C55E;" aria-hidden="true"></i>
              </div>
              <div class="perfil-field-body">
                <div class="perfil-field-label notranslate" translate="no">WhatsApp</div>
                <div class="perfil-field-value notranslate" translate="no" id="pf-whatsapp">—</div>
              </div>
              <button class="perfil-field-action notranslate" translate="no" id="btn-edit-wa">Editar</button>
            </div>
            <div class="perfil-field">
              <div class="perfil-field-icon" style="background:rgba(255,179,0,0.1);">
                <i class="fa-solid fa-calendar-days" style="color:var(--moeda);" aria-hidden="true"></i>
              </div>
              <div class="perfil-field-body">
                <div class="perfil-field-label notranslate" translate="no">Membro desde</div>
                <div class="perfil-field-value notranslate" translate="no" id="pf-joined">—</div>
              </div>
            </div>
          </div>

          <!-- Location -->
          <div class="perfil-group">
            <div class="perfil-group-title notranslate" translate="no">Localização</div>
            <div class="perfil-field">
              <div class="perfil-field-icon" style="background:rgba(139,92,246,0.1);">
                <i class="fa-solid fa-location-dot" style="color:#8B5CF6;" aria-hidden="true"></i>
              </div>
              <div class="perfil-field-body">
                <div class="perfil-field-label notranslate" translate="no">Província · Distrito</div>
                <div class="perfil-field-value notranslate" translate="no" id="pf-location">—</div>
              </div>
              <button class="perfil-field-action notranslate" translate="no" id="btn-edit-location">Editar</button>
            </div>
            <div class="perfil-field">
              <div class="perfil-field-icon" style="background:rgba(20,184,166,0.1);">
                <i class="fa-solid fa-school" style="color:#14B8A6;" aria-hidden="true"></i>
              </div>
              <div class="perfil-field-body">
                <div class="perfil-field-label notranslate" translate="no">Escola</div>
                <div class="perfil-field-value notranslate" translate="no" id="pf-school">—</div>
              </div>
              <button class="perfil-field-action notranslate" translate="no" id="btn-edit-school">Editar</button>
            </div>
          </div>

          <!-- Exam info — READ ONLY -->
          <div class="perfil-group">
            <div class="perfil-group-title notranslate" translate="no">Exame</div>
            <div class="perfil-field">
              <div class="perfil-field-icon" style="background:rgba(2,132,199,0.1);">
                <i class="fa-solid fa-graduation-cap" style="color:#0284C7;" aria-hidden="true"></i>
              </div>
              <div class="perfil-field-body">
                <div class="perfil-field-label notranslate" translate="no">Tipo de exame</div>
                <div class="perfil-field-value notranslate" translate="no" id="pf-exam-type">—</div>
              </div>
              <span class="perfil-field-locked">
                <i class="fa-solid fa-lock" style="font-size:11px;color:var(--text-muted);" aria-hidden="true"></i>
              </span>
            </div>
            <div class="perfil-field">
              <div class="perfil-field-icon" style="background:rgba(139,92,246,0.1);">
                <i class="fa-solid fa-book-open" style="color:#8B5CF6;" aria-hidden="true"></i>
              </div>
              <div class="perfil-field-body">
                <div class="perfil-field-label notranslate" translate="no">Disciplinas</div>
                <div class="perfil-field-value notranslate" translate="no" id="pf-subjects">—</div>
              </div>
              <span class="perfil-field-locked">
                <i class="fa-solid fa-lock" style="font-size:11px;color:var(--text-muted);" aria-hidden="true"></i>
              </span>
            </div>
            <div class="pf-exam-info-card" style="margin:0 16px 14px;">
              <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
              <p class="notranslate" translate="no">
                Para alterar o tipo de exame ou disciplinas,
                <a id="btn-contact-admin">contacte o suporte</a>.
              </p>
            </div>
          </div>

          <!-- Exam dates -->
          <div class="perfil-group">
            <div class="perfil-group-title notranslate" translate="no">Datas do Exame</div>
            <div id="pf-exam-dates-list"></div>
          </div>

          <div style="height:8px;"></div>
        </div>

        <!-- ══ MOEDAS TAB ══ -->
        <div id="tab-moedas" class="perfil-content" style="display:none;">
          <div style="height:16px;"></div>

          <!-- Balance card -->
          <div class="moedas-balance-card">
            <span class="moedas-balance-icon">
              <i class="fa-solid fa-coins" aria-hidden="true"></i>
            </span>
            <div class="moedas-balance-amount notranslate" translate="no" id="pf-balance">0</div>
            <div class="moedas-balance-label notranslate" translate="no">Moedas disponíveis</div>
          </div>

          <!-- How to earn -->
          <div class="perfil-group">
            <div class="perfil-group-title notranslate" translate="no">Como ganhar Moedas</div>
            <div class="moedas-earn-row">
              <div class="moedas-earn-icon" style="background:rgba(2,132,199,0.1);">
                <i class="fa-solid fa-user-check" style="color:#0284C7;" aria-hidden="true"></i>
              </div>
              <div class="moedas-earn-body">
                <div class="moedas-earn-title notranslate" translate="no">Completar o registo</div>
                <div class="moedas-earn-sub notranslate" translate="no">Bónus de boas-vindas</div>
              </div>
              <div class="moedas-earn-amount notranslate" translate="no">+${moeda.AWARDS.REGISTRATION}</div>
            </div>
            <div class="moedas-earn-row">
              <div class="moedas-earn-icon" style="background:rgba(239,68,68,0.1);">
                <i class="fa-solid fa-fire" style="color:#EF4444;" aria-hidden="true"></i>
              </div>
              <div class="moedas-earn-body">
                <div class="moedas-earn-title notranslate" translate="no">Desafio Diário (correcto)</div>
                <div class="moedas-earn-sub notranslate" translate="no">Um desafio por dia</div>
              </div>
              <div class="moedas-earn-amount notranslate" translate="no">+${moeda.AWARDS.DAILY_CHALLENGE}</div>
            </div>
            <div class="moedas-earn-row">
              <div class="moedas-earn-icon" style="background:rgba(34,197,94,0.1);">
                <i class="fa-solid fa-user-plus" style="color:#22C55E;" aria-hidden="true"></i>
              </div>
              <div class="moedas-earn-body">
                <div class="moedas-earn-title notranslate" translate="no">Convidar um amigo</div>
                <div class="moedas-earn-sub notranslate" translate="no">Quando o amigo completa o registo</div>
              </div>
              <div class="moedas-earn-amount notranslate" translate="no">+${moeda.AWARDS.INVITE}</div>
            </div>
            <div class="moedas-earn-row">
              <div class="moedas-earn-icon" style="background:rgba(255,179,0,0.1);">
                <i class="fa-solid fa-gift" style="color:var(--moeda);" aria-hidden="true"></i>
              </div>
              <div class="moedas-earn-body">
                <div class="moedas-earn-title notranslate" translate="no">Ser convidado por um amigo</div>
                <div class="moedas-earn-sub notranslate" translate="no">Bónus de convite</div>
              </div>
              <div class="moedas-earn-amount notranslate" translate="no">+${moeda.AWARDS.INVITED}</div>
            </div>
          </div>

          <!-- Invite code -->
          <div class="invite-code-box">
            <div class="invite-code-label notranslate" translate="no">
              <i class="fa-solid fa-ticket" aria-hidden="true"></i>&nbsp;O seu código de convite
            </div>
            <div class="invite-code-value notranslate" translate="no" id="pf-invite-code">——</div>
            <div class="invite-code-sub notranslate" translate="no">
              Partilhe com amigos. Ambos ganham Moedas quando o amigo completar o registo.
            </div>
            <div class="invite-share-row">
              <button class="invite-btn invite-btn-wa notranslate" translate="no" id="btn-share-wa">
                <i class="fa-brands fa-whatsapp" aria-hidden="true"></i> WhatsApp
              </button>
              <button class="invite-btn invite-btn-copy notranslate" translate="no" id="btn-share-copy">
                <i class="fa-solid fa-copy" aria-hidden="true"></i> Copiar
              </button>
            </div>
          </div>

          <!-- Invite stats -->
          <div class="invite-stats-row">
            <div class="invite-stat-card">
              <div class="invite-stat-icon" style="background:rgba(2,132,199,0.1);">
                <i class="fa-solid fa-user-plus" style="color:#0284C7;" aria-hidden="true"></i>
              </div>
              <div>
                <div class="invite-stat-value notranslate" translate="no" id="pf-stat-invited">0</div>
                <div class="invite-stat-label notranslate" translate="no">Amigos convidados</div>
              </div>
            </div>
            <div class="invite-stat-card">
              <div class="invite-stat-icon" style="background:rgba(34,197,94,0.1);">
                <i class="fa-solid fa-circle-check" style="color:#22C55E;" aria-hidden="true"></i>
              </div>
              <div>
                <div class="invite-stat-value notranslate" translate="no" id="pf-stat-completed">0</div>
                <div class="invite-stat-label notranslate" translate="no">Convites concluídos</div>
              </div>
            </div>
          </div>

          <div style="height:8px;"></div>
        </div>

        <!-- ══ MAIS TAB ══ -->
        <div id="tab-mais" class="perfil-content" style="display:none;">
          <div style="height:16px;"></div>

          <!-- Conta -->
          <div class="perfil-group">
            <div class="perfil-group-title notranslate" translate="no">Conta</div>
            <button class="settings-row notranslate" translate="no" id="btn-change-password">
              <div class="settings-row-icon" style="background:rgba(2,132,199,0.1);">
                <i class="fa-solid fa-key" style="color:#0284C7;" aria-hidden="true"></i>
              </div>
              <div class="settings-row-body">
                <div class="settings-row-title">Alterar palavra-passe</div>
                <div class="settings-row-sub" id="pf-pw-sub">—</div>
              </div>
              <i class="fa-solid fa-chevron-right settings-row-right" aria-hidden="true"></i>
            </button>
          </div>

          <!-- Configurações -->
          <div class="perfil-group">
            <div class="perfil-group-title notranslate" translate="no">Configurações</div>
            <button class="settings-row notranslate" translate="no" id="btn-dark-toggle">
              <div class="settings-row-icon" style="background:rgba(139,92,246,0.1);">
                <i class="fa-solid fa-moon" style="color:#8B5CF6;" aria-hidden="true"></i>
              </div>
              <div class="settings-row-body">
                <div class="settings-row-title">Modo escuro</div>
                <div class="settings-row-sub" id="pf-dark-sub">Desactivado</div>
              </div>
              <i class="fa-solid fa-chevron-right settings-row-right" aria-hidden="true"></i>
            </button>
          </div>

          <!-- Ajuda -->
          <div class="perfil-group">
            <div class="perfil-group-title notranslate" translate="no">Ajuda</div>
            <button class="settings-row notranslate" translate="no" id="btn-support">
              <div class="settings-row-icon" style="background:rgba(34,197,94,0.1);">
                <i class="fa-brands fa-whatsapp" style="color:#22C55E;" aria-hidden="true"></i>
              </div>
              <div class="settings-row-body">
                <div class="settings-row-title">Suporte</div>
                <div class="settings-row-sub">+258 84 892 0143</div>
              </div>
              <i class="fa-solid fa-arrow-up-right-from-square settings-row-right" aria-hidden="true"></i>
            </button>
          </div>

          <!-- Legal -->
          <div class="perfil-group">
            <div class="perfil-group-title notranslate" translate="no">Legal</div>
            <button class="settings-row notranslate" translate="no" id="btn-terms">
              <div class="settings-row-icon" style="background:rgba(139,92,246,0.1);">
                <i class="fa-solid fa-file-lines" style="color:#8B5CF6;" aria-hidden="true"></i>
              </div>
              <div class="settings-row-body">
                <div class="settings-row-title">Termos de Uso</div>
              </div>
              <i class="fa-solid fa-arrow-right settings-row-right" aria-hidden="true"></i>
            </button>
            <button class="settings-row notranslate" translate="no" id="btn-privacy">
              <div class="settings-row-icon" style="background:rgba(20,184,166,0.1);">
                <i class="fa-solid fa-shield-halved" style="color:#14B8A6;" aria-hidden="true"></i>
              </div>
              <div class="settings-row-body">
                <div class="settings-row-title">Política de Privacidade</div>
              </div>
              <i class="fa-solid fa-arrow-right settings-row-right" aria-hidden="true"></i>
            </button>
          </div>

          <!-- Sessão -->
          <div class="perfil-group">
            <div class="perfil-group-title notranslate" translate="no">Sessão</div>
            <button class="settings-row settings-row-warning notranslate" translate="no" id="btn-signout">
              <div class="settings-row-icon">
                <i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i>
              </div>
              <div class="settings-row-body">
                <div class="settings-row-title">Terminar sessão</div>
              </div>
              <i class="fa-solid fa-chevron-right settings-row-right" aria-hidden="true"></i>
            </button>
          </div>

          <div style="height:8px;"></div>
        </div>

      </div>
    `;
  },

  // ── ROOM 3 — INIT ───────────────────────────────────────
  async init(user, userData, params) {
    window.scrollTo(0, 0);

    ui.renderHeader({
      title:          'Perfil',
      showWordmark:   false,
      backRoute:      '/panel/dashboard',
      showDarkToggle: true,
      moedasBalance:  moeda.getBalance(userData),
    });

    // ── Module state reset ─────────────────────────────
    _activeTab  = 'perfil';
    _photoURL   = userData?.photoURL   || '';
    _photoEmoji = userData?.photoEmoji || '';

    // ── Detect auth method ─────────────────────────────
    const isGoogle = user?.providerData?.some(p => p.providerId === 'google.com');

    // ── Hero ───────────────────────────────────────────
    const firstName = (userData?.fullName || '').split(' ')[0] || 'Estudante';
    const lastName  = (userData?.fullName || '').split(' ').slice(-1)[0] || '';
    const initials  = ((firstName[0] || '') + (lastName[0] || '')).toUpperCase() || '?';

    _renderAvatar(_photoURL, _photoEmoji, initials);
    _setEl('pf-hero-name',  userData?.fullName || '—');
    _setEl('pf-hero-email', user?.email || '—');

    // Badge — exam type
    const badgeEl = document.getElementById('pf-hero-badge');
    if (badgeEl) {
      const badgeText = _buildBadgeText(userData);
      badgeEl.innerHTML = `<i class="fa-solid fa-graduation-cap" aria-hidden="true"></i>&nbsp;${badgeText}`;
    }

    // ── Avatar edit ────────────────────────────────────
    document.getElementById('btn-avatar-edit')?.addEventListener('click', () => {
      _openAvatarSheet(user, userData, initials);
    }, { once: true });

    // ── Perfil tab data ────────────────────────────────
    _setEl('pf-name',     userData?.fullName || '—');
    _setEl('pf-email',    user?.email || '—');
    _setEl('pf-whatsapp', userData?.whatsapp || '—');
    _setEl('pf-school',   userData?.school || '—');

    const loc = [userData?.province, userData?.district].filter(Boolean).join(' · ');
    _setEl('pf-location', loc || '—');

    if (userData?.joinedAt) {
      const d = userData.joinedAt.toDate
        ? userData.joinedAt.toDate()
        : new Date(userData.joinedAt);
      _setEl('pf-joined', d.toLocaleDateString('pt-PT', {
        day: 'numeric', month: 'long', year: 'numeric'
      }));
    }

    // Exam info — read only
    _setEl('pf-exam-type', _buildExamTypeLabel(userData));
    const subjects = getStudentSubjects(userData);
    _setEl('pf-subjects', subjects.length ? subjects.join(', ') : '—');

    // Exam dates list
    _renderExamDatesList(subjects, userData?.examDates || {}, user, userData);

    // ── Moedas tab data ────────────────────────────────
    _setEl('pf-balance',     String(moeda.getBalance(userData)));
    _setEl('pf-invite-code', userData?.inviteCode || '——');

    // Password sub-label
    _setEl('pf-pw-sub', isGoogle
      ? 'Conta Google — gerida pelo Google'
      : 'Alterar via email ou directamente');

    // Dark mode label
    _setEl('pf-dark-sub',
      document.documentElement.getAttribute('data-theme') === 'dark'
        ? 'Activado'
        : 'Desactivado'
    );

    // ── Load invite stats async ────────────────────────
    _loadInviteStats(userData);

    // ── Tabs ───────────────────────────────────────────
    document.querySelectorAll('.perfil-tab').forEach(tab => {
      tab.addEventListener('click', () => _switchTab(tab.dataset.tab));
    });

    if (params?.tab) _switchTab(params.tab);

    // ── Wire all buttons ───────────────────────────────
    _wirePerfilTab(user, userData, isGoogle);
    _wireMoedasTab(userData);
    _wireMaisTab(user, isGoogle);
  },

  // ── ROOM 4 — DESTROY ────────────────────────────────────
  destroy() {
    _activeTab  = 'perfil';
    _photoURL   = '';
    _photoEmoji = '';
  },

};

// ============================================================
// PRIVATE HELPERS
// ============================================================

function _setEl(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function _switchTab(tab) {
  _activeTab = tab;
  document.querySelectorAll('.perfil-tab').forEach(t => {
    const active = t.dataset.tab === tab;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', String(active));
  });
  document.getElementById('tab-perfil').style.display  = tab === 'perfil'  ? 'block' : 'none';
  document.getElementById('tab-moedas').style.display  = tab === 'moedas'  ? 'block' : 'none';
  document.getElementById('tab-mais').style.display    = tab === 'mais'    ? 'block' : 'none';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function _buildBadgeText(userData) {
  if (!userData) return 'ExameNova';
  if (userData.examType === 'ensino-geral') {
    const grade  = userData.grade  ? `${userData.grade}ª Classe` : '';
    const status = userData.status === 'repetente' ? ' · Repetente' : '';
    return grade ? `${grade}${status}` : 'Ensino Geral';
  }
  if (userData.examType === 'admissao') {
    if (userData.course)      return 'Admissão · Curso';
    if (userData.institution) return 'Admissão · Instituição';
    return 'Exame de Admissão';
  }
  return 'ExameNova';
}

function _buildExamTypeLabel(userData) {
  if (!userData) return '—';
  if (userData.examType === 'ensino-geral') {
    const parts = ['Ensino Geral'];
    if (userData.grade)  parts.push(`${userData.grade}ª Classe`);
    if (userData.status === 'repetente') parts.push('Repetente');
    if (userData.section && userData.section !== 'all') {
      parts.push(userData.section === 'letras' ? 'Secção de Letras' : 'Secção de Ciências');
    }
    return parts.join(' · ');
  }
  if (userData.examType === 'admissao') {
    if (userData.course)      return `Admissão · Curso · ${userData.course}`;
    if (userData.institution) return `Admissão · ${userData.institution}`;
    return 'Exame de Admissão';
  }
  return '—';
}

function _renderAvatar(photoURL, photoEmoji, initials) {
  const el = document.getElementById('pf-avatar');
  if (!el) return;
  if (photoURL) {
    el.innerHTML = `<img src="${photoURL}" alt="Foto de perfil">`;
  } else if (photoEmoji) {
    el.innerHTML = photoEmoji;
  } else {
    el.textContent = initials;
  }
}

function _renderExamDatesList(subjects, examDates, user, userData) {
  const container = document.getElementById('pf-exam-dates-list');
  if (!container) return;

  if (!subjects.length) {
    container.innerHTML = `
      <div style="padding:16px;text-align:center;">
        <p style="font-size:13px;color:var(--text-muted);">
          Não há disciplinas configuradas no seu perfil.
        </p>
      </div>
    `;
    return;
  }

  container.innerHTML = subjects.map(subject => {
    const date     = examDates[subject] || '';
    const dateLabel = date
      ? new Date(date + 'T00:00:00').toLocaleDateString('pt-PT', {
          day: 'numeric', month: 'long', year: 'numeric'
        })
      : null;

    return `
      <div
        class="perfil-date-row notranslate"
        translate="no"
        data-subject="${subject}"
        role="button"
        tabindex="0"
      >
        <div class="perfil-field-icon" style="background:rgba(2,132,199,0.1);">
          <i class="fa-solid fa-calendar" style="color:#0284C7;" aria-hidden="true"></i>
        </div>
        <div class="perfil-date-subject">${subject}</div>
        ${dateLabel
          ? `<div class="perfil-date-value">${dateLabel}</div>`
          : `<div class="perfil-date-empty">Definir data</div>`
        }
        <i class="fa-solid fa-chevron-right" style="font-size:11px;color:var(--text-muted);margin-left:4px;" aria-hidden="true"></i>
      </div>
    `;
  }).join('');

  // Wire date rows
  container.querySelectorAll('.perfil-date-row').forEach(row => {
    row.addEventListener('click', () => {
      const subject  = row.dataset.subject;
      const current  = userData?.examDates?.[subject] || '';
      _openDateSheet(subject, current, user, userData);
    });
  });
}

async function _loadInviteStats(userData) {
  if (!userData?.inviteCode) return;
  try {
    const snap = await getDocs(query(
      collection(db, 'invites'),
      where('inviterCode', '==', userData.inviteCode)
    ));
    const completed = snap.docs.filter(d => d.data().status === 'completed').length;
    _setEl('pf-stat-invited',   String(snap.size));
    _setEl('pf-stat-completed', String(completed));
  } catch {
    _setEl('pf-stat-invited',   '0');
    _setEl('pf-stat-completed', '0');
  }
}

// ── RE-AUTH GATE ─────────────────────────────────────────────
async function _requireReauth(user, isGoogle, onSuccess) {
  if (isGoogle) {
    ui.openBottomSheet({
      title:   'Confirmar identidade',
      content: `<p style="font-size:14px;color:var(--text-secondary);line-height:1.6;">
        Para editar os seus dados, confirme a sua identidade com a conta Google associada.
      </p>`,
      actions: [
        {
          label: 'Confirmar com Google',
          onClick: async () => {
            try {
              await reauthenticateWithPopup(user, new GoogleAuthProvider());
              ui.closeBottomSheet();
              onSuccess();
            } catch {
              ui.showToast('Não foi possível confirmar a identidade.', 'error');
            }
          }
        },
        { label: 'Cancelar', dismiss: true }
      ]
    });
  } else {
    ui.openBottomSheet({
      title:   'Confirmar identidade',
      content: `
        <p style="font-size:14px;color:var(--text-secondary);line-height:1.6;margin-bottom:14px;">
          Introduza a sua palavra-passe para continuar.
        </p>
        <div class="pf-input-group">
          <input
            class="pf-input"
            type="password"
            id="reauth-pw"
            placeholder="Palavra-passe actual"
            autocomplete="current-password"
          />
        </div>
      `,
      actions: [
        {
          label: 'Confirmar',
          onClick: async () => {
            const pw = document.getElementById('reauth-pw')?.value || '';
            if (!pw) { ui.showToast('Introduza a sua palavra-passe.', 'warning'); return; }
            try {
              await reauthenticateWithCredential(
                user,
                EmailAuthProvider.credential(user.email, pw)
              );
              ui.closeBottomSheet();
              onSuccess();
            } catch {
              ui.showToast('Palavra-passe incorrecta. Tente novamente.', 'error');
            }
          }
        },
        { label: 'Cancelar', dismiss: true }
      ]
    });
  }
}

// ── WIRE PERFIL TAB ──────────────────────────────────────────
function _wirePerfilTab(user, userData, isGoogle) {

  // Name — no reauth required
  document.getElementById('btn-edit-name')?.addEventListener('click', () => {
    ui.openBottomSheet({
      title: 'Editar nome',
      content: `
        <div class="pf-input-group">
          <label class="pf-input-label">Nome completo</label>
          <input class="pf-input" type="text" id="edit-name-input"
            value="${userData?.fullName || ''}"
            placeholder="Nome completo"
            autocomplete="name"
          />
        </div>
      `,
      actions: [
        {
          label: 'Guardar',
          onClick: async () => {
            const val = document.getElementById('edit-name-input')?.value.trim() || '';
            if (val.split(' ').filter(Boolean).length < 2) {
              ui.showToast('Introduza o nome e apelido.', 'warning'); return;
            }
            try {
              await updateDoc(doc(db, 'users', user.uid), { fullName: val });
              userData.fullName = val;
              _setEl('pf-name', val);
              _setEl('pf-hero-name', val);
              ui.closeBottomSheet();
              ui.showToast('Nome actualizado com sucesso.', 'success');
            } catch {
              ui.showToast('Erro ao guardar. Tente novamente.', 'error');
            }
          }
        },
        { label: 'Cancelar', dismiss: true }
      ]
    });
  });

  // WhatsApp — reauth required
  document.getElementById('btn-edit-wa')?.addEventListener('click', () => {
    _requireReauth(user, isGoogle, () => {
      ui.openBottomSheet({
        title: 'Editar WhatsApp',
        content: `
          <div class="pf-input-group">
            <label class="pf-input-label">Número de WhatsApp</label>
            <div class="pf-phone-row">
              <div class="pf-phone-prefix notranslate" translate="no">🇲🇿 +258</div>
              <input
                class="pf-input"
                type="tel"
                id="edit-wa-input"
                placeholder="84 000 0000"
                inputmode="tel"
                maxlength="12"
                autocomplete="tel"
                value="${(userData?.whatsapp || '').replace(/^\+258/, '').trim()}"
              />
            </div>
          </div>
        `,
        actions: [
          {
            label: 'Guardar',
            onClick: async () => {
              const raw = document.getElementById('edit-wa-input')?.value.replace(/\D/g, '') || '';
              if (raw.length < 8) {
                ui.showToast('Introduza um número válido.', 'warning'); return;
              }
              const full = `+258${raw}`;
              // Check if already used by another student
              try {
                const snap = await getDocs(query(
                  collection(db, 'users'),
                  where('whatsapp', '==', full)
                ));
                if (snap.docs.some(d => d.id !== user.uid)) {
                  ui.showToast('Este número já está registado noutra conta.', 'error');
                  return;
                }
                await updateDoc(doc(db, 'users', user.uid), { whatsapp: full });
                userData.whatsapp = full;
                _setEl('pf-whatsapp', full);
                ui.closeBottomSheet();
                ui.showToast('WhatsApp actualizado com sucesso.', 'success');
              } catch {
                ui.showToast('Erro ao guardar. Tente novamente.', 'error');
              }
            }
          },
          { label: 'Cancelar', dismiss: true }
        ]
      });
    });
  });

  // Location — reauth required
  document.getElementById('btn-edit-location')?.addEventListener('click', () => {
    _requireReauth(user, isGoogle, () => {
      const provinces = getProvinces();
      ui.openBottomSheet({
        title: 'Editar localização',
        content: `
          <div class="pf-input-group">
            <label class="pf-input-label">Província</label>
            <select class="pf-select" id="edit-prov">
              <option value="">Seleccione a província...</option>
              ${provinces.map(p => `
                <option value="${p}" ${userData?.province === p ? 'selected' : ''}>${p}</option>
              `).join('')}
            </select>
          </div>
          <div class="pf-input-group">
            <label class="pf-input-label">Distrito</label>
            <select class="pf-select" id="edit-dist" ${!userData?.province ? 'disabled' : ''}>
              <option value="">Seleccione o distrito...</option>
              ${getDistrictsByProvince(userData?.province || '').map(d => `
                <option value="${d}" ${userData?.district === d ? 'selected' : ''}>${d}</option>
              `).join('')}
            </select>
          </div>
        `,
        actions: [
          {
            label: 'Guardar',
            onClick: async () => {
              const prov = document.getElementById('edit-prov')?.value || '';
              const dist = document.getElementById('edit-dist')?.value || '';
              if (!prov || !dist) {
                ui.showToast('Seleccione a província e o distrito.', 'warning'); return;
              }
              try {
                await updateDoc(doc(db, 'users', user.uid), { province: prov, district: dist });
                userData.province = prov;
                userData.district = dist;
                _setEl('pf-location', `${prov} · ${dist}`);
                ui.closeBottomSheet();
                ui.showToast('Localização actualizada com sucesso.', 'success');
              } catch {
                ui.showToast('Erro ao guardar. Tente novamente.', 'error');
              }
            }
          },
          { label: 'Cancelar', dismiss: true }
        ]
      });

      // Province cascade
      setTimeout(() => {
        const provSel = document.getElementById('edit-prov');
        const distSel = document.getElementById('edit-dist');
        if (!provSel || !distSel) return;
        provSel.addEventListener('change', () => {
          const districts = getDistrictsByProvince(provSel.value);
          distSel.disabled = !districts.length;
          distSel.innerHTML = `
            <option value="">Seleccione o distrito...</option>
            ${districts.map(d => `<option value="${d}">${d}</option>`).join('')}
          `;
        });
      }, 100);
    });
  });

  // School — reauth required
  document.getElementById('btn-edit-school')?.addEventListener('click', () => {
    _requireReauth(user, isGoogle, () => {
      ui.openBottomSheet({
        title: 'Editar escola',
        content: `
          <div class="pf-input-group">
            <label class="pf-input-label">Nome da escola</label>
            <input
              class="pf-input"
              type="text"
              id="edit-school-input"
              value="${userData?.school || ''}"
              placeholder="Escola Secundária de..."
              autocomplete="organization"
            />
          </div>
        `,
        actions: [
          {
            label: 'Guardar',
            onClick: async () => {
              const val = document.getElementById('edit-school-input')?.value.trim() || '';
              if (!val) { ui.showToast('Introduza o nome da escola.', 'warning'); return; }
              try {
                await updateDoc(doc(db, 'users', user.uid), { school: val });
                userData.school = val;
                _setEl('pf-school', val);
                ui.closeBottomSheet();
                ui.showToast('Escola actualizada com sucesso.', 'success');
              } catch {
                ui.showToast('Erro ao guardar. Tente novamente.', 'error');
              }
            }
          },
          { label: 'Cancelar', dismiss: true }
        ]
      });
    });
  });

  // Contact admin
  document.getElementById('btn-contact-admin')?.addEventListener('click', () => {
    const msg = encodeURIComponent(
      `Olá, preciso de alterar os dados do meu exame na plataforma ExameNova.\n\nEmail: ${user?.email || '—'}`
    );
    window.open(`https://wa.me/258848920143?text=${msg}`, '_blank');
  });
}

// ── EXAM DATE SHEET ──────────────────────────────────────────
function _openDateSheet(subject, currentDate, user, userData) {
  ui.openBottomSheet({
    title:   `Data do exame — ${subject}`,
    content: `
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:14px;line-height:1.6;">
        Defina a data do exame de <strong>${subject}</strong>.
        O Meu Exame será desbloqueado 2 a 4 dias antes desta data.
      </p>
      <div class="pf-input-group">
        <label class="pf-input-label">Data do exame</label>
        <input
          class="pf-input"
          type="date"
          id="date-input"
          value="${currentDate}"
          min="${new Date().toLocaleDateString('sv-SE')}"
        />
      </div>
    `,
    actions: [
      {
        label: 'Guardar',
        onClick: async () => {
          const val = document.getElementById('date-input')?.value || '';
          if (!val) { ui.showToast('Seleccione uma data.', 'warning'); return; }
          try {
            const newDates = { ...(userData?.examDates || {}), [subject]: val };
            await updateDoc(doc(db, 'users', user.uid), { examDates: newDates });
            if (!userData.examDates) userData.examDates = {};
            userData.examDates[subject] = val;
            // Re-render date list
            const subjects = getStudentSubjects(userData);
            _renderExamDatesList(subjects, userData.examDates, user, userData);
            ui.closeBottomSheet();
            ui.showToast('Data guardada com sucesso.', 'success');
          } catch {
            ui.showToast('Erro ao guardar. Tente novamente.', 'error');
          }
        }
      },
      ...(currentDate ? [{
        label: 'Remover data',
        danger: true,
        onClick: async () => {
          try {
            const newDates = { ...(userData?.examDates || {}) };
            delete newDates[subject];
            await updateDoc(doc(db, 'users', user.uid), { examDates: newDates });
            userData.examDates = newDates;
            const subjects = getStudentSubjects(userData);
            _renderExamDatesList(subjects, userData.examDates, user, userData);
            ui.closeBottomSheet();
            ui.showToast('Data removida.', 'info');
          } catch {
            ui.showToast('Erro ao remover. Tente novamente.', 'error');
          }
        }
      }] : []),
      { label: 'Cancelar', dismiss: true }
    ]
  });
}

// ── WIRE MOEDAS TAB ──────────────────────────────────────────
function _wireMoedasTab(userData) {
  const code = userData?.inviteCode || '';
  const link = `https://examenova.dovelingua.com/panel/auth?code=${code}`;

  document.getElementById('btn-share-wa')?.addEventListener('click', () => {
    const msg = encodeURIComponent(
      `Olá! 👋\n\nEstou a usar o *ExameNova* para me preparar para o exame. É incrível!\n\nUse o meu código de convite *${code}* e ganha *${moeda.AWARDS.INVITED} Moedas* de bónus ao registar-se. 🎉\n\n👉 ${link}`
    );
    window.open(`https://wa.me/?text=${msg}`, '_blank');
  });

  document.getElementById('btn-share-copy')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(
        `Use o meu código ${code} no ExameNova e ganha ${moeda.AWARDS.INVITED} Moedas de bónus!\n${link}`
      );
      ui.showToast('Copiado para a área de transferência.', 'success');
    } catch {
      ui.showToast('Não foi possível copiar.', 'error');
    }
  });
}

// ── WIRE MAIS TAB ────────────────────────────────────────────
function _wireMaisTab(user, isGoogle) {

  // Change password
  document.getElementById('btn-change-password')?.addEventListener('click', () => {
    if (isGoogle) {
      ui.openBottomSheet({
        title:   'Palavra-passe Google',
        content: `<p style="font-size:14px;color:var(--text-secondary);line-height:1.6;">
          A sua conta usa o Google para autenticação.
          Para alterar a palavra-passe, aceda às definições da sua conta Google.
        </p>`,
        actions: [
          {
            label: 'Ir para conta Google',
            onClick: () => {
              window.open('https://myaccount.google.com/security', '_blank');
              ui.closeBottomSheet();
            }
          },
          { label: 'Fechar', dismiss: true }
        ]
      });
    } else {
      _requireReauth(user, false, () => {
        ui.openBottomSheet({
          title: 'Alterar palavra-passe',
          content: `
            <div class="pf-input-group">
              <label class="pf-input-label">Nova palavra-passe</label>
              <input
                class="pf-input"
                type="password"
                id="new-pw-input"
                placeholder="Mínimo 6 caracteres"
                autocomplete="new-password"
              />
            </div>
            <div class="pf-input-group">
              <label class="pf-input-label">Confirmar nova palavra-passe</label>
              <input
                class="pf-input"
                type="password"
                id="confirm-pw-input"
                placeholder="Repita a nova palavra-passe"
                autocomplete="new-password"
              />
            </div>
          `,
          actions: [
            {
              label: 'Guardar',
              onClick: async () => {
                const newPw     = document.getElementById('new-pw-input')?.value     || '';
                const confirmPw = document.getElementById('confirm-pw-input')?.value || '';
                if (newPw.length < 6) {
                  ui.showToast('A palavra-passe deve ter pelo menos 6 caracteres.', 'warning'); return;
                }
                if (newPw !== confirmPw) {
                  ui.showToast('As palavras-passe não coincidem.', 'error'); return;
                }
                try {
                  await updatePassword(user, newPw);
                  ui.closeBottomSheet();
                  ui.showToast('Palavra-passe actualizada com sucesso.', 'success');
                } catch {
                  ui.showToast('Erro ao actualizar. Tente novamente.', 'error');
                }
              }
            },
            { label: 'Cancelar', dismiss: true }
          ]
        });
      });
    }
  });

  // Dark mode
  document.getElementById('btn-dark-toggle')?.addEventListener('click', () => {
    ui.toggleDarkMode();
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    _setEl('pf-dark-sub', isDark ? 'Activado' : 'Desactivado');
  });

  // Support
  document.getElementById('btn-support')?.addEventListener('click', () => {
    const msg = encodeURIComponent('Olá, preciso de ajuda com a minha conta ExameNova.');
    window.open(`https://wa.me/258848920143?text=${msg}`, '_blank');
  });

  // Terms
  document.getElementById('btn-terms')?.addEventListener('click', () => {
    router.navigate('termos');
  });

  // Privacy
  document.getElementById('btn-privacy')?.addEventListener('click', () => {
    router.navigate('termos');
  });

  // Sign out
  document.getElementById('btn-signout')?.addEventListener('click', () => {
    ui.openBottomSheet({
      title:   'Terminar sessão',
      content: `<p style="font-size:14px;color:var(--text-secondary);line-height:1.6;">
        Tem a certeza que pretende terminar a sessão?
      </p>`,
      actions: [
        {
          label: 'Terminar sessão',
          danger: true,
          onClick: async () => {
            try {
              await signOut(auth);
              ui.closeBottomSheet();
              router.navigate('auth');
            } catch {
              ui.showToast('Erro ao terminar sessão. Tente novamente.', 'error');
            }
          }
        },
        { label: 'Cancelar', dismiss: true }
      ]
    });
  });
}

// ── AVATAR SHEET ─────────────────────────────────────────────
function _openAvatarSheet(user, userData, initials) {
  let _currentTab = 'emoji';

  const _buildContent = (tab) => `
    <div class="pf-avatar-tabs">
      <button class="pf-avatar-tab notranslate ${tab === 'emoji' ? 'active' : ''}" id="atab-emoji">
        <i class="fa-solid fa-face-smile" aria-hidden="true"></i>&nbsp;Emoji
      </button>
      <button class="pf-avatar-tab notranslate ${tab === 'foto' ? 'active' : ''}" id="atab-foto">
        <i class="fa-solid fa-image" aria-hidden="true"></i>&nbsp;Fotografia
      </button>
    </div>
    ${tab === 'emoji' ? `
      <div class="pf-emoji-grid" id="pf-emoji-grid">
        ${EMOJI_LIST.map(e => `
          <button
            class="pf-emoji-btn notranslate ${(_photoEmoji === e) ? 'selected' : ''}"
            data-emoji="${e}"
          >${e}</button>
        `).join('')}
      </div>
    ` : `
      <div class="pf-upload-area" id="pf-upload-area">
        <div class="pf-upload-icon"><i class="fa-solid fa-cloud-arrow-up" aria-hidden="true"></i></div>
        <div class="pf-upload-label notranslate" translate="no">Toque para escolher uma foto</div>
        <div class="pf-upload-sub notranslate" translate="no">JPG, PNG ou WEBP · Máx. 10 MB</div>
        <input type="file" id="pf-file-input" accept="image/*" style="display:none;">
      </div>
    `}
  `;

  ui.openBottomSheet({
    title:   'Alterar foto de perfil',
    content: _buildContent('emoji'),
    actions: [],
  });

  setTimeout(() => {
    const _wire = () => {
      // Tab switching
      document.getElementById('atab-emoji')?.addEventListener('click', () => {
        _currentTab = 'emoji';
        const sc = document.querySelector('.sheet-content');
        if (sc) { sc.innerHTML = _buildContent('emoji'); _wire(); }
      });
      document.getElementById('atab-foto')?.addEventListener('click', () => {
        _currentTab = 'foto';
        const sc = document.querySelector('.sheet-content');
        if (sc) { sc.innerHTML = _buildContent('foto'); _wire(); }
      });

      // Emoji selection
      document.getElementById('pf-emoji-grid')?.querySelectorAll('.pf-emoji-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const emoji = btn.dataset.emoji;
          try {
            await updateDoc(doc(db, 'users', user.uid), { photoURL: '', photoEmoji: emoji });
            userData.photoURL   = '';
            userData.photoEmoji = emoji;
            _photoURL   = '';
            _photoEmoji = emoji;
            _renderAvatar('', emoji, initials);
            ui.closeBottomSheet();
            ui.showToast('Foto de perfil actualizada.', 'success');
          } catch {
            ui.showToast('Erro ao guardar. Tente novamente.', 'error');
          }
        });
      });

      // Photo upload
      const area  = document.getElementById('pf-upload-area');
      const input = document.getElementById('pf-file-input');
      if (area && input) {
        area.addEventListener('click', () => input.click());
        input.addEventListener('change', async () => {
          const file = input.files?.[0];
          if (!file) return;
          if (!file.type.startsWith('image/')) {
            ui.showToast('Ficheiro inválido. Escolha uma imagem.', 'error'); return;
          }
          if (file.size > 10 * 1024 * 1024) {
            ui.showToast('A imagem não pode ultrapassar 10 MB.', 'error'); return;
          }
          ui.showSpinner();
          try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('upload_preset', CLOUDINARY_PRESET);
            formData.append('public_id', user.uid);
            const res  = await fetch(
              `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`,
              { method: 'POST', body: formData }
            );
            const data = await res.json();
            if (!data.secure_url) throw new Error('Upload failed');
            const url = data.secure_url;
            await updateDoc(doc(db, 'users', user.uid), { photoURL: url, photoEmoji: '' });
            userData.photoURL   = url;
            userData.photoEmoji = '';
            _photoURL   = url;
            _photoEmoji = '';
            _renderAvatar(url, '', initials);
            ui.hideSpinner();
            ui.closeBottomSheet();
            ui.showToast('Foto de perfil actualizada.', 'success');
          } catch {
            ui.hideSpinner();
            ui.showToast('Erro ao carregar a imagem. Tente novamente.', 'error');
          }
        });
      }
    };

    _wire();
  }, 100);
}

export default PerfilScreen;
