// ============================================================
// ExameNova — Exam Database Guide
// File: panel/js/core/exams.GUIDE.js
//
// THIS FILE CONTAINS NO CODE — IT IS PURE DOCUMENTATION.
// Read this file completely before writing any screen that
// touches exam data. Every rule here exists to prevent a
// real bug that has happened before.
//
// CONTENTS:
//   PART 1 — The two database connections
//   PART 2 — exams_questions: every field explained
//   PART 3 — exams_texts: every field explained
//   PART 4 — wrongAnswers: every field explained
//   PART 5 — The functions in exams.js
//   PART 6 — Critical rules every screen must follow
//   PART 7 — Student profile → correct query translation
//   PART 8 — Common mistakes and how to avoid them
// ============================================================


// ============================================================
// PART 1 — THE TWO DATABASE CONNECTIONS
// ============================================================
//
// exams.js connects to TWO Firebase projects:
//
// _examDb  — dovelingua-database (read-only)
//   Collections: exams_questions, exams_texts
//   This database is SHARED across all DoveLingua projects.
//   ExameNova NEVER writes to it from any screen.
//   The admin panel and the AI Worker are the only writers.
//
// db  — ExameNova main Firebase project (read + write)
//   Collection used here: wrongAnswers
//   This is the same db imported from firebase.js.
//
// IMPORT PATTERN (from any screen two levels deep):
//   import { exams } from '../../core/exams.js';
//
// Never import from _examDb or dovelingua-database directly.
// Never query exams_questions or exams_texts from a screen.
// Always go through the functions in exams.js.
// ============================================================


// ============================================================
// PART 2 — exams_questions COLLECTION
// ============================================================
//
// ONE DOCUMENT = ONE QUESTION.
// The Firestore document ID is the same value as ID_Questão.
//
// REAL DOCUMENT EXAMPLE:
// {
//   "ID_Questão":       "FIS005",
//   "ID_Exame":         "FISEX01",
//   "Tipo_Exame":       "Ensino Geral",
//   "Instituição":      "MINED",
//   "Curso":            "Ciências",
//   "Ano":              "2000",
//   "Classe":           "10ª Classe",
//   "Disciplina":       "Física",
//   "Chamada":          "1ª Chamada",
//   "Nº":               "5",
//   "Tipo":             "resposta-aberta",
//   "Tema_Relacionado": "Ondas Mecânicas",
//   "ID_Unidade":       "UNID01",
//   "Enunciado":        "A figura representa uma onda cujo período...",
//   "Descrição_Figura": "Onda sinusoidal com crista e vale...",
//   "Opção_A":          "Alternativa A...",
//   "Opção_B":          "Alternativa B...",
//   "Opção_C":          "Alternativa C...",
//   "Opção_D":          "Alternativa D...",
//   "Opção_E":          "Alternativa E...",
//   "Opção_F":          "Alternativa F...",
//   "Correspondência":  "10ª ↔ 12ª",
//   "Resposta":         "64 oscilações",
//   "Resposta_Possível":"a) Uma oscilação completa...",
//   "Pontos":           "30",
//   "Explicação":       "Período é o tempo de uma oscilação completa..."
// }
//
// ── FIELD REFERENCE ──────────────────────────────────────────
//
// ID_Questão {string}
//   Unique question identifier. Also the Firestore document ID.
//   Ensino Geral format:  {ABREV}{NNN}       e.g. 'FIS005', 'MAT001'
//   Admissão format:      {INST}_{ABREV}{NNN} e.g. 'UEM_MAT001'
//   ⚠️ This is an IDENTIFIER — never display it as question text.
//   ⚠️ Some AI reads 'ID_Questão' and tries to render it as the
//      question the student should answer. That is always wrong.
//      The question text is always in the Enunciado field.
//
// ID_Exame {string}
//   Groups all questions from the same exam paper.
//   All questions in one exam share the same ID_Exame.
//   e.g. 'FISEX01' — all questions from that Física exam.
//   Use this to fetch a complete exam paper via fetchExam().
//
// Tipo_Exame {string}
//   EXACTLY one of two values — never anything else:
//     'Ensino Geral'  — national MEC/MINED exam
//     'Admissão'      — institution admission exam
//
// Instituição {string}
//   Who issued the exam. EXACT values:
//     'MINED'   — all Ensino Geral exams
//     'UEM'     — Universidade Eduardo Mondlane
//     'UP'      — Universidade Pedagógica
//     'IFP'     — Instituto de Formação de Professores
//     'ACIPOL'  — Academia de Ciências Policiais
//     'ISRI'    — Instituto Superior de Relações Internacionais
//     'ISCTEM'  — Instituto Superior de Ciências e Tecnologia
//     'UCM'     — Universidade Católica de Moçambique
//     'ISPU'    — Instituto Superior Politécnico e Universitário
//     'IMAP'    — Instituto Superior de Administração Pública
//     'Matalane' — Escola Prática da Polícia de Matalane
//                  Disciplina: 'Prova Escrita'
//                  IFP and Matalane are SEPARATE institutions
//   ⚠️ These are case-sensitive. 'Uem' or 'uem' will match nothing.
//   Use exams.toDbInstitution(userData.institution) to convert
//   the profile ID ('uem') to the DB value ('UEM') automatically.
//
// Curso {string}
//   Admission course name for Admissão exams.
//   Empty for all Ensino Geral exams.
//   e.g. 'Medicina', 'Engenharia Civil', 'Ciências Policiais'
//
// Ano {string}
//   Year of the exam. e.g. '2023'
//   ⚠️ MAY ARRIVE AS '2023.0' due to an Excel import artefact.
//   NEVER compare q['Ano'] === '2023' directly — it may fail.
//   ALWAYS use exams.getYear(q) which normalises automatically.
//   ALWAYS use exams.normaliseYear(value) before comparing years.
//   ALWAYS use exams.filterByYear(questions, '2023') for client
//   filtering — it handles '2023.0' vs '2023' correctly.
//
// Classe {string}
//   Grade level with exact format including ª and Classe.
//   e.g. '10ª Classe', '12ª Classe'
//   ⚠️ EMPTY for Admissão exams — they have no fixed grade.
//   ⚠️ Never filter by Classe when fetching Admissão questions.
//      Admissão questions are filtered by Instituição and
//      Disciplina only — never by grade.
//   ⚠️ Grade '9' does not exist in the DB.
//      Grade 9 students use Grade 10 papers as equivalence.
//      Always call exams.toDbGrade('9') → '10ª Classe'.
//      The student always sees '9ª Classe' in the UI — never '10'.
//
// Disciplina {string}
//   Subject name as stored in the DB. DIFFERENT from profile names.
//   DB name       → Profile name (userData.subjects)
//   'Português'   → 'Língua Portuguesa'
//   'Inglês'      → 'Língua Inglesa'
//   'Francês'     → 'Língua Francesa'
//   'Matemática'  → 'Matemática'       (same)
//   'Física'      → 'Física'           (same)
//   'Química'     → 'Química'          (same)
//   'Biologia'    → 'Biologia'         (same)
//   'História'    → 'História'         (same)
//   'Geografia'   → 'Geografia'        (same)
//   'Filosofia'   ← 'Introdução à Filosofia'
//   'Prova Escrita' ← 'Prova Escrita'  (Matalane — same in both)
//   ⚠️ ALWAYS call exams.toDbSubject(profileName) before querying.
//      Never pass profile subject names directly to fetchQuestions().
//
// Chamada {string}
//   Exam sitting. EXACTLY one of:
//     '1ª Chamada'  — first sitting
//     '2ª Chamada'  — second/resit sitting
//   Optional filter — only use when the screen specifically
//   needs to separate sittings.
//
// Nº {string}
//   Question number within the original exam paper.
//   e.g. '1', '2', '40'
//   ⚠️ This is a string — use Number(q['Nº']) to sort numerically.
//   Use exams.sortByNumber(questions) which handles this correctly.
//
// Tipo {string}
//   Question type. EXACTLY one of four values:
//     'escolha-multipla'  — MCQ with options A B C D (sometimes E F)
//     'resposta-aberta'   — open answer, no options
//     'verdadeiro-falso'  — true/false
//     'correspondência'   — matching two columns
//   ⚠️ Never assume a question is MCQ — always check Tipo first.
//   ⚠️ Never render options for 'resposta-aberta' questions.
//   ⚠️ For 'correspondência', use exams.parseMatching(q).
//
// Tema_Relacionado {string}
//   Curriculum topic this question tests.
//   e.g. 'Ondas Mecânicas', 'Genética', 'Aparelho Digestivo'
//   May be empty for older questions.
//   Use exams.topicFrequency(questions) for tendências analysis.
//   Always check: if (q['Tema_Relacionado']) { ... }
//
// ID_Unidade {string}
//   Links to a curriculum unit. May be empty — not all questions
//   are linked yet. Always check before using:
//   if (q['ID_Unidade']) { ... }
//
// Enunciado {string}
//   THE FULL QUESTION TEXT — this is what the student reads.
//   Never truncated. Includes all conditions, data and the
//   question itself. Tables use pipe notation: | col1 | col2 |
//   ⚠️ This is the ONLY field that contains the question text.
//   ⚠️ ID_Questão is never the question text — it is an ID.
//
// Descrição_Figura {string}
//   Text description of any figure, graph or diagram that
//   accompanies the question. May be empty.
//   Always check before using: if (q['Descrição_Figura']) { ... }
//   Display this alongside or below the Enunciado when present.
//
// Opção_A through Opção_F {string}
//   Answer option text WITHOUT the letter prefix.
//   The app adds 'A.' when rendering — never stored in the DB.
//   Options E and F are rare — most questions have A through D.
//   ⚠️ Never hardcode A B C D — some exams have E and F.
//   ⚠️ Never render empty options — check each before displaying.
//   ALWAYS use exams.getOptions(q) which returns only
//   non-empty options as [{ letter: 'A', text: '...' }, ...].
//
// Correspondência {string}
//   JSON string for matching questions only. Empty for all others.
//   ALWAYS use exams.parseMatching(q) — never JSON.parse directly.
//   Returns: { coluna_i: [...], coluna_ii: [...] } or null.
//   Resposta for matching uses format: '1-C, 2-A, 3-B'
//
// Resposta {string}
//   Confirmed correct answer.
//   ⚠️ CRITICAL: stores the FULL TEXT of the correct option,
//   NEVER a letter. Options may be shuffled — the text is the
//   only reliable identifier of the correct answer.
//
//   MCQ (one answer):    full option text e.g. 'Filogenético'
//   MCQ (multiple):      texts joined by ' | '
//                        e.g. 'Abertura de estomas | Pressão radicular'
//   Verdadeiro-falso:    'Verdadeiro' or 'Falso'
//   Correspondência:     '1-C, 2-A, 3-B, 4-D'
//   Resposta-aberta:     EMPTY — evaluated by AI Worker
//
//   ⚠️ MAY BE EMPTY for MCQ too — not all answers are confirmed.
//   ⚠️ NEVER compare by letter position — always compare text.
//   ⚠️ ALWAYS check: if (q['Resposta']) { showAnswer(q['Resposta']); }
//
//   Grading pattern:
//     const opts     = exams.getOptions(question);
//     const selected = opts.find(o => o.letter === studentChoice);
//     const correct  = exams.checkAnswer(question, selected?.text ?? '');
//
//   When Resposta is empty, pass the full question to the AI Worker.
//   The screen never fabricates an answer.
//
// Resposta_Possível {string}
//   Model answer or reasoning for open questions.
//   Also used when the AI is not 100% certain of the MCQ answer.
//   May be empty. Use as context for the AI Worker when present.
//   Always check: if (q['Resposta_Possível']) { ... }
//
// Pontos {string}
//   Marks value for this question. e.g. '2', '2.5', '30'
//   ⚠️ This is a string — use parseFloat(q['Pontos']) for maths.
//   May be empty for older exams.
//
// Explicação {string}
//   AI-generated explanation of the correct answer.
//   ⚠️ ALWAYS EMPTY INITIALLY — only filled on demand by the
//      AI Worker when explicitly requested.
//   ⚠️ NEVER assume it is populated.
//   ALWAYS check: if (q['Explicação']) { showExplanation(...); }
//   When empty, request from the AI Worker passing the full
//   question object. Never generate explanations client-side.
//
// texto_titulo, texto_autor, texto_conteudo, texto_glossario
//   Reading text fields for language exams (Português, Inglês,
//   Francês). Embedded on every question in the exam.
//   Empty for all non-language subjects.
//   ⚠️ All questions in the same language exam carry the same
//      text fields. Read from the first question only and
//      render the text ONCE above all questions.
//   Use exams.getInlineText(questions[0]) to extract cleanly.
//   Use exams.isLanguageSubject(disciplina) to check first.
// ============================================================


// ============================================================
// PART 3 — exams_texts COLLECTION
// ============================================================
//
// ONE DOCUMENT = ONE READING TEXT for one exam.
// The Firestore document ID is the ID_Exame value.
//
// REAL DOCUMENT EXAMPLE:
// {
//   "ID_Exame":   "INGEX01",
//   "Disciplina": "Inglês",
//   "Ano":        "2022",
//   "Título":     "Moreira Chonguiça",
//   "Conteúdo":   "Moreira Chonguiça is a jazz musician...",
//   "Autor":      "Ashinaga Initiative",
//   "Glossário":  "accolade: public recognition; appointment: ..."
// }
//
// ── FIELD REFERENCE ──────────────────────────────────────────
//
// ID_Exame {string}     links back to exams_questions
// Disciplina {string}   'Português' | 'Inglês' | 'Francês' only
// Ano {string}          may be '2022.0' — use normaliseYear()
// Título {string}       title of the reading passage
// Conteúdo {string}     full text of the reading passage
// Autor {string}        author or source — may be empty
// Glossário {string}    'word: definition; word: definition'
//                       May be empty. Split on '; ' to parse.
//
// ── WHEN TO USE exams_texts vs inline text ───────────────────
//
// The text fields are ALSO embedded inline on every question
// in exams_questions (texto_titulo, texto_conteudo, etc).
// If you already fetched the questions, use getInlineText().
// Only call fetchExamText() when you need the text separately
// without fetching all questions first.
//
// ── FETCH FUNCTIONS ──────────────────────────────────────────
//
// exams.fetchExamText(examId)
//   One specific text by exam ID. Returns object or null.
//   Always null-check: const text = await exams.fetchExamText('INGEX01');
//
// exams.fetchExamTexts({ disciplina, ano })
//   Multiple texts with optional filters.
//   Returns array (may be empty).
// ============================================================


// ============================================================
// PART 4 — wrongAnswers COLLECTION (ExameNova main Firebase)
// ============================================================
//
// ONE DOCUMENT = ONE WRONG ANSWER RECORD for one student.
// Stored in ExameNova's main Firebase project, not dovelingua-database.
// Auto-generated Firestore document ID.
//
// DOCUMENT SHAPE:
// {
//   userId:       string    — Firebase Auth UID
//   questionId:   string    — ID_Questão from the question
//   subject:      string    — Disciplina DB value e.g. 'Física'
//   topic:        string    — Tema_Relacionado (may be empty)
//   context:      string    — optional label from the calling screen
//   questionData: object    — FULL question object snapshot
//   savedAt:      timestamp
//   retried:      boolean
//   retriedAt:    timestamp | null
// }
//
// questionData is a complete snapshot of the question at save time.
// This means any feature that needs to render the question —
// the AI Mentor, Revisão, Meu Exame — can do so without making
// another call to the exam database. The question data is already
// there. Use questionData exactly like a question from fetchQuestions().
//
// context is a free string the calling screen may set. It is
// purely for the screen's own filtering — not enforced by exams.js.
// Example values: 'simulacao', 'desafio', 'meu-exame'
// A screen may pass context to getWrongAnswers() to read back
// only its own records.
//
// On retry: the existing document is UPDATED with retried: true.
// A new document is NOT created. One record per wrong answer.
//
// ── FUNCTIONS ────────────────────────────────────────────────
//
// exams.saveWrongAnswer(userId, question, context?)
//   Saves a wrong answer. Pass the full question object.
//   Returns the new Firestore document ID.
//
// exams.getWrongAnswers(userId, { subject?, retried? }, noCache?)
//   Fetches wrong answer records for a student.
//   subject: DB name e.g. 'Física' (not the profile name)
//   retried: true | false | omit for all
//
// exams.markRetried(docId)
//   Marks a record as retried. Updates the existing document.
//   Pass the _id field from a getWrongAnswers() result.
// ============================================================


// ============================================================
// PART 5 — FUNCTIONS IN exams.js
// ============================================================
//
// Import the whole object OR individual functions:
//   import { exams } from '../../core/exams.js';
//   import { fetchQuestions, toDbSubject } from '../../core/exams.js';
//
// ── MAPPING (always call these before querying) ───────────────
//
// exams.toDbSubject('Língua Portuguesa')  → 'Português'
// exams.toDbSubjects(['Língua Portuguesa', 'Matemática'])
//                                         → ['Português', 'Matemática']
// exams.toDbGrade('9')                    → '10ª Classe'
// exams.toDbGrade('12')                   → '12ª Classe'
// exams.toDbInstitution('ifp')            → 'IFP'
// exams.toDbInstitution('acipol')         → 'ACIPOL'
//
// ── FETCH (async — always await) ─────────────────────────────
//
// exams.fetchQuestions(filters, noCache?)
//   The primary query function. All filter keys are optional.
//   Returns: array of question objects (may be empty).
//
//   Available filter keys:
//     disciplina  {string}  DB subject name — use toDbSubject() first
//     classe      {string}  DB grade string — use toDbGrade() first
//     tipo_exame  {string}  'Ensino Geral' | 'Admissão'
//     instituicao {string}  DB institution  — use toDbInstitution() first
//     ano         {string}  e.g. '2023' (normalised)
//     chamada     {string}  '1ª Chamada' | '2ª Chamada'
//     tipo        {string}  question type string
//     tema        {string}  exact Tema_Relacionado string
//     id_exame    {string}  specific exam ID e.g. 'FISEX01'
//
//   Examples:
//     // All Física questions for Grade 12 national exams:
//     await exams.fetchQuestions({
//       disciplina: exams.toDbSubject('Física'),
//       classe:     exams.toDbGrade('12'),
//       tipo_exame: 'Ensino Geral',
//     });
//
//     // All ACIPOL admission questions:
//     await exams.fetchQuestions({
//       tipo_exame:  'Admissão',
//       instituicao: exams.toDbInstitution('acipol'),
//     });
//     ⚠️ No classe filter for Admissão — they have no grade.
//
//     // All questions for a specific exam paper:
//     await exams.fetchQuestions({ id_exame: 'FISEX01' });
//     // Or use the shorthand:
//     await exams.fetchExam('FISEX01');
//
//     // MCQ only for a subject:
//     await exams.fetchQuestions({
//       disciplina: 'Física',
//       tipo:       'escolha-multipla',
//     });
//
// exams.fetchQuestion(questionId, noCache?)
//   One specific question by ID_Questão.
//   Returns: object or null. Always null-check.
//   const q = await exams.fetchQuestion('FIS005');
//   if (!q) { showError(); return; }
//
// exams.fetchExam(examId, noCache?)
//   All questions for one exam, sorted by Nº.
//   Returns: array sorted by question number.
//
// exams.fetchExamShuffled(examId, noCache?)
//   All questions for one exam in random order.
//   Returns: array in random order.
//
// exams.fetchExamText(examId, noCache?)
//   Reading text for a language exam.
//   Returns: text object or null. Always null-check.
//
// exams.fetchExamTexts(filters, noCache?)
//   Multiple texts. Filters: disciplina, ano.
//   Returns: array.
//
// ── METADATA ─────────────────────────────────────────────────
//
// exams.getExamMeta(questions)
//   Extracts exam metadata from the first element of any array.
//   Returns: { id_exame, tipo_exame, instituicao, curso, ano,
//              classe, disciplina, chamada } or null.
//   There is NO separate metadata collection — all metadata
//   is read from the questions themselves.
//
// exams.getInlineText(question)
//   Extracts reading text fields from a question object.
//   Returns: { titulo, autor, conteudo, glossario } or null.
//   Call on questions[0] — text is same on all questions.
//
// ── YEAR ─────────────────────────────────────────────────────
//
// exams.normaliseYear('2023.0')  → '2023'
// exams.getYear(question)        → normalised year string
//
// ── OPTIONS AND TYPES ────────────────────────────────────────
//
// exams.getOptions(question)
//   → [{ letter: 'A', text: '...' }, { letter: 'B', text: '...' }, ...]
//   Returns only non-empty options. Handles A through F.
//
// exams.hasOptions(question)
//   → true if the question has at least one option.
//
// exams.isLanguageSubject('Português')  → true
// exams.isLanguageSubject('Física')     → false
//
// exams.parseMatching(question)
//   → { coluna_i: [...], coluna_ii: [...] } or null
//
// ── SORTING ──────────────────────────────────────────────────
//
// exams.sortByNumber(questions)  → sorted by Nº numerically
// exams.sortByYear(questions, 'desc')  → newest first
//
// ── GROUPING ─────────────────────────────────────────────────
//
// exams.groupByYear(questions)        → { '2023': [...], ... }
// exams.groupByExam(questions)        → { 'FISEX01': [...], ... }
// exams.groupBySubject(questions)     → { 'Física': [...], ... }
// exams.groupByTopic(questions)       → { 'Ondas Mecânicas': [...], ... }
// exams.groupByType(questions)        → { 'escolha-multipla': [...], ... }
// exams.groupByInstitution(questions) → { 'MINED': [...], 'UEM': [...], ... }
//
// ── ANALYSIS ─────────────────────────────────────────────────
//
// exams.topicFrequency(questions)
//   Returns topics sorted by how many questions test them.
//   → [{ topic: 'Ondas Mecânicas', count: 12, questions: [...] }, ...]
//   Use for tendências features and weakness-based analysis.
//   Questions with no Tema_Relacionado are excluded.
//
// ── CLIENT-SIDE FILTERS (no Firestore call) ──────────────────
//
// exams.filterByYear(questions, '2023')
//   Filters after fetch — handles '2023.0' correctly.
//
// exams.filterWithAnswer(questions)
//   Returns only questions with a non-empty Resposta field.
//
// exams.filterWithExplanation(questions)
//   Returns only questions with a non-empty Explicação field.
//
// exams.filterByType(questions, 'escolha-multipla')
//   Client-side type filter on an already-fetched array.
//
// ── RANDOMISATION ────────────────────────────────────────────
//
// exams.shuffle(questions)
//   Returns new array in random order. Does not mutate original.
//
// exams.pickRandom(questions, 10)
//   Returns 10 randomly selected questions from a pool.
//   If pool has fewer than 10, returns all shuffled.
// ============================================================


// ============================================================
// PART 6 — CRITICAL RULES EVERY SCREEN MUST FOLLOW
// ============================================================
//
// ── RULE 1: THE AI NEVER GENERATES QUESTIONS OR ANSWERS ──────
//
// ExameNova is built on REAL past exam content.
// No screen ever asks the AI to invent a question, generate
// answer options, or produce exam content from its own knowledge.
// The AI Worker receives real question objects fetched from
// the database and works with that content.
// It may evaluate a student's answer, explain a concept, or
// suggest a study approach — but always grounded in the
// real question data passed to it.
// A screen that sends a subject name to the AI and asks it
// to generate questions is wrong. Always fetch first.
//
// ── RULE 2: ID_Questão IS NEVER THE QUESTION TEXT ────────────
//
// ID_Questão (e.g. 'FIS005', 'UEM_MAT001') is a database
// identifier. It tells you which document you are looking at.
// It is never displayed to the student.
// The question text is always in the Enunciado field.
// A screen that renders q['ID_Questão'] as the question
// the student answers is always wrong.
//
// ── RULE 3: ADMISSÃO QUESTIONS HAVE NO GRADE ─────────────────
//
// The Classe field is EMPTY for all Admissão questions.
// Never add a classe filter when fetching Admissão questions.
// Admissão questions are fetched by tipo_exame + instituicao
// and optionally by disciplina, ano, chamada or tipo.
// A screen that tries to filter UEM or IFP questions by grade
// will return zero results every time.
//
// ── RULE 4: ALWAYS CONVERT NAMES BEFORE QUERYING ─────────────
//
// The student's profile stores 'Língua Portuguesa'.
// The database stores 'Português'.
// The student's profile stores grade '9'.
// The database uses '10ª Classe'.
// The student's profile stores institution 'ifp'.
// The database stores 'IFP'.
// Never pass raw profile values to fetchQuestions().
// Always call toDbSubject(), toDbGrade(), toDbInstitution() first.
//
// ── RULE 5: ALWAYS CHECK Resposta AND Explicação ─────────────
//
// These fields may be empty on any question. Zero exceptions.
// if (q['Resposta'])   { /* use it */ } else { /* handle it */ }
// if (q['Explicação']) { /* use it */ } else { /* handle it */ }
// When Resposta is empty, pass the full question object to the
// AI Worker. The screen handles the empty case — it never
// fabricates an answer or silently fails.
//
// ── RULE 6: FETCH TEXT ONCE FOR LANGUAGE EXAMS ───────────────
//
// For Português, Inglês and Francês exams, the reading text
// is embedded on every question in the array.
// Call getInlineText(questions[0]) once and render it once.
// Never call getInlineText() on every question in a loop.
// Never show the text multiple times on the same screen.
//
// ── RULE 7: YEAR FIELD NEEDS NORMALISATION ───────────────────
//
// The Ano field may be '2023.0' in the database.
// Never use q['Ano'] directly in comparisons or display.
// Always use exams.getYear(q) or exams.normaliseYear(value).
// Always use exams.filterByYear() for client-side year filtering.
//
// ── RULE 8: NEVER WRITE TO THE EXAM DATABASE ─────────────────
//
// exams_questions and exams_texts are read-only from all screens.
// The only write operation in exams.js is to wrongAnswers,
// which lives in the ExameNova main Firebase project.
// Any screen that tries to write to exams_questions will be
// blocked by Firestore security rules.
//
// ── RULE 9: OPTIONS GO UP TO F — USE getOptions() ────────────
//
// Never render options by hardcoding A, B, C, D.
// Some Mozambican exams have 5 or 6 options.
// Always use exams.getOptions(q) which returns only non-empty
// options dynamically, regardless of how many exist.
//
// ── RULE 10: ALWAYS CHECK THE QUESTION TYPE ──────────────────
//
// Before rendering a question, always check q['Tipo']:
//   'escolha-multipla' → render options with getOptions()
//   'verdadeiro-falso' → render options (A = Verdadeiro, B = Falso)
//   'resposta-aberta'  → render text input, no options
//   'correspondência'  → render two columns with parseMatching()
// Never assume a question is multiple choice.
//
// ── RULE 11: FETCH IS CACHED — noCache WHEN FRESH DATA NEEDED ─
//
// All fetch results are cached in session memory after the
// first call. This saves Firestore reads on revisits.
// If a screen needs guaranteed fresh data (e.g. after a write),
// pass noCache = true as the last argument to any fetch function.
// For wrongAnswers, always use noCache = true after saveWrongAnswer()
// or markRetried() to ensure the list reflects the change.
// ============================================================


// ============================================================
// PART 7 — STUDENT PROFILE → CORRECT QUERY TRANSLATION
// ============================================================
//
// The student's userData from the router determines what to fetch.
// Here is the complete translation for every student type.
// Import getStudentSubjects from app.js to get the subject list.
//
// ── ENSINO GERAL — 9ª CLASSE ─────────────────────────────────
//
// userData.examType  = 'ensino-geral'
// userData.grade     = '9'
// userData.status    = 'normal' | 'repetente'
// userData.section   = 'letras' | 'ciencias' | 'all' (repetente only)
// userData.subjects  = ['Língua Portuguesa', 'Matemática', ...]
//                      (from getStudentSubjects(userData) in app.js)
//
// Query pattern:
//   disciplina: exams.toDbSubject(subject)   → 'Português', 'Matemática'...
//   classe:     exams.toDbGrade('9')         → '10ª Classe'
//   tipo_exame: 'Ensino Geral'
//
// ── ENSINO GERAL — 12ª CLASSE ────────────────────────────────
//
// userData.examType  = 'ensino-geral'
// userData.grade     = '12'
// userData.status    = 'normal' | 'repetente'
// userData.subjects  = ['Língua Portuguesa', 'Matemática', ...]
//
// Query pattern:
//   disciplina: exams.toDbSubject(subject)   → 'Português', 'Matemática'...
//   classe:     exams.toDbGrade('12')        → '12ª Classe'
//   tipo_exame: 'Ensino Geral'
//
// ── ADMISSÃO — BY COURSE ─────────────────────────────────────
//
// userData.examType    = 'admissao'
// userData.course      = 'direito' | 'historia' | etc.
// userData.institution = null
// userData.subjects    = ['Língua Portuguesa', 'História']
//                        (the chosen pair from getCourseById())
//
// Query pattern:
//   disciplina:  exams.toDbSubject(subject)      → 'Português', 'História'
//   tipo_exame:  'Admissão'
//   ⚠️ NO classe filter — Admissão has no grade
//   ⚠️ NO instituicao filter unless the course maps to a
//      specific institution (most courses are cross-institution)
//
// ── ADMISSÃO — BY INSTITUTION ────────────────────────────────
//
// userData.examType    = 'admissao'
// userData.course      = null
// userData.institution = 'ifp' | 'acipol' | 'matalane' | etc.
// userData.subjects    = from getInstitutionById(userData.institution)
//
// Examples by institution:
//   IFP:      subjects = ['Língua Portuguesa', 'Matemática']
//             → disciplina: 'Português' or 'Matemática'
//             → instituicao: 'IFP'
//   Matalane: subjects = ['Prova Escrita']
//             → disciplina: 'Prova Escrita'
//             → instituicao: 'Matalane'
//   ACIPOL:   subjects = ['Língua Portuguesa', 'História'] or
//                        ['Língua Portuguesa', 'Matemática']
//             → disciplina: 'Português' or 'História' or 'Matemática'
//             → instituicao: 'ACIPOL'
//
// Query pattern:
//   disciplina:  exams.toDbSubject(subject)
//   tipo_exame:  'Admissão'
//   instituicao: exams.toDbInstitution(userData.institution)
//                → 'IFP' | 'Matalane' | 'ACIPOL' etc.
//   ⚠️ NO classe filter — Admissão has no grade
//   ⚠️ NO chamada filter — Admissão has no sitting
//
// ── GETTING SUBJECTS FOR ANY STUDENT ─────────────────────────
//
// Never build the subject list manually in a screen.
// Always import and call getStudentSubjects(userData) from app.js.
// It handles all grade/status/section/course/institution logic.
// Then convert each subject with exams.toDbSubject() before querying.
//
//   import { getStudentSubjects } from '../../core/app.js';
//   const subjects = getStudentSubjects(userData);
//   // subjects = ['Língua Portuguesa', 'Matemática']
//
//   for (const subject of subjects) {
//     const questions = await exams.fetchQuestions({
//       disciplina: exams.toDbSubject(subject),
//       classe:     userData.grade ? exams.toDbGrade(userData.grade) : undefined,
//       tipo_exame: userData.examType === 'admissao' ? 'Admissão' : 'Ensino Geral',
//       instituicao: userData.institution
//         ? exams.toDbInstitution(userData.institution) : undefined,
//     });
//   }
// ============================================================


// ============================================================
// PART 8 — COMMON MISTAKES AND HOW TO AVOID THEM
// ============================================================
//
// MISTAKE 1: Displaying ID_Questão as the question
//   Wrong:   questionEl.textContent = q['ID_Questão'];
//   Correct: questionEl.textContent = q['Enunciado'];
//
// MISTAKE 2: Filtering Admissão questions by grade
//   Wrong:   { tipo_exame: 'Admissão', classe: '12ª Classe' }
//   Correct: { tipo_exame: 'Admissão', instituicao: 'IFP' }
//
// MISTAKE 3: Using raw profile subject names in a query
//   Wrong:   { disciplina: 'Língua Portuguesa' }
//   Correct: { disciplina: exams.toDbSubject('Língua Portuguesa') }
//            → { disciplina: 'Português' }
//
// MISTAKE 4: Using raw grade in a query
//   Wrong:   { classe: '9' }
//   Correct: { classe: exams.toDbGrade('9') }
//            → { classe: '10ª Classe' }
//
// MISTAKE 5: Comparing Ano directly
//   Wrong:   q['Ano'] === '2023'     // fails if '2023.0'
//   Correct: exams.getYear(q) === '2023'
//
// MISTAKE 6: Assuming Resposta is always present
//   Wrong:   showAnswer(q['Resposta']);
//   Correct: if (q['Resposta']) { showAnswer(q['Resposta']); }
//            else { requestFromAIWorker(q); }
//
// MISTAKE 7: Hardcoding 4 answer options
//   Wrong:   render(q['Opção_A'], q['Opção_B'], q['Opção_C'], q['Opção_D'])
//   Correct: exams.getOptions(q).forEach(o => render(o.letter, o.text))
//
// MISTAKE 8: Asking AI to generate questions for a subject
//   Wrong:   worker.callAI(`Generate 10 Física questions for Grade 12`)
//   Correct: const questions = await exams.fetchQuestions({
//              disciplina: 'Física', classe: '12ª Classe'
//            });
//            // Then pass questions to the AI Worker if needed
//
// MISTAKE 9: Rendering reading text on every question
//   Wrong:   questions.forEach(q => { renderText(q); renderQuestion(q); })
//   Correct: const text = exams.getInlineText(questions[0]);
//            if (text) renderText(text);
//            questions.forEach(q => renderQuestion(q));
//
// MISTAKE 10: Using institution ID directly in a query
//   Wrong:   { instituicao: 'ifp' }
//   Correct: { instituicao: exams.toDbInstitution('ifp') }
//            → { instituicao: 'IFP' }
//
// MISTAKE 11: Not null-checking fetchQuestion() result
//   Wrong:   const q = await exams.fetchQuestion('FIS005');
//            renderQuestion(q);    // crashes if q is null
//   Correct: const q = await exams.fetchQuestion('FIS005');
//            if (!q) { showError(); return; }
//            renderQuestion(q);
//
// MISTAKE 12: Building subject lists manually in a screen
//   Wrong:   const subjects = ['Matemática', 'Física'];
//   Correct: import { getStudentSubjects } from '../../core/app.js';
//            const subjects = getStudentSubjects(userData);
//
// MISTAKE 13: Generating content because the AI knows the subject
//   Wrong:   Calling the AI Worker with just a topic name and
//            asking it to produce study material or questions.
//   Correct: Always fetch real curriculum content from the database first.
//            Pass the fetched question objects to the AI Worker.
//            The AI works with real content — it never invents it.
// ============================================================
