// ============================================================
// panel/js/screens/mentor/mentor.js
// ExameNova — Mentor Screen v4.0
//
// ARCHITECTURE:
//   Cover → Chat (full-screen fixed slide-in)
//   No navbar | Fixed header + fixed input | No page reload
//
// AI INTELLIGENCE:
//   - System role used correctly (not faked as user message)
//   - Student profile injected: grade, subjects, weak topics,
//     desafio history, exam dates — AI knows student fully
//   - DB context: questions loaded once per subject, cached in
//     memory, searched locally on every message — no extra reads
//   - Wrong answers fetched once on open (max 20 recent)
//
// MOEDAS:
//   - 5 Moedas deducted on first message of a new conversation
//   - Existing conversations: free to continue
//
// LAYOUT FIX:
//   - min-height: 0 on messages container — fixes scroll
//   - header and input always fixed inside chat
//
// keepAlive: false | Navbar: absent | Header: back to dashboard
// ============================================================

import { db }                   from '../../core/firebase.js';
import { router }               from '../../core/router.js';
import { ui }                   from '../../core/ui.js';
import { worker }               from '../../core/worker.js';
import { moeda }                from '../../core/moeda.js';
import { getStudentSubjects }   from '../../core/app.js';
import {
  exams,
  fetchQuestions,
  getWrongAnswers,
  getOptions,
  toDbSubject,
  toDbGrade,
  toDbInstitution,
  normaliseYear,
} from '../../core/exams.js';

import {
  collection,
  addDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ── Constants ─────────────────────────────────────────────────
const STORAGE_KEY    = 'en_mentor_convs';
const EMOJI_KEY      = 'en_mentor_emojis';
const CONV_META_COL  = 'mentorConversations';
const MAX_HISTORY    = 20; // message pairs kept in context
const MAX_WRONG_FETCH = 20; // wrong answers fetched on open

const QUICK_EMOJIS = [
  '😊','👍','🤔','📚','✅','❓','💡','🙏','😅','🔥',
  '😂','😭','🎉','💪','✍️','📝','🧠','👀','😮','🤯',
  '😎','🙌','⭐','❤️','😴','🤝','😬','🫡','🥲','🚀',
];

// ── Module state ───────────────────────────────────────────────
let _user          = null;
let _userData      = null;
let _view          = 'cover';
let _conversations = [];
let _activeConvId  = null;
let _messages      = [];
let _activeSubject = null;
let _pillsMode     = 'subjects';
let _lastEmojis    = [];
let _isTyping      = false;
let _mediaRecorder = null;
let _audioChunks   = [];
let _isRecording   = false;
let _newConvPaid   = false; // tracks if first-message Moedas paid this conv

// Student intelligence cache — loaded once on screen open
let _wrongAnswers    = []; // fetched once, max 20
let _subjectQCache   = {}; // { 'Matemática': [questions] } — loaded per subject

// ── HTML escape ────────────────────────────────────────────────
function _esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

// ── Local storage ──────────────────────────────────────────────
function _saveConvs()              { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_conversations)); } catch {} }
function _loadConvs()              { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; } }
function _saveMsgs(id, msgs)       { try { localStorage.setItem(`${STORAGE_KEY}_${id}`, JSON.stringify(msgs)); } catch {} }
function _loadMsgs(id)             { try { return JSON.parse(localStorage.getItem(`${STORAGE_KEY}_${id}`) || '[]'); } catch { return []; } }
function _deleteMsgs(id)           { try { localStorage.removeItem(`${STORAGE_KEY}_${id}`); } catch {} }
function _loadEmojis()             { try { return JSON.parse(localStorage.getItem(EMOJI_KEY) || 'null') || [...QUICK_EMOJIS]; } catch { return [...QUICK_EMOJIS]; } }
function _saveEmojis(e)            { try { localStorage.setItem(EMOJI_KEY, JSON.stringify(e.slice(0, 30))); } catch {} }
function _useEmoji(e)              { _lastEmojis = [e, ..._lastEmojis.filter(x => x !== e)].slice(0, 30); _saveEmojis(_lastEmojis); }

// ── Date formatting ────────────────────────────────────────────
function _fmtDate(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1)  return 'Agora';
  if (m < 60) return `${m}m`;
  if (h < 24) return `${h}h`;
  if (d < 7)  return `${d}d`;
  return new Date(ts).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' });
}

// ── Mozambique local date ──────────────────────────────────────
function _mzToday() {
  const mz = new Date(Date.now() + 2 * 3600000);
  return [
    mz.getUTCFullYear(),
    String(mz.getUTCMonth() + 1).padStart(2,'0'),
    String(mz.getUTCDate()).padStart(2,'0'),
  ].join('-');
}

// ── Days until date ────────────────────────────────────────────
function _daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.round((new Date(dateStr) - new Date(_mzToday())) / 86400000);
}

// ============================================================
// STUDENT PROFILE BUILDER
// Builds a rich profile string injected into every AI call.
// AI knows the student fully before the first message.
// ============================================================

function _buildStudentProfile() {
  const name        = (_userData?.fullName || '').split(' ')[0] || 'Estudante';
  const examType    = _userData?.examType    || '';
  const grade       = _userData?.grade       || '';
  const status      = _userData?.status      || '';
  const course      = _userData?.course      || '';
  const institution = _userData?.institution || '';
  const subjects    = getStudentSubjects(_userData) || [];
  const examDates   = _userData?.examDates   || {};
  const streak      = _userData?.desafioStreak      || 0;
  const bestScore   = _userData?.desafioBestScore   || null;
  const history     = (_userData?.desafioHistory    || []).slice(-7);

  // Exam context
  let examContext = '';
  if (examType === 'ensino-geral') {
    examContext = `${grade}ª Classe — Ensino Geral${status === 'repetente' ? ' (Repetente)' : ''}`;
  } else if (examType === 'admissao') {
    examContext = course
      ? `Exame de Admissão — Curso de ${course}`
      : `Exame de Admissão — ${institution}`;
  }

  // Exam countdowns — sorted by urgency
  const countdowns = subjects
    .map(s => ({ s, days: _daysUntil(examDates[s]) }))
    .filter(x => x.days !== null)
    .sort((a, b) => a.days - b.days)
    .map(x => {
      const label = x.days <= 0 ? 'HOJE/PASSOU'
        : x.days <= 7  ? `${x.days} dias ⚠️ URGENTE`
        : x.days <= 30 ? `${x.days} dias`
        : `${x.days} dias`;
      return `  - ${x.s}: ${label}`;
    });

  // Weak topics from wrong answers
  const topicMap = {};
  for (const r of _wrongAnswers) {
    if (!r.retried && r.topic) {
      const key = `${r.subject}||${r.topic}`;
      if (!topicMap[key]) topicMap[key] = { topic: r.topic, subject: r.subject, count: 0 };
      topicMap[key].count++;
    }
  }
  const weakTopics = Object.values(topicMap)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map(w => {
      const displaySubj = subjects.find(s => toDbSubject(s) === w.subject) || w.subject;
      return `  - ${w.topic} (${displaySubj}): ${w.count} erro${w.count !== 1 ? 's' : ''} não resolvido${w.count !== 1 ? 's' : ''}`;
    });

  // Desafio trend
  const scores     = history.map(h => h.score);
  const avgRecent  = scores.length
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : null;
  const trend = scores.length >= 3
    ? scores[scores.length - 1] > scores[0] ? '📈 A melhorar'
    : scores[scores.length - 1] < scores[0] ? '📉 A piorar'
    : '➡️ Estável'
    : null;

  let profile = `════ PERFIL DO ESTUDANTE ════
Nome: ${name}
Exame: ${examContext}
Disciplinas: ${subjects.join(', ')}`;

  if (countdowns.length) {
    profile += `\n\nDADOS AOS EXAMES:\n${countdowns.join('\n')}`;
  }

  if (weakTopics.length) {
    profile += `\n\nTEMAS FRACOS (erros recentes não resolvidos):\n${weakTopics.join('\n')}`;
  } else {
    profile += `\n\nTEMAS FRACOS: Sem dados suficientes ainda.`;
  }

  if (avgRecent !== null) {
    profile += `\n\nDESEMPENHO RECENTE (Desafios):`;
    profile += `\n  Scores: ${scores.map(s => s + '%').join(' → ')}`;
    profile += `\n  Média: ${avgRecent}%`;
    if (trend) profile += `\n  Tendência: ${trend}`;
    profile += `\n  Streak actual: ${streak} dia${streak !== 1 ? 's' : ''}`;
    if (bestScore !== null) profile += `\n  Melhor score: ${bestScore}%`;
  }

  profile += `\n════════════════════════════`;
  return profile;
}

// ============================================================
// SYSTEM PROMPT BUILDER
// Uses proper system role — never injected as user message.
// ============================================================

function _buildSystemPrompt() {
  const subjects     = getStudentSubjects(_userData) || [];
  const name         = (_userData?.fullName || '').split(' ')[0] || 'Estudante';
  const studentProfile = _buildStudentProfile();

  const subjectRule = _activeSubject
    ? `DISCIPLINA DESTA CONVERSA: "${_activeSubject}"
Responde APENAS a perguntas sobre ${_activeSubject} nesta conversa.
Se o estudante perguntar sobre outra disciplina, redireciona gentilmente: "Nesta conversa focamo-nos em ${_activeSubject}. Para outra disciplina, inicia uma nova conversa."
Outras disciplinas do estudante: ${subjects.filter(s => s !== _activeSubject).join(', ')}.`
    : `DISCIPLINAS DO ESTUDANTE: ${subjects.join(', ')}.
Responde a perguntas sobre qualquer destas disciplinas.
Não respondas sobre disciplinas fora desta lista.`;

  return `És o Mentor do ExameNova — tutor pessoal e dedicado de ${name}, um estudante moçambicano.

${studentProfile}

IDENTIDADE E TOM:
- Chamas-te "Mentor". Nunca digas que és uma IA ou modelo de linguagem.
- Fala em Português Europeu — variante de Moçambique. Nunca Português do Brasil.
- Trata o estudante sempre pelo primeiro nome: ${name}.
- Tom: caloroso, paciente, encorajador — como um professor sentado ao lado do estudante.
- Quando o estudante erra, corrige com gentileza. Quando acerta, celebra genuinamente.
- Usa o perfil acima para personalizar cada resposta. Se o estudante perguntar sobre um tema fraco dele, reconhece isso: "Reparei que tens tido dificuldades com este tema."
- Se o exame estiver próximo, menciona a urgência naturalmente: "O teu exame é daqui a X dias — vamos garantir que ficas preparado."

${subjectRule}

FORMATO DAS RESPOSTAS:
- Comprimento: 2 a 4 parágrafos para conceitos. Mais longo apenas para exercícios completos.
- Quebra de linha após cada 1-2 frases. Nunca blocos densos de texto.
- NUNCA uses títulos com ## ou ###, linhas --- ou ***, LaTeX (\\[ \\frac \\]), ou blocos de código para matemática.
- Usa **negrito** para termos-chave e fórmulas importantes.
- Listas com - apenas para 3+ itens que não fluem naturalmente em prosa.

EQUAÇÕES E FÓRMULAS — escreve sempre em texto simples:
Matemática: **x = (-b ± √(b²-4ac)) / 2a**, **A = π × r²**
Física: **F = m × a**, **v = d / t**, **E = m × c²**
Química: **2H₂ + O₂ → 2H₂O**, H₂SO₄, CO₂, pH = -log[H⁺]
Símbolos Unicode: x², H₂O, →, ⇌, °C, ≈, ≠, ≤, ≥, ±, √, π, Δ, α, β

ESTILO DE ENSINO:
- Explica sempre o PORQUÊ, não apenas o quê.
- Usa exemplos do contexto moçambicano: Maputo, Zambeze, machamba, meticais.
- Quando resolves exercícios passo a passo, cada passo numa linha separada.
- Encoraja a tentar: "O que achas que acontece se...?" / "Tenta primeiro e diz-me."
- Celebra os acertos: "Exactamente! Muito bem, ${name}! 🎉"
- Termina respostas longas com "Em resumo:" seguido de uma frase concisa.
- NUNCA termines com "avisa-me se precisares" ou "fico à disposição".
- Só fazes perguntas de acompanhamento sobre o MESMO tema — nunca introduzes tema novo.
- Se o estudante disser "ok", "obrigado" ou "entendi" — não faças perguntas.`;
}

// ============================================================
// DB CONTEXT — load once per subject, search locally
// ============================================================

async function _ensureSubjectCache(subject) {
  if (_subjectQCache[subject]) return; // already loaded

  try {
    const isAdm   = _userData?.examType === 'admissao';
    const grade   = _userData?.grade ? toDbGrade(_userData.grade) : null;
    const filters = { disciplina: toDbSubject(subject) };

    if (!isAdm) {
      filters.tipo_exame = 'Ensino Geral';
      if (grade) filters.classe = grade;
    } else {
      filters.tipo_exame = 'Admissão';
      if (_userData?.institution) {
        filters.instituicao = toDbInstitution(_userData.institution);
      }
    }

    const all = await fetchQuestions(filters);
    _subjectQCache[subject] = all.filter(q => (q['Enunciado'] || '').trim());
  } catch (e) {
    console.warn('[Mentor] subject cache load:', e);
    _subjectQCache[subject] = [];
  }
}

function _extractKeywords(text) {
  const stop = new Set([
    'o','a','e','de','da','do','que','como','qual','me','para','sobre','é',
    'um','uma','os','as','por','com','em','ao','na','no','se','não','mas',
    'isso','este','esta','esse','essa','ser','tem','ter','foi','são','mais',
    'quando','onde','porque','então','assim','também','já','ainda','pode',
  ]);
  return text.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stop.has(w))
    .slice(0, 8);
}

function _findRelevantQuestions(text, subject) {
  const questions = _subjectQCache[subject] || [];
  if (!questions.length) return [];

  const keywords = _extractKeywords(text);
  if (!keywords.length) return [];

  const scored = questions.map(q => {
    const enunc = (q['Enunciado'] || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const topic = (q['Tema_Relacionado'] || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    let score = 0;
    for (const kw of keywords) {
      if (enunc.includes(kw)) score += 2;
      if (topic.includes(kw)) score += 3;
    }
    return { q, score };
  });

  return scored
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(x => x.q);
}

function _formatQuestionsForContext(questions) {
  if (!questions.length) return '';
  const lines = questions.map((q, i) => {
    const opts    = getOptions(q);
    const optText = opts.length
      ? opts.map(o => `    ${o.letter}) ${o.text}`).join('\n')
      : '';
    const year    = normaliseYear(q['Ano'] || '');
    const topic   = (q['Tema_Relacionado'] || '').trim();
    return `Questão ${i + 1}${year ? ` (Exame ${year})` : ''}${topic ? ` — ${topic}` : ''}:
  ${(q['Enunciado'] || '').trim()}
${optText ? optText + '\n' : ''}`;
  });

  return `[CONTEXTO — questões reais do currículo moçambicano relevantes para esta pergunta. Usa-as para fundamentar a tua resposta mas responde de forma conversacional, não as copies directamente.]
${lines.join('\n')}[FIM DO CONTEXTO]`;
}

// ============================================================
// SCREEN OBJECT
// ============================================================

const MentorScreen = {

  css() {
    if (document.getElementById('mentor-styles')) return '';
    return `<style id="mentor-styles">

      /* ── BASE ── */
      .mentor-root {
        background: var(--bg);
        min-height: 100dvh;
      }

      /* ══════════════════════════════
         COVER
      ══════════════════════════════ */
      .mentor-cover {
        display: flex;
        flex-direction: column;
        min-height: 100dvh;
      }

      /* Hero — soft blue tint, not competing with header */
      .mentor-hero {
        background: linear-gradient(160deg,
          rgba(2,132,199,0.07) 0%,
          rgba(139,92,246,0.05) 100%);
        border-bottom: 1px solid var(--border);
        padding: 32px 24px 28px;
        position: relative;
        overflow: hidden;
        text-align: center;
      }
      .mentor-hero-blob {
        position: absolute; border-radius: 50%;
        background: var(--primary); opacity: 0.04;
        pointer-events: none;
      }

      .mentor-avatar-wrap {
        position: relative; display: inline-block;
        margin-bottom: 14px;
      }
      .mentor-avatar {
        width: 76px; height: 76px; border-radius: 50%;
        background: linear-gradient(135deg,
          rgba(2,132,199,0.15) 0%, rgba(139,92,246,0.12) 100%);
        border: 2px solid rgba(2,132,199,0.2);
        display: flex; align-items: center; justify-content: center;
        font-size: 2.2rem; position: relative; z-index: 1;
        animation: mentorFloat 4s ease-in-out infinite;
      }
      .mentor-avatar-ring {
        position: absolute; inset: -7px; border-radius: 50%;
        border: 1.5px solid rgba(2,132,199,0.15);
        animation: mentorRing 4s ease-in-out infinite;
      }
      @keyframes mentorFloat {
        0%,100% { transform: translateY(0); }
        50%      { transform: translateY(-5px); }
      }
      @keyframes mentorRing {
        0%,100% { transform: scale(1); opacity: 1; }
        50%      { transform: scale(1.06); opacity: 0.5; }
      }

      .mentor-hero-title {
        font-size: 22px; font-weight: 900;
        color: var(--text);
        letter-spacing: -0.3px; margin-bottom: 6px;
        position: relative; z-index: 1;
      }
      .mentor-hero-sub {
        font-size: 13px; color: var(--text-muted);
        line-height: 1.6; max-width: 280px;
        margin: 0 auto; position: relative; z-index: 1;
      }

      /* Subject pills on cover */
      .mentor-cover-pills {
        display: flex; gap: 8px; overflow-x: auto;
        padding: 16px 16px 4px; scrollbar-width: none;
      }
      .mentor-cover-pills::-webkit-scrollbar { display: none; }
      .mentor-cover-pill {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 8px 14px; border-radius: 99px;
        border: 1.5px solid var(--border);
        background: var(--surface);
        font-size: 12px; font-weight: 600;
        color: var(--text-secondary);
        white-space: nowrap; cursor: pointer;
        transition: all 0.18s; font-family: inherit; flex-shrink: 0;
        -webkit-tap-highlight-color: transparent;
      }
      .mentor-cover-pill.active,
      .mentor-cover-pill:hover {
        border-color: var(--primary); color: var(--primary);
        background: var(--primary-light);
      }

      /* New conversation button */
      .mentor-new-btn {
        margin: 12px 16px 0;
        width: calc(100% - 32px);
        padding: 15px;
        background: linear-gradient(135deg, #0369A1, #0284C7);
        color: #fff; border: none; border-radius: var(--radius-lg);
        font-size: 15px; font-weight: 700; font-family: inherit;
        cursor: pointer;
        display: flex; align-items: center; justify-content: center; gap: 8px;
        transition: opacity 0.2s, transform 0.15s;
        box-shadow: 0 4px 20px rgba(2,132,199,0.3); min-height: 52px;
        -webkit-tap-highlight-color: transparent;
      }
      .mentor-new-btn:hover  { opacity: 0.92; }
      .mentor-new-btn:active { transform: scale(0.98); }

      /* Moedas cost note */
      .mentor-cost-note {
        display: flex; align-items: center; justify-content: center; gap: 6px;
        margin: 8px 16px 0;
        font-size: 11px; font-weight: 600; color: var(--text-muted);
      }
      .mentor-cost-note i { font-size: 11px; color: var(--moeda); }

      /* Conversation list */
      .mentor-conv-section {
        flex: 1; padding: 20px 16px 48px;
      }
      .mentor-conv-section-title {
        font-size: 11px; font-weight: 700;
        color: var(--text-muted);
        text-transform: uppercase; letter-spacing: 0.08em;
        margin-bottom: 12px;
      }
      .mentor-conv-list { display: flex; flex-direction: column; gap: 8px; }

      .mentor-conv-card {
        background: var(--surface);
        border: 1.5px solid var(--border);
        border-radius: var(--radius-lg);
        padding: 13px 16px; cursor: pointer;
        transition: border-color 0.18s, transform 0.12s;
        display: flex; align-items: center; gap: 12px;
        -webkit-tap-highlight-color: transparent;
      }
      .mentor-conv-card:hover  { border-color: var(--primary); }
      .mentor-conv-card:active { transform: scale(0.99); }

      .mentor-conv-icon {
        width: 42px; height: 42px; border-radius: var(--radius-md);
        background: var(--primary-light);
        display: flex; align-items: center; justify-content: center;
        font-size: 18px; flex-shrink: 0; color: var(--primary);
      }
      .mentor-conv-body { flex: 1; min-width: 0; }
      .mentor-conv-title {
        font-size: 14px; font-weight: 700; color: var(--text);
        margin-bottom: 3px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .mentor-conv-preview {
        font-size: 12px; color: var(--text-muted);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .mentor-conv-meta {
        display: flex; flex-direction: column;
        align-items: flex-end; gap: 4px; flex-shrink: 0;
      }
      .mentor-conv-date {
        font-size: 11px; color: var(--text-muted); white-space: nowrap;
      }
      .mentor-conv-subj-badge {
        font-size: 10px; font-weight: 700; padding: 2px 8px;
        border-radius: 99px;
        background: var(--primary-light); color: var(--primary);
        white-space: nowrap;
      }

      /* Empty state */
      .mentor-empty {
        text-align: center; padding: 40px 24px;
      }
      .mentor-empty-icon {
        font-size: 2.5rem; color: var(--text-muted);
        margin-bottom: 12px; opacity: 0.5;
      }
      .mentor-empty-title {
        font-size: 16px; font-weight: 700;
        color: var(--text); margin-bottom: 6px;
      }
      .mentor-empty-sub {
        font-size: 13px; color: var(--text-muted); line-height: 1.6;
      }

      /* ══════════════════════════════
         CHAT — full-screen fixed
      ══════════════════════════════ */
      .mentor-chat {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: var(--bg);
        z-index: 300;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        transform: translateX(100%);
        transition: transform 220ms ease;
      }
      .mentor-chat.open { transform: translateX(0); }

      /* Chat header — flex-shrink: 0 so it never moves */
      .mentor-chat-hdr {
        flex-shrink: 0;
        background: linear-gradient(135deg, #0369A1 0%, #0284C7 100%);
        height: 60px; padding: 0 12px;
        display: flex; align-items: center; gap: 10px;
        box-shadow: 0 2px 12px rgba(2,132,199,0.3);
        z-index: 2;
      }
      .mentor-chat-back {
        width: 34px; height: 34px; border-radius: 50%;
        background: rgba(255,255,255,0.15); border: none;
        color: #fff; font-size: 14px; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0; transition: background 0.2s; font-family: inherit;
      }
      .mentor-chat-back:hover { background: rgba(255,255,255,0.25); }

      .mentor-chat-av {
        width: 34px; height: 34px; border-radius: 50%;
        background: rgba(255,255,255,0.2);
        border: 2px solid rgba(255,255,255,0.3);
        display: flex; align-items: center; justify-content: center;
        font-size: 16px; flex-shrink: 0;
      }
      .mentor-chat-info { flex: 1; min-width: 0; }
      .mentor-chat-name {
        font-size: 14px; font-weight: 700; color: #fff; line-height: 1.2;
      }
      .mentor-chat-status {
        font-size: 11px; color: rgba(255,255,255,0.75);
        display: flex; align-items: center; gap: 4px;
      }
      .mentor-status-dot {
        width: 6px; height: 6px; border-radius: 50%; background: #22C55E;
      }
      .mentor-subj-badge {
        display: none;
        background: rgba(255,255,255,0.15);
        border: 1px solid rgba(255,255,255,0.25);
        border-radius: 99px; padding: 3px 10px;
        font-size: 11px; font-weight: 600;
        color: rgba(255,255,255,0.9);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        max-width: 90px; flex-shrink: 0;
      }
      .mentor-subj-badge.show { display: inline-block; }
      /* ── DARK MODE TOGGLE SWITCH ── */
      .mentor-toggle-track {
        width: 36px; height: 20px;
        border-radius: 99px;
        background: rgba(255,255,255,0.25);
        border: 1.5px solid rgba(255,255,255,0.3);
        position: relative;
        transition: background 0.25s;
        flex-shrink: 0;
      }
      .mentor-toggle-track.on {
        background: rgba(255,255,255,0.9);
      }
      .mentor-toggle-thumb {
        position: absolute;
        top: 2px; left: 2px;
        width: 14px; height: 14px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 1px 4px rgba(0,0,0,0.25);
        transition: transform 0.25s, background 0.25s;
      }
      .mentor-toggle-track.on .mentor-toggle-thumb {
        transform: translateX(16px);
        background: var(--primary);
      }

      .mentor-chat-menu {
        width: 34px; height: 34px; border-radius: 50%;
        background: rgba(255,255,255,0.15); border: none;
        color: #fff; font-size: 15px; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0; transition: background 0.2s; font-family: inherit;
      }
      .mentor-chat-menu:hover { background: rgba(255,255,255,0.25); }

      /* Messages — flex: 1 + min-height: 0 = scrollable, never pushes input */
      .mentor-msgs {
        flex: 1;
        min-height: 0;           /* critical fix */
        overflow-y: auto;
        overflow-x: hidden;
        -webkit-overflow-scrolling: touch;
        padding: 16px 14px 8px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      /* ── BUBBLES ── */
      .mentor-msg {
        display: flex; gap: 8px;
        animation: mentorMsgIn 0.2s ease both;
      }
      @keyframes mentorMsgIn {
        from { opacity: 0; transform: translateY(6px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      .mentor-msg.ai   { align-self: flex-start; }
      .mentor-msg.user { align-self: flex-end; flex-direction: row-reverse; }

      .mentor-msg-av {
        width: 30px; height: 30px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        font-size: 14px; flex-shrink: 0; margin-top: 4px;
      }
      .mentor-msg.ai   .mentor-msg-av {
        background: linear-gradient(135deg, #0369A1, #0284C7);
      }
      .mentor-msg.user .mentor-msg-av {
        background: linear-gradient(135deg, #6D28D9, #8B5CF6);
        color: #fff; font-size: 11px; font-weight: 700;
      }

      .mentor-msg-body { max-width: 80%; }
      .mentor-msg.user .mentor-msg-body {
        display: flex; flex-direction: column; align-items: flex-end;
      }

      .mentor-msg-name {
        font-size: 9px; font-weight: 700;
        text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 3px;
        color: var(--text-muted);
      }

      /* AI bubble */
      .mentor-msg.ai .mentor-bubble {
        background: var(--surface);
        border: 1.5px solid var(--border);
        border-top: 2px solid var(--primary);
        border-radius: 0 14px 14px 14px;
        padding: 10px 13px;
        font-size: 14px; line-height: 1.75;
        color: var(--text);
        box-shadow: 0 1px 4px rgba(0,0,0,0.05);
      }
      .mentor-msg.ai .mentor-bubble strong { color: var(--primary); font-weight: 700; }

      /* User bubble */
      .mentor-msg.user .mentor-bubble {
        background: linear-gradient(135deg, #6D28D9, #8B5CF6);
        border-radius: 14px 0 14px 14px;
        padding: 10px 13px;
        font-size: 14px; line-height: 1.75; color: #fff;
        box-shadow: 0 2px 8px rgba(139,92,246,0.25);
      }

      /* Image in bubble */
      .mentor-bubble-img {
        max-width: 200px; max-height: 200px; border-radius: 10px;
        object-fit: cover; display: block; margin-bottom: 6px;
      }

      /* Bubble footer */
      .mentor-msg-footer {
        display: flex; align-items: center; gap: 5px;
        margin-top: 5px; overflow-x: auto; scrollbar-width: none;
      }
      .mentor-msg-footer::-webkit-scrollbar { display: none; }
      .mentor-msg.user .mentor-msg-footer { justify-content: flex-end; }

      .mentor-copy-btn,
      .mentor-chip {
        display: inline-flex; align-items: center; gap: 3px;
        padding: 3px 9px; border-radius: 99px;
        font-family: inherit; font-size: 10px; font-weight: 600;
        cursor: pointer; border: 1px solid var(--border);
        background: none; color: var(--text-muted);
        transition: all 0.18s; white-space: nowrap; flex-shrink: 0;
      }
      .mentor-copy-btn:hover,
      .mentor-chip:hover {
        border-color: var(--primary); color: var(--primary);
        background: var(--primary-light);
      }

      /* Typing indicator */
      .mentor-typing {
        display: flex; gap: 8px; align-self: flex-start;
        animation: mentorFadeIn 0.2s ease both;
      }
      @keyframes mentorFadeIn { from { opacity: 0; } to { opacity: 1; } }
      .mentor-typing-bubble {
        background: var(--surface);
        border: 1.5px solid var(--border);
        border-top: 2px solid var(--primary);
        border-radius: 0 14px 14px 14px;
        padding: 12px 16px;
        display: flex; gap: 5px; align-items: center;
        box-shadow: 0 1px 4px rgba(0,0,0,0.05);
      }
      .mentor-td {
        width: 7px; height: 7px; border-radius: 50%;
        background: var(--primary);
        animation: mentorDot 1.4s ease-in-out infinite;
      }
      .mentor-td:nth-child(2) { animation-delay: 0.2s; }
      .mentor-td:nth-child(3) { animation-delay: 0.4s; }
      @keyframes mentorDot {
        0%,80%,100% { transform: scale(0.6); opacity: 0.3; }
        40%          { transform: scale(1);   opacity: 1; }
      }

      /* ── INPUT AREA — flex-shrink: 0 so it never moves ── */
      .mentor-input-area {
        flex-shrink: 0;
        background: var(--surface);
        border-top: 1px solid var(--border);
        padding-bottom: env(safe-area-inset-bottom, 0px);
      }

      /* Pills rows */
      .mentor-pills-row {
        display: flex; gap: 6px; overflow-x: auto;
        padding: 8px 12px 0; scrollbar-width: none;
      }
      .mentor-pills-row::-webkit-scrollbar { display: none; }


      .mentor-pill {
        display: inline-flex; align-items: center; gap: 5px;
        padding: 5px 12px; border-radius: 99px;
        border: 1.5px solid var(--border);
        background: var(--bg);
        font-size: 11px; font-weight: 600;
        color: var(--text-secondary);
        white-space: nowrap; cursor: pointer;
        transition: all 0.18s; font-family: inherit;
        min-height: 30px; flex-shrink: 0;
        -webkit-tap-highlight-color: transparent;
      }
      .mentor-pill:hover,
      .mentor-pill.active {
        border-color: var(--primary);
        background: var(--primary-light);
        color: var(--primary);
      }
      .mentor-pill-sim {
        border-color: rgba(2,132,199,0.3); color: var(--primary);
        background: var(--primary-light);
      }
      .mentor-pill-wa {
        border-color: rgba(34,197,94,0.3); color: #16A34A;
        background: rgba(34,197,94,0.06);
      }
      .mentor-pill-wa:hover { border-color: #16A34A; background: rgba(34,197,94,0.12); }
      .mentor-pill-report {
        border-color: rgba(245,158,11,0.3); color: #D97706;
        background: rgba(245,158,11,0.06);
      }
      .mentor-pill-report:hover { border-color: #D97706; background: rgba(245,158,11,0.12); }

      /* Emoji row */
      .mentor-emoji-row {
        display: flex; gap: 2px; overflow-x: auto;
        padding: 6px 12px 4px; scrollbar-width: none;
      }
      .mentor-emoji-row::-webkit-scrollbar { display: none; }
      .mentor-emoji-btn {
        font-size: 18px; padding: 3px; border: none; background: none;
        cursor: pointer; border-radius: 6px; transition: transform 0.15s;
        flex-shrink: 0; min-width: 30px; min-height: 30px;
        display: flex; align-items: center; justify-content: center;
      }
      .mentor-emoji-btn:active { transform: scale(0.82); }

      /* Input row */
      .mentor-input-row {
        display: flex; align-items: flex-end; gap: 6px;
        padding: 6px 10px 8px;
      }
      .mentor-btn-sm {
        width: 34px; height: 34px; border-radius: 50%;
        border: 1.5px solid var(--border);
        background: var(--bg); color: var(--text-muted);
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; flex-shrink: 0; font-size: 13px;
        transition: all 0.18s; font-family: inherit;
      }
      .mentor-btn-sm:hover { color: var(--primary); border-color: var(--primary); }
      .mentor-btn-sm.record-active {
        background: #EF4444; color: #fff; border-color: #EF4444;
        animation: mentorRecPulse 1s ease infinite;
      }
      @keyframes mentorRecPulse {
        0%,100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.4); }
        50%      { box-shadow: 0 0 0 6px rgba(239,68,68,0); }
      }

      .mentor-textarea-wrap { flex: 1; min-width: 0; }
      .mentor-textarea {
        width: 100%; min-height: 38px; max-height: 110px;
        padding: 9px 13px; border-radius: 19px;
        border: 1.5px solid var(--border);
        background: var(--bg); color: var(--text);
        font-family: inherit; font-size: 14px; line-height: 1.5;
        outline: none; resize: none; overflow-y: auto;
        transition: border-color 0.2s; box-sizing: border-box; display: block;
      }
      .mentor-textarea:focus { border-color: var(--primary); }
      .mentor-textarea::placeholder { color: var(--text-muted); }

      .mentor-transcribing {
        display: none; align-items: center; gap: 8px;
        padding: 9px 13px;
        background: rgba(239,68,68,0.06);
        border: 1.5px solid rgba(239,68,68,0.2);
        border-radius: 19px;
        font-size: 13px; color: #EF4444; font-weight: 600;
      }
      .mentor-transcribing.show { display: flex; }
      .mentor-transcribing-dot {
        width: 7px; height: 7px; border-radius: 50%;
        background: #EF4444; flex-shrink: 0;
        animation: mentorRecPulse 0.8s ease infinite;
      }

      .mentor-send-btn {
        width: 38px; height: 38px; border-radius: 50%;
        background: var(--primary); color: #fff; border: none;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; flex-shrink: 0; font-size: 14px;
        box-shadow: 0 2px 8px rgba(2,132,199,0.3);
        transition: all 0.18s; font-family: inherit;
      }
      .mentor-send-btn:hover:not(:disabled)  { filter: brightness(1.1); }
      .mentor-send-btn:active:not(:disabled) { transform: scale(0.9); }
      .mentor-send-btn:disabled {
        background: var(--border); color: var(--text-muted);
        box-shadow: none; cursor: not-allowed;
      }

      /* ── IMAGE INLINE PREVIEW ── */
      .mentor-img-inline {
        display: none;
        align-items: center; gap: 8px;
        padding: 6px 12px 0;
      }
      .mentor-img-inline.show { display: flex; }
      .mentor-img-inline-thumb {
        width: 36px; height: 36px; border-radius: 8px;
        object-fit: cover; flex-shrink: 0;
        border: 1.5px solid var(--primary);
      }
      .mentor-img-inline-label {
        flex: 1; font-size: 11px; font-weight: 600;
        color: var(--primary); min-width: 0;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .mentor-img-inline-cancel {
        width: 22px; height: 22px; border-radius: 50%;
        background: var(--border); border: none;
        color: var(--text-muted); font-size: 10px; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0; font-family: inherit;
        transition: background 0.15s, color 0.15s;
      }
      .mentor-img-inline-cancel:hover { background: #EF4444; color: #fff; }

      /* Camera icon active state */
      .mentor-btn-sm.img-active {
        border-color: var(--primary); color: var(--primary);
        background: var(--primary-light);
        position: relative;
      }
      .mentor-btn-sm.img-active::after {
        content: '';
        position: absolute; top: -2px; right: -2px;
        width: 8px; height: 8px; border-radius: 50%;
        background: #16A34A;
        border: 1.5px solid var(--surface);
      }

      /* Context loading indicator */
      .mentor-ctx-loading {
        display: none;
        align-items: center; gap: 6px;
        padding: 4px 12px;
        font-size: 10px; font-weight: 600; color: var(--text-muted);
      }
      .mentor-ctx-loading.show { display: flex; }
      .mentor-ctx-spin {
        width: 10px; height: 10px;
        border: 1.5px solid var(--border);
        border-top-color: var(--primary);
        border-radius: 50%;
        animation: mentorSpin 0.7s linear infinite; flex-shrink: 0;
      }
      @keyframes mentorSpin { to { transform: rotate(360deg); } }

      /* ── DARK ── */
      [data-theme="dark"] .mentor-conv-card { background: var(--bg-card); }
      [data-theme="dark"] .mentor-input-area { background: var(--bg-card); }
      [data-theme="dark"] .mentor-msg.ai .mentor-bubble { background: var(--bg-card); }
      [data-theme="dark"] .mentor-textarea { background: var(--bg); }
      [data-theme="dark"] .mentor-btn-sm   { background: var(--bg); }

      /* ── RESPONSIVE ── */
      @media (min-width: 768px) {
        .mentor-msgs { padding: 16px 10% 8px; }
        .mentor-msg-body { max-width: 72%; }
      }
      @media (min-width: 1025px) {
        .mentor-cover { max-width: 680px; margin: 0 auto; }
        .mentor-msgs  { padding: 16px 18% 8px; }
        .mentor-msg-body { max-width: 65%; }
      }

    </style>`;
  },

  mount() {
    return `
      <div class="mentor-root" translate="no">

        <!-- COVER -->
        <div class="mentor-cover" id="mentor-cover">
          <div id="header-mount"></div>

          <div class="mentor-hero">
            <div class="mentor-hero-blob"
              style="width:200px;height:200px;top:-80px;right:-60px;"></div>
            <div class="mentor-hero-blob"
              style="width:100px;height:100px;bottom:0;left:-20px;"></div>
            <div class="mentor-avatar-wrap">
              <div class="mentor-avatar-ring"></div>
              <div class="mentor-avatar">🧠</div>
            </div>
            <div class="mentor-hero-title notranslate" translate="no">
              Mentor
            </div>
            <div class="mentor-hero-sub notranslate" translate="no">
              O seu tutor pessoal. Estude melhor,
              entenda mais, prepare-se com confiança.
            </div>
          </div>

          <div class="mentor-cover-pills notranslate" translate="no"
            id="cover-pills"></div>

          <button class="mentor-new-btn notranslate" translate="no"
            id="btn-new-conv">
            <i class="fa-solid fa-plus" aria-hidden="true"></i>
            Nova Conversa
          </button>

          <div class="mentor-cost-note notranslate" translate="no">
            <i class="fa-solid fa-coins" aria-hidden="true"></i>
            5 Moedas por nova conversa
          </div>

          <div class="mentor-conv-section">
            <div class="mentor-conv-section-title notranslate" translate="no">
              Conversas recentes
            </div>
            <div class="mentor-conv-list notranslate" translate="no"
              id="conv-list"></div>
          </div>
        </div>

        <!-- CHAT — full-screen fixed -->
        <div class="mentor-chat" id="mentor-chat" aria-hidden="true">

          <div class="mentor-chat-hdr">
            <button class="mentor-chat-back notranslate" translate="no"
              id="btn-chat-back" aria-label="Voltar">
              <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>
            </button>
            <div class="mentor-chat-av">🧠</div>
            <div class="mentor-chat-info">
              <div class="mentor-chat-name notranslate" translate="no">
                Mentor
              </div>
              <div class="mentor-chat-status">
                <div class="mentor-status-dot"></div>
                <span class="notranslate" translate="no"
                  id="chat-status">Disponível</span>
              </div>
            </div>
            <div class="mentor-subj-badge notranslate" translate="no"
              id="chat-subj-badge"></div>
            <label class="mentor-dark-toggle notranslate" translate="no"
              id="btn-dark-toggle" aria-label="Modo escuro"
              style="display:flex;align-items:center;gap:5px;cursor:pointer;flex-shrink:0;">
              <i class="fa-solid fa-moon" style="font-size:11px;color:rgba(255,255,255,0.8);"></i>
              <div class="mentor-toggle-track" id="dark-toggle-track">
                <div class="mentor-toggle-thumb" id="dark-toggle-thumb"></div>
              </div>
            </label>
            <button class="mentor-chat-menu notranslate" translate="no"
              id="btn-chat-menu" aria-label="Opções">
              <i class="fa-solid fa-ellipsis-vertical" aria-hidden="true"></i>
            </button>
          </div>

          <div class="mentor-msgs" id="mentor-msgs"></div>

          <div class="mentor-input-area">
            <!-- Inline image indicator — compact, above textarea -->
            <div class="mentor-img-inline" id="img-preview">
              <img class="mentor-img-inline-thumb" id="img-preview-thumb"
                src="" alt="preview">
              <span class="mentor-img-inline-label notranslate" translate="no"
                id="img-preview-label">
                Imagem pronta — escreva uma descrição e envie
              </span>
              <button class="mentor-img-inline-cancel notranslate" translate="no"
                id="img-cancel-btn" aria-label="Remover imagem">
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div class="mentor-ctx-loading" id="ctx-loading">
              <div class="mentor-ctx-spin"></div>
              <span class="notranslate" translate="no">
                A carregar contexto do currículo…
              </span>
            </div>
            <div id="mentor-pills-wrap"></div>
            <div class="mentor-input-row">
              <button class="mentor-btn-sm notranslate" translate="no"
                id="btn-attach" aria-label="Imagem">
                <i class="fa-solid fa-image" aria-hidden="true"></i>
              </button>
              <input type="file" id="attach-input"
                accept="image/*" style="display:none;">

              <div class="mentor-textarea-wrap">
                <textarea
                  class="mentor-textarea notranslate" translate="no"
                  id="mentor-ta" placeholder="Escreva a sua dúvida…"
                  rows="1" aria-label="Mensagem"></textarea>
                <div class="mentor-transcribing" id="mentor-transcribing">
                  <div class="mentor-transcribing-dot"></div>
                  <span class="notranslate" translate="no">
                    A transcrever…
                  </span>
                </div>
              </div>

              <button class="mentor-btn-sm notranslate" translate="no"
                id="btn-record" aria-label="Gravar voz">
                <i class="fa-solid fa-microphone" aria-hidden="true"></i>
              </button>
              <button class="mentor-send-btn notranslate" translate="no"
                id="btn-send" disabled aria-label="Enviar">
                <i class="fa-solid fa-paper-plane" aria-hidden="true"></i>
              </button>
            </div>
          </div>

        </div>
      </div>
    `;
  },

  async init(user, userData, params) {
    _user          = user;
    _userData      = userData;
    _view          = 'cover';
    _lastEmojis    = _loadEmojis();
    _subjectQCache = {};
    _newConvPaid   = false;

    ui.renderHeader({
      title:          'Mentor',
      backRoute:      '/panel/dashboard',
      showDarkToggle: true,
      moedasBalance:  moeda.getBalance(userData),
    });

    _conversations = _loadConvs();

    // Fetch wrong answers once — feeds student profile
    try {
      _wrongAnswers = await getWrongAnswers(user.uid, {}, true);
      _wrongAnswers = _wrongAnswers.slice(0, MAX_WRONG_FETCH);
    } catch (e) {
      console.warn('[Mentor] wrong answers fetch:', e);
      _wrongAnswers = [];
    }

    _renderCover();

    if (params?.convId) {
      const conv = _conversations.find(c => c.id === params.convId);
      if (conv) _openConv(conv);
    }
  },

  destroy() {
    _view          = 'cover';
    _activeConvId  = null;
    _messages      = [];
    _activeSubject = null;
    _isTyping      = false;
    _newConvPaid   = false;
    _pillsMode     = 'subjects';
    if (_isRecording && _mediaRecorder) {
      try { _mediaRecorder.stop(); } catch {}
      _isRecording = false;
    }
  },
};

// ============================================================
// COVER
// ============================================================

function _renderCover() {
  const subjects = getStudentSubjects(_userData) || [];

  // Subject filter pills
  const pillsEl = document.getElementById('cover-pills');
  if (pillsEl) {
    pillsEl.innerHTML = subjects.map(s => `
      <button class="mentor-cover-pill notranslate${_activeSubject === s ? ' active' : ''}"
        translate="no" data-subject="${_esc(s)}">
        ${_esc(s)}
      </button>
    `).join('');
    pillsEl.querySelectorAll('.mentor-cover-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const isSame = _activeSubject === btn.dataset.subject;
        pillsEl.querySelectorAll('.mentor-cover-pill')
          .forEach(b => b.classList.remove('active'));
        _activeSubject = isSame ? null : btn.dataset.subject;
        if (!isSame) btn.classList.add('active');
        _renderConvList();
      });
    });
  }

  // New conversation button
  const newBtn = document.getElementById('btn-new-conv');
  if (newBtn && !newBtn._wired) {
    newBtn._wired = true;
    newBtn.addEventListener('click', _startNewConv);
  }

  _renderConvList();
}

function _renderConvList() {
  const el = document.getElementById('conv-list');
  if (!el) return;

  const filtered = _activeSubject
    ? _conversations.filter(c => c.subject === _activeSubject)
    : _conversations;

  if (!filtered.length) {
    el.innerHTML = `
      <div class="mentor-empty">
        <div class="mentor-empty-icon">
          <i class="fa-regular fa-comments" aria-hidden="true"></i>
        </div>
        <div class="mentor-empty-title notranslate" translate="no">
          ${_activeSubject
            ? `Sem conversas de ${_esc(_activeSubject)}`
            : 'Ainda não há conversas'}
        </div>
        <div class="mentor-empty-sub notranslate" translate="no">
          ${_activeSubject
            ? 'Inicie uma nova conversa sobre esta disciplina.'
            : 'Inicie uma nova conversa com o Mentor e comece a estudar.'}
        </div>
      </div>`;
    return;
  }

  const sorted = [...filtered].sort((a, b) => b.updatedAt - a.updatedAt);
  el.innerHTML = sorted.map(conv => `
    <div class="mentor-conv-card notranslate" translate="no"
      data-conv-id="${_esc(conv.id)}">
      <div class="mentor-conv-icon">
        <i class="fa-solid fa-brain" aria-hidden="true"></i>
      </div>
      <div class="mentor-conv-body">
        <div class="mentor-conv-title">${_esc(conv.title)}</div>
        <div class="mentor-conv-preview">
          ${_esc(conv.preview || 'Toque para continuar…')}
        </div>
      </div>
      <div class="mentor-conv-meta">
        <div class="mentor-conv-date">${_fmtDate(conv.updatedAt)}</div>
        ${conv.subject
          ? `<div class="mentor-conv-subj-badge">${_esc(conv.subject)}</div>`
          : ''}
      </div>
    </div>
  `).join('');

  el.querySelectorAll('.mentor-conv-card').forEach(card => {
    card.addEventListener('click', () => {
      const conv = _conversations.find(c => c.id === card.dataset.convId);
      if (conv) _openConv(conv);
    });
  });
}

function _startNewConv() {
  // Gate check — but do not deduct yet (deduct on first message)
  if (!moeda.checkMoedas(_userData, moeda.COSTS.MENTOR_SESSION)) {
    moeda.showMoedasSheet(moeda.getBalance(_userData), moeda.COSTS.MENTOR_SESSION);
    return;
  }

  const convId  = `conv_${Date.now()}`;
  const subject = _activeSubject || null;
  const conv = {
    id:        convId,
    title:     subject ? `${subject} — Nova conversa` : 'Nova conversa',
    subject,
    preview:   '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isNew:     true, // flag for first-message deduction
  };

  _conversations.unshift(conv);
  _saveConvs();

  // Save to Firestore (non-blocking)
  addDoc(collection(db, CONV_META_COL), {
    userId:    _user.uid,
    convId,
    title:     conv.title,
    subject,
    createdAt: serverTimestamp(),
  }).catch(() => {});

  _newConvPaid = false;
  _openConv(conv);
}

// ============================================================
// OPEN CONVERSATION
// ============================================================

function _openConv(conv) {
  _activeConvId  = conv.id;
  _activeSubject = conv.subject || null;
  _messages      = _loadMsgs(conv.id);
  _view          = 'chat';
  _pillsMode     = 'subjects';
  // Existing conversation — not new, no deduction needed
  if (!conv.isNew) _newConvPaid = true;

  const chatEl = document.getElementById('mentor-chat');
  if (chatEl) {
    // Lock height to actual window height — prevents browser chrome interference
    chatEl.style.height = window.innerHeight + 'px';
    chatEl.removeAttribute('aria-hidden');
    requestAnimationFrame(() => chatEl.classList.add('open'));
  }

  // Update height if window resizes (keyboard open/close)
  if (!window._mentorResizeWired) {
    window._mentorResizeWired = true;
    window.addEventListener('resize', () => {
      const el = document.getElementById('mentor-chat');
      if (el && el.classList.contains('open')) {
        el.style.height = window.innerHeight + 'px';
      }
    });
  }

  // Subject badge in header
  const badge = document.getElementById('chat-subj-badge');
  if (badge) {
    if (_activeSubject) {
      badge.textContent = _activeSubject;
      badge.classList.add('show');
    } else {
      badge.classList.remove('show');
    }
  }

  _renderAllMsgs();

  // Welcome message for new conversations
  if (!_messages.length) {
    _addAiMsg(_buildWelcome());
  }

  _renderPills();
  _wireInput();
  _wireChatHeader(conv);

  // Load subject questions into cache — shows loading indicator briefly
  if (_activeSubject) {
    _loadSubjectCache(_activeSubject);
  }
}

function _buildWelcome() {
  const name     = (_userData?.fullName || '').split(' ')[0] || 'Estudante';
  const subjects = getStudentSubjects(_userData) || [];
  const examDates = _userData?.examDates || {};

  // Find most urgent exam
  let urgentSubject = null;
  let minDays = null;
  for (const s of subjects) {
    if (examDates[s]) {
      const d = _daysUntil(examDates[s]);
      if (d !== null && d >= 0 && (minDays === null || d < minDays)) {
        minDays = d;
        urgentSubject = s;
      }
    }
  }

  // Weak topic hint
  const weakTopics = _wrongAnswers
    .filter(r => !r.retried && r.topic)
    .reduce((acc, r) => {
      acc[r.topic] = (acc[r.topic] || 0) + 1;
      return acc;
    }, {});
  const topWeak = Object.entries(weakTopics)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 1)
    .map(([t]) => t)[0];

  if (_activeSubject) {
    let msg = `Olá, **${name}**! 👋 Nesta conversa focamo-nos em **${_activeSubject}**.

Faz-me qualquer pergunta — conceitos, fórmulas, exercícios ou questões de exames anteriores. Vamos a isso! 💪`;

    if (urgentSubject === _activeSubject && minDays !== null) {
      msg += `\n\nO teu exame de **${_activeSubject}** é daqui a **${minDays} dia${minDays !== 1 ? 's' : ''}** — boa altura para consolidar os últimos temas. 🎯`;
    }
    if (topWeak) {
      msg += `\n\nReparei que tens tido dificuldades com **${topWeak}**. Podemos começar por aí se quiseres.`;
    }
    return msg;
  }

  const list = subjects.slice(0, 3).map(s => `**${s}**`).join(', ');
  let msg = `Olá, **${name}**! 👋 Bem-vindo ao Mentor!\n\nPosso ajudar-te com ${list}${subjects.length > 3 ? ' e mais' : ''}.`;

  if (urgentSubject && minDays !== null && minDays <= 30) {
    msg += `\n\n⚠️ O teu exame de **${urgentSubject}** é daqui a **${minDays} dia${minDays !== 1 ? 's' : ''}** — quer começar por aí?`;
  } else if (topWeak) {
    msg += `\n\nReparei que tens dificuldades com **${topWeak}**. Quer que comecemos por aí?`;
  } else {
    msg += `\n\nO que queres estudar hoje? 📚`;
  }
  return msg;
}

async function _loadSubjectCache(subject) {
  if (_subjectQCache[subject]) return;
  const ctxEl = document.getElementById('ctx-loading');
  if (ctxEl) ctxEl.classList.add('show');
  await _ensureSubjectCache(subject);
  if (ctxEl) ctxEl.classList.remove('show');
}

// ============================================================
// PILLS
// ============================================================

function _renderPills() {
  const wrap = document.getElementById('mentor-pills-wrap');
  if (!wrap) return;

  if (_pillsMode === 'emojis') {
    wrap.innerHTML = `
      <div class="mentor-emoji-row" id="emoji-row">
        ${_lastEmojis.map(e =>
          `<button class="mentor-emoji-btn" data-emoji="${e}">${e}</button>`
        ).join('')}
      </div>`;
    document.getElementById('emoji-row')
      ?.querySelectorAll('.mentor-emoji-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const ta  = document.getElementById('mentor-ta');
          if (!ta) return;
          const pos = ta.selectionStart ?? ta.value.length;
          ta.value  = ta.value.slice(0, pos) + btn.dataset.emoji + ta.value.slice(pos);
          ta.selectionStart = ta.selectionEnd = pos + btn.dataset.emoji.length;
          ta.focus();
          _useEmoji(btn.dataset.emoji);
          _updateSendBtn();
        });
      });
    return;
  }

  const subjects = getStudentSubjects(_userData) || [];

  const subjectPills = subjects.map(s => `
    <button class="mentor-pill notranslate${_activeSubject === s ? ' active' : ''}"
      translate="no" data-subject="${_esc(s)}">${_esc(s)}</button>
  `).join('');

  // Single row — subjects + action pills together
  wrap.innerHTML = `
    <div class="mentor-pills-row" id="pills-subjects">
      ${subjectPills}
      <div style="width:1px;height:18px;background:var(--border);
        flex-shrink:0;align-self:center;margin:0 2px;"></div>
      <button class="mentor-pill mentor-pill-sim notranslate" translate="no"
        data-action="simulacao">
        <i class="fa-solid fa-bolt" style="font-size:10px;"></i> Simulação
      </button>
      <button class="mentor-pill mentor-pill-wa notranslate" translate="no"
        data-action="wa">
        <i class="fa-brands fa-whatsapp" style="font-size:10px;"></i> Grupo
      </button>
      <button class="mentor-pill mentor-pill-report notranslate" translate="no"
        data-action="report">
        <i class="fa-solid fa-flag" style="font-size:10px;"></i> Reportar
      </button>
    </div>`;

  // Wire subject pills
  document.getElementById('pills-subjects')
    ?.querySelectorAll('[data-subject]').forEach(pill => {
      pill.addEventListener('click', () => {
        const isSame = _activeSubject === pill.dataset.subject;
        document.querySelectorAll('#pills-subjects [data-subject]')
          .forEach(p => p.classList.remove('active'));
        _activeSubject = isSame ? null : pill.dataset.subject;
        if (!isSame) {
          pill.classList.add('active');
          _loadSubjectCache(_activeSubject);
        }
        // Update header badge
        const badge = document.getElementById('chat-subj-badge');
        if (badge) {
          if (_activeSubject) {
            badge.textContent = _activeSubject;
            badge.classList.add('show');
          } else {
            badge.classList.remove('show');
          }
        }
        // Update conv
        const conv = _conversations.find(c => c.id === _activeConvId);
        if (conv) { conv.subject = _activeSubject; _saveConvs(); }
      });
    });

  // Wire action pills
  document.getElementById('pills-subjects')
    ?.querySelectorAll('[data-action]').forEach(pill => {
      pill.addEventListener('click', () => {
        const a = pill.dataset.action;
        if      (a === 'simulacao') router.navigate('/panel/simulacao');
        else if (a === 'wa')        window.open('https://chat.whatsapp.com/FVYCayFjaGCAdCwrGEaJrv','_blank');
        else if (a === 'report')    _openReportSheet();
      });
    });
}

// ============================================================
// WIRE INPUT
// ============================================================

function _wireInput() {
  const ta      = document.getElementById('mentor-ta');
  const sendBtn = document.getElementById('btn-send');
  const attachBtn   = document.getElementById('btn-attach');
  const attachInput = document.getElementById('attach-input');
  const recordBtn   = document.getElementById('btn-record');
  if (!ta || !sendBtn) return;

  ta.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 110) + 'px';
    _updateSendBtn();
  });

  ta.addEventListener('focus', () => {
    if (_pillsMode !== 'emojis') {
      _pillsMode = 'emojis'; _renderPills();
    }
  });

  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) _sendMsg();
    }
  });

  ta.addEventListener('blur', () => {
    // Small delay so pill tap registers before switching back
    setTimeout(() => {
      if (!ta.value.trim() && _pillsMode !== 'subjects') {
        _pillsMode = 'subjects'; _renderPills();
      }
    }, 200);
  });

  if (!sendBtn._wired) {
    sendBtn._wired = true;
    sendBtn.addEventListener('click', _sendMsg);
  }

  if (attachBtn && attachInput && !attachBtn._wired) {
    attachBtn._wired = true;
    attachBtn.addEventListener('click', () => attachInput.click());
    attachInput.addEventListener('change', () => {
      const file = attachInput.files?.[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        ui.showToast('Escolha uma imagem válida.', 'error'); return;
      }
      if (file.size > 10 * 1024 * 1024) {
        ui.showToast('A imagem não pode ultrapassar 10 MB.', 'error'); return;
      }
      attachInput.value = '';
      _showImgPreview(file);
    });
  }

  // Wire image cancel button
  document.getElementById('img-cancel-btn')?.addEventListener('click', _hideImgPreview);

  if (recordBtn && !recordBtn._wired) {
    recordBtn._wired = true;
    recordBtn.addEventListener('click', () => _toggleRecording());
  }
}

function _wireChatHeader(conv) {
  const backBtn = document.getElementById('btn-chat-back');
  if (backBtn && !backBtn._wired) {
    backBtn._wired = true;
    backBtn.addEventListener('click', _closeChat);
  }
  const darkBtn   = document.getElementById('btn-dark-toggle');
  const trackEl   = document.getElementById('dark-toggle-track');
  if (darkBtn && !darkBtn._wired) {
    darkBtn._wired = true;
    // Set initial state
    const initDark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (initDark && trackEl) trackEl.classList.add('on');
    darkBtn.addEventListener('click', () => {
      ui.toggleDarkMode();
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      if (trackEl) trackEl.classList.toggle('on', isDark);
    });
  }

  const menuBtn = document.getElementById('btn-chat-menu');
  if (menuBtn && !menuBtn._wired) {
    menuBtn._wired = true;
    menuBtn.addEventListener('click', () => _openChatMenu(conv));
  }
}

function _closeChat() {
  const chatEl = document.getElementById('mentor-chat');
  if (chatEl) {
    chatEl.classList.remove('open');
    chatEl.setAttribute('aria-hidden','true');
    chatEl.style.height = ''; // reset so it does not affect cover
  }
  _view      = 'cover';
  _pillsMode = 'subjects';
  _renderConvList();
}

function _updateSendBtn() {
  const ta      = document.getElementById('mentor-ta');
  const btn     = document.getElementById('btn-send');
  const preview = document.getElementById('img-preview');
  const hasPending = !!preview?._pendingFile;
  if (btn) btn.disabled = (!ta?.value.trim() && !hasPending) || _isTyping;
}

// ============================================================
// SEND MESSAGE
// ============================================================

async function _sendMsg() {
  const ta      = document.getElementById('mentor-ta');
  const text    = ta?.value.trim();
  const preview = document.getElementById('img-preview');
  const pending = preview?._pendingFile;

  // If image is pending, send as image message
  if (pending) {
    const caption = text || '';
    if (ta) { ta.value = ''; ta.style.height = 'auto'; }
    _hideImgPreview();
    _sendImgMsg(pending, caption);
    return;
  }

  if (!text || _isTyping) return;

  // First message of new conversation — deduct Moedas now
  if (!_newConvPaid) {
    const bal = moeda.getBalance(_userData);
    if (bal < moeda.COSTS.MENTOR_SESSION) {
      moeda.showMoedasSheet(bal, moeda.COSTS.MENTOR_SESSION);
      return;
    }
    try {
      const result = await moeda.deductMoedas(_user.uid, moeda.COSTS.MENTOR_SESSION);
      if (!result.success) {
        ui.showToast('Erro ao deduzir Moedas. Tente novamente.', 'error');
        return;
      }
      _newConvPaid = true;
      _userData    = { ..._userData, moedas: result.newBalance };
    } catch (e) {
      ui.showToast('Erro ao deduzir Moedas.', 'error');
      return;
    }
  }

  _addUserMsg(text);
  if (ta) { ta.value = ''; ta.style.height = 'auto'; }
  _pillsMode = 'subjects';
  _renderPills();
  _updateSendBtn();

  // Ensure subject cache loaded
  if (_activeSubject && !_subjectQCache[_activeSubject]) {
    await _ensureSubjectCache(_activeSubject);
  }

  // Find relevant questions from cache — local search, zero Firestore reads
  const relevant = _activeSubject
    ? _findRelevantQuestions(text, _activeSubject)
    : [];
  const dbContext = _formatQuestionsForContext(relevant);

  // Build conversation history for AI — last MAX_HISTORY pairs
  const history = _messages
    .filter(m => m.type !== 'image')
    .slice(-MAX_HISTORY * 2)
    .map(m => ({
      role:    m.role === 'user' ? 'user' : 'assistant',
      content: m.text || '',
    }));

  // Inject DB context into last user message if relevant questions found
  if (dbContext && history.length) {
    history[history.length - 1] = {
      role:    'user',
      content: (history[history.length - 1].content || '') + '\n\n' + dbContext,
    };
  }

  _showTyping();
  _setStatus('A escrever…');

  try {
    // Correct architecture: system role separate, clean history after
    const messages = [
      { role: 'system', content: _buildSystemPrompt() },
      ...history,
    ];

    const response = await worker.callAI(messages, {
      maxTokens:   1400,
      temperature: 0.7,
    });

    _hideTyping();
    _addAiMsg(response || 'Desculpa, não consegui gerar uma resposta. Tenta novamente. 😔');
    _setStatus('Disponível');

  } catch (err) {
    _hideTyping();
    _setStatus('Disponível');
    _addAiMsg('Ocorreu um erro de ligação. Verifica a internet e tenta novamente. 🔌');
  }
}

function _showImgPreview(file) {
  const preview   = document.getElementById('img-preview');
  const thumb     = document.getElementById('img-preview-thumb');
  const attachBtn = document.getElementById('btn-attach');
  const ta        = document.getElementById('mentor-ta');
  if (!preview || !thumb) return;

  preview._pendingFile = file;

  const reader = new FileReader();
  reader.onload = () => {
    thumb.src = reader.result;
    preview.classList.add('show');
    if (attachBtn) attachBtn.classList.add('img-active');
    // Update textarea placeholder to guide user
    if (ta) {
      ta.placeholder = 'Escreva uma descrição para a imagem…';
      ta.focus();
    }
  };
  reader.readAsDataURL(file);
}

function _hideImgPreview() {
  const preview   = document.getElementById('img-preview');
  const attachBtn = document.getElementById('btn-attach');
  const ta        = document.getElementById('mentor-ta');
  if (preview) {
    preview.classList.remove('show');
    preview._pendingFile = null;
  }
  if (attachBtn) attachBtn.classList.remove('img-active');
  if (ta) ta.placeholder = 'Escreva a sua dúvida…';
}

async function _sendImgMsg(file, captionText = '') {
  if (_isTyping) return;

  const base64 = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

  _addUserImgMsg(base64);
  const ta = document.getElementById('mentor-ta');
  const caption = captionText || 'O que está nesta imagem? Pode ajudar-me?';

  _showTyping();
  _setStatus('A analisar a imagem…');

  try {
    const messages = [
      { role: 'system', content: _buildSystemPrompt() },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: base64 } },
          { type: 'text',      text: caption },
        ],
      },
    ];
    const response = await worker.callAI(messages, {
      hasImage: true, maxTokens: 1400, temperature: 0.7,
    });
    _hideTyping();
    _addAiMsg(response || 'Não consegui analisar a imagem. Tenta com uma foto mais nítida. 📸');
    _setStatus('Disponível');
  } catch {
    _hideTyping();
    _setStatus('Disponível');
    _addAiMsg('Não consegui analisar a imagem. Tenta enviar uma foto mais nítida. 📸');
  }
}

// ============================================================
// VOICE RECORDING
// ============================================================

async function _toggleRecording() {
  const btn = document.getElementById('btn-record');

  if (_isRecording) {
    if (_mediaRecorder) _mediaRecorder.stop();
    _isRecording = false;
    if (btn) {
      btn.classList.remove('record-active');
      btn.innerHTML = '<i class="fa-solid fa-microphone" aria-hidden="true"></i>';
    }
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    _audioChunks  = [];
    _mediaRecorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4',
    });

    _mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) _audioChunks.push(e.data);
    };

    _mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const ta           = document.getElementById('mentor-ta');
      const transcEl     = document.getElementById('mentor-transcribing');
      if (ta)       ta.style.display = 'none';
      if (transcEl) transcEl.classList.add('show');

      try {
        const blob = new Blob(_audioChunks, {
          type: _mediaRecorder.mimeType || 'audio/webm'
        });
        const text = await worker.transcribeAudio(blob);
        if (ta) {
          ta.style.display   = 'block';
          ta.value           = text;
          ta.style.height    = 'auto';
          ta.style.height    = Math.min(ta.scrollHeight, 110) + 'px';
          ta.focus();
          _updateSendBtn();
        }
      } catch {
        ui.showToast('Não foi possível transcrever o áudio.', 'error');
        if (ta) ta.style.display = 'block';
      } finally {
        if (transcEl) transcEl.classList.remove('show');
      }
    };

    _mediaRecorder.start();
    _isRecording = true;
    if (btn) {
      btn.classList.add('record-active');
      btn.innerHTML = '<i class="fa-solid fa-stop" aria-hidden="true"></i>';
    }
  } catch (err) {
    ui.showToast(
      err.name === 'NotAllowedError'
        ? 'Permissão de microfone negada.'
        : 'Não foi possível aceder ao microfone.',
      'error'
    );
  }
}

// ============================================================
// MESSAGE RENDERING
// ============================================================

function _addUserMsg(text) {
  const msg = { id: `m_${Date.now()}`, role: 'user', type: 'text', text, time: Date.now() };
  _messages.push(msg);
  _saveMsgs(_activeConvId, _messages);
  _updateConvPreview(text);
  _renderMsg(msg);
  _scrollBottom();
}

function _addUserImgMsg(base64) {
  const msg = {
    id: `m_${Date.now()}`, role: 'user', type: 'image',
    base64, text: '[Imagem enviada]', time: Date.now(),
  };
  _messages.push(msg);
  _renderMsg(msg);
  _scrollBottom();
}

function _addAiMsg(text) {
  const msg = { id: `m_${Date.now()}`, role: 'ai', type: 'text', text, time: Date.now() };
  _messages.push(msg);
  _saveMsgs(_activeConvId, _messages);
  _updateConvPreview(text);
  _renderMsg(msg);
  _scrollBottom();
}

function _renderMsg(msg) {
  const container = document.getElementById('mentor-msgs');
  if (!container) return;

  const isAi   = msg.role === 'ai';
  const name   = isAi
    ? '🧠 Mentor'
    : '👤 ' + ((_userData?.fullName || '').split(' ')[0] || 'Tu');
  const initials = (_userData?.fullName || 'E').charAt(0).toUpperCase();

  const el       = document.createElement('div');
  el.className   = `mentor-msg ${isAi ? 'ai' : 'user'}`;
  el.id          = msg.id;
  el.dataset.raw = (msg.text || '').replace(/\*\*/g,'').replace(/_/g,'');

  if (isAi) {
    el.innerHTML = `
      <div class="mentor-msg-av">🧠</div>
      <div class="mentor-msg-body">
        <div class="mentor-msg-name notranslate" translate="no">${_esc(name)}</div>
        <div class="mentor-bubble notranslate" translate="no">
          ${_fmtAi(msg.text || '')}
        </div>
        <div class="mentor-msg-footer">
          <button class="mentor-copy-btn">📋 Copiar</button>
          <button class="mentor-chip" data-qa="Simplifica a resposta anterior">
            🔄 Mais simples
          </button>
          <button class="mentor-chip" data-qa="Dá mais exemplos sobre o mesmo tema">
            💡 + Exemplos
          </button>
        </div>
      </div>`;
  } else {
    el.innerHTML = `
      <div class="mentor-msg-body">
        <div class="mentor-msg-name notranslate" translate="no">${_esc(name)}</div>
        ${msg.type === 'image'
          ? `<img class="mentor-bubble-img" src="${msg.base64}" alt="Imagem">`
          : ''}
        ${msg.type !== 'image'
          ? `<div class="mentor-bubble notranslate" translate="no">
               ${_esc(msg.text || '')}
             </div>`
          : ''}
        <div class="mentor-msg-footer">
          <button class="mentor-copy-btn">📋 Copiar</button>
        </div>
      </div>
      <div class="mentor-msg-av">${initials}</div>`;
  }

  // Wire copy buttons
  el.querySelectorAll('.mentor-copy-btn').forEach(btn => {
    if (!btn._wired) {
      btn._wired = true;
      btn.addEventListener('click', () => _copyText(btn, el.dataset.raw));
    }
  });

  // Wire quick chips
  el.querySelectorAll('.mentor-chip[data-qa]').forEach(chip => {
    if (!chip._wired) {
      chip._wired = true;
      chip.addEventListener('click', () => {
        const ta = document.getElementById('mentor-ta');
        if (!ta || _isTyping) return;
        ta.value = chip.dataset.qa;
        _updateSendBtn();
        _sendMsg();
      });
    }
  });

  container.appendChild(el);
}

function _renderAllMsgs() {
  const container = document.getElementById('mentor-msgs');
  if (!container) return;
  container.innerHTML = '';
  _messages.forEach(msg => _renderMsg(msg));
  _scrollBottom();
}

function _showTyping() {
  _isTyping = true;
  _updateSendBtn();
  if (document.getElementById('mentor-typing')) return;
  const container = document.getElementById('mentor-msgs');
  if (!container) return;
  const el     = document.createElement('div');
  el.className = 'mentor-typing';
  el.id        = 'mentor-typing';
  el.innerHTML = `
    <div class="mentor-msg-av"
      style="background:linear-gradient(135deg,#0369A1,#0284C7);">🧠</div>
    <div class="mentor-typing-bubble">
      <div class="mentor-td"></div>
      <div class="mentor-td"></div>
      <div class="mentor-td"></div>
    </div>`;
  container.appendChild(el);
  _scrollBottom();
}

function _hideTyping() {
  _isTyping = false;
  document.getElementById('mentor-typing')?.remove();
  _updateSendBtn();
}

function _scrollBottom() {
  const c = document.getElementById('mentor-msgs');
  if (c) setTimeout(() => { c.scrollTop = c.scrollHeight; }, 50);
}

function _setStatus(text) {
  const el = document.getElementById('chat-status');
  if (el) el.textContent = text;
}

// ============================================================
// CHAT MENU
// ============================================================

function _openChatMenu(conv) {
  ui.openBottomSheet({
    title:   'Opções da conversa',
    content: '',
    actions: [
      {
        label:   'Nova conversa',
        onClick: () => {
          ui.closeBottomSheet();
          _closeChat();
          setTimeout(_startNewConv, 250);
        },
      },
      {
        label:   'Apagar esta conversa',
        danger:  true,
        onClick: () => {
          ui.closeBottomSheet();
          _deleteConv(conv.id);
        },
      },
      { label: 'Cancelar', dismiss: true },
    ],
  });
}

function _deleteConv(convId) {
  _conversations = _conversations.filter(c => c.id !== convId);
  _saveConvs();
  _deleteMsgs(convId);
  _closeChat();
  ui.showToast('Conversa apagada.', 'info');
}

// ============================================================
// REPORT SHEET
// ============================================================

function _openReportSheet() {
  ui.openBottomSheet({
    title:   'Reportar problema',
    content: `
      <p style="font-size:13px;color:var(--text-muted);line-height:1.6;margin-bottom:12px;">
        Descreva o problema encontrado no Mentor.
      </p>
      <textarea id="report-text"
        style="width:100%;min-height:90px;padding:12px;border-radius:12px;
        border:1.5px solid var(--border);background:var(--bg);
        color:var(--text);font-family:inherit;font-size:14px;
        resize:none;outline:none;box-sizing:border-box;"
        placeholder="Descreva o problema…"></textarea>`,
    actions: [
      {
        label:   'Enviar via WhatsApp',
        onClick: () => {
          const text = document.getElementById('report-text')?.value.trim() || '';
          if (!text) { ui.showToast('Descreva o problema primeiro.', 'warning'); return; }
          const msg = encodeURIComponent(
            `[ExameNova — Mentor] Problema reportado:\n\n${text}`
          );
          window.open(`https://wa.me/258848920143?text=${msg}`, '_blank');
          ui.closeBottomSheet();
        },
      },
      { label: 'Cancelar', dismiss: true },
    ],
  });
}

// ============================================================
// TEXT FORMATTING
// ============================================================

function _inlineFmt(line) {
  return _esc(line)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/_([^_\n]+)_/g,       '<em>$1</em>')
    .replace(/\*([^*\n]+)\*/g,     '<em>$1</em>');
}

function _fmtAi(text) {
  if (!text) return '';
  let html = '';
  for (const line of text.split('\n')) {
    if (/^\s*[-*]\s+/.test(line)) {
      const content = line.replace(/^\s*[-*]\s+/, '');
      html += `<div style="display:flex;gap:7px;align-items:flex-start;margin:2px 0;">
        <span style="color:var(--primary);font-size:10px;margin-top:5px;flex-shrink:0;">●</span>
        <span>${_inlineFmt(content)}</span>
      </div>`;
    } else if (line.trim() === '') {
      html += '<div style="height:6px;"></div>';
    } else {
      html += `<div style="margin:1px 0;">${_inlineFmt(line)}</div>`;
    }
  }
  return html;
}

// ============================================================
// UTILITIES
// ============================================================

function _updateConvPreview(text) {
  const conv = _conversations.find(c => c.id === _activeConvId);
  if (!conv) return;
  const plain    = text.replace(/\*\*/g,'').replace(/\n/g,' ').slice(0, 60);
  conv.preview   = plain + (text.length > 60 ? '…' : '');
  conv.updatedAt = Date.now();
  _saveConvs();
}

function _copyText(btn, text) {
  if (btn.dataset.copying) return;
  btn.dataset.copying = '1';
  navigator.clipboard.writeText(text || '').then(() => {
    btn.textContent = '✅ Copiado!';
    setTimeout(() => {
      btn.textContent = '📋 Copiar';
      delete btn.dataset.copying;
    }, 2000);
  }).catch(() => {
    ui.showToast('Não foi possível copiar.', 'error');
    delete btn.dataset.copying;
  });
}

export default MentorScreen;
