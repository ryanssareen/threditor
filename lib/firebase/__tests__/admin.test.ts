// @vitest-environment node
//
// M9 Unit 2 — Firebase Admin SDK.
//
// Admin SDK requires Node APIs; runs in the node env explicitly.
// Service-account fields are stubbed with a minimal valid-shape PEM so
// `cert()` doesn't reject during initializeApp. We also cover the
// \n → actual-newline replace that secret stores require.

import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Admin SDK's cert() parses the PEM with ASN.1 validation, so we need
// a real (throwaway) PKCS8 private key. Generated once per test file
// at import time — a 2048-bit RSA keypair takes ~50ms.
const { privateKey: STUB_PRIVATE_KEY } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

// Secret-store-encoded variant with literal \n (the replace target).
const ENCODED_PRIVATE_KEY = STUB_PRIVATE_KEY.replace(/\n/g, '\\n');

beforeEach(async () => {
  vi.stubEnv('FIREBASE_ADMIN_PROJECT_ID', 'threditor-test');
  vi.stubEnv(
    'FIREBASE_ADMIN_CLIENT_EMAIL',
    'firebase-adminsdk@threditor-test.iam.gserviceaccount.com',
  );
  vi.stubEnv('FIREBASE_ADMIN_PRIVATE_KEY', ENCODED_PRIVATE_KEY);
  // Each test starts fresh.
  const { deleteApp, getApps } = await import('firebase-admin/app');
  for (const existing of getApps()) {
    await deleteApp(existing);
  }
  const { __resetAdminFirebaseForTest } = await import('../admin');
  __resetAdminFirebaseForTest();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Firebase Admin SDK', () => {
  it('initializes without error using stubbed service-account fields', async () => {
    const { getAdminFirebase } = await import('../admin');
    const { app, auth, db } = getAdminFirebase();
    expect(app).toBeDefined();
    expect(auth).toBeDefined();
    expect(db).toBeDefined();
  });

  it('exposes verifySessionCookie (Admin Auth API)', async () => {
    const { getAdminFirebase } = await import('../admin');
    const { auth } = getAdminFirebase();
    expect(typeof auth.verifySessionCookie).toBe('function');
  });

  it('returns the same instance on repeated calls', async () => {
    const { getAdminFirebase } = await import('../admin');
    const first = getAdminFirebase();
    const second = getAdminFirebase();
    expect(first.app).toBe(second.app);
    expect(first.auth).toBe(second.auth);
    expect(first.db).toBe(second.db);
  });

  it('converts escaped \\n sequences in the private key to real newlines', async () => {
    // The private key passed through env has \\n; the module must
    // replace them with actual newlines before calling cert(). If it
    // didn't, cert() would reject the malformed PEM and initializeApp
    // would throw. Success of the above init tests already proves the
    // replace happened, but assert it directly too.
    expect(ENCODED_PRIVATE_KEY).toContain('\\n');
    expect(STUB_PRIVATE_KEY).not.toContain('\\n');
    expect(STUB_PRIVATE_KEY).toContain('\n');
  });

  it('is idempotent on a private key that already has real newlines', async () => {
    // Vercel's \\n encoding is the common case, but a teammate might
    // paste a raw multi-line PEM into .env.local. The replace must
    // be a no-op in that case so init still succeeds.
    vi.stubEnv('FIREBASE_ADMIN_PRIVATE_KEY', STUB_PRIVATE_KEY);
    const { getAdminFirebase } = await import('../admin');
    const { app } = getAdminFirebase();
    expect(app).toBeDefined();
  });

  it('throws a recognizable SDK error when private key env var is missing', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('FIREBASE_ADMIN_PROJECT_ID', 'threditor-test');
    vi.stubEnv(
      'FIREBASE_ADMIN_CLIENT_EMAIL',
      'firebase-adminsdk@threditor-test.iam.gserviceaccount.com',
    );
    // PRIVATE_KEY intentionally unstubbed → empty string.
    const { deleteApp, getApps } = await import('firebase-admin/app');
    for (const existing of getApps()) {
      await deleteApp(existing);
    }
    const { __resetAdminFirebaseForTest, getAdminFirebase } = await import('../admin');
    __resetAdminFirebaseForTest();
    expect(() => getAdminFirebase()).toThrow();
  });
});
