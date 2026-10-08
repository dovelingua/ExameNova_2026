// ============================================================
// ExameNova — Homepage JS
// File: public/js/index.js
//
// Handles homepage-specific behaviour only.
// shared.js handles: navbar, FAQ, footer year, scroll-reveal.
// ============================================================

(function () {
  'use strict';

  // ── HERO PARTICLES (lightweight, CSS-free) ───────────────
  // Small floating dots in the hero — pure JS, no library
  function createParticles() {
    const hero = document.querySelector('.hero');
    if (!hero) return;

    // Only create if user has no motion preference
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const count = 6;
    const sizes  = [5, 4, 7, 3, 6, 4];
    const lefts  = ['10%', '82%', '50%', '65%', '28%', '90%'];
    const tops   = ['76%', '64%', '82%', '70%', '79%', '68%'];
    const delays = ['0s', '1.8s', '3.4s', '5.2s', '2.3s', '4.1s'];

    for (let i = 0; i < count; i++) {
      const dot = document.createElement('div');
      dot.setAttribute('aria-hidden', 'true');
      dot.style.cssText = `
        position:absolute;
        width:${sizes[i]}px;
        height:${sizes[i]}px;
        left:${lefts[i]};
        top:${tops[i]};
        background:rgba(255,255,255,0.18);
        border-radius:50%;
        pointer-events:none;
        opacity:0;
        animation:particleFly 9s ease-in-out infinite;
        animation-delay:${delays[i]};
      `;
      hero.appendChild(dot);
    }

    // Inject the keyframe once
    if (!document.getElementById('particle-kf')) {
      const style = document.createElement('style');
      style.id = 'particle-kf';
      style.textContent = `
        @keyframes particleFly {
          0%   { opacity:0; transform:translateY(0) scale(0); }
          10%  { opacity:0.4; }
          90%  { opacity:0.12; }
          100% { opacity:0; transform:translateY(-130px) scale(1.5); }
        }
      `;
      document.head.appendChild(style);
    }
  }

  // ── INSTALL PROMPT ───────────────────────────────────────
  // Show a subtle PWA install prompt after the hero
  // Only on mobile, only once per session
  let deferredInstallPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
  });

  // ── INIT ─────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    createParticles();
  });

})();
