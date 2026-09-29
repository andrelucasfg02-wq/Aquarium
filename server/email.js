// Outgoing email via the Resend HTTP API (no extra npm deps — plain fetch).
// Env:
//   RESEND_API_KEY — required to actually send; if missing, emails are logged
//                    server-side and skipped (forgot-password still returns ok).
//   EMAIL_FROM     — sender address, e.g. "Chibi Aquarium <noreply@aquarium-game.onrender.com>".
//                    Must be a verified sender in Resend.
//   APP_URL        — public base URL used to build reset links.

async function sendEmail({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn('[email] RESEND_API_KEY not set — email to %s skipped (subject: %s)', to, subject);
    return { ok: false, skipped: true };
  }
  const from = process.env.EMAIL_FROM || 'Chibi Aquarium <onboarding@resend.dev>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[email] Resend failed (%s): %s', res.status, body.slice(0, 300));
    return { ok: false, status: res.status };
  }
  return { ok: true };
}

function passwordResetHtml(resetUrl) {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#3a2b4d">
      <h2>🐠 Reset your password</h2>
      <p>Someone asked to reset the password for your Chibi Aquarium account.
         If that was you, tap the button below. The link expires in 1 hour.</p>
      <p><a href="${resetUrl}"
            style="display:inline-block;background:#e8a34c;color:#fff;text-decoration:none;
                   padding:12px 28px;border-radius:999px;font-weight:bold">Set a new password</a></p>
      <p style="font-size:12px;color:#8a7a9e">If you didn't ask for this, just ignore this email —
         your password stays the same.</p>
    </div>`;
}

module.exports = { sendEmail, passwordResetHtml };
