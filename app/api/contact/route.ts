import 'server-only';

/**
 * POST /api/contact — landing-page contact form sender.
 *
 * Validates the submission server-side (the client validates too, but
 * never trust the client) and forwards via Brevo's transactional email
 * API (https://api.brevo.com/v3/smtp/email).
 *
 * Required env:
 *   BREVO_API_KEY        Brevo transactional key, starts with `xkeysib-`
 *                        or `xsmtpsib-`.
 *   CONTACT_TO_EMAIL     Address that submissions are delivered to.
 *   CONTACT_FROM_EMAIL   Verified Brevo single-sender or domain address.
 *   CONTACT_FROM_NAME    (optional) Display name on the From line.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TOPICS = ['bug', 'feature', 'press', 'other'] as const;
type Topic = (typeof TOPICS)[number];

const NAME_MAX = 60;
const EMAIL_MAX = 320; // RFC 5321 path limit
const MESSAGE_MIN = 10;
const MESSAGE_MAX = 800;
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Body = {
  name?: unknown;
  email?: unknown;
  topic?: unknown;
  message?: unknown;
};

function badRequest(error: string): NextResponse {
  return NextResponse.json({ error }, { status: 400 });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const apiKey = process.env.BREVO_API_KEY;
  const toEmail = process.env.CONTACT_TO_EMAIL;
  const fromEmail = process.env.CONTACT_FROM_EMAIL;
  const fromName = process.env.CONTACT_FROM_NAME ?? 'Threditor Contact Form';

  if (
    apiKey === undefined ||
    apiKey === '' ||
    toEmail === undefined ||
    toEmail === '' ||
    fromEmail === undefined ||
    fromEmail === ''
  ) {
    console.error('contact: missing env vars', {
      hasKey: Boolean(apiKey),
      hasTo: Boolean(toEmail),
      hasFrom: Boolean(fromEmail),
    });
    return NextResponse.json(
      { error: 'service_misconfigured' },
      { status: 500 },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return badRequest('invalid_json');
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const topicRaw = typeof body.topic === 'string' ? body.topic : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';

  if (name.length === 0 || name.length > NAME_MAX) return badRequest('name_invalid');
  if (
    email.length === 0 ||
    email.length > EMAIL_MAX ||
    !EMAIL_RX.test(email)
  ) {
    return badRequest('email_invalid');
  }
  if (!TOPICS.includes(topicRaw as Topic)) return badRequest('topic_invalid');
  if (message.length < MESSAGE_MIN || message.length > MESSAGE_MAX) {
    return badRequest('message_invalid');
  }

  const topic = topicRaw as Topic;
  const subject = `[Threditor · ${topic}] ${name}`;
  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeTopic = escapeHtml(topic);
  const safeMessage = escapeHtml(message).replace(/\n/g, '<br/>');

  const htmlContent = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,sans-serif;color:#111">
  <p><strong>Topic:</strong> ${safeTopic}</p>
  <p><strong>From:</strong> ${safeName} &lt;${safeEmail}&gt;</p>
  <hr/>
  <p>${safeMessage}</p>
</body></html>`;

  const textContent = `Topic: ${topic}
From: ${name} <${email}>

${message}
`;

  let brevoRes: Response;
  try {
    brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { email: fromEmail, name: fromName },
        to: [{ email: toEmail }],
        replyTo: { email, name },
        subject,
        htmlContent,
        textContent,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.error('contact: brevo fetch failed', err);
    return NextResponse.json({ error: 'upstream_unreachable' }, { status: 502 });
  }

  if (!brevoRes.ok) {
    const text = await brevoRes.text().catch(() => '');
    console.error('contact: brevo rejected', brevoRes.status, text);
    return NextResponse.json({ error: 'send_failed' }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
