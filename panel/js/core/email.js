// ============================================================
// panel/js/core/email.js
// ExameNova — Email Foundation Layer
// The ONLY file that triggers email sending in the panel.
// Calls worker.sendEmail() — never calls Resend directly.
//
// DESIGN:
// This file holds the foundation and helpers only. Each screen's
// AI adds its own email function in the TEMPLATE ZONE below when
// building that screen. No templates are pre-registered.
//
// RULES FOR EVERY EMAIL FUNCTION:
// - Build the body from the helpers (_emailHeading, _emailPara,
//   _emailButton, _emailMuted) and send with _send().
// - ALWAYS wrap user-supplied values (names, subjects, codes)
//   with _esc() — a student could type HTML into their name.
// - Formal European Portuguese (Mozambique) — never Tu/Teu/Tens.
// - Email clients ignore most modern CSS: keep tables + inline
//   styles, solid colours (no gradients, no CSS variables).
// - Gold #FFB300 only for Moedas amounts.
// - Never mention DoveLingua in the visible email body.
//
// COLOURS (palette "Maré", fixed hex — emails cannot use CSS vars):
//   Header #0284C7 | Button #0369A1 (white text stays readable)
// ============================================================

import { worker } from './worker.js';

// ─────────────────────────────────────────────
// INTERNAL: HTML ESCAPE
// Use on EVERY value that comes from a user or from Firestore.
// ─────────────────────────────────────────────
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

// ─────────────────────────────────────────────
// INTERNAL HTML WRAPPER
// Wraps any email body in a clean, branded shell.
// All email functions go through this — never raw HTML.
// @param {string} content    — HTML body built from the helpers
// @param {string} preheader  — short preview text shown in the inbox
// ─────────────────────────────────────────────
function wrapEmail(content, preheader = '') {
  const hidden = preheader
    ? `<div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent; font-size:1px; line-height:1px;">${escapeHtml(preheader)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>ExameNova</title>
</head>
<body style="margin:0; padding:0; background-color:#F5F5F5; font-family:Inter, Arial, Helvetica, sans-serif; color:#212121;">
  ${hidden}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; background:#FFFFFF; border-radius:12px; overflow:hidden;">

          <!-- Header -->
          <tr>
            <td bgcolor="#0284C7" align="center" style="background:#0284C7; padding:28px 32px; text-align:center;">
              <span style="font-size:22px; font-weight:700; color:#FFFFFF; letter-spacing:-0.5px;">ExameNova</span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding:20px 32px; border-top:1px solid #EEEEEE; text-align:center;">
              <p style="margin:0; font-size:12px; color:#757575; line-height:1.5;">
                Plataforma ExameNova &mdash; Preparação para Exames em Moçambique<br>
                Este é um email automático. Por favor, não responda a este email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─────────────────────────────────────────────
// HELPER: Heading
// ─────────────────────────────────────────────
function emailHeading(text) {
  return `<h1 style="margin:0 0 16px 0; font-size:22px; line-height:1.3; font-weight:700; color:#212121;">${escapeHtml(text)}</h1>`;
}

// ─────────────────────────────────────────────
// HELPER: Paragraph
// `text` may contain simple developer-written HTML (<strong>, <br>).
// Wrap any user-supplied value with _esc() BEFORE passing it in.
// ─────────────────────────────────────────────
function emailPara(text) {
  return `<p style="margin:0 0 16px 0; font-size:15px; line-height:1.6; color:#212121;">${text}</p>`;
}

// ─────────────────────────────────────────────
// HELPER: Small muted note (hints, "ignore this email if…")
// ─────────────────────────────────────────────
function emailMuted(text) {
  return `<p style="margin:0 0 16px 0; font-size:13px; line-height:1.6; color:#757575;">${text}</p>`;
}

// ─────────────────────────────────────────────
// HELPER: Primary button (table-based so it also works in Outlook)
// Only https:// links are accepted — anything else is dropped.
// ─────────────────────────────────────────────
function emailButton(text, url) {
  if (!/^https:\/\//i.test(String(url))) {
    console.warn('[email] emailButton ignored a non-https URL');
    return '';
  }
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px 0;">
    <tr>
      <td bgcolor="#0369A1" style="background:#0369A1; border-radius:8px;">
        <a href="${escapeHtml(url)}" style="display:inline-block; padding:14px 28px; font-size:15px; font-weight:600; color:#FFFFFF; text-decoration:none; border-radius:8px;">${escapeHtml(text)}</a>
      </td>
    </tr>
  </table>`;
}

// ─────────────────────────────────────────────
// SEND
// Wraps the body, then hands it to the Worker.
// An email failure must NEVER block the student's flow, so errors
// are caught and returned as { success: false }.
// @param {string} toEmail
// @param {string} subject
// @param {string} bodyHtml   — built from the helpers above
// @param {string} preheader  — optional inbox preview text
// ─────────────────────────────────────────────
async function send(toEmail, subject, bodyHtml, preheader = '') {
  try {
    const html = wrapEmail(bodyHtml, preheader);
    return await worker.sendEmail(toEmail, subject, html);
  } catch (err) {
    console.error('[email] send failed:', err);
    return { success: false };
  }
}

// ─────────────────────────────────────────────
// TEMPLATE ZONE
// Each screen AI adds its email function below this line.
// Follow this exact pattern for every new email function:
//
// /**
//  * Brief description of what this email does.
//  * Added by: [screen name] AI
//  * @param {string} toEmail
//  * @param {string} studentName
//  */
// async function sendXxxxxEmail(toEmail, studentName) {
//   const body = `
//     ${emailHeading('Bem-vindo(a) ao ExameNova')}
//     ${emailPara(`Olá, <strong>${escapeHtml(studentName)}</strong>!`)}
//     ${emailPara('Texto da mensagem em português formal.')}
//     ${emailButton('Texto do Botão', 'https://...')}
//     ${emailMuted('Se não pediu este email, pode ignorá-lo.')}
//   `;
//   return send(toEmail, 'Assunto do email', body, 'Texto de pré-visualização');
// }
//
// Then add the function to the export at the bottom of this file.
// ─────────────────────────────────────────────

// [ Email functions added here by each screen AI ]

// ─────────────────────────────────────────────
// EXPORTS
// Add new email functions to this object as they are created.
// ─────────────────────────────────────────────
export const email = {

  // Internal helpers — available to all screen AIs
  // when building email templates
  _wrapEmail:    wrapEmail,
  _emailHeading: emailHeading,
  _emailPara:    emailPara,
  _emailMuted:   emailMuted,
  _emailButton:  emailButton,
  _esc:          escapeHtml,
  _send:         send,

  // [ Email functions registered here by each screen AI ]
  // Example:
  // sendWelcomeEmail,
  // sendExamReminderEmail,

};
