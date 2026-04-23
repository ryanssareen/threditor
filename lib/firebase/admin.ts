/**
 * M9 Unit 2: Firebase Admin SDK — server-only.
 *
 * NO `'use client'` directive. This module must never be imported
 * into a client component, route handler that runs in the Edge
 * runtime, or any browser-bundle path. Admin SDK requires Node.js
 * APIs and the service-account private key.
 *
 * The `import 'server-only'` below is the compile-time guard: any
 * client-bundle path that transitively imports this file fails the
 * Next.js build. Adding the guard at scaffolding time (before any
 * consumer exists) avoids relying on future reviewers to catch it.
 *
 * Env vars (NOT NEXT_PUBLIC_ prefixed):
 *   - FIREBASE_ADMIN_PROJECT_ID
 *   - FIREBASE_ADMIN_CLIENT_EMAIL
 *   - FIREBASE_ADMIN_PRIVATE_KEY  (with literal \n → actual newlines)
 *
 * The private-key `\\n → \n` replace is required because Vercel and
 * most secret stores encode multi-line PEM values as a single line
 * with escaped newlines; the Admin SDK's `cert()` needs real newlines
 * in the PEM body.
 */

import 'server-only';

import { createPrivateKey } from 'node:crypto';
import {
  cert,
  getApps,
  initializeApp,
  type App,
} from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

/**
 * Normalize a PEM private key pulled from an env var.
 *
 * Vercel / secret stores mangle multi-line PEMs several ways; OpenSSL 3
 * (Node 18+) is strict about format and fails with
 * `error:1E08010C:DECODER routines::unsupported` on the slightest
 * deviation. We defensively:
 *   1. Escaped → real newlines (done first so JSON fragments parse).
 *   2. If the value contains a BEGIN/END marker pair, extract only the
 *      text between them (+ markers) — this tolerates pasting a whole
 *      service-account JSON or a JSON fragment like `"private_key":
 *      "-----BEGIN ...-----\n..."` instead of just the key.
 *   3. Strip a single pair of wrapping quotes.
 *   4. Normalize CRLF → LF.
 *   5. Ensure a trailing newline after `-----END PRIVATE KEY-----`.
 */
export function normalizePrivateKey(raw: string): string {
  let key = raw.trim();
  // Escaped → real newlines (run before marker extraction so a
  // JSON-fragment paste with `\n` escapes is salvageable).
  key = key.replace(/\\n/g, '\n');
  key = key.replace(/\r\n/g, '\n');
  // Extract the PEM block if the value is wrapped in extra content
  // (e.g., whole JSON service account, JSON fragment with commas/keys).
  const beginMarker = '-----BEGIN PRIVATE KEY-----';
  const endMarker = '-----END PRIVATE KEY-----';
  const beginIdx = key.indexOf(beginMarker);
  const endIdx = key.indexOf(endMarker);
  if (beginIdx >= 0 && endIdx > beginIdx) {
    key = key.slice(beginIdx, endIdx + endMarker.length);
  }
  // Strip a single pair of wrapping quotes if still present.
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1);
  }
  // Ensure trailing newline (PEM spec).
  if (!key.endsWith('\n')) key = key + '\n';
  return key;
}

function readAdminConfig(): {
  projectId: string;
  clientEmail: string;
  privateKey: string;
} {
  const raw = process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? '';
  return {
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID ?? '',
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL ?? '',
    privateKey: normalizePrivateKey(raw),
  };
}

/**
 * Returns a shape-only diagnostic about the configured private key —
 * never includes key material. Safe to return in an error response so
 * we can diagnose mis-pasted keys without leaking secrets.
 */
export type PrivateKeyVerdict =
  | 'env_missing' // FIREBASE_ADMIN_PRIVATE_KEY not set or empty
  | 'env_missing_markers' // No -----BEGIN/-----END markers anywhere — not a PEM
  | 'env_wrapped_in_json' // Contains JSON-fragment markers around the PEM
  | 'env_ok_code_flaw' // Env looks fine; normalized key parses fine; OR parse fails
                       // despite clean input → bug is in our code/runtime
  | 'env_malformed_key' // Has markers but the base64 body is corrupt
  | 'env_ok'; // Everything checks out

export function getPrivateKeyShape(): {
  verdict: PrivateKeyVerdict;
  verdictExplanation: string;
  rawLength: number;
  rawFirst80: string;
  rawLast80: string;
  rawHasBeginMarker: boolean;
  rawHasEndMarker: boolean;
  rawHasRealNewlines: boolean;
  rawHasEscapedNewlines: boolean;
  rawHasDoubleEscapedNewlines: boolean;
  rawHasJsonFragmentMarkers: boolean;
  rawHasSurroundingQuotes: boolean;
  rawEndsWithNewline: boolean;
  rawCharBeforeBegin: string;
  rawCharAfterEnd: string;
  normalizedLength: number;
  normalizedNewlineCount: number;
  normalizedStartsCorrectly: boolean;
  normalizedEndsCorrectly: boolean;
  normalizedFirstLine: string;
  normalizedLastLine: string;
  cryptoParseOk: boolean;
  cryptoParseError: string;
  projectIdSet: boolean;
  clientEmailSet: boolean;
  clientEmailLooksRight: boolean;
} {
  const raw = process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? '';
  const trimmed = raw.trim();
  const normalized = normalizePrivateKey(raw);

  const lines = normalized.split('\n');
  const firstLine = lines[0] ?? '';
  const lastNonEmpty = [...lines].reverse().find((l) => l.length > 0) ?? '';

  let cryptoParseOk = false;
  let cryptoParseError = '';
  try {
    createPrivateKey({ key: normalized, format: 'pem' });
    cryptoParseOk = true;
  } catch (e) {
    cryptoParseError =
      e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
  }

  const hasBeginMarker = raw.includes('-----BEGIN PRIVATE KEY-----');
  const hasEndMarker = raw.includes('-----END PRIVATE KEY-----');
  // Detect common JSON-fragment leftovers — `"private_key"`, `"client_email"`,
  // or a closing brace near the start/end. These are signals that the value
  // pasted into the env var is a service-account JSON / JSON fragment instead
  // of just the PEM.
  const rawHasJsonFragmentMarkers =
    /"private_key"\s*:/.test(raw) ||
    /"client_email"\s*:/.test(raw) ||
    /"type"\s*:\s*"service_account"/.test(raw);

  // Char before/after the markers helps prove whether extra content surrounds
  // the PEM. For a clean bare PEM these should be empty strings.
  let rawCharBeforeBegin = '';
  let rawCharAfterEnd = '';
  const bIdx = raw.indexOf('-----BEGIN PRIVATE KEY-----');
  const eIdx = raw.indexOf('-----END PRIVATE KEY-----');
  if (bIdx > 0) {
    rawCharBeforeBegin = raw.slice(Math.max(0, bIdx - 10), bIdx);
  }
  if (eIdx >= 0) {
    const tail = raw.slice(eIdx + '-----END PRIVATE KEY-----'.length);
    rawCharAfterEnd = tail.slice(0, 10);
  }

  // Verdict resolution — narrow from "most likely problem" to general.
  let verdict: PrivateKeyVerdict;
  let verdictExplanation: string;
  if (raw.length === 0) {
    verdict = 'env_missing';
    verdictExplanation =
      'FIREBASE_ADMIN_PRIVATE_KEY is not set on this deployment. Add it in Vercel Project Settings → Environment Variables.';
  } else if (!hasBeginMarker || !hasEndMarker) {
    verdict = 'env_missing_markers';
    verdictExplanation =
      'The env var is set but contains neither "-----BEGIN PRIVATE KEY-----" nor "-----END PRIVATE KEY-----". The value is not a PEM private key. Check that you pasted the private_key field (including BEGIN/END lines) from your service-account JSON.';
  } else if (rawHasJsonFragmentMarkers) {
    verdict = 'env_wrapped_in_json';
    verdictExplanation =
      'The env var contains JSON keys like "private_key": or "client_email":. You pasted a JSON object/fragment instead of just the PEM. The code now strips this automatically — if crypto parse still fails after that, the PEM body itself is corrupt. Cleaner fix: `jq -r \'.private_key\' service-account.json | pbcopy` and repaste.';
  } else if (cryptoParseOk) {
    verdict = 'env_ok';
    verdictExplanation =
      'Env var parses cleanly as a PEM. If publish is still failing, the problem is elsewhere (permissions, project-ID mismatch, service-account disabled).';
  } else if (bIdx === 0 && rawCharAfterEnd.replace(/[\s\n]/g, '') === '') {
    // Bare PEM (no surrounding content) but still fails parse.
    verdict = 'env_ok_code_flaw';
    verdictExplanation =
      'Env var is a bare PEM (nothing before BEGIN, nothing meaningful after END) but OpenSSL still rejects it. This is NOT an env-var format problem — it is either (a) corrupt base64 body from a bad paste, or (b) a bug in the normalizePrivateKey() function in lib/firebase/admin.ts. Check cryptoParseError + normalizedNewlineCount (should be ~28).';
  } else {
    verdict = 'env_malformed_key';
    verdictExplanation =
      'Env var has BEGIN/END markers but extra content surrounds them (see rawCharBeforeBegin / rawCharAfterEnd) OR the base64 body is corrupt. Compare rawFirst80 / rawLast80 against what you pasted.';
  }

  return {
    verdict,
    verdictExplanation,
    rawLength: raw.length,
    rawFirst80: raw.slice(0, 80),
    rawLast80: raw.slice(-80),
    rawHasBeginMarker: hasBeginMarker,
    rawHasEndMarker: hasEndMarker,
    rawHasRealNewlines: raw.includes('\n'),
    rawHasEscapedNewlines: raw.includes('\\n'),
    rawHasDoubleEscapedNewlines: raw.includes('\\\\n'),
    rawHasJsonFragmentMarkers,
    rawHasSurroundingQuotes:
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")),
    rawEndsWithNewline: raw.endsWith('\n'),
    rawCharBeforeBegin,
    rawCharAfterEnd,
    normalizedLength: normalized.length,
    normalizedNewlineCount: (normalized.match(/\n/g) ?? []).length,
    normalizedStartsCorrectly: normalized.startsWith('-----BEGIN PRIVATE KEY-----\n'),
    normalizedEndsCorrectly: normalized.trimEnd().endsWith('-----END PRIVATE KEY-----'),
    normalizedFirstLine: firstLine.slice(0, 50),
    normalizedLastLine: lastNonEmpty.slice(0, 50),
    cryptoParseOk,
    cryptoParseError,
    projectIdSet: (process.env.FIREBASE_ADMIN_PROJECT_ID ?? '').length > 0,
    clientEmailSet: (process.env.FIREBASE_ADMIN_CLIENT_EMAIL ?? '').length > 0,
    clientEmailLooksRight: /@[\w-]+\.iam\.gserviceaccount\.com$/.test(
      process.env.FIREBASE_ADMIN_CLIENT_EMAIL ?? '',
    ),
  };
}

let app: App | null = null;
let adminAuth: Auth | null = null;
let adminDb: Firestore | null = null;

export function getAdminFirebase(): { app: App; auth: Auth; db: Firestore } {
  if (app === null) {
    const existing = getApps();
    app =
      existing.length > 0
        ? existing[0]
        : initializeApp({ credential: cert(readAdminConfig()) });
  }
  if (adminAuth === null) adminAuth = getAuth(app);
  if (adminDb === null) adminDb = getFirestore(app);
  return { app, auth: adminAuth, db: adminDb };
}

/** Test-only: reset the module-scope singletons. */
export function __resetAdminFirebaseForTest(): void {
  app = null;
  adminAuth = null;
  adminDb = null;
}
