// ============================================================
// worker-email/index.js
// ExameNova — Email Cloudflare Worker
// Handles: All transactional email via Resend
// From:    examenova@dovelingua.com
// Secret:  WORKER_SECRET
// Resend:  RESEND_API_KEY
//
// Templates are NOT registered here.
// Each screen's AI registers its own template ID in email.js.
// This worker simply receives a payload and forwards to Resend.
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

const FROM_ADDRESS = 'ExameNova <examenova@dovelingua.com>';
const RESEND_URL   = 'https://api.resend.com/emails';

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
      return json({ error: 'method_not_allowed' }, 405);
    }

    // Validate shared secret
    const secret = request.headers.get('X-Worker-Secret');
    if (!secret || secret !== env.WORKER_SECRET) {
      return json({ error: 'forbidden' }, 403);
    }

    // Parse body
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'invalid_json' }, 400);
    }

    const { to, subject, html } = body;

    // Validate required fields
    if (!to || !subject || !html) {
      return json({ error: 'missing_fields', required: ['to', 'subject', 'html'] }, 400);
    }

    // Validate email format
    if (typeof to !== 'string' || !to.includes('@')) {
      return json({ error: 'invalid_email' }, 400);
    }

    // Send via Resend
    try {
      const res = await fetch(RESEND_URL, {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from:    FROM_ADDRESS,
          to:      [to],
          subject: subject,
          html:    html
        })
      });

      const data = await res.json();

      if (!res.ok) {
        return json({ error: 'resend_error', detail: data }, res.status);
      }

      return json({ success: true, id: data.id }, 200);

    } catch (err) {
      return json({ error: 'server_error', detail: err.message }, 500);
    }
  }
};

// ─────────────────────────────────────────────
// RESPONSE HELPER
// ─────────────────────────────────────────────
function json(data, status = 200, request = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...getCorsHeaders(request), 'Content-Type': 'application/json' }
  });
}
