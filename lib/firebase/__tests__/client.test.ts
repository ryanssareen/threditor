// @vitest-environment jsdom
//
// M9 Unit 1 — Firebase client SDK.
// Env vars set via vi.stubEnv so initializeApp receives a valid shape.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteApp, getApps } from 'firebase/app';

import { __resetFirebaseForTest, getFirebase } from '../client';

beforeEach(async () => {
  // Clean up any Firebase apps from a prior test run so initializeApp
  // gets a fresh slate each time.
  for (const app of getApps()) {
    await deleteApp(app);
  }
  // Firebase Auth's client SDK validates the API key shape at init —
  // a real-looking 'AIzaSy…' prefix + 39-char length passes the check.
  // No Google API call fires during getAuth/getFirestore, so the value
  // doesn't need to be a real key.
  vi.stubEnv(
    'NEXT_PUBLIC_FIREBASE_API_KEY',
    'AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7',
  );
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', 'test.firebaseapp.com');
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'threditor-test');
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID', '000000000000');
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_APP_ID', '1:000000000000:web:abcdef');
  __resetFirebaseForTest();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Firebase Client SDK', () => {
  it('initializes without error', () => {
    const { app, auth, db } = getFirebase();
    expect(app).toBeDefined();
    expect(auth).toBeDefined();
    expect(db).toBeDefined();
  });

  it('returns the same instance on repeated calls', () => {
    const first = getFirebase();
    const second = getFirebase();
    expect(first.app).toBe(second.app);
    expect(first.auth).toBe(second.auth);
    expect(first.db).toBe(second.db);
  });

  it('uses the configured project id', () => {
    const { app } = getFirebase();
    expect(app.options.projectId).toBe('threditor-test');
  });
});
