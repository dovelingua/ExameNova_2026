// ============================================================
// ExameNova — Static Data + Exam Logic Tree
// File: panel/js/core/app.js
//
// SECTION 1: PROVINCES + DISTRICTS (North to South)
// SECTION 2: ENSINO GERAL — 9ª and 12ª Classe subjects
// SECTION 3: EXAMES DE ADMISSÃO — Courses + Institutions
// SECTION 4: MOEDAS — costs, awards, balance check helpers
//
// RULES:
// - This file is imported by screens that need static data
// - Nothing here is fetched from Firestore — it is all static
// - Subject logic lives here — NEVER hardcoded in screens
// - Moedas mutation (deduct/award) is NEVER done here —
//   that goes via worker.js → Cloudflare Worker
// - showMoedasSheet does NOT import ui.js directly —
//   the calling screen passes its own openBottomSheet function
//   to avoid a circular import (same pattern as ProvaNova)
// ============================================================


// ============================================================
// SECTION 1 — PROVINCES + DISTRICTS
// Ordered geographically North to South.
// Used in onboarding.js and perfil.js for location selection.
// ============================================================

export const PROVINCES = {
  'Cabo Delgado': [
    'Pemba',
    'Montepuez',
    'Mueda',
    'Mocímboa da Praia',
    'Palma',
    'Macomia',
    'Chiúre',
    'Namuno',
    'Balama',
    'Ancuabe',
    'Mecúfi',
    'Quissanga',
    'Meluco',
    'Muidumbe',
    'Nangade',
    'Ibo',
    'Metuge',
  ],
  'Niassa': [
    'Lichinga',
    'Cuamba',
    'Mandimba',
    'Marrupa',
    'Lago',
    'Sanga',
    'Mavago',
    'Mecula',
    'Majune',
    'Maúa',
    'Mecanhelas',
    'Chimbonila',
    'Metarica',
    'Muembe',
    'N\'gauma',
    'Nipepe',
  ],
  'Nampula': [
    'Nampula',
    'Nacala Porto',
    'Angoche',
    'Monapo',
    'Malema',
    'Ribaué',
    'Mecubúri',
    'Eráti',
    'Memba',
    'Murrupula',
    'Muecate',
    'Nacala-a-Velha',
    'Mossuril',
    'Ilha de Moçambique',
    'Meconta',
    'Moginçual',
    'Mogovolas',
    'Moma',
    'Lalaua',
    'Larde',
    'Liúpo',
    'Rapale',
    'Nacarôa',
  ],
  'Zambézia': [
    'Quelimane',
    'Mocuba',
    'Gurué',
    'Milange',
    'Alto Molócue',
    'Gilé',
    'Pebane',
    'Namarroi',
    'Ile',
    'Maganja da Costa',
    'Lugela',
    'Morrumbala',
    'Namacurra',
    'Mopeia',
    'Chinde',
    'Derre',
    'Inhassunge',
    'Luabo',
    'Mocubela',
    'Molumbo',
    'Mulevala',
    'Nicoadala',
  ],
  'Tete': [
    'Tete',
    'Moatize',
    'Angónia',
    'Changara',
    'Cahora-Bassa',
    'Zumbo',
    'Marávia',
    'Chiuta',
    'Macanga',
    'Magoé',
    'Mutarara',
    'Chifunde',
    'Dôa',
    'Marara',
    'Tsangano',
  ],
  'Manica': [
    'Chimoio',
    'Manica',
    'Gondola',
    'Bárue',
    'Sussundenga',
    'Mossurize',
    'Guro',
    'Tambara',
    'Macate',
    'Machaze',
    'Macossa',
    'Vanduzi',
  ],
  'Sofala': [
    'Beira',
    'Dondo',
    'Nhamatanda',
    'Búzi',
    'Gorongosa',
    'Marromeu',
    'Caia',
    'Chemba',
    'Cheringoma',
    'Chibabava',
    'Machanga',
    'Maringué',
    'Muanza',
  ],
  'Inhambane': [
    'Inhambane',
    'Maxixe',
    'Vilanculos',
    'Massinga',
    'Morrumbene',
    'Govuro',
    'Mabote',
    'Inhassoro',
    'Funhalouro',
    'Homoíne',
    'Panda',
    'Jangamo',
    'Zavala',
    'Inharrime',
  ],
  'Gaza': [
    'Xai-Xai',
    'Chókwè',
    'Chibuto',
    'Manjacaze',
    'Bilene',
    'Chicualacuala',
    'Guijá',
    'Massingir',
    'Chigubo',
    'Mabalane',
    'Mapai',
    'Massangena',
    'Chongoene',
    'Limpopo',
  ],
  'Maputo Província': [
    'Matola',
    'Manhiça',
    'Marracuene',
    'Boane',
    'Moamba',
    'Namaacha',
    'Magude',
    'Matutuíne',
  ],
  'Maputo Cidade': [
    'KaMpfumo',
    'Nlhamankulu',
    'KaMaxaquene',
    'KaMavota',
    'KaMubukwana',
    'KaTembe',
    'KaNyaka',
  ],
};

/**
 * Returns province names in North-to-South geographic order.
 * Used to populate province selects in onboarding and perfil.
 * @returns {string[]}
 */
export function getProvinces() {
  return Object.keys(PROVINCES);
}

/**
 * Returns districts for a given province.
 * Returns empty array if province is unknown or not yet selected.
 * @param {string} province - Must match a PROVINCES key exactly.
 * @returns {string[]}
 */
export function getDistrictsByProvince(province) {
  if (!province || !PROVINCES[province]) return [];
  return PROVINCES[province];
}


// ============================================================
// SECTION 2 — ENSINO GERAL SUBJECTS
//
// 9ª CLASSE:
// Grade 9 is a new exam grade — no previous exams exist yet.
// The platform uses Grade 10 past exams as equivalence.
// This is handled via the dbGrade field in the student profile.
// When a student selects 9ª Classe, dbGrade is set to '10'
// so all database queries fetch Grade 10 papers transparently.
// The student always sees '9ª Classe' in the UI — never '10'.
//
// A Grade 9 student can be:
//   a) Normal    → takes ALL subjects (both sections combined)
//   b) Repeating → takes ONE section only (Letras or Ciências)
//   c) Repeating all → retakes all subjects (same as normal flow)
//
// 12ª CLASSE:
// A Grade 12 student can be:
//   a) Normal    → takes ALL subjects below
//   b) Repeating → selects only the subjects they failed
// ============================================================

// ── 9ª Classe ────────────────────────────────────────────────

export const GRADE9_LETRAS = [
  'Língua Portuguesa',
  'Língua Inglesa',
  'História',
  'Geografia',
];

export const GRADE9_CIENCIAS = [
  'Matemática',
  'Química',
  'Física',
  'Biologia',
];

// All Grade 9 subjects combined (for normal students and
// those repeating all subjects)
export const GRADE9_ALL = [
  ...GRADE9_LETRAS,
  ...GRADE9_CIENCIAS,
];

// ── 12ª Classe ───────────────────────────────────────────────

export const GRADE12_ALL = [
  'Língua Portuguesa',
  'Língua Francesa',
  'Língua Inglesa',
  'Introdução à Filosofia',
  'Geografia',
  'História',
  'Matemática',
  'Química',
  'Biologia',
  'Física',
];

/**
 * Returns subjects for a Grade 9 student based on their status
 * and chosen section.
 *
 * @param {string} status   - 'normal' | 'repetente'
 * @param {string} section  - 'letras' | 'ciencias' | 'all'
 *                            'all' is used when repeating student
 *                            is retaking all subjects.
 *                            Ignored when status is 'normal'.
 * @returns {string[]} array of subject names
 *
 * Examples:
 *   getGrade9Subjects('normal', '')         → all 8 subjects
 *   getGrade9Subjects('repetente', 'letras') → 4 letras subjects
 *   getGrade9Subjects('repetente', 'ciencias') → 4 ciências subjects
 *   getGrade9Subjects('repetente', 'all')   → all 8 subjects
 */
export function getGrade9Subjects(status, section) {
  if (status === 'normal') return GRADE9_ALL;
  if (status === 'repetente') {
    if (section === 'letras')   return GRADE9_LETRAS;
    if (section === 'ciencias') return GRADE9_CIENCIAS;
    if (section === 'all')      return GRADE9_ALL;
  }
  return GRADE9_ALL;
}

/**
 * Returns subjects for a Grade 12 student.
 * Normal students get all subjects.
 * Repeating students pass their own array of failed subjects.
 *
 * @param {string}   status   - 'normal' | 'repetente'
 * @param {string[]} selected - subjects the repeating student failed
 *                              (ignored when status is 'normal')
 * @returns {string[]}
 */
export function getGrade12Subjects(status, selected = []) {
  if (status === 'normal') return GRADE12_ALL;
  if (status === 'repetente' && Array.isArray(selected) && selected.length) {
    // Only return subjects that are valid Grade 12 subjects
    return selected.filter(s => GRADE12_ALL.includes(s));
  }
  // Fallback: return all if no valid selection
  return GRADE12_ALL;
}

/**
 * Returns the internal database grade for a given display grade.
 * Grade 9 uses Grade 10 past exams as equivalence.
 * Grade 12 uses its own papers.
 *
 * @param {string} grade - '9' | '12'
 * @returns {string} the grade string used for database queries
 */
export function getDbGrade(grade) {
  if (grade === '9') return '10';
  return grade;
}


// ============================================================
// SECTION 3 — EXAMES DE ADMISSÃO
//
// COURSES:
// Each course has a name and one or two possible subject pairs.
// When a course has two pairs, the student chooses ONE pair
// at registration. That chosen pair becomes their subjects.
//
// INSTITUTIONS:
// Treated separately from courses.
// Some institutions require an interview — stored as hasInterview.
// The interview cannot be simulated — it is noted in the UI only.
// Subject pairs work the same as courses.
//
// ADDING NEW COURSES / INSTITUTIONS:
// Simply add a new entry to ADMISSAO_COURSES or
// ADMISSAO_INSTITUTIONS below. All screens use these arrays
// dynamically — no screen code needs to change.
// ============================================================

/**
 * ADMISSAO_COURSES
 * Each entry:
 *   id:     unique key used in Firestore (never changes)
 *   label:  display name shown to student
 *   pairs:  array of subject pair arrays
 *           one pair  → student has no choice, gets that pair
 *           two pairs → student picks one pair at registration
 */
export const ADMISSAO_COURSES = [
  {
    id:    'historia',
    label: 'Lic. em História',
    pairs: [
      ['Língua Portuguesa', 'História'],
      ['Língua Portuguesa', 'Língua Inglesa'],
    ],
  },
  {
    id:    'lingua-inglesa',
    label: 'Lic. em Língua Inglesa',
    pairs: [
      ['Língua Portuguesa', 'História'],
      ['Língua Portuguesa', 'Língua Inglesa'],
    ],
  },
  {
    id:    'lingua-portuguesa',
    label: 'Lic. em Língua Portuguesa',
    pairs: [
      ['Língua Portuguesa', 'História'],
      ['Língua Portuguesa', 'Língua Inglesa'],
    ],
  },
  {
    id:    'frances',
    label: 'Lic. em Francês',
    pairs: [
      ['Língua Portuguesa', 'Língua Francesa'],
    ],
  },
  {
    id:    'jornalismo',
    label: 'Lic. em Jornalismo',
    pairs: [
      ['Língua Portuguesa', 'História'],
    ],
  },
  {
    id:    'direito',
    label: 'Lic. em Direito',
    pairs: [
      ['Língua Portuguesa', 'História'],
    ],
  },
  {
    id:    'filosofia',
    label: 'Lic. em Filosofia',
    pairs: [
      ['Língua Portuguesa', 'Introdução à Filosofia'],
    ],
  },
  {
    id:    'geografia',
    label: 'Lic. em Geografia',
    pairs: [
      ['Geografia', 'História'],
    ],
  },
  {
    id:    'pedagogia',
    label: 'Lic. em Pedagogia',
    pairs: [
      ['Língua Portuguesa', 'História'],
    ],
  },
  // ── More courses added here as the platform expands ───────
];

/**
 * ADMISSAO_INSTITUTIONS
 * Each entry:
 *   id:           unique key used in Firestore (never changes)
 *   label:        display name shown to student
 *   pairs:        subject pair arrays (same logic as courses)
 *   hasInterview: true if the institution requires an interview
 *                 The interview is flagged in the UI —
 *                 it cannot be simulated on the platform.
 */
export const ADMISSAO_INSTITUTIONS = [
  {
    id:           'ifp',
    label:        'IFP — Instituto de Formação de Professores',
    pairs:        [
      ['Língua Portuguesa', 'Matemática'],
    ],
    hasInterview: true,
  },
  {
    id:           'acipol',
    label:        'ACIPOL — Academia de Ciências Policiais',
    pairs:        [
      ['Língua Portuguesa', 'História'],
      ['Língua Portuguesa', 'Matemática'],
    ],
    hasInterview: false,
  },
  {
    id:           'matalane',
    label:        'Academia Militar de Matalane',
    pairs:        [
      ['Prova Escrita'],
    ],
    hasInterview: false,
  },
  // ── More institutions added here as the platform expands ──
];

/**
 * Returns all available Admissão courses.
 * Used to populate course selects in onboarding and perfil.
 * @returns {Array} array of course objects
 */
export function getAllCourses() {
  return ADMISSAO_COURSES;
}

/**
 * Returns all available Admissão institutions.
 * Used to populate institution selects in onboarding and perfil.
 * @returns {Array} array of institution objects
 */
export function getAllInstitutions() {
  return ADMISSAO_INSTITUTIONS;
}

/**
 * Returns a course object by its id.
 * Returns null if not found.
 * @param {string} courseId
 * @returns {object|null}
 */
export function getCourseById(courseId) {
  return ADMISSAO_COURSES.find(c => c.id === courseId) || null;
}

/**
 * Returns an institution object by its id.
 * Returns null if not found.
 * @param {string} institutionId
 * @returns {object|null}
 */
export function getInstitutionById(institutionId) {
  return ADMISSAO_INSTITUTIONS.find(i => i.id === institutionId) || null;
}

/**
 * Returns the subjects a student can access based on their
 * full profile. This is the single function screens call
 * to get a student's accessible subjects — never hardcode
 * subject lists in screens.
 *
 * For Ensino Geral students, subjects come from grade + status + section.
 * For Admissão students, subjects come from their chosen pair.
 *
 * @param {object} userData - Firestore user document
 * @returns {string[]} array of subject names the student can access
 *
 * userData shape expected:
 * {
 *   examType:    'ensino-geral' | 'admissao',
 *   grade:       '9' | '12',           (ensino-geral only)
 *   status:      'normal' | 'repetente', (ensino-geral only)
 *   section:     'letras' | 'ciencias' | 'all', (9ª repetente only)
 *   subjects:    string[],             (12ª repetente — their failed subjects)
 *   course:      string,               (admissao course id, if by course)
 *   institution: string,               (admissao institution id, if by institution)
 *   pairIndex:   number,               (0 or 1 — which pair the student chose)
 * }
 */
export function getStudentSubjects(userData) {
  if (!userData) return [];

  if (userData.examType === 'ensino-geral') {
    const grade   = userData.grade   || '';
    const status  = userData.status  || 'normal';
    const section = userData.section || '';

    if (grade === '9') {
      return getGrade9Subjects(status, section);
    }
    if (grade === '12') {
      return getGrade12Subjects(status, userData.subjects || []);
    }
    return [];
  }

  if (userData.examType === 'admissao') {

    // By course
    if (userData.course) {
      const course = getCourseById(userData.course);
      if (!course || !course.pairs.length) return [];
      const pairIndex = typeof userData.pairIndex === 'number'
        ? userData.pairIndex
        : 0;
      return course.pairs[pairIndex] || course.pairs[0] || [];
    }

    // By institution
    if (userData.institution) {
      const inst = getInstitutionById(userData.institution);
      if (!inst || !inst.pairs.length) return [];
      const pairIndex = typeof userData.pairIndex === 'number'
        ? userData.pairIndex
        : 0;
      return inst.pairs[pairIndex] || inst.pairs[0] || [];
    }
  }

  return [];
}

/**
 * Returns the groupId for a student's chatroom.
 * Students in the same grade/section/course/institution
 * share the same Bate-papo room.
 * This ID is stored in Firestore on the user document
 * and in the chatGroups collection.
 *
 * This function generates the expected groupId from profile data
 * so screens can verify or look up the group without an extra read.
 *
 * @param {object} userData - Firestore user document
 * @returns {string} groupId string
 *
 * Examples:
 *   9ª normal           → 'grade9-normal'
 *   9ª letras           → 'grade9-letras'
 *   9ª ciencias         → 'grade9-ciencias'
 *   12ª normal          → 'grade12-normal'
 *   12ª repetente       → 'grade12-repetente'
 *   direito pair 0      → 'admissao-direito-0'
 *   direito pair 1      → 'admissao-direito-1'
 *   ifp                 → 'admissao-ifp'
 */
export function getGroupId(userData) {
  if (!userData) return 'geral';

  if (userData.examType === 'ensino-geral') {
    const grade  = userData.grade  || '';
    const status = userData.status || 'normal';

    if (grade === '9') {
      if (status === 'normal')    return 'grade9-normal';
      if (status === 'repetente') {
        const section = userData.section || 'all';
        if (section === 'letras')   return 'grade9-letras';
        if (section === 'ciencias') return 'grade9-ciencias';
        return 'grade9-all';
      }
    }
    if (grade === '12') {
      if (status === 'normal')    return 'grade12-normal';
      if (status === 'repetente') return 'grade12-repetente';
    }
  }

  if (userData.examType === 'admissao') {
    if (userData.course) {
      const pairIndex = typeof userData.pairIndex === 'number'
        ? userData.pairIndex
        : 0;
      return `admissao-${userData.course}-${pairIndex}`;
    }
    if (userData.institution) {
      return `admissao-${userData.institution}`;
    }
  }

  return 'geral';
}


// ============================================================
// SECTION 4 — MOEDAS
//
// All coin costs and awards are defined here.
// Teacher Dove sets the final values.
// Screens import from here — never hardcode coin values.
//
// Moedas mutation (deduct/award) is SENSITIVE and goes via
// Cloudflare Worker through worker.js — never done here.
// ============================================================

// ── Moedas costs per feature ─────────────────────────────────
// Set to 0 for free features.
// Teacher Dove confirms final values before moeda.js is built.

export const COST_SIMULACAO_ANTERIORES = 0;  // Real past exam questions — free
export const COST_SIMULACAO_GERADAS    = 2;  // AI-generated questions
export const COST_MEU_EXAME            = 5;  // Premium pre-exam simulation
export const COST_MENTOR_SESSION       = 1;  // Per AI tutor session
export const COST_DESAFIO_DIARIO       = 0;  // Daily challenge — free to attempt

// ── Moedas awards ────────────────────────────────────────────

export const AWARD_REGISTRATION        = 20; // On registration completion
export const AWARD_DAILY_CHALLENGE     = 5;  // On daily challenge completion
export const AWARD_INVITE              = 10; // When invited student registers
export const AWARD_INVITED             = 15; // For the invited student
export const AWARD_STREAK_7            = 10; // 7-day study streak (Version 2)

// ── Balance helpers ──────────────────────────────────────────

/**
 * Returns the student's current Moedas balance.
 * Reads from the userData object already loaded by the router.
 * Never fetches from Firestore — router keeps userData current.
 *
 * @param {object} userData - Firestore user document
 * @returns {number}
 */
export function getMoedasBalance(userData) {
  if (!userData || typeof userData.moedas !== 'number') return 0;
  return userData.moedas;
}

/**
 * Checks if the student has enough Moedas for an action.
 * Read-only — never deducts anything.
 * Use before any feature that costs Moedas.
 *
 * @param {object} userData - Firestore user document
 * @param {number} cost - Moedas cost of the action
 * @returns {boolean}
 */
export function checkMoedas(userData, cost) {
  return getMoedasBalance(userData) >= cost;
}

/**
 * Opens the Moedas bottom sheet when a student has insufficient
 * Moedas for a feature. Shows current balance and how to earn more.
 *
 * Does NOT import ui.js directly — calling screen passes its own
 * openBottomSheet reference to avoid a circular import.
 * This is the same pattern ProvaNova uses for showCreditsSheet.
 *
 * @param {function} openBottomSheetFn - ui.openBottomSheet from the screen
 * @param {number}   currentBalance    - student's current Moedas balance
 * @param {number}   required          - Moedas needed for the feature
 */
export function showMoedasSheet(openBottomSheetFn, currentBalance, required) {
  if (typeof openBottomSheetFn !== 'function') return;
  openBottomSheetFn({
    title:   'Moedas insuficientes',
    content: `
      <p>Tens <strong>${currentBalance} Moeda${currentBalance !== 1 ? 's' : ''}</strong> disponíve${currentBalance !== 1 ? 'is' : 'l'}.</p>
      <p>Esta funcionalidade requer <strong>${required} Moeda${required !== 1 ? 's' : ''}</strong>.</p>
      <br>
      <p>Podes ganhar Moedas a:</p>
      <ul style="margin:8px 0 0 16px;line-height:1.8;color:var(--text-secondary);font-size:14px;">
        <li>Completar o Desafio Diário</li>
        <li>Convidar amigos para o ExameNova</li>
        <li>Ser um estudante activo</li>
      </ul>
    `,
    actions: [
      { label: 'Convidar amigos e ganhar Moedas', route: '/panel/perfil' },
      { label: 'Fechar', dismiss: true },
    ],
  });
}

// ============================================================
// NOTE ON MOEDAS MUTATION:
// deductMoedas() and awardMoedas() are NOT implemented here.
// All Moedas balance changes go via Cloudflare Worker through
// panel/js/core/worker.js. Screens call worker.deductMoedas()
// and worker.awardMoedas() — never Firestore directly.
// This protects balance integrity — no client-side manipulation.
// ============================================================
