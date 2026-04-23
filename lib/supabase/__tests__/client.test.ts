// @vitest-environment jsdom
//
// M9 Unit 3 — Supabase client SDK.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetSupabaseForTest,
  getStorageBucket,
  getSupabase,
} from '../client';

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://stub.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'stub-anon-key');
  vi.stubEnv('SUPABASE_BUCKET_NAME', 'skins');
  __resetSupabaseForTest();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Supabase Client SDK', () => {
  it('initializes without error', () => {
    const client = getSupabase();
    expect(client).toBeDefined();
  });

  it('returns the same instance on repeated calls', () => {
    expect(getSupabase()).toBe(getSupabase());
  });

  it('provides storage bucket access (defaults to "skins")', () => {
    const bucket = getStorageBucket();
    expect(bucket).toBeDefined();
    // Supabase's StorageFileApi carries a private `bucketId`. Assert
    // on that via a shape check without poking internal shape too hard.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((bucket as any).bucketId).toBe('skins');
  });

  it('honors SUPABASE_BUCKET_NAME env override', () => {
    vi.stubEnv('SUPABASE_BUCKET_NAME', 'private-bucket');
    const bucket = getStorageBucket();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((bucket as any).bucketId).toBe('private-bucket');
  });
});
