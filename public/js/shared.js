// ============================================================
// ExameNova — Shared Public Site JS
// File: public/js/shared.js
//
// Imported by every public HTML page via:
//   <script src="/public/js/shared.js" defer></script>
//
// CONTAINS:
//   1. Navbar scroll + hamburger + mobile menu
//   2. FAQ accordion
//   3. Smooth scroll for anchor links
//   4. Footer year
//   5. Active nav link detection
//   6. Scroll-reveal animation
// ============================================================

(function () {
  'use strict';

  // ── 1. FOOTER YEAR ───────────────────────────────────────
  document.querySelectorAll('.js-year').forEach(el => {
    el.textContent = new Date().getFullYear();
  });

  // ── 2. NAVBAR SCROLL ────────────────────────────────────
  const nav = document.getElementById('main-nav');
  if (nav) {
    const onScroll = () => {
      nav.classList.toggle('scrolled', window.scrollY > 44);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll(); // apply on load in case page is already scrolled
  }

  // ── 3. HAMBURGER + MOBILE MENU ──────────────────────────
  const hamburger  = document.getElementById('nav-hamburger');
  const mobileMenu = document.getElementById('nav-mobile');
  let menuOpen = false;

  function openMenu() {
    menuOpen = true;
    if (mobileMenu) mobileMenu.classList.add('open');
    if (hamburger)  hamburger.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    document.body.style.overflow = 'hidden';
  }

  function closeMenu() {
    menuOpen = false;
    if (mobileMenu) mobileMenu.classList.remove('open');
    if (hamburger)  hamburger.innerHTML = '<i class="fa-solid fa-bars"></i>';
    document.body.style.overflow = '';
  }

  if (hamburger) {
    hamburger.addEventListener('click', () => {
      menuOpen ? closeMenu() : openMenu();
    });
  }

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (
      menuOpen &&
      mobileMenu && !mobileMenu.contains(e.target) &&
      hamburger && !hamburger.contains(e.target)
    ) {
      closeMenu();
    }
  });

  // Close on mobile link tap
  document.querySelectorAll('.nav-mobile-link, .nav-mobile-btn').forEach(el => {
    el.addEventListener('click', closeMenu);
  });

  // ── 4. ACTIVE NAV LINK ──────────────────────────────────
  // Highlights the nav link matching the current page path
  const currentPath = window.location.pathname.replace(/\/$/, '');
  document.querySelectorAll('.nav-link[href], .nav-mobile-link[href]').forEach(link => {
    const href = link.getAttribute('href').replace(/\/$/, '');
    if (href && currentPath.endsWith(href) && href !== '/') {
      link.classList.add('active');
    }
  });

  // ── 5. FAQ ACCORDION ────────────────────────────────────
  // Works with any .faq-item > .faq-question + .faq-answer structure
  document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', () => {
      const item   = btn.closest('.faq-item');
      const isOpen = item.classList.contains('open');

      // Close all items in the same list
      const list = item.closest('.faq-list') || item.parentElement;
      list.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));

      // Toggle this one
      if (!isOpen) item.classList.add('open');
    });
  });

  // ── 6. SMOOTH SCROLL ────────────────────────────────────
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', (e) => {
      const id     = link.getAttribute('href');
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      closeMenu();
      const navHeight = nav ? nav.offsetHeight : 64;
      const top = target.getBoundingClientRect().top + window.scrollY - navHeight - 8;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  });

  // ── 7. SCROLL-REVEAL ────────────────────────────────────
  // Any element with class .reveal animates in when scrolled into view
  const reveals = document.querySelectorAll('.reveal');
  if (reveals.length && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    reveals.forEach(el => observer.observe(el));
  } else {
    // Fallback: just show everything
    reveals.forEach(el => el.classList.add('revealed'));
  }

})();
