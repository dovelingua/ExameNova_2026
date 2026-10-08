// ============================================================
// panel/js/core/meu-exame-pdf.js
// ExameNova — Meu Exame PDF Generator
//
// Generates the corrected exam PDF after Meu Exame submission.
// Called by renders/meu-exame-render.js — never called directly.
//
// PDF LAYOUT:
//   Page 1: Header (emblem + institution lines + subject line)
//            Title bar
//            Result summary box (score, correct, wrong, time)
//            Integrity note (if flagged)
//            Reading text (language subjects only)
//   Pages 2+: Questions with options
//              Student answer marked (✓ green / ✗ red)
//              Correct answer shown (● dark green when student wrong)
//   Last section: Composition text (9ª Classe language only)
//   Every page: Diagonal semi-transparent "ExameNova" watermark
//               Footer with platform notice
//
// TYPOGRAPHY:
//   Font:     Times New Roman (loaded from /panel/js/fonts/)
//   Body:     12pt throughout (exam standard)
//   Headers:  12pt bold
//   Title:    13pt bold centred
//   Footer:   8pt italic
//
// WATERMARK:
//   Text:     "ExameNova"
//   Opacity:  0.06 (semi-transparent)
//   Angle:    45° diagonal
//   Repeated: tiled across every page
//   Colour:   primary blue #0284C7
//
// Uses jsPDF loaded via CDN in panel/index.html.
// Uses /assets/images/emblem.png (passed as base64 from render).
// Uses Times New Roman font from /panel/js/fonts/timesNewRoman.js
// ============================================================

// ── Helper: parse AI option text (strip leading A) B) etc.) ──
function _parseOptText(text) {
  return String(text || '').replace(/^[A-Da-d][\.:)]\s*/i, '').trim();
}

// ── Helper: get options from a question object ────────────────
function _getOpts(q) {
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
  return letters
    .map(l => ({ letter: l, text: String(q[`Opção_${l}`] ?? '').trim() }))
    .filter(o => o.text.length > 0);
}

// ── Helper: format mm:ss ──────────────────────────────────────
function _fmtTime(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// ── Helper: line height in mm for a given font size (pt) ─────
function _lh(fs) {
  return fs * 0.3528 * 1.5;
}

// ============================================================
// DRAW WATERMARK — called on every page
// Tiles "ExameNova" diagonally at 45° across the full page
// ============================================================

function _drawWatermark(pdf) {
  const PW = 210;
  const PH = 297;

  pdf.saveGraphicsState();
  pdf.setFont('TimesNewRoman', 'bold');
  pdf.setFontSize(28);

  // Blue watermark colour at very low opacity
  // jsPDF does not support true opacity for text directly,
  // so we use a light grey-blue that reads as semi-transparent
  // when printed on white paper.
  pdf.setTextColor(180, 210, 230); // rgba(2,132,199,0.18) equivalent on white

  // Tile the watermark diagonally across the page
  // Step size controls density — smaller = more repetitions
  const stepX = 70;
  const stepY = 55;

  for (let row = -2; row < Math.ceil(PH / stepY) + 2; row++) {
    for (let col = -1; col < Math.ceil(PW / stepX) + 1; col++) {
      const x = col * stepX + (row % 2 === 0 ? 0 : stepX / 2);
      const y = row * stepY;

      pdf.text('ExameNova', x, y, {
        angle: 45,
        align: 'center',
      });
    }
  }

  pdf.setTextColor(0, 0, 0);
  pdf.restoreGraphicsState();
}

// ============================================================
// MAIN PDF GENERATOR
// ============================================================

export async function generateMeuExamePDF({
  subject,
  dbSubject,
  userData,
  questions,
  studentAnswers,
  correctAnswers,
  composition,
  examText,
  emblemB64,
  score,
  correctCount,
  wrongCount,
  totalTime,
  verdictLabel,
  tabSwitches,
  is9a,
  isLang,
}) {
  // ── Page constants ─────────────────────────────────────────
  const PW = 210;
  const PH = 297;
  const ML = 25;   // left margin
  const MR = 20;   // right margin
  const MT = 18;   // top margin
  const MB = 18;   // bottom margin
  const CW = PW - ML - MR;  // content width = 165mm

  // ── Load jsPDF ─────────────────────────────────────────────
  if (!window.jspdf) {
    throw new Error('jsPDF not loaded — check panel/index.html CDN tag');
  }
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // ── Load fonts ─────────────────────────────────────────────
  let fontLoaded = false;
  try {
    const fontModule = await import('/panel/js/fonts/timesNewRoman.js');
    const { TIMES_NORMAL, TIMES_BOLD, TIMES_ITALIC, TIMES_BOLDITALIC } = fontModule;
    pdf.addFileToVFS('Times-Normal.ttf',     TIMES_NORMAL);
    pdf.addFileToVFS('Times-Bold.ttf',       TIMES_BOLD);
    pdf.addFileToVFS('Times-Italic.ttf',     TIMES_ITALIC);
    pdf.addFileToVFS('Times-BoldItalic.ttf', TIMES_BOLDITALIC);
    pdf.addFont('Times-Normal.ttf',     'TimesNewRoman', 'normal');
    pdf.addFont('Times-Bold.ttf',       'TimesNewRoman', 'bold');
    pdf.addFont('Times-Italic.ttf',     'TimesNewRoman', 'italic');
    pdf.addFont('Times-BoldItalic.ttf', 'TimesNewRoman', 'bolditalic');
    fontLoaded = true;
  } catch (e) {
    console.warn('[MeuExamePDF] Font load failed — using Helvetica fallback:', e);
  }

  function setFont(style = 'normal', size = 12) {
    if (fontLoaded) {
      pdf.setFont('TimesNewRoman', style);
    } else {
      pdf.setFont('helvetica', style === 'bolditalic' ? 'bolditalic' : style);
    }
    pdf.setFontSize(size);
  }

  // ── State ──────────────────────────────────────────────────
  let y = MT;
  let pageNum = 1;

  function addPage() {
    // Draw watermark on the page we are finishing
    _drawWatermark(pdf);
    _drawFooter();
    pdf.addPage();
    pageNum++;
    y = MT;
    // Draw watermark on new page immediately so it is always behind content
    _drawWatermark(pdf);
  }

  function need(mm) {
    if (y + mm > PH - MB - 10) addPage();
  }

  function _drawFooter() {
    setFont('italic', 8);
    pdf.setTextColor(140, 140, 140);
    pdf.text(
      'Documento gerado pelo ExameNova · Simulação Pré-Exame · Não é um documento oficial do MEC',
      PW / 2, PH - 6, { align: 'center' }
    );
    pdf.setTextColor(0, 0, 0);
  }

  // Draw watermark on page 1 before any content
  _drawWatermark(pdf);

  // ── PAGE 1: HEADER ─────────────────────────────────────────

  // Emblem
  if (emblemB64) {
    try {
      pdf.addImage(emblemB64, 'PNG', PW / 2 - 10, y - 3, 20, 20);
      y += 24;
    } catch (e) {
      y += 4;
    }
  } else {
    y += 4;
  }

  // Institution header lines
  setFont('bold', 10);
  pdf.setTextColor(0, 0, 0);

  const district = userData?.district || '___________';
  const school   = userData?.school   || '___________';

  const headerLines = [
    'REPÚBLICA DE MOÇAMBIQUE',
    `GOVERNO DO DISTRITO DE ${district.toUpperCase()}`,
    school.toUpperCase(),
    'PLATAFORMA EXAMENOVA — SIMULAÇÃO PRÉ-EXAME',
  ];

  headerLines.forEach(line => {
    const lineLines = pdf.splitTextToSize(line, CW);
    pdf.text(lineLines, PW / 2, y, { align: 'center' });
    y += lineLines.length * _lh(10) + 0.5;
  });
  y += 4;

  // Subject and grade line
  setFont('italic', 12);
  const grade      = is9a ? '9ª Classe' : `${userData?.grade || '12'}ª Classe`;
  const examTypeStr = userData?.examType === 'admissao'
    ? `Admissão${userData?.institution ? ' — ' + userData.institution.toUpperCase() : ''}`
    : grade;

  pdf.text(`Disciplina de ${subject}`, ML, y);
  pdf.text(examTypeStr, ML + CW, y, { align: 'right' });
  y += _lh(12) + 2;

  // Divider line
  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.5);
  pdf.line(ML, y, ML + CW, y);
  y += 4;

  // Title
  setFont('bold', 13);
  const titleText  = `MEU EXAME — ${subject.toUpperCase()}`;
  const titleLines = pdf.splitTextToSize(titleText, CW);
  pdf.text(titleLines, PW / 2, y, { align: 'center' });
  y += titleLines.length * _lh(13) + 2;

  setFont('italic', 10);
  pdf.text('Simulação Pré-Exame · ExameNova', PW / 2, y, { align: 'center' });
  y += _lh(10) + 4;

  // Result summary box
  const summaryH = 26;
  pdf.setDrawColor(2, 132, 199);
  pdf.setLineWidth(0.6);
  pdf.setFillColor(240, 248, 255);
  pdf.rect(ML, y, CW, summaryH, 'FD');

  setFont('bold', 12);
  pdf.setTextColor(0, 0, 0);
  pdf.text(`Nota Final: ${score} / 20`, ML + 6, y + 8);

  setFont('bold', 12);
  pdf.setTextColor(
    score >= 10 ? 0 : 150,
    score >= 10 ? 120 : 0,
    0
  );
  pdf.text(verdictLabel, ML + CW - 6, y + 8, { align: 'right' });

  setFont('normal', 12);
  pdf.setTextColor(0, 0, 0);
  pdf.text(
    `Correctas: ${correctCount}   Erradas: ${wrongCount}   Tempo: ${_fmtTime(totalTime)}`,
    ML + 6, y + 16
  );

  setFont('italic', 10);
  pdf.setTextColor(80, 80, 80);
  pdf.text(
    `Total de questões: ${questions.length}`,
    ML + 6, y + 22
  );
  pdf.setTextColor(0, 0, 0);

  y += summaryH + 6;

  // Integrity note
  if (tabSwitches >= 2) {
    need(10);
    setFont('italic', 10);
    pdf.setTextColor(160, 100, 0);
    const flagText = `⚠ Nota de integridade: ${tabSwitches} saída(s) de página registada(s) durante o exame.`;
    const flagLines = pdf.splitTextToSize(flagText, CW);
    pdf.text(flagLines, ML, y);
    pdf.setTextColor(0, 0, 0);
    y += flagLines.length * _lh(10) + 4;
  }

  // ── READING TEXT (language subjects, page 1 or 2) ──────────

  if (isLang && examText?.conteudo) {
    need(20);

    // Section heading
    setFont('bold', 12);
    pdf.setTextColor(0, 0, 0);
    pdf.text('TEXTO DE LEITURA', ML, y);
    y += _lh(12) + 2;

    // Box around passage
    const passageTextStr = examText.conteudo || '';
    setFont('normal', 12);
    const passageLines = pdf.splitTextToSize(passageTextStr, CW - 8);
    const passageTitleH  = examText.titulo  ? _lh(12) + 2 : 0;
    const passageAutorH  = examText.autor   ? _lh(10) + 1 : 0;
    const passageGlossH  = examText.glossario ? _lh(9) + 3 : 0;
    const totalPassH     = passageTitleH + passageAutorH
                         + passageLines.length * _lh(12)
                         + passageGlossH + 10;

    // Passage may span multiple pages — draw line by line
    pdf.setDrawColor(80, 80, 80);
    pdf.setLineWidth(0.4);
    pdf.setFillColor(252, 252, 252);

    // Draw box only if it fits, otherwise just draw text
    if (y + Math.min(totalPassH, PH - MB - y - 10) < PH - MB) {
      const boxH = Math.min(totalPassH, PH - MB - y - 6);
      pdf.rect(ML, y, CW, boxH, 'FD');
    }

    y += 5;

    if (examText.titulo) {
      setFont('bold', 12);
      const tLines = pdf.splitTextToSize(examText.titulo, CW - 8);
      pdf.text(tLines, PW / 2, y, { align: 'center' });
      y += tLines.length * _lh(12) + 2;
    }
    if (examText.autor) {
      setFont('italic', 10);
      pdf.text(examText.autor, PW / 2, y, { align: 'center' });
      y += _lh(10) + 2;
    }

    setFont('normal', 12);
    pdf.setTextColor(30, 30, 30);
    passageLines.forEach(line => {
      need(_lh(12) + 1);
      pdf.text(line, ML + 4, y);
      y += _lh(12);
    });

    if (examText.glossario) {
      need(10);
      setFont('italic', 9);
      pdf.setTextColor(80, 80, 80);
      const gLines = pdf.splitTextToSize(`Glossário: ${examText.glossario}`, CW - 8);
      y += 3;
      pdf.text(gLines, ML + 4, y);
      y += gLines.length * _lh(9) + 2;
    }

    pdf.setTextColor(0, 0, 0);
    y += 6;
  }

  // ── QUESTIONS SECTION ──────────────────────────────────────

  need(14);
  setFont('bold', 12);
  pdf.setTextColor(0, 0, 0);
  pdf.text('QUESTÕES E RESPOSTAS', ML, y);
  y += _lh(12) + 1;
  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.4);
  pdf.line(ML, y, ML + CW, y);
  y += 5;

  questions.forEach((q, gi) => {
    const qText    = (q['Enunciado'] || '').trim();
    const given    = studentAnswers[gi];
    const correct  = correctAnswers[gi];
    const givenText = given?.text || (typeof given === 'string' ? given : '') || '';
    const isSkipped  = given === undefined || given === null;
    const isComp     = is9a && isLang && gi === questions.length - 1;
    const isCorrectA = !isSkipped && !isComp && givenText === correct;

    // Question number + text
    need(_lh(12) * 2 + 4);

    setFont('bold', 12);
    pdf.setTextColor(0, 0, 0);

    // Small coloured indicator dot before number
    const dotColour = isSkipped
      ? [160, 160, 160]
      : isComp
      ? [139, 92, 246]
      : isCorrectA
      ? [22, 163, 74]
      : [220, 38, 38];

    pdf.setFillColor(...dotColour);
    pdf.circle(ML - 4, y - 1.5, 1.5, 'F');

    const qLines = pdf.splitTextToSize(`${gi + 1}. ${qText}`, CW - 4);
    pdf.text(qLines, ML, y);
    y += qLines.length * _lh(12) + 2;

    if (isComp) {
      // Composition — handled after all questions
    } else {
      // Get options
      let opts = [];
      if (q._aiGenerated) {
        opts = ['A', 'B', 'C', 'D']
          .map(l => ({ letter: l, text: _parseOptText(q[`Opção_${l}`] || '') }))
          .filter(o => o.text.length > 0);
      } else {
        opts = _getOpts(q);
      }

      if (opts.length > 0) {
        const avgLen = opts.reduce((s, o) => s + o.text.length, 0) / opts.length;
        const twoCol = avgLen <= 32 && opts.length <= 4;
        const colW   = CW / 2 - 6;

        opts.forEach((o, oi) => {
          const isStudentChoice  = givenText === o.text;
          const isCorrectOption  = correct === o.text;

          let colour = [0, 0, 0];
          let style  = 'normal';
          let prefix = `${o.letter}) `;

          if (isStudentChoice && isCorrectA) {
            // Student chose correctly — green bold with tick
            colour = [0, 110, 0];
            style  = 'bold';
            prefix = `✓ ${o.letter}) `;
          } else if (isStudentChoice && !isCorrectA) {
            // Student chose wrongly — red bold with cross
            colour = [180, 0, 0];
            style  = 'bold';
            prefix = `✗ ${o.letter}) `;
          } else if (isCorrectOption && !isCorrectA && !isSkipped) {
            // Correct answer (not chosen by student) — dark green italic with dot
            colour = [0, 80, 0];
            style  = 'italic';
            prefix = `● ${o.letter}) `;
          }

          setFont(style, 12);
          pdf.setTextColor(...colour);

          if (twoCol) {
            const col = oi % 2 === 0 ? ML + 4 : ML + 4 + CW / 2;
            const optLines = pdf.splitTextToSize(`${prefix}${o.text}`, colW);
            if (oi % 2 === 0 && oi > 0) { need(_lh(12)); y += _lh(12); }
            need(_lh(12));
            pdf.text(optLines, col, y);
            if (oi % 2 === 1 || oi === opts.length - 1) { y += _lh(12); }
          } else {
            const optLines = pdf.splitTextToSize(`${prefix}${o.text}`, CW - 8);
            need(_lh(12) * optLines.length);
            pdf.text(optLines, ML + 4, y);
            y += optLines.length * _lh(12);
          }
        });

        pdf.setTextColor(0, 0, 0);
      }

      if (isSkipped) {
        need(_lh(12));
        setFont('italic', 12);
        pdf.setTextColor(120, 120, 120);
        pdf.text('Não respondida', ML + 4, y);
        pdf.setTextColor(0, 0, 0);
        y += _lh(12);
      }
    }

    y += 4; // space between questions
  });

  // ── COMPOSITION SECTION ────────────────────────────────────

  if (is9a && isLang && composition?.trim()) {
    need(20);

    pdf.setDrawColor(139, 92, 246);
    pdf.setLineWidth(0.5);
    pdf.line(ML, y, ML + CW, y);
    y += 4;

    setFont('bold', 12);
    pdf.setTextColor(0, 0, 0);
    pdf.text('COMPOSIÇÃO DO ESTUDANTE', ML, y);
    y += _lh(12) + 4;

    setFont('normal', 12);
    pdf.setTextColor(30, 30, 30);
    const compLines = pdf.splitTextToSize(composition.trim(), CW);
    compLines.forEach(line => {
      need(_lh(12) + 1);
      pdf.text(line, ML, y);
      y += _lh(12);
    });

    pdf.setTextColor(0, 0, 0);
    y += 6;
  }

  // ── FINAL PAGE WATERMARK + FOOTER ─────────────────────────
  // (addPage already draws these on intermediate pages)
  _drawWatermark(pdf);
  _drawFooter();

  // ── SAVE ──────────────────────────────────────────────────
  const fname = `MeuExame_${(subject || 'exame').replace(/\s+/g, '_')}.pdf`;
  pdf.save(fname);
}
