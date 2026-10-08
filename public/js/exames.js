// ============================================================
// ExameNova — Exames Page JS
// File: public/js/exames.js
//
// RESPONSIBILITIES:
//   1. Exam data — fetched from Firestore (exam catalogue)
//      Falls back to static demo data if Firestore unavailable
//   2. Render exam cards into #exams-grid
//   3. Filter + search logic (client-side, instant)
//   4. Download gate — 3 free, then modal
//   5. Modal — group + invite code verification via Worker
//   6. Download tracking — anonymous log per download
//
// DOWNLOAD GATE FLOW:
//   - localStorage key 'en_dl_count'  — number of downloads
//   - localStorage key 'en_dl_unlocked' — 'true' if verified
//   - First 3 downloads: free, no modal, count increments
//   - 4th download onwards: modal appears (unless unlocked)
//   - Verified via group + invite code → Worker validates
//   - On success: en_dl_unlocked = 'true', download proceeds
//
// WORKER ENDPOINT:
//   Replace WORKER_URL with the actual Cloudflare Worker URL
//   Teacher Dove provides this — never hardcode secrets here.
//
// FIRESTORE:
//   Exam catalogue lives in collection 'publicExams'.
//   Each document matches the EXAM shape below.
//   Falls back to DEMO_EXAMS if Firestore unavailable.
// ============================================================

(function () {
  'use strict';

  // ── CONFIGURATION ────────────────────────────────────────
  const WORKER_URL    = 'https://YOUR_WORKER.workers.dev'; // Teacher Dove sets this
  const FREE_LIMIT    = 3;
  const LS_COUNT      = 'en_dl_count';
  const LS_UNLOCKED   = 'en_dl_unlocked';

  // ── FIREBASE (CDN) ───────────────────────────────────────
  // Loaded inline here so exames.html has no module dependency.
  // ExameNova's panel uses ES modules; this public page uses
  // a classic script tag approach for simplicity.
  const FIREBASE_CONFIG = {
    apiKey:            'REPLACE_WITH_YOUR_KEY',
    authDomain:        'REPLACE.firebaseapp.com',
    projectId:         'REPLACE',
    storageBucket:     'REPLACE.appspot.com',
    messagingSenderId: 'REPLACE',
    appId:             'REPLACE',
  };
  // Teacher Dove fills in the Firebase config above.
  // The public exam catalogue is READ ONLY — no auth needed.

  // ── EXAM DATA SHAPE ─────────────────────────────────────
  // Each exam object:
  // {
  //   id:          string  — unique document ID
  //   title:       string  — full title e.g. "Exame Nacional de Matemática"
  //   subject:     string  — e.g. "matematica"
  //   subjectLabel:string  — e.g. "Matemática"
  //   grade:       string  — "9" | "12" | "admissao"
  //   gradeLabel:  string  — "9ª Classe" | "12ª Classe" | "Admissão"
  //   year:        string  — "2023"
  //   chamada:     string  — "1" | "2"
  //   institution: string  — "MEC" | "UEM" | "IFP" | "ACIPOL" | "Matalane" | ""
  //   pdfUrl:      string  — Cloudinary URL
  // }

  // ── DEMO EXAMS (fallback when Firestore not yet populated) ──
  const DEMO_EXAMS = [
    {
      id: 'd1', title: 'Exame Nacional de Matemática',
      subject: 'matematica', subjectLabel: 'Matemática',
      grade: '12', gradeLabel: '12ª Classe',
      year: '2023', chamada: '1', institution: 'MEC', pdfUrl: '#',
    },
    {
      id: 'd2', title: 'Exame Nacional de Matemática',
      subject: 'matematica', subjectLabel: 'Matemática',
      grade: '12', gradeLabel: '12ª Classe',
      year: '2023', chamada: '2', institution: 'MEC', pdfUrl: '#',
    },
    {
      id: 'd3', title: 'Exame Nacional de Língua Portuguesa',
      subject: 'portugues', subjectLabel: 'Língua Portuguesa',
      grade: '12', gradeLabel: '12ª Classe',
      year: '2023', chamada: '1', institution: 'MEC', pdfUrl: '#',
    },
    {
      id: 'd4', title: 'Exame Nacional de Língua Portuguesa',
      subject: 'portugues', subjectLabel: 'Língua Portuguesa',
      grade: '12', gradeLabel: '12ª Classe',
      year: '2023', chamada: '2', institution: 'MEC', pdfUrl: '#',
    },
    {
      id: 'd5', title: 'Exame Nacional de Física',
      subject: 'fisica', subjectLabel: 'Física',
      grade: '12', gradeLabel: '12ª Classe',
      year: '2022', chamada: '1', institution: 'MEC', pdfUrl: '#',
    },
    {
      id: 'd6', title: 'Exame Nacional de Química',
      subject: 'quimica', subjectLabel: 'Química',
      grade: '12', gradeLabel: '12ª Classe',
      year: '2022', chamada: '1', institution: 'MEC', pdfUrl: '#',
    },
    {
      id: 'd7', title: 'Exame Nacional de Biologia',
      subject: 'biologia', subjectLabel: 'Biologia',
      grade: '12', gradeLabel: '12ª Classe',
      year: '2022', chamada: '2', institution: 'MEC', pdfUrl: '#',
    },
    {
      id: 'd8', title: 'Exame Nacional de História',
      subject: 'historia', subjectLabel: 'História',
      grade: '12', gradeLabel: '12ª Classe',
      year: '2023', chamada: '1', institution: 'MEC', pdfUrl: '#',
    },
    {
      id: 'd9', title: 'Exame Nacional de Geografia',
      subject: 'geografia', subjectLabel: 'Geografia',
      grade: '12', gradeLabel: '12ª Classe',
      year: '2022', chamada: '1', institution: 'MEC', pdfUrl: '#',
    },
    {
      id: 'd10', title: 'Exame Nacional de Língua Portuguesa',
      subject: 'portugues', subjectLabel: 'Língua Portuguesa',
      grade: '9', gradeLabel: '9ª Classe',
      year: '2023', chamada: '1', institution: 'MEC', pdfUrl: '#',
    },
    {
      id: 'd11', title: 'Exame Nacional de Matemática',
      subject: 'matematica', subjectLabel: 'Matemática',
      grade: '9', gradeLabel: '9ª Classe',
      year: '2023', chamada: '1', institution: 'MEC', pdfUrl: '#',
    },
    {
      id: 'd12', title: 'Exame de Admissão — Língua Portuguesa',
      subject: 'portugues', subjectLabel: 'Língua Portuguesa',
      grade: 'admissao', gradeLabel: 'Admissão',
      year: '2023', chamada: '1', institution: 'ACIPOL', pdfUrl: '#',
    },
    {
      id: 'd13', title: 'Exame de Admissão — Língua Portuguesa',
      subject: 'portugues', subjectLabel: 'Língua Portuguesa',
      grade: 'admissao', gradeLabel: 'Admissão',
      year: '2022', chamada: '1', institution: 'IFP', pdfUrl: '#',
    },
    {
      id: 'd14', title: 'Exame de Admissão — Matemática',
      subject: 'matematica', subjectLabel: 'Matemática',
      grade: 'admissao', gradeLabel: 'Admissão',
      year: '2023', chamada: '1', institution: 'IFP', pdfUrl: '#',
    },
    {
      id: 'd15', title: 'Exame de Admissão — Prova Escrita',
      subject: 'prova-escrita', subjectLabel: 'Prova Escrita',
      grade: 'admissao', gradeLabel: 'Admissão',
      year: '2022', chamada: '1', institution: 'Matalane', pdfUrl: '#',
    },
  ];

  // ── SUBJECT ICONS + COLOURS ──────────────────────────────
  const SUBJECT_META = {
    matematica:  { icon: 'fa-calculator',   color: '#0284C7', bg: '#E0F2FE' },
    portugues:   { icon: 'fa-book-open',     color: '#8B5CF6', bg: '#EDE9FE' },
    ingles:      { icon: 'fa-language',      color: '#14B8A6', bg: '#CCFBF1' },
    frances:     { icon: 'fa-comment',       color: '#F59E0B', bg: '#FEF3C7' },
    fisica:      { icon: 'fa-atom',          color: '#0369A1', bg: '#E0F2FE' },
    quimica:     { icon: 'fa-flask',         color: '#059669', bg: '#D1FAE5' },
    biologia:    { icon: 'fa-dna',           color: '#22C55E', bg: '#DCFCE7' },
    historia:    { icon: 'fa-landmark',      color: '#D97706', bg: '#FEF3C7' },
    geografia:   { icon: 'fa-earth-africa',  color: '#0F766E', bg: '#CCFBF1' },
    filosofia:   { icon: 'fa-lightbulb',     color: '#7C3AED', bg: '#EDE9FE' },
    'prova-escrita': { icon: 'fa-file-pen',  color: '#6B7280', bg: '#F3F4F6' },
  };

  function subjectMeta(subject) {
    return SUBJECT_META[subject] || { icon: 'fa-file-pdf', color: '#0284C7', bg: '#E0F2FE' };
  }

  // ── GRADE BAR COLOUR ─────────────────────────────────────
  function gradeBarColor(grade) {
    if (grade === '9')        return 'linear-gradient(90deg,#0284C7,#38BDF8)';
    if (grade === '12')       return 'linear-gradient(90deg,#8B5CF6,#A78BFA)';
    if (grade === 'admissao') return 'linear-gradient(90deg,#14B8A6,#34D399)';
    return 'linear-gradient(90deg,#0284C7,#38BDF8)';
  }

  // ── RENDER A SINGLE EXAM CARD ────────────────────────────
  function renderCard(exam, dlCount, unlocked) {
    const meta     = subjectMeta(exam.subject);
    const isFree   = unlocked || dlCount < FREE_LIMIT;
    const barColor = gradeBarColor(exam.grade);

    const instBadge = exam.institution
      ? `<span class="badge badge-institution">${exam.institution}</span>`
      : '';

    const chamadaBadgeClass = exam.chamada === '2' ? 'badge-chamada-2' : 'badge-chamada-1';
    const chamadaLabel      = exam.chamada === '2' ? '2ª Chamada' : '1ª Chamada';

    const btnClass = isFree ? 'free' : 'locked';
    const btnIcon  = isFree ? 'fa-download' : 'fa-lock';
    const btnLabel = isFree ? 'Descarregar PDF' : 'Descarregar — verificar conta';

    return `
      <article
        class="exam-card"
        role="listitem"
        data-id="${exam.id}"
        data-subject="${exam.subject}"
        data-grade="${exam.grade}"
        data-year="${exam.year}"
        data-chamada="${exam.chamada}"
        data-institution="${(exam.institution || '').toLowerCase()}"
        data-title="${exam.title.toLowerCase()} ${exam.subjectLabel.toLowerCase()} ${exam.year}"
        data-pdf="${exam.pdfUrl}"
        aria-label="${exam.subjectLabel} — ${exam.gradeLabel} — ${exam.year} — ${chamadaLabel}"
      >
        <div class="exam-card-bar" style="background:${barColor};" aria-hidden="true"></div>

        <div class="exam-card-body">
          <div class="exam-card-top">
            <div class="exam-card-icon" style="background:${meta.bg};" aria-hidden="true">
              <i class="fa-solid ${meta.icon}" style="color:${meta.color};"></i>
            </div>
            <div class="exam-card-badges">
              <span class="badge badge-grade">${exam.gradeLabel}</span>
              <span class="badge ${chamadaBadgeClass}">${chamadaLabel}</span>
              ${instBadge}
            </div>
          </div>

          <div class="exam-card-subject">${exam.subjectLabel}</div>
          <div class="exam-card-title">${exam.title}</div>

          <div class="exam-card-meta">
            <div class="exam-card-meta-item">
              <i class="fa-regular fa-calendar" aria-hidden="true"></i>
              ${exam.year}
            </div>
            <div class="exam-card-meta-item">
              <i class="fa-solid fa-graduation-cap" aria-hidden="true"></i>
              ${exam.gradeLabel}
            </div>
            ${exam.institution ? `
            <div class="exam-card-meta-item">
              <i class="fa-solid fa-university" aria-hidden="true"></i>
              ${exam.institution}
            </div>` : ''}
          </div>
        </div>

        <div class="exam-card-footer">
          <button
            class="exam-download-btn ${btnClass}"
            data-exam-id="${exam.id}"
            aria-label="Descarregar ${exam.subjectLabel} ${exam.year}"
          >
            <i class="fa-solid ${btnIcon}" aria-hidden="true"></i>
            ${btnLabel}
          </button>
        </div>
      </article>
    `;
  }

  // ── STATE ────────────────────────────────────────────────
  let allExams      = [];
  let filteredExams = [];
  let pendingExam   = null; // exam waiting for gate verification

  function getDlCount()  {
    try { return parseInt(localStorage.getItem(LS_COUNT) || '0'); } catch { return 0; }
  }
  function setDlCount(n) {
    try { localStorage.setItem(LS_COUNT, String(n)); } catch {}
  }
  function isUnlocked()  {
    try { return localStorage.getItem(LS_UNLOCKED) === 'true'; } catch { return false; }
  }
  function setUnlocked() {
    try { localStorage.setItem(LS_UNLOCKED, 'true'); } catch {}
  }

  // ── RENDER GRID ──────────────────────────────────────────
  function renderGrid(exams) {
    const grid  = document.getElementById('exams-grid');
    const empty = document.getElementById('exams-empty');
    const count = document.getElementById('results-count');
    if (!grid) return;

    const dlCount  = getDlCount();
    const unlocked = isUnlocked();

    if (!exams.length) {
      grid.innerHTML  = '';
      grid.appendChild(empty);
      empty.classList.add('visible');
      if (count) count.innerHTML = 'Nenhum resultado encontrado.';
      return;
    }

    empty.classList.remove('visible');
    grid.innerHTML = exams.map(e => renderCard(e, dlCount, unlocked)).join('');

    if (count) {
      count.innerHTML = `<strong>${exams.length}</strong> exame${exams.length !== 1 ? 's' : ''} encontrado${exams.length !== 1 ? 's' : ''}`;
    }

    // Wire download buttons
    grid.querySelectorAll('.exam-download-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const examId = btn.dataset.examId;
        const exam   = allExams.find(x => x.id === examId);
        if (exam) handleDownload(exam);
      });
    });
  }

  // ── FILTER LOGIC ─────────────────────────────────────────
  function applyFilters() {
    const grade    = document.getElementById('filter-grade')?.value   || '';
    const subject  = document.getElementById('filter-subject')?.value || '';
    const year     = document.getElementById('filter-year')?.value    || '';
    const chamada  = document.getElementById('filter-chamada')?.value || '';
    const search   = (document.getElementById('filter-search')?.value || '').toLowerCase().trim();

    const hasFilters = grade || subject || year || chamada || search;
    const clearBtn   = document.getElementById('filter-clear');
    if (clearBtn) clearBtn.classList.toggle('visible', !!hasFilters);

    filteredExams = allExams.filter(exam => {
      if (grade   && exam.grade   !== grade)   return false;
      if (subject && exam.subject !== subject) return false;
      if (year    && exam.year    !== year)    return false;
      if (chamada && exam.chamada !== chamada) return false;
      if (search) {
        const hay = `${exam.title} ${exam.subjectLabel} ${exam.year} ${exam.institution}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    renderGrid(filteredExams);
  }

  // ── DOWNLOAD HANDLER ─────────────────────────────────────
  function handleDownload(exam) {
    const dlCount  = getDlCount();
    const unlocked = isUnlocked();

    if (unlocked || dlCount < FREE_LIMIT) {
      // Free download — proceed directly
      triggerDownload(exam);
      setDlCount(dlCount + 1);
      trackDownload(exam);
    } else {
      // Gate — show modal
      pendingExam = exam;
      openModal(exam);
    }
  }

  function triggerDownload(exam) {
    if (!exam.pdfUrl || exam.pdfUrl === '#') {
      // PDF not yet uploaded — friendly notice
      showTempNotice('Este PDF ainda não está disponível. Brevemente!');
      return;
    }
    const a = document.createElement('a');
    a.href     = exam.pdfUrl;
    a.download = `${exam.subjectLabel}_${exam.gradeLabel}_${exam.year}_${exam.chamada}a-Chamada.pdf`.replace(/\s+/g, '_');
    a.target   = '_blank';
    a.rel      = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function trackDownload(exam) {
    // Anonymous tracking — sent to Cloudflare Worker
    // Teacher Dove wires this to the Worker once URL is set
    if (!WORKER_URL || WORKER_URL.includes('YOUR_WORKER')) return;
    fetch(`${WORKER_URL}/track-download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        examId:      exam.id,
        subject:     exam.subject,
        grade:       exam.grade,
        year:        exam.year,
        chamada:     exam.chamada,
        institution: exam.institution,
        ts:          Date.now(),
      }),
    }).catch(() => {}); // silent — tracking is best-effort
  }

  // ── TEMPORARY NOTICE ─────────────────────────────────────
  function showTempNotice(msg) {
    let el = document.getElementById('temp-notice');
    if (!el) {
      el = document.createElement('div');
      el.id = 'temp-notice';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      el.style.cssText = `
        position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
        background:#212121; color:#fff; font-size:13px; font-weight:600;
        padding:12px 20px; border-radius:50px;
        box-shadow:0 4px 20px rgba(0,0,0,0.25);
        z-index:9999; white-space:nowrap;
        animation:fadeUp 0.3s ease both;
      `;
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(el._timer);
    el._timer = setTimeout(() => { el.style.display = 'none'; }, 3500);
  }

  // ── MODAL ────────────────────────────────────────────────
  function openModal(exam) {
    const overlay     = document.getElementById('modal-overlay');
    const defaultView = document.getElementById('modal-default');
    const successView = document.getElementById('modal-success');
    const errorEl     = document.getElementById('modal-error');
    const nameEl      = document.getElementById('modal-exam-name');
    const metaEl      = document.getElementById('modal-exam-meta');
    const iconEl      = document.getElementById('modal-exam-icon');
    const codeInput   = document.getElementById('modal-invite-code');
    const groupSelect = document.getElementById('modal-group-select');
    const verifyBtn   = document.getElementById('modal-verify-btn');

    // Reset
    if (defaultView) defaultView.style.display = 'block';
    if (successView) successView.classList.remove('visible');
    if (errorEl)     errorEl.classList.remove('visible');
    if (codeInput)   codeInput.value = '';
    if (groupSelect) groupSelect.value = '';
    if (verifyBtn)   verifyBtn.disabled = true;

    // Fill exam info
    if (nameEl) nameEl.textContent = `${exam.subjectLabel} — ${exam.year}`;
    if (metaEl) metaEl.innerHTML = `
      <span>${exam.gradeLabel}</span>
      <span>·</span>
      <span>${exam.chamada === '2' ? '2ª Chamada' : '1ª Chamada'}</span>
      ${exam.institution ? `<span>·</span><span>${exam.institution}</span>` : ''}
    `;

    const meta = subjectMeta(exam.subject);
    if (iconEl) {
      iconEl.style.background = meta.bg;
      iconEl.innerHTML = `<i class="fa-solid ${meta.icon}" style="color:${meta.color};font-size:17px;"></i>`;
    }

    overlay?.classList.add('open');
    document.body.style.overflow = 'hidden';

    // Enable verify button when both fields filled
    function checkReady() {
      if (verifyBtn) {
        verifyBtn.disabled = !(groupSelect?.value && codeInput?.value.trim().length >= 4);
      }
    }

    groupSelect?.addEventListener('change', checkReady);
    codeInput?.addEventListener('input', () => {
      // Auto-format: ENV-XXXX uppercase
      let val = codeInput.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
      codeInput.value = val;
      checkReady();
    });
  }

  function closeModal() {
    const overlay = document.getElementById('modal-overlay');
    overlay?.classList.remove('open');
    document.body.style.overflow = '';
    pendingExam = null;
  }

  // ── MODAL VERIFY ─────────────────────────────────────────
  async function verifyAndDownload() {
    const groupSelect = document.getElementById('modal-group-select');
    const codeInput   = document.getElementById('modal-invite-code');
    const verifyBtn   = document.getElementById('modal-verify-btn');
    const errorEl     = document.getElementById('modal-error');
    const errorText   = document.getElementById('modal-error-text');

    const group = groupSelect?.value || '';
    const code  = codeInput?.value.trim().toUpperCase() || '';

    if (!group || !code) return;

    // Loading state
    if (verifyBtn) {
      verifyBtn.disabled = true;
      verifyBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> A verificar...';
    }
    if (errorEl) errorEl.classList.remove('visible');

    try {
      // Call Cloudflare Worker to validate group + invite code
      // Worker checks: does this invite code exist AND belong to this group?
      if (!WORKER_URL || WORKER_URL.includes('YOUR_WORKER')) {
        // Dev mode: accept any code for testing
        handleVerifySuccess();
        return;
      }

      const res  = await fetch(`${WORKER_URL}/verify-download-gate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group, code }),
      });

      const data = await res.json();

      if (data.valid) {
        handleVerifySuccess();
      } else {
        throw new Error(data.message || 'invalid');
      }

    } catch (err) {
      if (errorEl) errorEl.classList.add('visible');
      if (errorText) {
        errorText.textContent = err.message === 'invalid'
          ? 'Código ou grupo incorrectos. Confirma os teus dados e tenta novamente.'
          : 'Erro de ligação. Verifica a tua internet e tenta novamente.';
      }
      if (verifyBtn) {
        verifyBtn.disabled = false;
        verifyBtn.innerHTML = '<i class="fa-solid fa-shield-check"></i> Verificar e descarregar';
      }
    }
  }

  function handleVerifySuccess() {
    setUnlocked();

    const defaultView = document.getElementById('modal-default');
    const successView = document.getElementById('modal-success');
    const dlLink      = document.getElementById('modal-dl-link');

    if (defaultView) defaultView.style.display = 'none';
    if (successView) successView.classList.add('visible');

    if (dlLink && pendingExam) {
      dlLink.href     = pendingExam.pdfUrl;
      dlLink.download = `${pendingExam.subjectLabel}_${pendingExam.gradeLabel}_${pendingExam.year}.pdf`.replace(/\s+/g, '_');
    }

    // Trigger download automatically after brief delay
    if (pendingExam) {
      setTimeout(() => {
        triggerDownload(pendingExam);
        trackDownload(pendingExam);
      }, 600);
    }

    // Re-render grid to remove locks
    renderGrid(filteredExams.length ? filteredExams : allExams);
  }

  // ── LOAD EXAMS ───────────────────────────────────────────
  async function loadExams() {
    const count = document.getElementById('results-count');
    if (count) count.innerHTML = 'A carregar exames...';

    try {
      // Try to load from Firestore
      // Teacher Dove fills in the Firebase config at the top
      // When config is placeholder, fall back to demo data
      if (FIREBASE_CONFIG.apiKey === 'REPLACE_WITH_YOUR_KEY') {
        throw new Error('firebase-not-configured');
      }

      // Dynamic Firebase import (CDN)
      const { initializeApp }   = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
      const { getFirestore, collection, getDocs, orderBy, query }
        = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

      const app = initializeApp(FIREBASE_CONFIG, 'exames-public');
      const db  = getFirestore(app);

      const q    = query(collection(db, 'publicExams'), orderBy('year', 'desc'));
      const snap = await getDocs(q);

      allExams = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      if (!allExams.length) throw new Error('empty');

    } catch {
      // Fall back to demo data
      allExams = DEMO_EXAMS;
    }

    filteredExams = [...allExams];
    renderGrid(filteredExams);
  }

  // ── WIRE FILTERS ─────────────────────────────────────────
  function wireFilters() {
    ['filter-grade', 'filter-subject', 'filter-year', 'filter-chamada'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', applyFilters);
    });

    let searchTimer;
    document.getElementById('filter-search')?.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(applyFilters, 280);
    });

    document.getElementById('filter-clear')?.addEventListener('click', () => {
      ['filter-grade', 'filter-subject', 'filter-year', 'filter-chamada'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      const search = document.getElementById('filter-search');
      if (search) search.value = '';
      applyFilters();
    });
  }

  // ── WIRE MODAL EVENTS ────────────────────────────────────
  function wireModal() {
    document.getElementById('modal-close')?.addEventListener('click', closeModal);
    document.getElementById('modal-overlay')?.addEventListener('click', (e) => {
      if (e.target === document.getElementById('modal-overlay')) closeModal();
    });

    document.getElementById('modal-verify-btn')?.addEventListener('click', verifyAndDownload);

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });
  }

  // ── INIT ─────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    wireFilters();
    wireModal();
    loadExams();
  });

})();
