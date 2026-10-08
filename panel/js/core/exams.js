// ============================================================
// ExameNova — Exam Database Query Layer
// File: panel/js/core/exams.js
//
// TWO FIREBASE CONNECTIONS:
//   _examDb  — dovelingua-database project (questions + texts)
//   db       — ExameNova main project (wrongAnswers only)
//
// TWO READ-ONLY COLLECTIONS (exam db):
//   exams_questions  — one Firestore document per question
//   exams_texts      — reading passages (language exams only)
//
// ONE WRITABLE COLLECTION (main db):
//   wrongAnswers     — student wrong answer records
//
// FIELD NAMES ARE PORTUGUESE WITH ACCENTS — CASE-SENSITIVE:
//   q['Opção_A']    ✅     q['Opcao_A']    ❌
//   q['ID_Questão'] ✅     q['ID_Questao'] ❌
//
// SUBJECT NAMES:
//   Profile stores full names ('Língua Portuguesa').
//   DB stores short names ('Português').
//   Always call toDbSubject() or toDbSubjects() before querying.
//
// GRADE:
//   Grade '9' maps to '10ª Classe' in the DB (equivalence).
//   Always call toDbGrade() before querying.
//
// ANSWERS:
//   Resposta stores the FULL TEXT of the correct option, never
//   a letter. Options may be shuffled — always compare text.
//   Use checkAnswer(question, selectedText) for answer checking.
//   Resposta and Explicação may both be empty — always check:
//     if (q['Resposta'])   { ... }
//     if (q['Explicação']) { ... }
//
// INSTITUTIONS:
//   Both 'MINED' and 'MINEDH' exist for Ensino Geral exams.
//   When fetching all Ensino Geral questions for a subject,
//   fetch with both institution values and merge results.
//
// ADMISSÃO:
//   Classe is always empty for Admissão questions.
//   Chamada is always empty for Admissão questions.
//   Never add classe or chamada filters for Admissão queries.
//   IFP and Matalane are SEPARATE institutions:
//     IFP      → Instituição 'IFP',      subjects: Português + Matemática
//     Matalane → Instituição 'Matalane', subject:  Prova Escrita
//
// CACHING:
//   All fetch results are cached in session memory (module Map).
//   Cache clears on page reload. Pass noCache = true to bypass.
//   Always pass noCache = true after writing to wrongAnswers.
//
// COMPOSITE INDEXES:
//   Combining multiple where() clauses requires composite indexes
//   in Firestore. If a query fails, Firebase logs a console error
//   with a direct URL to create the missing index. Share that URL
//   with Teacher Dove — it is a one-click fix in the console.
// ============================================================

import { db } from './firebase.js';

import {
  initializeApp,
  getApps,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';

import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';


// ============================================================
// SECTION 1 — SECOND FIREBASE APP (dovelingua-database)
// ============================================================

const EXAM_DB_CONFIG = {
  apiKey:            'AIzaSyDrn1Ch2diZ40yk7GSSOEfZII72Rp2-EXI',
  authDomain:        'dovelingua-database.firebaseapp.com',
  projectId:         'dovelingua-database',
  storageBucket:     'dovelingua-database.firebasestorage.app',
  messagingSenderId: '102201240074',
  appId:             '1:102201240074:web:483fb869ac368db0354df3',
};

const _examApp = getApps().find(a => a.name === 'exam-db')
  ?? initializeApp(EXAM_DB_CONFIG, 'exam-db');

const _examDb = getFirestore(_examApp);

const _QCol  = collection(_examDb, 'exams_questions');
const _TCol  = collection(_examDb, 'exams_texts');
const _WACol = collection(db,      'wrongAnswers');


// ============================================================
// SECTION 2 — MAPPINGS
//
// SUBJECT MAP — profile name → DB Disciplina value.
// Subjects not in this map are passed through unchanged.
//
// GRADE MAP — profile grade → DB Classe value.
// Grade '9' uses Grade 10 papers as equivalence (see app.js).
//
// INSTITUTION MAP — profile institution ID → DB Instituição value.
// Matalane PRM is a course under IFP, not a separate institution.
// For Matalane students: institution = 'IFP', curso = 'Matalane PRM'.
// ============================================================

const SUBJECT_MAP = {
  'Língua Portuguesa':      'Português',
  'Língua Inglesa':         'Inglês',
  'Língua Francesa':        'Francês',
  'Introdução à Filosofia': 'Filosofia',
  'Matemática':             'Matemática',
  'Física':                 'Física',
  'Química':                'Química',
  'Biologia':               'Biologia',
  'História':               'História',
  'Geografia':              'Geografia',
  'Prova Escrita':          'Prova Escrita',  // Matalane exam subject
};

const GRADE_MAP = {
  '9':  '10ª Classe',
  '10': '10ª Classe',
  '12': '12ª Classe',
};

const INSTITUTION_MAP = {
  'ifp':      'IFP',
  'acipol':   'ACIPOL',
  'matalane': 'Matalane',  // Escola Prática da Polícia de Matalane
  'uem':      'UEM',
  'up':       'UP',
  'isri':     'ISRI',
  'isctem':   'ISCTEM',
  'ucm':      'UCM',
  'ispu':     'ISPU',
  'imap':     'IMAP',
  'faef':     'FAEF',
  'estec':    'ESTEC',
};

/**
 * Converts a profile subject name to its DB Disciplina value.
 * Unknown names are returned unchanged.
 * @param {string} name
 * @returns {string}
 */
export function toDbSubject(name) {
  return SUBJECT_MAP[name] ?? name;
}

/**
 * Converts an array of profile subject names to DB values.
 * @param {string[]} names
 * @returns {string[]}
 */
export function toDbSubjects(names) {
  if (!Array.isArray(names)) return [];
  return names.map(toDbSubject);
}

/**
 * Converts a profile grade string to the DB Classe value.
 * Grade '9' returns '10ª Classe' (equivalence mapping).
 * @param {string} grade — '9' | '10' | '12'
 * @returns {string}
 */
export function toDbGrade(grade) {
  return GRADE_MAP[String(grade)] ?? `${grade}ª Classe`;
}

/**
 * Converts a profile institution ID to the DB Instituição value.
 * Unknown IDs are uppercased and returned as-is.
 * @param {string} id — e.g. 'ifp', 'acipol', 'matalane'
 * @returns {string}
 */
export function toDbInstitution(id) {
  return INSTITUTION_MAP[String(id).toLowerCase()] ?? String(id).toUpperCase();
}


// ============================================================
// SECTION 3 — SESSION CACHE
// ============================================================

const _cache = new Map();

function _cacheKey(namespace, payload) {
  return namespace + ':' + JSON.stringify(payload);
}

function _cacheGet(key) {
  return _cache.get(key);
}

function _cacheSet(key, results) {
  _cache.set(key, Object.freeze([...results]));
}

function _cacheInvalidate(prefix) {
  for (const key of _cache.keys()) {
    if (key.startsWith(prefix + ':')) _cache.delete(key);
  }
}


// ============================================================
// SECTION 4 — INTERNAL QUERY BUILDER
//
// Accepted filter keys → DB field:
//   disciplina       → Disciplina          use toDbSubject() first
//   classe           → Classe              use toDbGrade() first
//                                          omit for Admissão
//   tipo_exame       → Tipo_Exame          'Ensino Geral' | 'Admissão'
//   instituicao      → Instituição         use toDbInstitution() first
//   ano              → Ano                 normalised string e.g. '2023'
//   chamada          → Chamada             '1ª Chamada' | '2ª Chamada'
//                                          omit for Admissão
//   tipo             → Tipo                question type string
//   tema             → Tema_Relacionado    exact topic string
//   id_exame         → ID_Exame            specific exam ID
//   tipologia_textual→ Tipologia_Textual   text genre (exams_texts only)
//
// ANO NOTE:
//   The DB may store '2023.0' (Excel artefact). If ano filtering
//   returns 0 results, use filterByYear() client-side instead.
// ============================================================

function _buildConstraints(filters) {
  const c = [];
  if (filters.disciplina)        c.push(where('Disciplina',         '==', filters.disciplina));
  if (filters.classe)            c.push(where('Classe',             '==', filters.classe));
  if (filters.tipo_exame)        c.push(where('Tipo_Exame',         '==', filters.tipo_exame));
  if (filters.instituicao)       c.push(where('Instituição',        '==', filters.instituicao));
  if (filters.ano)               c.push(where('Ano',                '==', filters.ano));
  if (filters.chamada)           c.push(where('Chamada',            '==', filters.chamada));
  if (filters.tipo)              c.push(where('Tipo',               '==', filters.tipo));
  if (filters.tema)              c.push(where('Tema_Relacionado',   '==', filters.tema));
  if (filters.id_exame)          c.push(where('ID_Exame',           '==', filters.id_exame));
  if (filters.tipologia_textual) c.push(where('Tipologia_Textual',  '==', filters.tipologia_textual));
  return c;
}

async function _execQuery(col, filters, noCache) {
  const key = _cacheKey(col.id, filters);
  if (!noCache) {
    const cached = _cacheGet(key);
    if (cached) return [...cached];
  }

  const constraints = _buildConstraints(filters);
  const q    = constraints.length ? query(col, ...constraints) : query(col);
  const snap = await getDocs(q);
  const results = snap.docs.map(d => ({ _id: d.id, ...d.data() }));

  if (!noCache) _cacheSet(key, results);
  return results;
}


// ============================================================
// SECTION 5 — FETCH FUNCTIONS
//
// All functions are async and return arrays, except:
//   fetchQuestion()  → single object | null
//   fetchExamText()  → single object | null
//
// Every returned object has an _id field = Firestore document ID.
// Pass noCache = true to bypass session cache.
// All functions throw on Firestore errors — wrap in try/catch.
// ============================================================

/**
 * Fetches questions from exams_questions using any combination
 * of equality filters. Primary query function — all keys optional.
 *
 * Filter keys:
 *   disciplina  {string}  DB subject   — always use toDbSubject() first
 *   classe      {string}  DB grade     — always use toDbGrade() first
 *                                        OMIT for Admissão queries
 *   tipo_exame  {string}  'Ensino Geral' | 'Admissão'
 *   instituicao {string}  DB institution — use toDbInstitution() first
 *   ano         {string}  e.g. '2023'
 *   chamada     {string}  '1ª Chamada' | '2ª Chamada'
 *                                        OMIT for Admissão queries
 *   tipo        {string}  'escolha-multipla' | 'resposta-aberta' |
 *                         'verdadeiro-falso'  | 'correspondência'
 *   tema        {string}  exact Tema_Relacionado string
 *   id_exame    {string}  specific exam ID e.g. 'FISEX01'
 *
 * ⚠️ MINED + MINEDH: Ensino Geral questions may have either value.
 *    To get all national exam questions for a subject, either omit
 *    instituicao or fetch twice (once per value) and merge.
 *
 * @param {object}  [filters={}]
 * @param {boolean} [noCache=false]
 * @returns {Promise<object[]>}
 */
export async function fetchQuestions(filters = {}, noCache = false) {
  return _execQuery(_QCol, filters, noCache);
}

/**
 * Convenience: fetch all national Ensino Geral questions for a
 * subject and grade, merging both MINED and MINEDH institutions.
 * Use this instead of fetchQuestions() when you want all
 * national exam questions without worrying about institution.
 *
 * @param {string}  dbSubject  — DB subject name e.g. 'Física'
 * @param {string}  dbGrade    — DB grade e.g. '12ª Classe'
 * @param {object}  [extra={}] — additional filters (ano, chamada, tipo, tema)
 * @param {boolean} [noCache=false]
 * @returns {Promise<object[]>}
 */
export async function fetchEnsinoGeral(dbSubject, dbGrade, extra = {}, noCache = false) {
  const base = { disciplina: dbSubject, classe: dbGrade, tipo_exame: 'Ensino Geral', ...extra };
  const [r1, r2] = await Promise.all([
    fetchQuestions({ ...base, instituicao: 'MINED'   }, noCache),
    fetchQuestions({ ...base, instituicao: 'MINEDH'  }, noCache),
  ]);
  return [...r1, ...r2];
}

/**
 * Convenience: fetch all Admissão questions for an institution
 * and subject. No grade or chamada filters applied.
 *
 * @param {string}  dbInstitution — DB institution e.g. 'IFP'
 * @param {string}  dbSubject     — DB subject e.g. 'Matemática'
 * @param {object}  [extra={}]    — additional filters (ano, tipo, tema)
 * @param {boolean} [noCache=false]
 * @returns {Promise<object[]>}
 */
export async function fetchAdmissao(dbInstitution, dbSubject, extra = {}, noCache = false) {
  return fetchQuestions({
    tipo_exame:  'Admissão',
    instituicao: dbInstitution,
    disciplina:  dbSubject,
    ...extra,
  }, noCache);
}

/**
 * Fetches a single question by its ID_Questão.
 * Returns the question object or null if not found.
 * @param {string}  questionId  e.g. 'FIS005', 'UEM_MAT001'
 * @param {boolean} [noCache=false]
 * @returns {Promise<object|null>}
 */
export async function fetchQuestion(questionId, noCache = false) {
  const key = _cacheKey('single-q', questionId);
  if (!noCache) {
    const cached = _cacheGet(key);
    if (cached) return { ...cached[0] };
  }

  const snap = await getDoc(doc(_examDb, 'exams_questions', questionId));
  if (!snap.exists()) return null;

  const result = { _id: snap.id, ...snap.data() };
  if (!noCache) _cacheSet(key, [result]);
  return result;
}

/**
 * Fetches all questions for one specific exam, sorted by Nº.
 * @param {string}  examId   e.g. 'FISEX01'
 * @param {boolean} [noCache=false]
 * @returns {Promise<object[]>}
 */
export async function fetchExam(examId, noCache = false) {
  const questions = await fetchQuestions({ id_exame: examId }, noCache);
  return sortByNumber(questions);
}

/**
 * Fetches all questions for one specific exam in random order.
 * Option order within each question is preserved.
 * @param {string}  examId
 * @param {boolean} [noCache=false]
 * @returns {Promise<object[]>}
 */
export async function fetchExamShuffled(examId, noCache = false) {
  const questions = await fetchQuestions({ id_exame: examId }, noCache);
  return shuffle(questions);
}

/**
 * Fetches a reading text from exams_texts by exam ID.
 * Returns a single text object or null if none exists.
 * Normalises field names — use the returned object's
 * .titulo, .autor, .conteudo, .glossario, .tipologia properties.
 * @param {string}  examId   e.g. 'PORTEX01'
 * @param {boolean} [noCache=false]
 * @returns {Promise<object|null>}
 */
export async function fetchExamText(examId, noCache = false) {
  const key = _cacheKey('text', examId);
  if (!noCache) {
    const cached = _cacheGet(key);
    if (cached) return { ...cached[0] };
  }

  const snap = await getDoc(doc(_examDb, 'exams_texts', examId));
  if (!snap.exists()) return null;

  const result = normaliseTextDoc({ _id: snap.id, ...snap.data() });
  if (!noCache) _cacheSet(key, [result]);
  return result;
}

/**
 * Fetches reading texts from exams_texts with optional filters.
 * Returns normalised text objects (use .titulo, .conteudo etc.).
 *
 * Filter keys:
 *   disciplina        {string}  'Português' | 'Inglês' | 'Francês'
 *   ano               {string}  e.g. '2022'
 *   tipo_exame        {string}  'Ensino Geral' | 'Admissão'
 *   instituicao       {string}  DB institution value
 *   classe            {string}  DB grade e.g. '12ª Classe'
 *   tipologia_textual {string}  'Texto Narrativo' | 'Texto Lírico' etc.
 *                                (Português only — empty for Inglês/Francês)
 *
 * @param {object}  [filters={}]
 * @param {boolean} [noCache=false]
 * @returns {Promise<object[]>}
 */
export async function fetchExamTexts(filters = {}, noCache = false) {
  const key = _cacheKey('texts', filters);
  if (!noCache) {
    const cached = _cacheGet(key);
    if (cached) return [...cached];
  }

  const results = await _execQuery(_TCol, filters, noCache);
  const normalised = results.map(normaliseTextDoc);

  if (!noCache) _cacheSet(key, normalised);
  return normalised;
}


// ============================================================
// SECTION 6 — CLIENT-SIDE UTILITY FUNCTIONS
//
// No Firestore calls — pure JS transformations.
// None of them mutate the input array.
// ============================================================

// ── Text document normalisation ────────────────────────────────

/**
 * Normalises a raw exams_texts document to consistent lowercase
 * property names so screens never need to check both formats.
 * Always use this on documents returned from exams_texts.
 * fetchExamText() and fetchExamTexts() call this automatically.
 * @param {object} doc
 * @returns {object}
 */
export function normaliseTextDoc(textDoc) {
  if (!textDoc) return null;
  return {
    ...textDoc,
    titulo:    String(textDoc['Título']              ?? textDoc['titulo']    ?? '').trim(),
    autor:     String(textDoc['Autor']               ?? textDoc['autor']     ?? '').trim(),
    conteudo:  String(textDoc['Conteúdo']            ?? textDoc['conteudo']  ?? '').trim(),
    glossario: String(textDoc['Glossário']           ?? textDoc['glossario'] ?? '').trim(),
    tipologia: String(textDoc['Tipologia_Textual']   ?? textDoc['tipologia'] ?? '').trim(),
    disciplina:String(textDoc['Disciplina']          ?? '').trim(),
    ano:       normaliseYear(textDoc['Ano']          ?? ''),
    classe:    String(textDoc['Classe']              ?? '').trim(),
  };
}

// ── Year normalisation ─────────────────────────────────────────

/**
 * Normalises an Ano value from '2023.0' to '2023'.
 * @param {string|number} value
 * @returns {string}
 */
export function normaliseYear(value) {
  const n = parseFloat(String(value ?? ''));
  return isNaN(n) ? '' : String(Math.round(n));
}

/**
 * Reads the Ano field from a question and returns the normalised year.
 * @param {object} question
 * @returns {string}
 */
export function getYear(question) {
  return normaliseYear(question?.['Ano']);
}

// ── Answer checking ────────────────────────────────────────────

/**
 * Checks if a student's selected option text matches the correct
 * answer stored in the Resposta field.
 *
 * ⚠️ CRITICAL RULE: Resposta stores the FULL TEXT of the correct
 * option, never a letter. Options may be shuffled. Never compare
 * by letter or array index — always compare by text.
 *
 * For 'escolha-multipla':
 *   const opts     = exams.getOptions(question);
 *   const selected = opts.find(o => o.letter === studentChoice);
 *   const correct  = exams.checkAnswer(question, selected?.text ?? '');
 *
 * For 'verdadeiro-falso':
 *   const correct = exams.checkAnswer(question, 'Verdadeiro'); // or 'Falso'
 *
 * Returns false when Resposta is empty — caller must handle that
 * case by passing the question to the AI Worker for evaluation.
 *
 * @param {object} question     — full question object
 * @param {string} selectedText — text of the student's chosen option
 * @returns {boolean}
 */
export function checkAnswer(question, selectedText) {
  const resposta = String(question?.['Resposta'] ?? '').trim();
  if (!resposta) return false;
  return resposta === String(selectedText ?? '').trim();
}

/**
 * Returns true if the question has a confirmed correct answer.
 * For MCQ and T/F: Resposta is non-empty.
 * For open/matching: always false — AI Worker evaluates these.
 * @param {object} question
 * @returns {boolean}
 */
export function hasConfirmedAnswer(question) {
  return !!String(question?.['Resposta'] ?? '').trim();
}

// ── Options ────────────────────────────────────────────────────

/**
 * Returns the non-empty options of a question as an ordered array.
 * Each item: { letter: 'A', text: '...' }
 * Use letter for DISPLAY only — use text for answer checking.
 * Handles A through F dynamically.
 * @param {object} question
 * @returns {{ letter: string, text: string }[]}
 */
export function getOptions(question) {
  if (!question) return [];
  return ['A', 'B', 'C', 'D', 'E', 'F']
    .map(l => ({ letter: l, text: String(question[`Opção_${l}`] ?? '').trim() }))
    .filter(o => o.text.length > 0);
}

/**
 * Returns true if the question has at least one option.
 * @param {object} question
 * @returns {boolean}
 */
export function hasOptions(question) {
  return getOptions(question).length > 0;
}

// ── Language subject ───────────────────────────────────────────

/**
 * Returns true if a DB Disciplina value is a language subject
 * that may have an associated reading text.
 * Pass the DB name ('Português'), not the profile name.
 * @param {string} disciplina
 * @returns {boolean}
 */
export function isLanguageSubject(disciplina) {
  return ['Português', 'Inglês', 'Francês'].includes(disciplina);
}

// ── Matching questions ─────────────────────────────────────────

/**
 * Parses the Correspondência plain-text field for matching questions.
 * The field is NOT JSON — it is plain text with \n line breaks.
 * Format: 'Coluna I:\n\n1. Item\n2. Item\n\nColuna II:\n\nA. Def\nB. Def'
 * Returns { coluna_i: [...], coluna_ii: [...] } or null.
 * Always null-check the return value before using.
 * Resposta for matching uses format: '1-B, 2-A, 3-D'
 * @param {object} question
 * @returns {{ coluna_i: string[], coluna_ii: string[] }|null}
 */
export function parseMatching(question) {
  const raw = String(question?.['Correspondência'] ?? '').trim();
  if (!raw) return null;
  try {
    const halves = raw.split(/Coluna\s+II\s*:/i);
    if (halves.length < 2) return null;
    const colI  = halves[0].replace(/Coluna\s+I\s*:/i, '').trim();
    const colII = halves[1].trim();
    const parseCol = str => str
      .split('\n')
      .map(l => l.replace(/^\s*\d+[.)]\s*/, '').replace(/^\s*[A-Z][.)]\s*/i, '').trim())
      .filter(l => l.length > 0);
    const coluna_i  = parseCol(colI);
    const coluna_ii = parseCol(colII);
    if (!coluna_i.length || !coluna_ii.length) return null;
    return { coluna_i, coluna_ii };
  } catch {
    return null;
  }
}

// ── Exam metadata ──────────────────────────────────────────────

/**
 * Extracts exam-level metadata from any question array.
 * Reads from the first element — all questions in one exam
 * carry identical metadata. No separate metadata collection exists.
 * @param {object[]} questions
 * @returns {{
 *   id_exame: string, tipo_exame: string, instituicao: string,
 *   curso: string, ano: string, classe: string,
 *   disciplina: string, chamada: string
 * }|null}
 */
export function getExamMeta(questions) {
  if (!questions?.length) return null;
  const q = questions[0];
  return {
    id_exame:    q['ID_Exame']    ?? '',
    tipo_exame:  q['Tipo_Exame']  ?? '',
    instituicao: q['Instituição'] ?? '',
    curso:       q['Curso']       ?? '',
    ano:         normaliseYear(q['Ano'] ?? ''),
    classe:      q['Classe']      ?? '',
    disciplina:  q['Disciplina']  ?? '',
    chamada:     q['Chamada']     ?? '',
  };
}

// ── Inline reading text ────────────────────────────────────────

/**
 * Extracts reading text fields embedded in a question object.
 * For language exams, the text is duplicated on every question.
 * Always call on questions[0] only — render the text ONCE.
 * Returns null if the question carries no text.
 * @param {object} question
 * @returns {{ titulo: string, autor: string, conteudo: string, glossario: string }|null}
 */
export function getInlineText(question) {
  if (!question) return null;
  const conteudo = String(question['texto_conteudo'] ?? '').trim();
  if (!conteudo) return null;
  return {
    titulo:    String(question['texto_titulo']    ?? '').trim(),
    autor:     String(question['texto_autor']     ?? '').trim(),
    conteudo,
    glossario: String(question['texto_glossario'] ?? '').trim(),
  };
}

// ── Sorting ────────────────────────────────────────────────────

/**
 * Returns a new array sorted by question number (Nº field).
 * Uses numeric comparison — '10' comes after '2'.
 * @param {object[]} questions
 * @returns {object[]}
 */
export function sortByNumber(questions) {
  return [...(questions ?? [])].sort(
    (a, b) => Number(a['Nº'] ?? 0) - Number(b['Nº'] ?? 0)
  );
}

/**
 * Returns a new array sorted by exam year (Ano field).
 * Normalises '2023.0' before comparing.
 * @param {object[]} questions
 * @param {'asc'|'desc'} [direction='asc']
 * @returns {object[]}
 */
export function sortByYear(questions, direction = 'asc') {
  const m = direction === 'desc' ? -1 : 1;
  return [...(questions ?? [])].sort(
    (a, b) => (Number(getYear(a)) - Number(getYear(b))) * m
  );
}

// ── Grouping ───────────────────────────────────────────────────

function _groupBy(arr, keyFn) {
  const out = {};
  for (const item of (arr ?? [])) {
    const k = keyFn(item);
    if (!out[k]) out[k] = [];
    out[k].push(item);
  }
  return out;
}

/** Groups by normalised year. → { '2023': [...], ... } */
export function groupByYear(questions) {
  return _groupBy(questions, q => getYear(q));
}

/** Groups by exam ID. → { 'FISEX01': [...], ... } */
export function groupByExam(questions) {
  return _groupBy(questions, q => q['ID_Exame'] ?? '');
}

/** Groups by subject. → { 'Física': [...], ... } */
export function groupBySubject(questions) {
  return _groupBy(questions, q => q['Disciplina'] ?? '');
}

/** Groups by topic. → { 'Ondas Mecânicas': [...], ... } */
export function groupByTopic(questions) {
  return _groupBy(questions, q => q['Tema_Relacionado'] ?? '');
}

/** Groups by question type. → { 'escolha-multipla': [...], ... } */
export function groupByType(questions) {
  return _groupBy(questions, q => q['Tipo'] ?? '');
}

/**
 * Groups by institution.
 * → { 'MINED': [...], 'MINEDH': [...], 'UEM': [...], ... }
 */
export function groupByInstitution(questions) {
  return _groupBy(questions, q => q['Instituição'] ?? '');
}

// ── Topic frequency ────────────────────────────────────────────

/**
 * Returns topic frequency sorted by count (most first).
 * Questions with empty Tema_Relacionado are excluded.
 * Use for tendências features and weakness-based analysis.
 * @param {object[]} questions
 * @returns {{ topic: string, count: number, questions: object[] }[]}
 */
export function topicFrequency(questions) {
  const grouped = groupByTopic(questions);
  return Object.entries(grouped)
    .filter(([topic]) => topic.trim().length > 0)
    .map(([topic, qs]) => ({ topic, count: qs.length, questions: qs }))
    .sort((a, b) => b.count - a.count);
}

// ── Client-side filters ────────────────────────────────────────

/**
 * Filters by year after normalising stored values.
 * Use this when Firestore Ano filter returns unexpected results.
 * @param {object[]} questions
 * @param {string}   year  e.g. '2023'
 * @returns {object[]}
 */
export function filterByYear(questions, year) {
  const norm = normaliseYear(year);
  return (questions ?? []).filter(q => getYear(q) === norm);
}

/**
 * Returns questions with a non-empty Resposta field.
 * These can be auto-graded. Resposta stores full option text.
 * @param {object[]} questions
 * @returns {object[]}
 */
export function filterWithAnswer(questions) {
  return (questions ?? []).filter(q => !!String(q['Resposta'] ?? '').trim());
}

/**
 * Returns questions that already have an AI Explicação.
 * @param {object[]} questions
 * @returns {object[]}
 */
export function filterWithExplanation(questions) {
  return (questions ?? []).filter(q => !!String(q['Explicação'] ?? '').trim());
}

/**
 * Client-side type filter on an already-fetched array.
 * @param {object[]} questions
 * @param {string}   tipo
 * @returns {object[]}
 */
export function filterByType(questions, tipo) {
  return (questions ?? []).filter(q => q['Tipo'] === tipo);
}

/**
 * Client-side institution filter on an already-fetched array.
 * Useful for separating MINED from MINEDH after a merged fetch.
 * @param {object[]} questions
 * @param {string}   instituicao  — exact DB value e.g. 'MINED'
 * @returns {object[]}
 */
export function filterByInstitution(questions, instituicao) {
  return (questions ?? []).filter(q => q['Instituição'] === instituicao);
}

// ── Randomisation ──────────────────────────────────────────────

/**
 * Returns a new array in random order (Fisher-Yates).
 * Does not mutate the original array.
 * @param {object[]} questions
 * @returns {object[]}
 */
export function shuffle(questions) {
  const arr = [...(questions ?? [])];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Returns N randomly selected questions from a pool.
 * Returns all shuffled if pool has fewer than N.
 * Does not mutate the original array.
 * @param {object[]} questions
 * @param {number}   count
 * @returns {object[]}
 */
export function pickRandom(questions, count) {
  return shuffle(questions ?? []).slice(0, Math.min(count, (questions ?? []).length));
}


// ============================================================
// SECTION 7 — WRONG ANSWERS (ExameNova main Firestore)
//
// Uses db from firebase.js — NOT _examDb.
// The wrongAnswers collection lives in ExameNova's main project.
// Stores a full question snapshot so any feature can render
// the question without re-fetching from the exam database.
// On retry: existing document is updated, not replaced.
// ============================================================

/**
 * Saves a wrong answer record for a student.
 * Stores the full question object as a snapshot.
 * @param {string} userId
 * @param {object} question   — full question object
 * @param {string} [context]  — optional e.g. 'simulacao', 'desafio'
 * @returns {Promise<string>} — new Firestore document ID
 */
export async function saveWrongAnswer(userId, question, context = '') {
  const ref = await addDoc(_WACol, {
    userId,
    questionId:   question['ID_Questão'] ?? question._id ?? '',
    subject:      question['Disciplina']      ?? '',
    topic:        question['Tema_Relacionado'] ?? '',
    context,
    questionData: question,
    savedAt:      serverTimestamp(),
    retried:      false,
    retriedAt:    null,
  });
  _cacheInvalidate('wa');
  return ref.id;
}

/**
 * Fetches a student's wrong answer records.
 * @param {string}  userId
 * @param {object}  [filters={}]
 * @param {string}  [filters.subject]   — DB subject name e.g. 'Física'
 * @param {boolean} [filters.retried]   — true | false | omit for all
 * @param {string}  [filters.context]   — e.g. 'simulacao'
 * @param {boolean} [noCache=false]
 * @returns {Promise<object[]>}
 */
export async function getWrongAnswers(userId, filters = {}, noCache = false) {
  const key = _cacheKey('wa', { userId, ...filters });
  if (!noCache) {
    const cached = _cacheGet(key);
    if (cached) return [...cached];
  }

  const c = [where('userId', '==', userId)];
  if (filters.subject  !== undefined) c.push(where('subject',  '==', filters.subject));
  if (filters.retried  !== undefined) c.push(where('retried',  '==', filters.retried));
  if (filters.context  !== undefined) c.push(where('context',  '==', filters.context));

  const q    = query(_WACol, ...c);
  const snap = await getDocs(q);
  const results = snap.docs.map(d => ({ _id: d.id, ...d.data() }));

  if (!noCache) _cacheSet(key, results);
  return results;
}

/**
 * Marks a wrong answer record as retried.
 * Updates the existing document — does not create a new one.
 * @param {string} docId — _id from a getWrongAnswers() result
 * @returns {Promise<void>}
 */
export async function markRetried(docId) {
  await updateDoc(doc(db, 'wrongAnswers', docId), {
    retried:   true,
    retriedAt: serverTimestamp(),
  });
  _cacheInvalidate('wa');
}


// ============================================================
// SECTION 8 — EXPORTS
//
// All functions are already exported individually above.
// The exams object allows a single-namespace import:
//   import { exams } from '../../core/exams.js';
// ============================================================

export const exams = {
  // ── Mappings
  toDbSubject,
  toDbSubjects,
  toDbGrade,
  toDbInstitution,

  // ── Fetch
  fetchQuestions,
  fetchEnsinoGeral,
  fetchAdmissao,
  fetchQuestion,
  fetchExam,
  fetchExamShuffled,
  fetchExamText,
  fetchExamTexts,

  // ── Text normalisation
  normaliseTextDoc,

  // ── Metadata
  getExamMeta,
  getInlineText,

  // ── Year
  normaliseYear,
  getYear,

  // ── Answer checking
  checkAnswer,
  hasConfirmedAnswer,

  // ── Options + types
  getOptions,
  hasOptions,
  isLanguageSubject,
  parseMatching,

  // ── Sorting
  sortByNumber,
  sortByYear,

  // ── Grouping
  groupByYear,
  groupByExam,
  groupBySubject,
  groupByTopic,
  groupByType,
  groupByInstitution,

  // ── Analysis
  topicFrequency,

  // ── Client-side filters
  filterByYear,
  filterWithAnswer,
  filterWithExplanation,
  filterByType,
  filterByInstitution,

  // ── Randomisation
  shuffle,
  pickRandom,

  // ── Wrong answers
  saveWrongAnswer,
  getWrongAnswers,
  markRetried,
};
