'use client';

/**
 * M9 Unit 3: Supabase client SDK — browser-only.
 *
 * Singleton pattern matches the Firebase client module (lib/firebase/
 * client.ts). Env vars are NEXT_PUBLIC_* so Next.js inlines them at
 * build time.
 *
 * Supabase Auth is NOT used in this project — user identity comes
 * from Firebase Auth. The Supabase client is scoped to Storage only
 * (bucket name from SUPABASE_BUCKET_NAME, default 'skins').
 *
 * For server-side uploads (M11+), a separate server module must use
 * SUPABASE_SERVICE_ROLE_KEY to bypass RLS; it MUST NOT live in this
 * file because the service-role key is a secret.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client === null) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    );
  }
  return client;
}

/**
 * Convenience accessor for the skin-upload bucket. Centralized so the
 * bucket name (env-configurable) is read in one place.
 */
export function getStorageBucket() {
  const bucketName = process.env.SUPABASE_BUCKET_NAME ?? 'skins';
  return getSupabase().storage.from(bucketName);
}

/** Test-only: reset the module-scope singleton. */
export function __resetSupabaseForTest(): void {
  client = null;
}
