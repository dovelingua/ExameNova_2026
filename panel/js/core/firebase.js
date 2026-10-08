// ============================================================
// panel/js/core/firebase.js
// ExameNova — Firebase Initialisation
// TWO projects: examenova-core (auth + data) | examenova-chat (messages)
// This is the ONLY file that initialises Firebase.
// Import { auth, db } for all screens.
// Import { chatDb } only in bate-papo.js and moderador.js.
// ============================================================

import { initializeApp }     from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth }           from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore }      from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ─────────────────────────────────────────────
// PROJECT 1 — examenova-core
// Account: exaenova78@gmail.com
// Handles: auth, users, progress, wrongAnswers,
//          invites, chatGroups metadata
// ─────────────────────────────────────────────
const coreConfig = {
  apiKey:            'AIzaSyCGAEhr3hWkY1hCLjaxCe7M3Ap6wfUY7Ys',
  authDomain:        'examenova-1.firebaseapp.com',
  projectId:         'examenova-1',
  storageBucket:     'examenova-1.firebasestorage.app',
  messagingSenderId: '326956742768',
  appId:             '1:326956742768:web:52a62f1a4b37855cbf9cb5'
};

export const coreApp = initializeApp(coreConfig, 'core');

export const auth = getAuth(coreApp);
export const db   = getFirestore(coreApp);

// ─────────────────────────────────────────────
// PROJECT 2 — examenova-chat
// Account: charlemoz04@gmail.com
// Handles: chat/[groupId]/messages ONLY
// High read pressure isolated here entirely
// ─────────────────────────────────────────────
const chatConfig = {
  apiKey:            'AIzaSyBNFWB0clm0adtl4TbXd9AjCiEWJyJGWmM',
  authDomain:        'examenova-2.firebaseapp.com',
  projectId:         'examenova-2',
  storageBucket:     'examenova-2.firebasestorage.app',
  messagingSenderId: '33491886692',
  appId:             '1:33491886692:web:27d15e71beafada3dab571'
};

const chatApp = initializeApp(chatConfig, 'chat');

export const chatDb   = getFirestore(chatApp);
export const chatAuth = getAuth(chatApp);
