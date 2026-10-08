// ============================================================
// panel/js/screens/bate-papo/bate-papo.js
// ExameNova — Bate-papo (Group Chat)
// Real-time peer study chat — filtered by student groupId
// No navbar — back button only
// keepAlive: false
// ============================================================

import { auth, db, chatDb, chatAuth } from '../../core/firebase.js';
import { router }            from '../../core/router.js';
import { ui }                from '../../core/ui.js';
import { moeda }             from '../../core/moeda.js';
import { worker }            from '../../core/worker.js';

import {
  collection,
  query,
  orderBy,
  limit,
  startAfter,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp,
  Timestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ============================================================
// CONSTANTS
// ============================================================

const CLOUDINARY_CLOUD  = 'c1twcxrq';
const CLOUDINARY_PRESET = 'ExameNova_Bate_Papo_Chat';
const MESSAGES_PER_PAGE = 50;
const REACTIONS_CACHE_KEY = id => `en_bp_reactions_${id}`;
const GROUP_CACHE_KEY     = id => `en_bp_group_${id}`;
const SUSPENSION_1H_MS    = 60 * 60 * 1000;
const RECENT_EMOJI_KEY    = 'en_bp_recent_emojis';

const QUICK_REACTIONS = ['👍','❤️','😂','😮','😢','🙏','🔥','💪'];

const ALL_EMOJIS = [
  '😊','😄','😂','🤣','😅','😆','😍','🥰','😘','😎',
  '😭','😞','😔','😟','🥺','😢','😤','😠','🤔','🤭',
  '😮','😲','🤩','🥳','😴','🤯','🙄','😏','😇','🥹',
  '👍','👎','👏','🙌','🤝','🙏','💪','✌️','🤞','👀',
  '❤️','🧡','💛','💚','💙','💜','🖤','💔','💕','🔥',
  '✅','❌','⭐','🌟','💡','📚','✏️','📝','🎯','🎓',
  '😁','😀','🥲','😋','😛','😜','🤪','😬','🤐','🫡',
  '🫠','🤫','🫢','😶','😑','😒','🙃','🤑','😵','🫥',
];

const DEFAULT_RECENT_EMOJIS = ['😊','👍','🔥','😭','🙏'];

// ============================================================
// MODULE STATE
// ============================================================
let _user           = null;
let _userData       = null;
let _groupId        = null;
let _groupData      = null;
let _isModerator    = false;
let _isAdmin        = false;
let _messages       = [];
let _lastDoc        = null;
let _loadingMore    = false;
let _suspended      = false;
let _suspendedUntil = null;
let _unsubMessages  = null;
let _unsubGroup     = null;
let _reactions      = {};
let _suspendTimer   = null;
let _replyToMsg     = null;
let _attachedImage  = null;
let _recentEmojis   = [...DEFAULT_RECENT_EMOJIS];

// ============================================================
// SCREEN
// ============================================================

const BatePapoScreen = {

  css() {
    if (document.getElementById('bp-styles')) return '';
    return `<style id="bp-styles">

      /* ══════════════════════════════════
         ROOT — occupies full viewport
      ══════════════════════════════════ */
      .bp-root {
        display: flex;
        flex-direction: column;
        height: 100dvh;
        height: 100vh;
        max-height: 100dvh;
        max-height: 100vh;
        width: 100%;
        overflow: hidden;
        background: var(--bg, #F5F7FA);
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
      }

      /* ══════════════════════════════════
         HEADER
      ══════════════════════════════════ */
      .bp-header {
        flex-shrink: 0;
        background: linear-gradient(135deg, #0369A1 0%, #0284C7 100%);
        box-shadow: 0 2px 12px rgba(2,132,199,0.35);
        z-index: 100;
      }

      .bp-header-main {
        height: 58px;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 12px;
      }

      .bp-hdr-btn {
        width: 36px;
        height: 36px;
        border-radius: 10px;
        background: rgba(255,255,255,0.15);
        border: 1px solid rgba(255,255,255,0.2);
        color: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font-size: 15px;
        flex-shrink: 0;
        transition: background 0.2s;
      }
      .bp-hdr-btn:hover  { background: rgba(255,255,255,0.25); }
      .bp-hdr-btn:active { transform: scale(0.94); }

      .bp-hdr-avatar {
        width: 34px;
        height: 34px;
        border-radius: 50%;
        background: rgba(255,255,255,0.2);
        border: 2px solid rgba(255,255,255,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        flex-shrink: 0;
      }

      .bp-hdr-info { flex: 1; min-width: 0; }

      .bp-hdr-title {
        font-size: 15px;
        font-weight: 700;
        color: #fff;
        line-height: 1.2;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .bp-hdr-sub {
        font-size: 11px;
        color: rgba(255,255,255,0.7);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* group bar */
      .bp-group-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 5px 14px 7px;
        border-top: 1px solid rgba(255,255,255,0.1);
      }

      .bp-group-label {
        flex: 1;
        font-size: 11px;
        font-weight: 600;
        color: rgba(255,255,255,0.8);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .bp-online-row {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
      }

      .bp-online-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #22C55E;
        animation: bpPulse 2s ease-in-out infinite;
      }

      @keyframes bpPulse {
        0%,100% { opacity: 1; }
        50%      { opacity: 0.35; }
      }

      .bp-online-label {
        font-size: 11px;
        color: #22C55E;
        font-weight: 600;
      }

      /* ── PINNED ── */
      .bp-pinned {
        display: none;
        flex-shrink: 0;
        background: rgba(2,132,199,0.07);
        border-bottom: 1px solid rgba(2,132,199,0.14);
        padding: 7px 14px;
        gap: 10px;
        align-items: center;
        cursor: pointer;
      }
      .bp-pinned.show { display: flex; }
      .bp-pinned-icon { color: #0284C7; font-size: 12px; flex-shrink: 0; }
      .bp-pinned-body { flex: 1; min-width: 0; }
      .bp-pinned-label {
        font-size: 10px;
        font-weight: 700;
        color: #0284C7;
        letter-spacing: 0.06em;
        margin-bottom: 1px;
      }
      .bp-pinned-text {
        font-size: 12px;
        color: var(--text-secondary, #555);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* ── TOPIC ── */
      .bp-topic {
        display: none;
        flex-shrink: 0;
        background: rgba(139,92,246,0.06);
        border-bottom: 1px solid rgba(139,92,246,0.12);
        padding: 6px 14px;
        align-items: center;
        gap: 8px;
      }
      .bp-topic.show { display: flex; }
      .bp-topic-icon { color: #8B5CF6; font-size: 12px; flex-shrink: 0; }
      .bp-topic-text {
        font-size: 12px;
        color: var(--text-secondary, #555);
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* ── LOCKED ── */
      .bp-locked-banner {
        display: none;
        flex-shrink: 0;
        background: rgba(239,68,68,0.06);
        border-bottom: 1px solid rgba(239,68,68,0.14);
        padding: 7px 14px;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }
      .bp-locked-banner.show { display: flex; }
      .bp-locked-text { font-size: 12px; font-weight: 600; color: #EF4444; }

      /* ══════════════════════════════════
         MESSAGES — only this scrolls
      ══════════════════════════════════ */
      .bp-messages {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        -webkit-overflow-scrolling: touch;
        padding: 12px 12px 6px;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .bp-load-more {
        text-align: center;
        padding: 8px 0 12px;
        font-size: 12px;
        font-weight: 600;
        color: #0284C7;
        cursor: pointer;
        opacity: 0.8;
      }
      .bp-load-more:hover { opacity: 1; }

      /* Date separator */
      .bp-date-sep {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 0 6px;
        font-size: 11px;
        font-weight: 600;
        color: var(--text-muted, #9CA3AF);
      }
      .bp-date-sep::before,
      .bp-date-sep::after {
        content: '';
        flex: 1;
        height: 1px;
        background: var(--border, #E5E7EB);
      }

      /* ── MESSAGE ROW ── */
      .bp-msg-row {
        display: flex;
        gap: 8px;
        margin-bottom: 2px;
        animation: bpPop 0.22s cubic-bezier(0.4,0,0.2,1) both;
      }
      @keyframes bpPop {
        from { opacity: 0; transform: translateY(8px) scale(0.97); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }

      .bp-msg-row.own  { flex-direction: row-reverse; }
      .bp-msg-row.cont { padding-left: 36px; }
      .bp-msg-row.own.cont { padding-left: 0; padding-right: 36px; }

      /* Avatar */
      .bp-msg-av {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: rgba(2,132,199,0.12);
        border: 1.5px solid rgba(2,132,199,0.2);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: 700;
        color: #0284C7;
        flex-shrink: 0;
        align-self: flex-end;
        cursor: pointer;
        overflow: hidden;
        transition: transform 0.15s;
      }
      .bp-msg-av:active { transform: scale(0.9); }
      .bp-msg-av img { width: 100%; height: 100%; object-fit: cover; }

      .bp-msg-bubble { max-width: 74%; }

      .bp-msg-sender {
        font-size: 11px;
        font-weight: 700;
        color: #0284C7;
        margin-bottom: 2px;
        display: flex;
        align-items: center;
        gap: 5px;
      }

      .bp-mod-badge {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        background: rgba(139,92,246,0.1);
        color: #8B5CF6;
        border-radius: 4px;
        padding: 1px 5px;
        font-size: 9px;
        font-weight: 700;
      }

      /* Other bubble */
      .bp-msg-content {
        background: #fff;
        border: 1px solid rgba(0,0,0,0.06);
        border-top-left-radius: 4px;
        border-radius: 0 14px 14px 14px;
        padding: 9px 12px;
        font-size: 14px;
        line-height: 1.55;
        color: var(--text, #1a1a1a);
        word-break: break-word;
        white-space: pre-wrap;
        box-shadow: 0 1px 3px rgba(0,0,0,0.06);
        cursor: pointer;
        user-select: text;
      }
      [data-theme="dark"] .bp-msg-content {
        background: #1E293B;
        border-color: rgba(255,255,255,0.06);
        color: #F1F5F9;
      }

      /* Own bubble */
      .bp-msg-row.own .bp-msg-content {
        background: #0284C7;
        color: #fff;
        border-color: transparent;
        border-top-left-radius: 14px;
        border-top-right-radius: 4px;
        border-radius: 14px 4px 14px 14px;
        box-shadow: 0 2px 8px rgba(2,132,199,0.3);
      }

      /* Deleted */
      .bp-msg-content.deleted {
        background: var(--bg, #F5F7FA) !important;
        border: 1px dashed var(--border, #E5E7EB) !important;
        color: var(--text-muted, #9CA3AF) !important;
        font-style: italic;
        font-size: 13px;
        box-shadow: none !important;
        cursor: default;
      }

      /* Reply quote */
      .bp-reply-quote {
        background: rgba(2,132,199,0.08);
        border-left: 3px solid #0284C7;
        border-radius: 6px;
        padding: 5px 9px;
        margin-bottom: 6px;
        font-size: 12px;
        color: var(--text-secondary, #555);
        line-height: 1.4;
      }
      .bp-reply-quote-name {
        font-weight: 700;
        color: #0284C7;
        margin-bottom: 1px;
        font-size: 11px;
      }
      .bp-reply-quote-text {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .bp-msg-row.own .bp-reply-quote {
        background: rgba(255,255,255,0.15);
        border-color: rgba(255,255,255,0.5);
        color: rgba(255,255,255,0.8);
      }
      .bp-msg-row.own .bp-reply-quote-name { color: rgba(255,255,255,0.9); }

      /* Image */
      .bp-msg-image {
        max-width: 220px;
        max-height: 220px;
        border-radius: 10px;
        object-fit: cover;
        display: block;
        cursor: zoom-in;
        margin-bottom: 4px;
      }

      /* Time + sent tick */
      .bp-msg-meta {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-top: 3px;
        padding: 0 3px;
      }
      .bp-msg-row.own .bp-msg-meta { justify-content: flex-end; }

      .bp-msg-time {
        font-size: 10px;
        color: var(--text-muted, #9CA3AF);
      }

      .bp-sent-tick {
        display: none;
        font-size: 10px;
        color: #22C55E;
      }
      .bp-msg-row.own .bp-sent-tick { display: inline-flex; align-items: center; }

      /* Reactions */
      .bp-reactions {
        display: flex;
        flex-wrap: wrap;
        gap: 3px;
        margin-top: 3px;
        padding: 0 3px;
      }
      .bp-msg-row.own .bp-reactions { justify-content: flex-end; }

      .bp-reaction-pill {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        background: #fff;
        border: 1px solid rgba(0,0,0,0.08);
        border-radius: 999px;
        padding: 2px 7px;
        font-size: 13px;
        cursor: pointer;
        transition: all 0.15s;
        user-select: none;
        min-height: 24px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
      }
      [data-theme="dark"] .bp-reaction-pill {
        background: #1E293B;
        border-color: rgba(255,255,255,0.08);
      }
      .bp-reaction-pill:active { transform: scale(0.9); }
      .bp-reaction-pill.own-reacted {
        background: rgba(2,132,199,0.1);
        border-color: #0284C7;
      }
      .bp-reaction-count {
        font-size: 11px;
        font-weight: 700;
        color: var(--text-muted, #9CA3AF);
      }
      .bp-reaction-pill.own-reacted .bp-reaction-count { color: #0284C7; }

      /* Scroll to bottom */
      .bp-scroll-btn {
        position: absolute;
        bottom: 90px;
        right: 14px;
        width: 38px;
        height: 38px;
        border-radius: 50%;
        background: #fff;
        border: 1px solid rgba(0,0,0,0.08);
        box-shadow: 0 4px 14px rgba(0,0,0,0.12);
        display: none;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font-size: 15px;
        color: #0284C7;
        z-index: 50;
        transition: all 0.2s;
      }
      [data-theme="dark"] .bp-scroll-btn {
        background: #1E293B;
        border-color: rgba(255,255,255,0.08);
      }
      .bp-scroll-btn.show { display: flex; }
      .bp-scroll-btn:hover { background: #0284C7; color: #fff; }

      .bp-unread-badge {
        position: absolute;
        top: -4px; right: -4px;
        width: 18px; height: 18px;
        border-radius: 50%;
        background: #EF4444;
        color: #fff;
        font-size: 9px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      /* ── REPLY PREVIEW BAR ── */
      .bp-reply-preview {
        display: none;
        flex-shrink: 0;
        background: #fff;
        border-top: 1px solid rgba(0,0,0,0.06);
        border-left: 3px solid #0284C7;
        padding: 7px 12px;
        gap: 10px;
        align-items: center;
      }
      [data-theme="dark"] .bp-reply-preview {
        background: #1E293B;
        border-top-color: rgba(255,255,255,0.06);
      }
      .bp-reply-preview.show { display: flex; }
      .bp-reply-preview-body { flex: 1; min-width: 0; }
      .bp-reply-preview-name {
        font-size: 11px;
        font-weight: 700;
        color: #0284C7;
        margin-bottom: 2px;
      }
      .bp-reply-preview-text {
        font-size: 12px;
        color: var(--text-muted, #9CA3AF);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .bp-reply-cancel {
        width: 26px; height: 26px;
        border-radius: 50%;
        background: none; border: none;
        cursor: pointer;
        color: var(--text-muted, #9CA3AF);
        display: flex; align-items: center; justify-content: center;
        font-size: 13px; flex-shrink: 0;
        transition: color 0.2s;
      }
      .bp-reply-cancel:hover { color: #EF4444; }

      /* ── SUSPENDED BANNER ── */
      .bp-suspended-banner {
        display: none;
        flex-shrink: 0;
        background: rgba(239,68,68,0.06);
        border-top: 1px solid rgba(239,68,68,0.14);
        padding: 9px 14px;
        text-align: center;
        font-size: 12px;
        font-weight: 600;
        color: #EF4444;
        line-height: 1.5;
      }
      .bp-suspended-banner.show { display: block; }

      /* ══════════════════════════════════
         INPUT AREA — fixed at bottom
      ══════════════════════════════════ */
      .bp-input-area {
        flex-shrink: 0;
        background: #fff;
        border-top: 1px solid rgba(0,0,0,0.07);
        padding: 8px 12px;
        padding-bottom: max(10px, env(safe-area-inset-bottom, 0px));
      }
      [data-theme="dark"] .bp-input-area {
        background: #1E293B;
        border-top-color: rgba(255,255,255,0.06);
      }

      /* Extra pills row */
      .bp-extra-row {
        display: flex;
        gap: 6px;
        margin-bottom: 7px;
        overflow-x: auto;
        overflow-y: hidden;
        scrollbar-width: none;
        white-space: nowrap;
        -webkit-overflow-scrolling: touch;
        transition: max-height 0.28s ease, opacity 0.2s, margin 0.28s;
        max-height: 40px;
        opacity: 1;
      }
      .bp-extra-row::-webkit-scrollbar { display: none; }
      .bp-extra-row.hidden {
        max-height: 0;
        opacity: 0;
        margin-bottom: 0;
        pointer-events: none;
        overflow: hidden;
      }

      .bp-ex-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        flex-shrink: 0;
        padding: 5px 13px;
        border-radius: 20px;
        font-family: inherit;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        border: 1.5px solid rgba(0,0,0,0.1);
        background: #fff;
        color: var(--text-muted, #9CA3AF);
        transition: all 0.2s;
        white-space: nowrap;
      }
      [data-theme="dark"] .bp-ex-btn {
        background: #1E293B;
        border-color: rgba(255,255,255,0.1);
        color: #94A3B8;
      }
      .bp-ex-btn:hover { border-color: #0284C7; color: #0284C7; }
      .bp-ex-btn:active { transform: scale(0.96); }
      .bp-ex-btn.wa {
        border-color: rgba(34,197,94,0.4);
        color: #16A34A;
      }
      .bp-ex-btn.wa:hover { background: #F0FDF4; border-color: #16A34A; }
      .bp-ex-btn.danger {
        border-color: rgba(239,68,68,0.35);
        color: #EF4444;
      }
      .bp-ex-btn.danger:hover { background: #FEF2F2; border-color: #EF4444; }

      /* Emoji quick row */
      .bp-emoji-quick-row {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-bottom: 6px;
        transition: max-height 0.25s, opacity 0.2s, margin 0.25s;
        max-height: 36px;
        opacity: 1;
        overflow: hidden;
      }
      .bp-emoji-quick-row.hidden {
        max-height: 0;
        opacity: 0;
        margin-bottom: 0;
        pointer-events: none;
      }

      .bp-eq-emoji {
        font-size: 20px;
        cursor: pointer;
        padding: 2px 5px;
        border-radius: 8px;
        transition: background 0.15s;
        line-height: 1;
        user-select: none;
      }
      .bp-eq-emoji:hover { background: rgba(0,0,0,0.06); }
      .bp-eq-emoji:active { transform: scale(0.85); }

      .bp-eq-more {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 10px;
        border-radius: 14px;
        border: 1.5px solid rgba(0,0,0,0.1);
        background: #fff;
        font-size: 11px;
        font-weight: 700;
        color: var(--text-muted, #9CA3AF);
        cursor: pointer;
        transition: all 0.2s;
        white-space: nowrap;
        user-select: none;
      }
      [data-theme="dark"] .bp-eq-more {
        background: #1E293B;
        border-color: rgba(255,255,255,0.1);
      }
      .bp-eq-more:hover { border-color: #0284C7; color: #0284C7; }

      /* Input row — unified rounded container */
      .bp-input-row {
        display: flex;
        align-items: flex-end;
        gap: 6px;
        background: #F8FAFC;
        border: 1.5px solid rgba(0,0,0,0.1);
        border-radius: 26px;
        padding: 5px 5px 5px 8px;
        transition: border-color 0.2s, box-shadow 0.2s;
      }
      [data-theme="dark"] .bp-input-row {
        background: #0F172A;
        border-color: rgba(255,255,255,0.1);
      }
      .bp-input-row:focus-within {
        border-color: #0284C7;
        box-shadow: 0 0 0 3px rgba(2,132,199,0.12);
      }

      /* Image attach button */
      .bp-img-btn-wrap {
        position: relative;
        flex-shrink: 0;
        width: 32px;
        height: 32px;
      }
      .bp-img-btn {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: rgba(0,0,0,0.05);
        border: none;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font-size: 14px;
        color: var(--text-muted, #9CA3AF);
        transition: all 0.2s;
        position: relative;
        overflow: hidden;
        user-select: none;
      }
      .bp-img-btn:hover { background: rgba(2,132,199,0.1); color: #0284C7; }

      .bp-img-thumb {
        position: absolute;
        inset: 0;
        width: 100%; height: 100%;
        object-fit: cover;
        border-radius: 50%;
        display: none;
      }
      .bp-img-thumb.show { display: block; }

      .bp-img-remove {
        position: absolute;
        top: -3px; right: -3px;
        width: 15px; height: 15px;
        border-radius: 50%;
        background: #EF4444;
        border: 2px solid #fff;
        display: none;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 10;
        font-size: 7px;
        color: #fff;
        font-weight: 700;
        line-height: 1;
      }
      .bp-img-remove.show { display: flex; }

      /* Textarea */
      .bp-textarea {
        flex: 1;
        min-height: 28px;
        max-height: 110px;
        background: none;
        border: none;
        outline: none;
        font-family: inherit;
        font-size: 14px;
        color: var(--text, #1a1a1a);
        resize: none;
        line-height: 1.5;
        padding: 4px 2px;
        align-self: center;
      }
      [data-theme="dark"] .bp-textarea { color: #F1F5F9; }
      .bp-textarea::placeholder { color: var(--text-muted, #9CA3AF); }
      .bp-textarea:disabled { opacity: 0.5; cursor: not-allowed; }

      /* Send button */
      .bp-send-btn {
        width: 38px;
        height: 38px;
        border-radius: 50%;
        background: linear-gradient(135deg, #0369A1, #0284C7);
        border: none;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        flex-shrink: 0;
        box-shadow: 0 2px 8px rgba(2,132,199,0.35);
        transition: all 0.2s;
      }
      .bp-send-btn:hover  { filter: brightness(1.1); transform: scale(1.05); }
      .bp-send-btn:active { transform: scale(0.88); }
      .bp-send-btn:disabled {
        opacity: 0.35;
        cursor: not-allowed;
        transform: none;
        filter: none;
      }
      .bp-send-btn svg { width: 16px; height: 16px; fill: #fff; }

      /* Upload progress */
      .bp-upload-overlay {
        display: none;
        position: absolute;
        inset: 0;
        background: rgba(2,132,199,0.08);
        border-radius: 26px;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: 700;
        color: #0284C7;
        gap: 6px;
        z-index: 5;
      }
      .bp-upload-overlay.show { display: flex; }

      /* ── EMOJI PANEL ── */
      .bp-emoji-overlay {
        position: fixed;
        inset: 0;
        z-index: 340;
        display: none;
      }
      .bp-emoji-overlay.open { display: block; }

      .bp-emoji-panel {
        position: fixed;
        bottom: 0; left: 0; right: 0;
        background: #fff;
        border-top: 1px solid rgba(0,0,0,0.07);
        border-radius: 20px 20px 0 0;
        padding: 12px 14px 28px;
        z-index: 350;
        transform: translateY(100%);
        transition: transform 0.3s cubic-bezier(0.4,0,0.2,1);
        box-shadow: 0 -6px 28px rgba(0,0,0,0.1);
        max-height: 52vh;
        overflow-y: auto;
      }
      [data-theme="dark"] .bp-emoji-panel {
        background: #1E293B;
        border-top-color: rgba(255,255,255,0.06);
      }
      .bp-emoji-panel.open { transform: translateY(0); }

      .bp-emoji-handle {
        width: 38px; height: 4px;
        background: rgba(0,0,0,0.1);
        border-radius: 2px;
        margin: 0 auto 12px;
      }
      [data-theme="dark"] .bp-emoji-handle { background: rgba(255,255,255,0.12); }

      .bp-emoji-section {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        color: var(--text-muted, #9CA3AF);
        margin-bottom: 8px;
        text-transform: uppercase;
      }

      .bp-emoji-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 2px;
        margin-bottom: 12px;
      }

      .bp-em {
        font-size: 26px;
        cursor: pointer;
        padding: 5px;
        border-radius: 8px;
        transition: background 0.15s;
        line-height: 1;
        user-select: none;
      }
      .bp-em:hover  { background: rgba(0,0,0,0.06); }
      .bp-em:active { transform: scale(0.88); }
      [data-theme="dark"] .bp-em:hover { background: rgba(255,255,255,0.08); }

      /* ── REACTION PICKER ── */
      .bp-reaction-picker {
        display: none;
        position: fixed;
        z-index: 500;
        background: #fff;
        border: 1px solid rgba(0,0,0,0.08);
        border-radius: 999px;
        padding: 8px 10px;
        box-shadow: 0 8px 28px rgba(0,0,0,0.14);
        flex-direction: row;
        gap: 2px;
      }
      [data-theme="dark"] .bp-reaction-picker {
        background: #1E293B;
        border-color: rgba(255,255,255,0.08);
      }
      .bp-reaction-picker.show { display: flex; }

      .bp-rp-btn {
        font-size: 24px;
        padding: 5px;
        border: none;
        background: none;
        cursor: pointer;
        border-radius: 8px;
        transition: transform 0.15s;
        min-width: 38px;
        min-height: 38px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .bp-rp-btn:active { transform: scale(0.82); }

      /* ── IMAGE VIEWER ── */
      .bp-image-viewer {
        display: none;
        position: fixed;
        inset: 0;
        z-index: 900;
        background: rgba(0,0,0,0.92);
        align-items: center;
        justify-content: center;
        padding: 20px;
      }
      .bp-image-viewer.show { display: flex; }
      .bp-image-viewer img {
        max-width: 100%;
        max-height: 90dvh;
        border-radius: 10px;
        object-fit: contain;
      }
      .bp-iv-close {
        position: absolute;
        top: 16px; right: 16px;
        width: 38px; height: 38px;
        border-radius: 50%;
        background: rgba(255,255,255,0.15);
        border: none;
        color: #fff;
        font-size: 17px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
      }
      .bp-iv-close:hover { background: rgba(255,255,255,0.25); }

      /* ── RESPONSIVE ── */
      @media (min-width: 768px) {
        .bp-messages { padding: 12px 10% 6px; }
        .bp-msg-bubble { max-width: 62%; }
      }
      @media (min-width: 1025px) {
        .bp-root { max-width: 780px; margin: 0 auto; }
        .bp-messages { padding: 12px 16% 6px; }
        .bp-msg-bubble { max-width: 56%; }
      }

    </style>`;
  },

  // ── MOUNT ───────────────────────────────────────────────
  mount() {
    return `
      <div class="bp-root" translate="no">

        <!-- FIXED HEADER -->
        <div class="bp-header">
          <div class="bp-header-main">
            <button class="bp-hdr-btn" id="bp-back" aria-label="Voltar">
              <i class="fa-solid fa-arrow-left"></i>
            </button>
            <div class="bp-hdr-avatar" id="bp-hdr-avatar">💬</div>
            <div class="bp-hdr-info">
              <div class="bp-hdr-title notranslate" id="bp-hdr-title">Bate-papo</div>
              <div class="bp-hdr-sub notranslate" id="bp-hdr-sub">Grupo de estudo</div>
            </div>
            <button class="bp-hdr-btn" id="bp-dark-toggle" aria-label="Tema">
              <i class="fa-solid fa-moon" id="bp-dark-icon"></i>
            </button>
            <button class="bp-hdr-btn" id="bp-menu-btn" aria-label="Opções">
              <i class="fa-solid fa-ellipsis-vertical"></i>
            </button>
          </div>
          <div class="bp-group-bar">
            <span class="bp-group-label notranslate" id="bp-group-label">—</span>
            <div class="bp-online-row">
              <div class="bp-online-dot"></div>
              <span class="bp-online-label notranslate">
                <span id="bp-online-num">—</span> activos
              </span>
            </div>
          </div>
        </div>

        <!-- PINNED -->
        <div class="bp-pinned notranslate" id="bp-pinned">
          <i class="fa-solid fa-thumbtack bp-pinned-icon"></i>
          <div class="bp-pinned-body">
            <div class="bp-pinned-label">Mensagem afixada</div>
            <div class="bp-pinned-text" id="bp-pinned-text"></div>
          </div>
          <i class="fa-solid fa-angle-right" style="font-size:11px;color:#9CA3AF;"></i>
        </div>

        <!-- TOPIC -->
        <div class="bp-topic notranslate" id="bp-topic">
          <i class="fa-solid fa-hashtag bp-topic-icon"></i>
          <span class="bp-topic-text" id="bp-topic-text"></span>
        </div>

        <!-- LOCKED -->
        <div class="bp-locked-banner notranslate" id="bp-locked-banner">
          <i class="fa-solid fa-lock" style="color:#EF4444;font-size:12px;"></i>
          <span class="bp-locked-text">Chat bloqueado pelo moderador</span>
        </div>

        <!-- MESSAGES — only this scrolls -->
        <div class="bp-messages" id="bp-messages">
          <div style="text-align:center;padding:32px 20px;color:#9CA3AF;font-size:13px;">
            <i class="fa-solid fa-circle-notch fa-spin"
              style="font-size:1.4rem;color:#0284C7;display:block;margin-bottom:10px;"></i>
            A carregar mensagens...
          </div>
        </div>

        <!-- SCROLL TO BOTTOM -->
        <button class="bp-scroll-btn notranslate" id="bp-scroll-btn" aria-label="Fim">
          <i class="fa-solid fa-chevron-down"></i>
          <span class="bp-unread-badge" id="bp-unread-badge" style="display:none;"></span>
        </button>

        <!-- REPLY PREVIEW -->
        <div class="bp-reply-preview" id="bp-reply-preview">
          <div class="bp-reply-preview-body">
            <div class="bp-reply-preview-name" id="bp-reply-name"></div>
            <div class="bp-reply-preview-text" id="bp-reply-text"></div>
          </div>
          <button class="bp-reply-cancel" id="bp-reply-cancel">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        <!-- SUSPENDED -->
        <div class="bp-suspended-banner notranslate" id="bp-suspended-banner"></div>

        <!-- FIXED INPUT AREA -->
        <div class="bp-input-area" id="bp-input-area">

          <!-- Extra pills -->
          <div class="bp-extra-row" id="bp-extra-row">
            <button class="bp-ex-btn wa" id="bp-wa-btn">
              <i class="fa-brands fa-whatsapp"></i> Grupo WhatsApp
            </button>
            <button class="bp-ex-btn" id="bp-rules-btn">
              <i class="fa-solid fa-book-open"></i> Regras
            </button>
            <button class="bp-ex-btn danger" id="bp-report-btn">
              <i class="fa-solid fa-flag"></i> Reportar
            </button>
          </div>

          <!-- Emoji quick row -->
          <div class="bp-emoji-quick-row hidden" id="bp-emoji-quick-row">
            <span class="bp-eq-emoji" id="bp-eq-0">😊</span>
            <span class="bp-eq-emoji" id="bp-eq-1">👍</span>
            <span class="bp-eq-emoji" id="bp-eq-2">🔥</span>
            <span class="bp-eq-emoji" id="bp-eq-3">😭</span>
            <span class="bp-eq-emoji" id="bp-eq-4">🙏</span>
            <div class="bp-eq-more" id="bp-eq-more">
              <i class="fa-solid fa-plus" style="font-size:9px;"></i> Mais
            </div>
          </div>

          <!-- Main input row -->
          <div style="position:relative;">
            <div class="bp-input-row" id="bp-input-row">
              <div class="bp-img-btn-wrap">
                <label for="bp-file-input" class="bp-img-btn" id="bp-img-btn">
                  <span id="bp-img-icon"><i class="fa-solid fa-image"></i></span>
                  <img class="bp-img-thumb" id="bp-img-thumb" src="" alt="">
                </label>
                <input type="file" id="bp-file-input" accept="image/*"
                  style="position:fixed;opacity:0;width:1px;height:1px;top:-999px;left:-999px;">
                <div class="bp-img-remove" id="bp-img-remove">✕</div>
              </div>

              <textarea
                class="bp-textarea notranslate"
                id="bp-textarea"
                placeholder="Escreva uma mensagem..."
                rows="1"
                aria-label="Mensagem"
              ></textarea>

              <button class="bp-send-btn notranslate" id="bp-send-btn" disabled aria-label="Enviar">
                <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
              </button>
            </div>
            <div class="bp-upload-overlay" id="bp-upload-overlay">
              <i class="fa-solid fa-circle-notch fa-spin"></i> A enviar...
            </div>
          </div>
        </div>

        <!-- EMOJI PANEL -->
        <div class="bp-emoji-overlay" id="bp-emoji-overlay"></div>
        <div class="bp-emoji-panel" id="bp-emoji-panel">
          <div class="bp-emoji-handle"></div>
          <div class="bp-emoji-section">Recentes</div>
          <div class="bp-emoji-grid" id="bp-emoji-recent"></div>
          <div class="bp-emoji-section">Todos</div>
          <div class="bp-emoji-grid" id="bp-emoji-all"></div>
        </div>

        <!-- REACTION PICKER -->
        <div class="bp-reaction-picker notranslate" id="bp-reaction-picker">
          ${QUICK_REACTIONS.map(e =>
            `<button class="bp-rp-btn" data-emoji="${e}">${e}</button>`
          ).join('')}
        </div>

        <!-- IMAGE VIEWER -->
        <div class="bp-image-viewer" id="bp-image-viewer">
          <button class="bp-iv-close notranslate" id="bp-iv-close" aria-label="Fechar">
            <i class="fa-solid fa-xmark"></i>
          </button>
          <img id="bp-viewer-img" src="" alt="Imagem">
        </div>

      </div>
    `;
  },

  // ── INIT ────────────────────────────────────────────────
  async init(user, userData, params) {
    _user           = user;
    _userData       = userData;
    _groupId        = userData?.groupId || null;
    _isModerator    = userData?.role === 'moderador';
    _isAdmin        = userData?.role === 'admin';
    _messages       = [];
    _lastDoc        = null;
    _reactions      = _loadReactionsCache(_groupId);
    _suspended      = false;
    _suspendedUntil = null;
    _replyToMsg     = null;
    _attachedImage  = null;
    _recentEmojis   = _loadRecentEmojis();

    // Sign into chat DB
    try {
      const { signInWithCustomToken } = await import(
        'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js'
      );
      const result = await worker.setCustomClaims(
        _user.uid,
        _userData.groupId || '',
        _userData.role    || 'student'
      );
      if (!result?.customToken) throw new Error('No custom token returned');
      await signInWithCustomToken(chatAuth, result.customToken);
    } catch (err) {
      console.warn('[BatePapo] Chat sign-in failed:', err);
      ui.showToast('Erro ao entrar no chat. Tente novamente.', 'error');
      return;
    }

    if (!_groupId) {
      ui.showToast('O seu perfil não tem grupo atribuído. Complete o perfil primeiro.', 'error');
      router.navigate('perfil');
      return;
    }

    // Wire header
    document.getElementById('bp-back')
      ?.addEventListener('click', () => router.navigate('dashboard'), { once: true });
    _wireDarkToggle();
    document.getElementById('bp-menu-btn')?.addEventListener('click', () => _openMenu());
    document.getElementById('bp-iv-close')
      ?.addEventListener('click', () => {
        document.getElementById('bp-image-viewer')?.classList.remove('show');
      }, { once: true });

    // Load & subscribe
    await _loadGroupData();
    await _checkSuspension();
    await _loadInitialMessages();
    _subscribeMessages();
    _subscribeGroup();

    // Wire UI
    _wireInput();
    _wireScroll();
    _wireEmojiPanel();
    _wireExtraRow();

    _scrollToBottom(false);
  },

  // ── DESTROY ─────────────────────────────────────────────
  destroy() {
    if (_unsubMessages) { _unsubMessages(); _unsubMessages = null; }
    if (_unsubGroup)    { _unsubGroup();    _unsubGroup    = null; }
    if (_suspendTimer)  { clearTimeout(_suspendTimer); _suspendTimer = null; }
    _user = _userData = _groupId = _groupData = null;
    _messages = []; _lastDoc = null; _reactions = {};
    _suspended = false; _replyToMsg = null; _attachedImage = null;
    document.getElementById('bp-reaction-picker')?.classList.remove('show');
    document.getElementById('bp-image-viewer')?.classList.remove('show');
    document.getElementById('bp-emoji-panel')?.classList.remove('open');
    document.getElementById('bp-emoji-overlay')?.classList.remove('open');
  },
};

// ============================================================
// GROUP DATA
// ============================================================

async function _loadGroupData() {
  try {
    const cached = _loadGroupCache(_groupId);
    if (cached) _applyGroupData(cached);
    const snap = await getDoc(doc(chatDb, 'chatGroups', _groupId));
    if (snap.exists()) {
      _groupData = { id: snap.id, ...snap.data() };
      _saveGroupCache(_groupId, _groupData);
      _applyGroupData(_groupData);
    } else {
      _groupData = {
        groupId: _groupId, label: _buildGroupLabel(_userData),
        locked: false, topic: '', pinnedMessageId: null,
        pinnedMessageText: '', moderatorId: null, moderatorName: null,
      };
      _applyGroupData(_groupData);
    }
    _loadOnlineCount();
  } catch (err) {
    console.error('[BatePapo] Group data load failed:', err);
  }
}

function _applyGroupData(data) {
  if (!data) return;

  const label = document.getElementById('bp-group-label');
  if (label) label.textContent = data.label || _buildGroupLabel(_userData);

  const sub = document.getElementById('bp-hdr-sub');
  if (sub) sub.textContent = data.moderatorName
    ? `Moderador: ${data.moderatorName}` : 'Grupo de estudo';

  const pinnedEl  = document.getElementById('bp-pinned');
  const pinnedTxt = document.getElementById('bp-pinned-text');
  if (pinnedEl && pinnedTxt) {
    if (data.pinnedMessageText) {
      pinnedTxt.textContent = data.pinnedMessageText;
      pinnedEl.classList.add('show');
    } else {
      pinnedEl.classList.remove('show');
    }
  }

  const topicEl  = document.getElementById('bp-topic');
  const topicTxt = document.getElementById('bp-topic-text');
  if (topicEl && topicTxt) {
    if (data.topic) {
      topicTxt.textContent = `Tópico: ${data.topic}`;
      topicEl.classList.add('show');
    } else {
      topicEl.classList.remove('show');
    }
  }

  const lockedBanner = document.getElementById('bp-locked-banner');
  const textarea     = document.getElementById('bp-textarea');
  const sendBtn      = document.getElementById('bp-send-btn');
  const imgBtn       = document.getElementById('bp-img-btn');

  if (data.locked && !_isModerator && !_isAdmin) {
    lockedBanner?.classList.add('show');
    if (textarea) textarea.disabled = true;
    if (sendBtn)  sendBtn.disabled  = true;
    if (imgBtn)   imgBtn.style.pointerEvents = 'none';
  } else {
    lockedBanner?.classList.remove('show');
    if (!_suspended) {
      if (textarea) textarea.disabled = false;
      if (sendBtn)  sendBtn.disabled  = !textarea?.value.trim() && !_attachedImage;
      if (imgBtn)   imgBtn.style.pointerEvents = '';
    }
  }
}

function _buildGroupLabel(userData) {
  if (!userData) return 'Grupo de Estudo';
  const { examType, grade, status, section, course, institution } = userData;
  if (examType === 'ensino-geral') {
    let label = `${grade}ª Classe`;
    if (status === 'repetente') {
      label += section === 'letras'   ? ' — Letras'
             : section === 'ciencias' ? ' — Ciências'
             : ' — Repetentes';
    }
    return label;
  }
  if (examType === 'admissao') {
    return course ? `Admissão — ${course}` : `Admissão — ${institution || 'Instituição'}`;
  }
  return 'Grupo de Estudo';
}

async function _loadOnlineCount() {
  try {
    const snap = await getDocs(
      query(collection(db, 'users'), where('groupId', '==', _groupId))
    );
    const el = document.getElementById('bp-online-num');
    if (el) el.textContent = snap.size;
  } catch {
    const el = document.getElementById('bp-online-num');
    if (el) el.textContent = '—';
  }
}

// ============================================================
// SUSPENSION
// ============================================================

async function _checkSuspension() {
  if (_isModerator || _isAdmin) return;
  try {
    const suspSnap = await getDoc(
      doc(chatDb, 'chatGroups', _groupId, 'suspensions', _user.uid)
    );
    if (suspSnap.exists()) {
      const data = suspSnap.data();
      const expiresAt = data.expiresAt?.toDate?.() || new Date(data.expiresAt);
      if (expiresAt > new Date()) {
        _suspended      = true;
        _suspendedUntil = expiresAt;
        _applySuspension();
        const remaining = expiresAt.getTime() - Date.now();
        _suspendTimer = setTimeout(() => {
          _suspended = false; _suspendedUntil = null; _liftSuspensionUI();
        }, remaining);
      }
    }
  } catch {}
}

function _applySuspension() {
  const textarea = document.getElementById('bp-textarea');
  const sendBtn  = document.getElementById('bp-send-btn');
  const imgBtn   = document.getElementById('bp-img-btn');
  const banner   = document.getElementById('bp-suspended-banner');
  if (textarea) textarea.disabled = true;
  if (sendBtn)  sendBtn.disabled  = true;
  if (imgBtn)   imgBtn.style.pointerEvents = 'none';
  if (banner && _suspendedUntil) {
    const t = _suspendedUntil.toLocaleTimeString('pt-PT',
      { hour: '2-digit', minute: '2-digit' });
    banner.textContent = `Suspenso até às ${t}. Contacte o moderador se tiver dúvidas.`;
    banner.classList.add('show');
  }
}

function _liftSuspensionUI() {
  const textarea = document.getElementById('bp-textarea');
  const sendBtn  = document.getElementById('bp-send-btn');
  const imgBtn   = document.getElementById('bp-img-btn');
  const banner   = document.getElementById('bp-suspended-banner');
  if (textarea) textarea.disabled = false;
  if (imgBtn)   imgBtn.style.pointerEvents = '';
  if (sendBtn)  sendBtn.disabled = !textarea?.value.trim();
  banner?.classList.remove('show');
  ui.showToast('A sua suspensão terminou. Pode voltar a participar.', 'info');
}

// ============================================================
// MESSAGE LOADING
// ============================================================

async function _loadInitialMessages() {
  try {
    const q = query(
      collection(chatDb, 'chat', _groupId, 'messages'),
      orderBy('sentAt', 'desc'),
      limit(MESSAGES_PER_PAGE)
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      _lastDoc  = snap.docs[snap.docs.length - 1];
      _messages = snap.docs.reverse().map(d => ({ _id: d.id, ...d.data() }));
      _renderAllMessages();
    } else {
      _renderEmptyState();
    }
    if (snap.docs.length === MESSAGES_PER_PAGE) _prependLoadMore();
  } catch (err) {
    console.error('[BatePapo] Load messages failed:', err.code, err.message);
    ui.showToast('Erro ao carregar mensagens. Verifica a ligação.', 'error');
  }
}

async function _loadMoreMessages() {
  if (_loadingMore || !_lastDoc) return;
  _loadingMore = true;
  try {
    const q = query(
      collection(chatDb, 'chat', _groupId, 'messages'),
      orderBy('sentAt', 'desc'),
      startAfter(_lastDoc),
      limit(MESSAGES_PER_PAGE)
    );
    const snap = await getDocs(q);
    if (snap.empty) {
      document.getElementById('bp-load-more')?.remove();
      _loadingMore = false; return;
    }
    _lastDoc = snap.docs[snap.docs.length - 1];
    const older = snap.docs.reverse().map(d => ({ _id: d.id, ...d.data() }));
    _messages = [...older, ..._messages];
    const c = document.getElementById('bp-messages');
    const prevH = c?.scrollHeight || 0;
    _renderAllMessages();
    if (c) c.scrollTop = c.scrollHeight - prevH;
    if (snap.docs.length < MESSAGES_PER_PAGE)
      document.getElementById('bp-load-more')?.remove();
  } catch (err) {
    console.error('[BatePapo] Load more failed:', err);
  } finally {
    _loadingMore = false;
  }
}

// ============================================================
// REALTIME
// ============================================================

function _subscribeMessages() {
  if (_unsubMessages) _unsubMessages();
  const since = Timestamp.now();
  const q = query(
    collection(chatDb, 'chat', _groupId, 'messages'),
    orderBy('sentAt', 'asc'),
    startAfter(since)
  );
  _unsubMessages = onSnapshot(q, snap => {
    snap.docChanges().forEach(change => {
      if (change.type === 'added') {
        const msg = { _id: change.doc.id, ...change.doc.data() };
        if (_messages.find(m => m._id === msg._id)) return;
        _messages.push(msg);
        if (msg.reactions && Object.keys(msg.reactions).length) {
          _reactions[msg._id] = msg.reactions;
          _saveReactionsCache(_groupId, _reactions);
        }
        const c = document.getElementById('bp-messages');
        const isAtBottom = c
          ? c.scrollTop + c.clientHeight >= c.scrollHeight - 60 : true;
        _renderMessage(msg);
        if (isAtBottom) _scrollToBottom(true);
        else _showUnreadBadge();
      }
      if (change.type === 'modified') {
        const msg = { _id: change.doc.id, ...change.doc.data() };
        const idx = _messages.findIndex(m => m._id === msg._id);
        if (idx !== -1) _messages[idx] = msg;
        if (msg.reactions) {
          _reactions[msg._id] = msg.reactions;
          _saveReactionsCache(_groupId, _reactions);
        }
        _rerenderMessage(msg);
      }
    });
  }, err => console.error('[BatePapo] Subscription error:', err));
}

function _subscribeGroup() {
  if (_unsubGroup) _unsubGroup();
  _unsubGroup = onSnapshot(doc(chatDb, 'chatGroups', _groupId), snap => {
    if (snap.exists()) {
      _groupData = { id: snap.id, ...snap.data() };
      _saveGroupCache(_groupId, _groupData);
      _applyGroupData(_groupData);
    }
  });
}

// ============================================================
// RENDERING
// ============================================================

function _renderEmptyState() {
  const c = document.getElementById('bp-messages');
  if (!c) return;
  c.innerHTML = `
    <div style="text-align:center;padding:40px 24px;color:#9CA3AF;">
      <i class="fa-regular fa-comments"
        style="font-size:2.8rem;display:block;margin-bottom:14px;color:#0284C7;opacity:0.35;"></i>
      <div style="font-size:15px;font-weight:700;color:#374151;margin-bottom:6px;">
        Seja o primeiro a escrever!
      </div>
      <div style="font-size:13px;line-height:1.65;">
        Este é o vosso espaço de estudo.<br>
        Coloquem dúvidas, partilhem dicas!
      </div>
    </div>`;
}

function _prependLoadMore() {
  const c = document.getElementById('bp-messages');
  if (!c) return;
  const el = document.createElement('div');
  el.className   = 'bp-load-more notranslate';
  el.id          = 'bp-load-more';
  el.innerHTML   = '<i class="fa-solid fa-clock-rotate-left" style="margin-right:5px;"></i>Mensagens anteriores';
  el.addEventListener('click', () => _loadMoreMessages());
  c.insertBefore(el, c.firstChild);
}

function _renderAllMessages() {
  const c = document.getElementById('bp-messages');
  if (!c) return;
  c.innerHTML = '';
  if (!_messages.length) { _renderEmptyState(); return; }
  let lastDate = null;
  _messages.forEach((msg, idx) => {
    const d = _getMsgDate(msg);
    if (d !== lastDate) { c.appendChild(_buildDateSep(d)); lastDate = d; }
    const prev = idx > 0 ? _messages[idx - 1] : null;
    const cont = prev && prev.senderId === msg.senderId && !_isDifferentMinute(prev, msg);
    c.appendChild(_buildMessageEl(msg, cont));
  });
  if (_messages.length === MESSAGES_PER_PAGE) _prependLoadMore();
}

function _renderMessage(msg) {
  const c = document.getElementById('bp-messages');
  if (!c) return;
  const lastMsg  = _messages[_messages.length - 2];
  const msgDate  = _getMsgDate(msg);
  const lastDate = lastMsg ? _getMsgDate(lastMsg) : null;
  if (msgDate !== lastDate) c.appendChild(_buildDateSep(msgDate));
  const idx  = _messages.indexOf(msg);
  const prev = idx > 0 ? _messages[idx - 1] : null;
  const cont = prev && prev.senderId === msg.senderId && !_isDifferentMinute(prev, msg);
  c.appendChild(_buildMessageEl(msg, cont));
}

function _rerenderMessage(msg) {
  const el = document.getElementById(`bp-msg-${msg._id}`);
  if (!el) return;
  const idx  = _messages.indexOf(msg);
  const prev = idx > 0 ? _messages[idx - 1] : null;
  const cont = prev && prev.senderId === msg.senderId && !_isDifferentMinute(prev, msg);
  el.replaceWith(_buildMessageEl(msg, cont));
}

function _buildDateSep(dateStr) {
  const el = document.createElement('div');
  el.className   = 'bp-date-sep notranslate';
  el.textContent = dateStr;
  return el;
}

function _buildMessageEl(msg, isCont) {
  const isOwn     = msg.senderId === _user?.uid;
  const reactions = _reactions[msg._id] || msg.reactions || {};

  const el = document.createElement('div');
  el.className = `bp-msg-row${isOwn ? ' own' : ''}${isCont ? ' cont' : ''}`;
  el.id        = `bp-msg-${msg._id}`;

  // Avatar
  let avHtml = '';
  if (!isCont) {
    const avContent = msg.senderPhoto
      ? `<img src="${_esc(msg.senderPhoto)}" alt="">`
      : _getInitials(msg.senderName);
    avHtml = `<div class="bp-msg-av" data-uid="${_esc(msg.senderId)}">${avContent}</div>`;
  }

  // Sender
  let senderHtml = '';
  if (!isCont && !isOwn) {
    const isMod = msg.senderRole === 'moderador' || msg.senderRole === 'admin';
    senderHtml = `<div class="bp-msg-sender">
      ${_esc(msg.senderName || 'Estudante')}
      ${isMod ? `<span class="bp-mod-badge">
        <i class="fa-solid fa-shield-halved" style="font-size:8px;"></i> Mod
      </span>` : ''}
    </div>`;
  }

  // Reply quote
  let replyHtml = '';
  if (msg.replyTo) {
    replyHtml = `<div class="bp-reply-quote">
      <div class="bp-reply-quote-name">${_esc(msg.replyTo.senderName || '')}</div>
      <div class="bp-reply-quote-text">${_esc(msg.replyTo.text || '[Imagem]')}</div>
    </div>`;
  }

  // Content
  let contentHtml = '';
  if (msg.deleted) {
    contentHtml = `<div class="bp-msg-content deleted">
      <i class="fa-solid fa-ban" style="margin-right:5px;font-size:11px;"></i>Mensagem removida
    </div>`;
  } else if (msg.imageUrl) {
    contentHtml = `<div class="bp-msg-content"
      style="padding:5px;background:transparent;border:none;box-shadow:none;">
      <img class="bp-msg-image" src="${_esc(msg.imageUrl)}"
        data-src="${_esc(msg.imageUrl)}" loading="lazy" alt="Imagem">
      ${msg.text ? `<div style="padding:4px 6px 2px;font-size:13px;">${_esc(msg.text)}</div>` : ''}
    </div>`;
  } else {
    contentHtml = `<div class="bp-msg-content">${_esc(msg.text || '')}</div>`;
  }

  // Time + tick
  const time = _formatTime(msg.sentAt);
  const tickHtml = isOwn && !msg.deleted
    ? `<i class="fa-solid fa-check bp-sent-tick" title="Enviado"></i>` : '';

  // Reactions
  const rxMap = {};
  Object.entries(reactions).forEach(([uid, emoji]) => {
    if (!rxMap[emoji]) rxMap[emoji] = [];
    rxMap[emoji].push(uid);
  });
  const rxHtml = Object.entries(rxMap).map(([emoji, uids]) => {
    const own = uids.includes(_user?.uid);
    return `<button class="bp-reaction-pill${own ? ' own-reacted' : ''} notranslate"
      data-msg-id="${msg._id}" data-emoji="${emoji}">
      ${emoji}<span class="bp-reaction-count">${uids.length}</span>
    </button>`;
  }).join('');

  el.innerHTML = `
    ${!isOwn ? avHtml : ''}
    <div class="bp-msg-bubble">
      ${senderHtml}
      ${replyHtml}
      ${contentHtml}
      <div class="bp-msg-meta">
        <span class="bp-msg-time notranslate">${time}</span>
        ${tickHtml}
      </div>
      ${rxHtml ? `<div class="bp-reactions">${rxHtml}</div>` : ''}
    </div>
    ${isOwn ? avHtml : ''}
  `;

  // Wire long press
  const bubble = el.querySelector('.bp-msg-content');
  if (bubble && !msg.deleted) _wireMessageActions(bubble, msg);

  // Reaction pills
  el.querySelectorAll('.bp-reaction-pill').forEach(pill => {
    pill.addEventListener('click', e => {
      e.stopPropagation();
      _toggleReaction(msg._id, pill.dataset.emoji);
    });
  });

  // Image tap
  const img = el.querySelector('.bp-msg-image');
  if (img) {
    img.addEventListener('click', () => {
      const viewer = document.getElementById('bp-image-viewer');
      const vImg   = document.getElementById('bp-viewer-img');
      if (viewer && vImg) { vImg.src = img.dataset.src; viewer.classList.add('show'); }
    });
  }

  // Avatar tap (moderator)
  el.querySelector('.bp-msg-av')?.addEventListener('click', () => {
    if (_isModerator || _isAdmin) _openModeratorUserMenu(msg.senderId, msg.senderName);
  });

  return el;
}

// ============================================================
// MESSAGE ACTIONS
// ============================================================

let _pressTimer = null;

function _wireMessageActions(bubble, msg) {
  const isOwn = msg.senderId === _user?.uid;
  const open  = e => { e?.preventDefault(); _openMessageActions(msg, isOwn); };
  bubble.addEventListener('touchstart', () => {
    _pressTimer = setTimeout(() => open(), 500);
  }, { passive: true });
  bubble.addEventListener('touchend',   () => clearTimeout(_pressTimer));
  bubble.addEventListener('touchmove',  () => clearTimeout(_pressTimer));
  bubble.addEventListener('contextmenu', open);
}

function _openMessageActions(msg, isOwn) {
  const canDelete = isOwn || _isModerator || _isAdmin;
  const actions = [
    { label: 'Reagir',    onClick: () => { ui.closeBottomSheet(); _showReactionPicker(msg._id); } },
    { label: 'Responder', onClick: () => { ui.closeBottomSheet(); _setReplyTo(msg); } },
  ];
  if ((_isModerator || _isAdmin) && !msg.deleted) {
    actions.push({ label: 'Afixar', onClick: () => { ui.closeBottomSheet(); _pinMessage(msg); } });
  }
  if (canDelete && !msg.deleted) {
    actions.push({ label: 'Apagar', danger: true,
      onClick: () => { ui.closeBottomSheet(); _deleteMessage(msg._id); } });
  }
  if (!isOwn && !_isModerator) {
    actions.push({ label: 'Reportar',
      onClick: () => { ui.closeBottomSheet(); _reportMessage(msg); } });
  }
  actions.push({ label: 'Cancelar', dismiss: true });
  ui.openBottomSheet({ title: '', content: '', actions });
}

// ============================================================
// REACTION PICKER
// ============================================================

function _showReactionPicker(messageId) {
  const picker = document.getElementById('bp-reaction-picker');
  if (!picker) return;
  picker.classList.add('show');
  const msgEl = document.getElementById(`bp-msg-${messageId}`);
  if (msgEl) {
    const rect = msgEl.getBoundingClientRect();
    picker.style.top       = `${Math.max(Math.min(rect.top - 62, window.innerHeight - 80), 60)}px`;
    picker.style.left      = '50%';
    picker.style.transform = 'translateX(-50%)';
  }
  picker.querySelectorAll('.bp-rp-btn').forEach(btn => {
    const fresh = btn.cloneNode(true);
    btn.replaceWith(fresh);
    fresh.addEventListener('click', () => {
      picker.classList.remove('show');
      _toggleReaction(messageId, fresh.dataset.emoji);
    }, { once: true });
  });
  const close = e => {
    if (!picker.contains(e.target)) {
      picker.classList.remove('show');
      document.removeEventListener('click', close);
    }
  };
  setTimeout(() => document.addEventListener('click', close), 100);
}

async function _toggleReaction(messageId, emoji) {
  if (!_user || _suspended) return;
  try {
    if (!_reactions[messageId]) _reactions[messageId] = {};
    const existing = _reactions[messageId][_user.uid];
    if (existing === emoji) delete _reactions[messageId][_user.uid];
    else _reactions[messageId][_user.uid] = emoji;
    const idx = _messages.findIndex(m => m._id === messageId);
    if (idx !== -1) {
      _messages[idx].reactions = { ..._reactions[messageId] };
      _rerenderMessage(_messages[idx]);
    }
    _saveReactionsCache(_groupId, _reactions);
    await updateDoc(
      doc(chatDb, 'chat', _groupId, 'messages', messageId),
      { reactions: _reactions[messageId] }
    );
  } catch (err) {
    console.error('[BatePapo] Reaction failed:', err);
    ui.showToast('Não foi possível reagir.', 'error');
  }
}

// ============================================================
// SEND
// ============================================================

function _setReplyTo(msg) {
  _replyToMsg = msg;
  const preview = document.getElementById('bp-reply-preview');
  const name    = document.getElementById('bp-reply-name');
  const text    = document.getElementById('bp-reply-text');
  if (name) name.textContent = msg.senderName || 'Estudante';
  if (text) text.textContent = msg.text || '[Imagem]';
  preview?.classList.add('show');
  document.getElementById('bp-textarea')?.focus();
}

function _clearReplyTo() {
  _replyToMsg = null;
  document.getElementById('bp-reply-preview')?.classList.remove('show');
}

async function _sendTextMessage() {
  const textarea = document.getElementById('bp-textarea');
  const text     = textarea?.value.trim();
  if ((!text && !_attachedImage) || _suspended) return;
  if (_groupData?.locked && !_isModerator && !_isAdmin) return;

  if (_attachedImage) { await _sendImageMessage(_attachedImage); return; }

  const replyTo = _replyToMsg ? {
    messageId: _replyToMsg._id,
    senderName: _replyToMsg.senderName,
    text: _replyToMsg.text || '[Imagem]',
  } : null;

  _clearReplyTo();
  if (textarea) { textarea.value = ''; textarea.style.height = 'auto'; }
  document.getElementById('bp-send-btn').disabled = true;
  _showExtraRow(true);
  document.getElementById('bp-emoji-quick-row')?.classList.add('hidden');

  try {
    await addDoc(collection(chatDb, 'chat', _groupId, 'messages'), {
      senderId:    _user.uid,
      senderName:  _userData?.fullName || 'Estudante',
      senderPhoto: _userData?.photoURL || '',
      senderRole:  _userData?.role || 'student',
      text, imageUrl: '', replyTo, reactions: {},
      deleted: false, pinned: false,
      sentAt: serverTimestamp(),
    });
  } catch (err) {
    console.error('[BatePapo] Send failed:', err);
    ui.showToast('Erro ao enviar mensagem.', 'error');
    if (textarea) textarea.value = text;
  }
}

async function _sendImageMessage(file) {
  if (_suspended || (_groupData?.locked && !_isModerator && !_isAdmin)) return;
  const overlay  = document.getElementById('bp-upload-overlay');
  const textarea = document.getElementById('bp-textarea');
  const caption  = textarea?.value.trim() || '';
  if (textarea)  textarea.disabled = true;
  if (overlay)   overlay.classList.add('show');
  try {
    const form = new FormData();
    form.append('file', file);
    form.append('upload_preset', CLOUDINARY_PRESET);
    form.append('folder', 'examenova/batepapo');
    const res  = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`,
      { method: 'POST', body: form }
    );
    const data = await res.json();
    if (!data.secure_url) throw new Error('Upload failed');
    if (textarea) { textarea.value = ''; textarea.disabled = false; }
    if (overlay)  overlay.classList.remove('show');
    _clearAttachedImage();
    const replyTo = _replyToMsg ? {
      messageId: _replyToMsg._id,
      senderName: _replyToMsg.senderName, text: '[Imagem]',
    } : null;
    _clearReplyTo();
    await addDoc(collection(chatDb, 'chat', _groupId, 'messages'), {
      senderId:    _user.uid,
      senderName:  _userData?.fullName || 'Estudante',
      senderPhoto: _userData?.photoURL || '',
      senderRole:  _userData?.role || 'student',
      text: caption, imageUrl: data.secure_url, replyTo, reactions: {},
      deleted: false, pinned: false, sentAt: serverTimestamp(),
    });
  } catch (err) {
    console.error('[BatePapo] Image upload failed:', err);
    if (textarea) textarea.disabled = false;
    if (overlay)  overlay.classList.remove('show');
    ui.showToast('Erro ao enviar imagem.', 'error');
  }
}

// ============================================================
// DELETE / PIN / REPORT
// ============================================================

async function _deleteMessage(id) {
  try {
    await updateDoc(doc(chatDb, 'chat', _groupId, 'messages', id), { deleted: true });
  } catch {
    ui.showToast('Erro ao apagar mensagem.', 'error');
  }
}

async function _pinMessage(msg) {
  try {
    await updateDoc(doc(chatDb, 'chat', _groupId, 'messages', msg._id), { pinned: true });
    const gRef  = doc(chatDb, 'chatGroups', _groupId);
    const gSnap = await getDoc(gRef);
    if (gSnap.exists()) {
      await updateDoc(gRef, { pinnedMessageId: msg._id, pinnedMessageText: msg.text || '[Imagem]' });
    } else {
      await setDoc(gRef, {
        groupId: _groupId, label: _buildGroupLabel(_userData),
        locked: false, topic: '',
        pinnedMessageId: msg._id, pinnedMessageText: msg.text || '[Imagem]',
        moderatorId: _user.uid, moderatorName: _userData?.fullName || '',
        createdAt: serverTimestamp(),
      });
    }
    ui.showToast('Mensagem afixada.', 'success');
  } catch {
    ui.showToast('Erro ao afixar mensagem.', 'error');
  }
}

function _reportMessage(msg) {
  const t = encodeURIComponent(
    `[ExameNova — Bate-papo] Mensagem reportada no grupo ${_groupId}:\n\nID: ${msg._id}\nAutor: ${msg.senderName}\nTexto: ${msg.text || '[Imagem]'}`
  );
  window.open(`https://wa.me/258848920143?text=${t}`, '_blank');
}

// ============================================================
// MODERATOR
// ============================================================

function _openMenu() {
  const actions = [];
  if (_isModerator || _isAdmin) {
    actions.push({
      label: _groupData?.locked ? 'Desbloquear chat' : 'Bloquear chat',
      onClick: () => { ui.closeBottomSheet(); _toggleLock(); }
    });
    actions.push({ label: 'Definir tópico',  onClick: () => { ui.closeBottomSheet(); _openTopicSheet(); } });
    actions.push({ label: 'Remover afixado', onClick: () => { ui.closeBottomSheet(); _removePinned(); } });
  }
  actions.push({ label: 'Fechar', dismiss: true });
  ui.openBottomSheet({ title: 'Opções', content: '', actions });
}

function _openModeratorUserMenu(uid, name) {
  if (!_isModerator && !_isAdmin) return;
  if (uid === _user.uid) return;
  ui.openBottomSheet({
    title: name || 'Estudante', content: '',
    actions: [
      { label: 'Suspender 1 hora', danger: true,
        onClick: () => { ui.closeBottomSheet(); _suspendUser(uid, name); } },
      { label: 'Cancelar', dismiss: true }
    ]
  });
}

async function _suspendUser(uid, name) {
  try {
    const expiresAt = new Date(Date.now() + SUSPENSION_1H_MS);
    await setDoc(doc(chatDb, 'chatGroups', _groupId, 'suspensions', uid), {
      uid, name, expiresAt: Timestamp.fromDate(expiresAt),
      suspendedBy: _user.uid, suspendedAt: serverTimestamp(),
    });
    ui.showToast(`${name} foi suspenso por 1 hora.`, 'info');
  } catch {
    ui.showToast('Erro ao suspender o estudante.', 'error');
  }
}

async function _toggleLock() {
  try {
    const gRef  = doc(chatDb, 'chatGroups', _groupId);
    const gSnap = await getDoc(gRef);
    const locked = !(gSnap.data()?.locked ?? false);
    if (gSnap.exists()) {
      await updateDoc(gRef, { locked });
    } else {
      await setDoc(gRef, {
        groupId: _groupId, label: _buildGroupLabel(_userData),
        locked, topic: '', pinnedMessageId: null, pinnedMessageText: '',
        moderatorId: _user.uid, moderatorName: _userData?.fullName || '',
        createdAt: serverTimestamp(),
      });
    }
    ui.showToast(locked ? 'Chat bloqueado.' : 'Chat desbloqueado.', 'info');
  } catch {
    ui.showToast('Erro ao alterar o estado do chat.', 'error');
  }
}

function _openTopicSheet() {
  ui.openBottomSheet({
    title: 'Definir tópico',
    content: `
      <p style="font-size:13px;color:#9CA3AF;margin-bottom:12px;line-height:1.5;">
        O tópico aparece no topo do chat para todos os estudantes.
      </p>
      <textarea id="topic-input"
        style="width:100%;padding:12px;border-radius:12px;
        border:1.5px solid rgba(0,0,0,0.1);background:#F8FAFC;
        color:#1a1a1a;font-family:inherit;font-size:14px;
        resize:none;min-height:80px;outline:none;box-sizing:border-box;"
        placeholder="Ex: Hoje vamos rever Genética — Biologia 12ª Classe"
      >${_groupData?.topic || ''}</textarea>`,
    actions: [
      {
        label: 'Guardar',
        onClick: async () => {
          const val = document.getElementById('topic-input')?.value.trim() || '';
          try {
            const gRef  = doc(chatDb, 'chatGroups', _groupId);
            const gSnap = await getDoc(gRef);
            if (gSnap.exists()) {
              await updateDoc(gRef, { topic: val });
            } else {
              await setDoc(gRef, {
                groupId: _groupId, label: _buildGroupLabel(_userData),
                locked: false, topic: val, pinnedMessageId: null, pinnedMessageText: '',
                moderatorId: _user.uid, moderatorName: _userData?.fullName || '',
                createdAt: serverTimestamp(),
              });
            }
            ui.closeBottomSheet();
            ui.showToast('Tópico definido.', 'success');
          } catch { ui.showToast('Erro ao guardar o tópico.', 'error'); }
        }
      },
      ...(_groupData?.topic ? [{
        label: 'Remover tópico', danger: true,
        onClick: async () => {
          try {
            await updateDoc(doc(chatDb, 'chatGroups', _groupId), { topic: '' });
            ui.closeBottomSheet();
          } catch { ui.showToast('Erro ao remover o tópico.', 'error'); }
        }
      }] : []),
      { label: 'Cancelar', dismiss: true }
    ]
  });
}

async function _removePinned() {
  try {
    const gRef  = doc(chatDb, 'chatGroups', _groupId);
    const gSnap = await getDoc(gRef);
    if (gSnap.exists() && gSnap.data().pinnedMessageId) {
      await updateDoc(gRef, { pinnedMessageId: null, pinnedMessageText: '' });
      ui.showToast('Mensagem afixada removida.', 'info');
    }
  } catch { ui.showToast('Erro ao remover mensagem afixada.', 'error'); }
}

// ============================================================
// INPUT WIRING
// ============================================================

function _wireInput() {
  const textarea  = document.getElementById('bp-textarea');
  const sendBtn   = document.getElementById('bp-send-btn');
  const fileInput = document.getElementById('bp-file-input');
  const imgBtn    = document.getElementById('bp-img-btn');
  const imgRemove = document.getElementById('bp-img-remove');
  const replyCancel = document.getElementById('bp-reply-cancel');

  textarea?.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 110) + 'px';
    const has = !!textarea.value.trim() || !!_attachedImage;
    if (sendBtn) sendBtn.disabled = !has;
    _showExtraRow(!textarea.value.trim() && !_attachedImage);
    document.getElementById('bp-emoji-quick-row')
      ?.classList.toggle('hidden', !textarea.value.trim() && !_attachedImage);
  });

  textarea?.addEventListener('focus', () => {
    _showExtraRow(false);
    document.getElementById('bp-emoji-quick-row')?.classList.remove('hidden');
  });

  textarea?.addEventListener('blur', () => {
    setTimeout(() => {
      if (!textarea.value.trim() && !_attachedImage) {
        _showExtraRow(true);
        document.getElementById('bp-emoji-quick-row')?.classList.add('hidden');
      }
    }, 400);
  });

  textarea?.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault(); _sendTextMessage();
    }
  });

  sendBtn?.addEventListener('click', () => _sendTextMessage());

  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      ui.showToast('Escolha uma imagem válida.', 'error'); return;
    }
    if (file.size > 10 * 1024 * 1024) {
      ui.showToast('A imagem não pode ultrapassar 10 MB.', 'error'); return;
    }
    _setAttachedImage(file);
    fileInput.value = '';
  });

  imgBtn?.addEventListener('click', e => {
    if (_attachedImage) { e.preventDefault(); e.stopPropagation(); _clearAttachedImage(); }
  });

  imgRemove?.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation(); _clearAttachedImage();
  });

  replyCancel?.addEventListener('click', () => _clearReplyTo());
}

function _setAttachedImage(file) {
  _attachedImage = file;
  const reader = new FileReader();
  reader.onload = e => {
    const thumb   = document.getElementById('bp-img-thumb');
    const icon    = document.getElementById('bp-img-icon');
    const remove  = document.getElementById('bp-img-remove');
    const sendBtn = document.getElementById('bp-send-btn');
    if (thumb)   { thumb.src = e.target.result; thumb.classList.add('show'); }
    if (icon)    icon.style.display = 'none';
    if (remove)  remove.classList.add('show');
    if (sendBtn) sendBtn.disabled = false;
    _showExtraRow(false);
    document.getElementById('bp-emoji-quick-row')?.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

function _clearAttachedImage() {
  _attachedImage = null;
  const thumb   = document.getElementById('bp-img-thumb');
  const icon    = document.getElementById('bp-img-icon');
  const remove  = document.getElementById('bp-img-remove');
  const sendBtn = document.getElementById('bp-send-btn');
  const textarea = document.getElementById('bp-textarea');
  if (thumb)   { thumb.classList.remove('show'); thumb.src = ''; }
  if (icon)    icon.style.display = '';
  if (remove)  remove.classList.remove('show');
  if (sendBtn) sendBtn.disabled = !textarea?.value.trim();
}

function _showExtraRow(show) {
  document.getElementById('bp-extra-row')?.classList.toggle('hidden', !show);
}

// ============================================================
// EXTRA ROW
// ============================================================

function _wireExtraRow() {
  document.getElementById('bp-wa-btn')?.addEventListener('click', () => {
    window.open('https://chat.whatsapp.com/FVYCayFjaGCAdCwrGEaJrv', '_blank');
  });
  document.getElementById('bp-rules-btn')?.addEventListener('click', () => {
    ui.openBottomSheet({
      title: 'Regras do Bate-papo',
      content: `<div style="font-size:13px;color:#6B7280;line-height:1.75;">
        <div style="margin-bottom:8px;">✅ Respeita todos os membros do grupo.</div>
        <div style="margin-bottom:8px;">✅ Partilha apenas conteúdo relacionado com os estudos.</div>
        <div style="margin-bottom:8px;">❌ Não envies spam ou conteúdo inapropriado.</div>
        <div style="margin-bottom:8px;">❌ Não uses linguagem ofensiva ou discriminatória.</div>
        <div>⚠️ O incumprimento pode resultar em suspensão.</div>
      </div>`,
      actions: [{ label: 'Entendido', dismiss: true }]
    });
  });
  document.getElementById('bp-report-btn')?.addEventListener('click', () => {
    const t = encodeURIComponent(`[ExameNova — Bate-papo] Problema reportado no grupo ${_groupId}`);
    window.open(`https://wa.me/258848920143?text=${t}`, '_blank');
  });
}

// ============================================================
// EMOJI PANEL
// ============================================================

function _wireEmojiPanel() {
  _buildEmojiQuickRow();
  document.getElementById('bp-eq-more')?.addEventListener('click', _openEmojiPanel);
  document.getElementById('bp-emoji-overlay')?.addEventListener('click', _closeEmojiPanel);
}

function _loadRecentEmojis() {
  try {
    const r = localStorage.getItem(RECENT_EMOJI_KEY);
    return r ? JSON.parse(r) : [...DEFAULT_RECENT_EMOJIS];
  } catch { return [...DEFAULT_RECENT_EMOJIS]; }
}

function _saveRecentEmojis() {
  try { localStorage.setItem(RECENT_EMOJI_KEY, JSON.stringify(_recentEmojis)); } catch {}
}

function _useEmoji(emoji) {
  _recentEmojis = [emoji, ..._recentEmojis.filter(e => e !== emoji)].slice(0, 8);
  _saveRecentEmojis();
}

function _buildEmojiQuickRow() {
  for (let i = 0; i < 5; i++) {
    const el = document.getElementById(`bp-eq-${i}`);
    if (el && _recentEmojis[i]) {
      el.textContent = _recentEmojis[i];
      const clone = el.cloneNode(true);
      el.replaceWith(clone);
      clone.addEventListener('click', () => _insertEmoji(_recentEmojis[i]));
    }
  }
}

function _openEmojiPanel() {
  const recent = document.getElementById('bp-emoji-recent');
  const all    = document.getElementById('bp-emoji-all');
  if (recent) {
    recent.innerHTML = '';
    _recentEmojis.forEach(em => {
      const s = document.createElement('span');
      s.className = 'bp-em'; s.textContent = em;
      s.addEventListener('click', () => _insertEmoji(em));
      recent.appendChild(s);
    });
  }
  if (all) {
    all.innerHTML = '';
    ALL_EMOJIS.forEach(em => {
      const s = document.createElement('span');
      s.className = 'bp-em'; s.textContent = em;
      s.addEventListener('click', () => _insertEmoji(em));
      all.appendChild(s);
    });
  }
  document.getElementById('bp-emoji-panel')?.classList.add('open');
  document.getElementById('bp-emoji-overlay')?.classList.add('open');
}

function _closeEmojiPanel() {
  document.getElementById('bp-emoji-panel')?.classList.remove('open');
  document.getElementById('bp-emoji-overlay')?.classList.remove('open');
}

function _insertEmoji(emoji) {
  const ta = document.getElementById('bp-textarea');
  if (!ta) return;
  const pos = ta.selectionStart ?? ta.value.length;
  ta.value  = ta.value.slice(0, pos) + emoji + ta.value.slice(pos);
  ta.selectionStart = ta.selectionEnd = pos + emoji.length;
  ta.focus();
  _useEmoji(emoji);
  _buildEmojiQuickRow();
  _closeEmojiPanel();
  const sendBtn = document.getElementById('bp-send-btn');
  if (sendBtn) sendBtn.disabled = !ta.value.trim();
}

// ============================================================
// SCROLL
// ============================================================

function _wireScroll() {
  const c   = document.getElementById('bp-messages');
  const btn = document.getElementById('bp-scroll-btn');
  if (!c || !btn) return;

  c.addEventListener('scroll', () => {
    const atBottom = c.scrollTop + c.clientHeight >= c.scrollHeight - 80;
    if (atBottom) {
      btn.classList.remove('show');
      const badge = document.getElementById('bp-unread-badge');
      if (badge) badge.style.display = 'none';
    } else {
      btn.classList.add('show');
    }
    if (c.scrollTop < 60 && !_loadingMore && _lastDoc) _loadMoreMessages();
  }, { passive: true });

  btn.addEventListener('click', () => {
    _scrollToBottom(true);
    const badge = document.getElementById('bp-unread-badge');
    if (badge) badge.style.display = 'none';
  });
}

function _scrollToBottom(smooth) {
  const c = document.getElementById('bp-messages');
  if (!c) return;
  if (smooth) c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' });
  else        c.scrollTop = c.scrollHeight;
}

function _showUnreadBadge() {
  const badge = document.getElementById('bp-unread-badge');
  const btn   = document.getElementById('bp-scroll-btn');
  if (!badge || !btn) return;
  btn.classList.add('show');
  badge.style.display = 'flex';
  badge.textContent   = (parseInt(badge.textContent) || 0) + 1;
}

// ============================================================
// DARK TOGGLE
// ============================================================

function _wireDarkToggle() {
  const btn  = document.getElementById('bp-dark-toggle');
  const icon = document.getElementById('bp-dark-icon');
  const sync = () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark'
      || document.body.classList.contains('night');
    if (icon) icon.className = dark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  };
  sync();
  if (btn && !btn._wired) {
    btn._wired = true;
    btn.addEventListener('click', () => { ui.toggleDarkMode(); sync(); });
  }
}

// ============================================================
// CACHE HELPERS
// ============================================================

function _loadReactionsCache(gid) {
  try { const r = localStorage.getItem(REACTIONS_CACHE_KEY(gid)); return r ? JSON.parse(r) : {}; }
  catch { return {}; }
}
function _saveReactionsCache(gid, rx) {
  try { localStorage.setItem(REACTIONS_CACHE_KEY(gid), JSON.stringify(rx)); } catch {}
}
function _loadGroupCache(gid) {
  try { const r = localStorage.getItem(GROUP_CACHE_KEY(gid)); return r ? JSON.parse(r) : null; }
  catch { return null; }
}
function _saveGroupCache(gid, data) {
  try { localStorage.setItem(GROUP_CACHE_KEY(gid), JSON.stringify(data)); } catch {}
}

// ============================================================
// DATE / TIME
// ============================================================

function _getMsgDate(msg) {
  const ts  = msg.sentAt?.toDate?.() || new Date(msg.sentAt || Date.now());
  const now = new Date();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (_isSameDay(ts, now))  return 'Hoje';
  if (_isSameDay(ts, yest)) return 'Ontem';
  return ts.toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric' });
}
function _isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth()  === b.getMonth()
    && a.getDate()   === b.getDate();
}
function _isDifferentMinute(a, b) {
  const ta = a.sentAt?.toDate?.() || new Date(a.sentAt || 0);
  const tb = b.sentAt?.toDate?.() || new Date(b.sentAt || 0);
  return Math.abs(ta.getTime() - tb.getTime()) > 60000;
}
function _formatTime(sentAt) {
  const ts = sentAt?.toDate?.() || new Date(sentAt || Date.now());
  return ts.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
}

// ============================================================
// UTILS
// ============================================================

function _getInitials(name) {
  if (!name) return '?';
  const p = name.trim().split(' ');
  return (p[0][0] + (p[1]?.[0] || '')).toUpperCase();
}

function _esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default BatePapoScreen;
