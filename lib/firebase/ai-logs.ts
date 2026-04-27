import 'server-only';

/**
 * M16 Unit 3: AI generation logs.
 *
 * Best-effort writes to /aiGenerations. A logging miss does NOT fail
 * the user-facing route — we swallow + console.error.
 *
 * Prompts are logged verbatim with light PII redaction (phone/email/
 * cc patterns). The collection is server-only (rules deny client
 * access). TTL policy on `expireAt` (now + 90 days) sweeps stale logs.
 *
 * `ipHash` is intentionally NOT stored on /aiGenerations docs —
 * co-locating uid + ipHash on a 90-day-retained collection would
 * enable retroactive deanonymization if `IP_HASH_SALT` ever leaks.
 * The ipHash lives only on the rate-limit bucket docs which TTL-sweep
 * within ~26h.
 */

import { FieldValue, Timestamp } from 'firebase-admin/firestore';

import { getAdminFirebase } from './admin';

const TTL_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Lightweight PII-pattern redactor. Not a full DLP — covers the
 * common accidental-paste cases (phone, email, credit card). A full
 * DLP would need contextual awareness; the minimal-redactor is
 * paired with a documented user-deletion path (`gcloud firestore
 * delete` by uid) for everything else.
 */
export function redactPrompt(prompt: string): string {
  let redacted = prompt;
  // Email — most specific, run first so it doesn't get clobbered by
  // the phone regex.
  redacted = redacted.replace(
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    '[REDACTED:email]',
  );
  // Credit-card-shaped digit runs (13-19 digits with optional
  // separators).
  redacted = redacted.replace(/\b(?:\d[ -]?){13,19}\b/g, '[REDACTED:cc]');
  // Phone-shaped runs (7-15 digits with separators).
  redacted = redacted.replace(
    /(?:\+?\d[ \-().]?){7,15}/g,
    (match) => {
      // Don't redact short numeric strings that aren't phone-shaped.
      const digits = match.replace(/\D/g, '');
      return digits.length >= 7 ? '[REDACTED:phone]' : match;
    },
  );
  return redacted;
}

export type LogGenerationEntry = {
  uid: string;
  prompt: string;
  model: string;
  /**
   * AI provider that produced this generation. Required for cohort
   * comparison during the M17 rollout window (Unit 8). Distinct from
   * `model` because two different `model` strings can still share a
   * provider (e.g., `cf/sdxl-lightning` and `cf/sdxl-base` both
   * `provider: 'cloudflare'`).
   */
  provider: 'groq' | 'cloudflare';
  success: boolean;
  error?: string;
  /**
   * Validation/processing failure category. Groq path: codec reasons
   * (`palette_index_oor`, `row_runs_invalid`, etc). Cloudflare path:
   * image-pipeline reasons (`resize_failed`, `quantize_failed`,
   * `rle_failed`).
   */
  validationFailureCategory?: string;
  retryCount: 0 | 1;
  finishReason: string | null;
  /**
   * Token counts. `null` (not 0) on the Cloudflare path — 0 is a
   * meaningful Groq value ("ran but consumed nothing"), null means
   * "not applicable to this provider".
   */
  tokensIn: number | null;
  tokensOut: number | null;
  costEstimate: number;
};

/**
 * Append a log entry. Returns the doc id on success, null on failure
 * (logged but not re-thrown).
 */
export async function logGeneration(
  entry: LogGenerationEntry,
  now: Date = new Date(),
): Promise<string | null> {
  try {
    const { db } = getAdminFirebase();
    const ref = db.collection('aiGenerations').doc();
    const expireAt = Timestamp.fromMillis(now.getTime() + TTL_DAYS * MS_PER_DAY);
    await ref.set({
      uid: entry.uid,
      prompt: redactPrompt(entry.prompt),
      model: entry.model,
      provider: entry.provider,
      success: entry.success,
      error: entry.error ?? null,
      validationFailureCategory: entry.validationFailureCategory ?? null,
      retryCount: entry.retryCount,
      finishReason: entry.finishReason,
      tokensIn: entry.tokensIn,
      tokensOut: entry.tokensOut,
      costEstimate: entry.costEstimate,
      createdAt: FieldValue.serverTimestamp(),
      expireAt,
    });
    return ref.id;
  } catch (err) {
    console.error('logGeneration failed:', err);
    return null;
  }
}
