// ============================================================
// worker-core/index.js
// ExameNova — Core Cloudflare Worker
// Handles: Moedas deduction/award, invite validation,
//          custom claims (groupId, role) via Firebase Admin
// Secret:  WORKER_SECRET (validates all incoming requests)
// Firebase: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL,
//           FIREBASE_PRIVATE_KEY
// ============================================================

const ALLOWED_ORIGINS = [
  'https://dovelingua.com',
  'https://examenova.dovelingua.com',
  'https://exemo.dovelingua.com',
  'https://exame.dovelingua.com'
];

function getCorsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Worker-Secret',
  };
}

// ─────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────
export default {
  async fetch(request, env) {

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: getCorsHeaders(request) });
    }

    // Only accept POST
    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405, request);
    }

    // Validate shared secret
    const secret = request.headers.get('X-Worker-Secret');
    if (!secret || secret !== env.WORKER_SECRET) {
      return json({ error: 'forbidden' }, 403, request);
    }

    // Parse body
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'invalid_json' }, 400, request);
    }

    const { action } = body;

    // Route to correct handler
    switch (action) {

      case 'deductMoedas':
        return handleDeductMoedas(body, env, request);

      case 'awardMoedas':
        return handleAwardMoedas(body, env, request);

      case 'validateInvite':
        return handleValidateInvite(body, env, request);

      case 'setCustomClaims':
        return handleSetCustomClaims(body, env, request);

      default:
        return json({ error: 'unknown_action' }, 400, request);
    }
  }
};

// ─────────────────────────────────────────────
// HANDLER: DEDUCT MOEDAS
// Body: { action, userId, amount }
// ─────────────────────────────────────────────
async function handleDeductMoedas({ userId, amount }, env, request) {
  if (!userId || typeof amount !== 'number' || amount <= 0) {
    return json({ error: 'invalid_params' }, 400, request);
  }

  try {
    const token  = await getFirebaseToken(env);
    const docUrl = firestoreDocUrl(env, `users/${userId}`);

    // Read current balance
    const readRes = await firestoreGet(docUrl, token);
    if (!readRes.ok) return json({ error: 'user_not_found' }, 404, request);

    const data    = await readRes.json();
    const current = firestoreGetNumber(data, 'moedas');

    if (current < amount) {
      return json({ success: false, reason: 'insufficient_moedas', balance: current }, 200, request);
    }

    const newBalance = current - amount;

    // Write new balance
    const writeRes = await firestorePatch(docUrl, token, { moedas: newBalance });
    if (!writeRes.ok) return json({ error: 'write_failed' }, 500, request);

    return json({ success: true, newBalance }, 200, request);

  } catch (err) {
    return json({ error: 'server_error', detail: err.message }, 500, request);
  }
}

// ─────────────────────────────────────────────
// HANDLER: AWARD MOEDAS
// Body: { action, userId, amount, reason }
// ─────────────────────────────────────────────
async function handleAwardMoedas({ userId, amount, reason }, env, request) {
  if (!userId || typeof amount !== 'number' || amount <= 0) {
    return json({ error: 'invalid_params' }, 400, request);
  }

  try {
    const token  = await getFirebaseToken(env);
    const docUrl = firestoreDocUrl(env, `users/${userId}`);

    // Read current balance
    const readRes = await firestoreGet(docUrl, token);
    if (!readRes.ok) return json({ error: 'user_not_found' }, 404, request);

    const data       = await readRes.json();
    const current    = firestoreGetNumber(data, 'moedas');
    const newBalance = current + amount;

    // Write new balance
    const writeRes = await firestorePatch(docUrl, token, { moedas: newBalance });
    if (!writeRes.ok) return json({ error: 'write_failed' }, 500, request);

    return json({ success: true, newBalance, reason: reason || 'award' }, 200, request);

  } catch (err) {
    return json({ error: 'server_error', detail: err.message }, 500, request);
  }
}

// ─────────────────────────────────────────────
// HANDLER: VALIDATE INVITE CODE
// Body: { action, code }
// ─────────────────────────────────────────────
async function handleValidateInvite({ code }, env, request) {
  if (!code || typeof code !== 'string') {
    return json({ error: 'invalid_params' }, 400, request);
  }

  try {
    const token = await getFirebaseToken(env);

    // Query users collection for matching inviteCode
    const queryUrl = firestoreQueryUrl(env, 'users', 'inviteCode', code);
    const res      = await fetch(queryUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) return json({ valid: false }, 200, request);

    const result = await res.json();
    const docs   = result.documents || [];

    if (docs.length === 0) {
      return json({ valid: false }, 200, request);
    }

    const inviterDoc = docs[0];
    const inviterId  = inviterDoc.name.split('/').pop();

    return json({ valid: true, inviterId }, 200, request);

  } catch (err) {
    return json({ error: 'server_error', detail: err.message }, 500, request);
  }
}

// ─────────────────────────────────────────────
// HANDLER: SET CUSTOM CLAIMS
// Body: { action, userId, groupId, role }
// Sets groupId and role as Firebase custom claims
// so Firestore rules in examenova-2 can verify group membership
// ─────────────────────────────────────────────
async function handleSetCustomClaims({ userId, groupId, role }, env, request) {
  if (!userId || !groupId || !role) {
    return json({ error: 'invalid_params' }, 400, request);
  }

  try {
    const token = await getFirebaseToken(env);

    // Firebase Auth REST API — set custom claims
    const url = `https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/accounts:update?access_token=${token}`;

    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        localId:      userId,
        customAttributes: JSON.stringify({ groupId, role })
      })
    });

    if (!res.ok) {
      const err = await res.text();
      return json({ error: 'claims_failed', detail: err }, 500, request);
    }

    return json({ success: true }, 200, request);

  } catch (err) {
    return json({ error: 'server_error', detail: err.message }, 500, request);
  }
}

// ─────────────────────────────────────────────
// FIREBASE ADMIN — TOKEN (service account JWT)
// ─────────────────────────────────────────────
async function getFirebaseToken(env) {
  const now     = Math.floor(Date.now() / 1000);
  const payload = {
    iss:   env.FIREBASE_CLIENT_EMAIL,
    sub:   env.FIREBASE_CLIENT_EMAIL,
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit'
  };

  // Build JWT
  const header    = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body      = b64url(JSON.stringify(payload));
  const unsigned  = `${header}.${body}`;
  const signature = await signRS256(unsigned, env.FIREBASE_PRIVATE_KEY);
  const jwt       = `${unsigned}.${signature}`;

  // Exchange for access token
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });

  const data = await res.json();
  if (!data.access_token) throw new Error('Failed to get Firebase token');
  return data.access_token;
}

// ─────────────────────────────────────────────
// FIRESTORE HELPERS
// ─────────────────────────────────────────────
function firestoreDocUrl(env, path) {
  return `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;
}

function firestoreQueryUrl(env, collection, field, value) {
  return `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}?orderBy=${field}&startAt=${value}&endAt=${value}`;
}

async function firestoreGet(url, token) {
  return fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function firestorePatch(url, token, fields) {
  // Build Firestore field mask and value map
  const fieldMask    = Object.keys(fields).map(f => `updateMask.fieldPaths=${f}`).join('&');
  const firestoreDoc = { fields: {} };

  for (const [key, val] of Object.entries(fields)) {
    if (typeof val === 'number') {
      firestoreDoc.fields[key] = { integerValue: val };
    } else if (typeof val === 'string') {
      firestoreDoc.fields[key] = { stringValue: val };
    } else if (typeof val === 'boolean') {
      firestoreDoc.fields[key] = { booleanValue: val };
    }
  }

  return fetch(`${url}?${fieldMask}`, {
    method:  'PATCH',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(firestoreDoc)
  });
}

// Extract number from Firestore document field
function firestoreGetNumber(doc, field) {
  const f = doc?.fields?.[field];
  if (!f) return 0;
  return parseInt(f.integerValue || f.doubleValue || 0, 10);
}

// ─────────────────────────────────────────────
// CRYPTO HELPERS — RS256 JWT signing
// ─────────────────────────────────────────────
function b64url(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function signRS256(data, pemKey) {
  // Clean PEM — strip headers/footers, real whitespace, AND literal
  // "\n" two-character sequences (common when a private key is pasted
  // into a Cloudflare env var as a single-line string).
  const pem     = pemKey
    .replace(/-----BEGIN RSA PRIVATE KEY-----|-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END RSA PRIVATE KEY-----|-----END PRIVATE KEY-----/g, '')
    .replace(/\\n/g, '')
    .replace(/\s/g, '');

  const binary  = Uint8Array.from(atob(pem), c => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'pkcs8',
    binary.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const encoder   = new TextEncoder();
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    encoder.encode(data)
  );

  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ─────────────────────────────────────────────
// RESPONSE HELPER
// ─────────────────────────────────────────────
function json(data, status = 200, request) {
  const corsHeaders = request ? getCorsHeaders(request) : {};
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
