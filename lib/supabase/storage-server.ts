import 'server-only';

/**
 * M11 Unit 3: server-side Supabase Storage writer.
 *
 * Uses the service-role key (bypasses RLS). Never imported from the
 * client — `server-only` enforces at build time.
 *
 * Two public functions:
 *   uploadSkinAssets({ uid, skinId, pngBlob, ogBlob? }) → URLs
 *   deleteSkinAssets({ uid, skinId }) → void (fail-soft cleanup)
 *
 * Upload order: PNG first, then OG. If OG upload fails AFTER the PNG
 * succeeded, delete the PNG and throw so the caller sees a clean
 * error with no orphaned Storage objects.
 *
 * Path convention: `skins/{uid}/{skinId}.png` + `...-og.webp`.
 * Matches DESIGN §11.5 + Supabase RLS policies documented in
 * docs/supabase-storage-policies.md.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type RequiredEnv = {
  supabaseUrl: string;
  serviceRoleKey: string;
  bucket: string;
};

function readEnv(): RequiredEnv {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_BUCKET_NAME ?? 'skins';
  const missing: string[] = [];
  if (supabaseUrl === undefined || supabaseUrl.length === 0) {
    missing.push('NEXT_PUBLIC_SUPABASE_URL');
  }
  if (serviceRoleKey === undefined || serviceRoleKey.length === 0) {
    missing.push('SUPABASE_SERVICE_ROLE_KEY');
  }
  if (
    missing.length > 0 ||
    supabaseUrl === undefined ||
    serviceRoleKey === undefined
  ) {
    throw new Error(`Supabase not configured: missing ${missing.join(', ')}`);
  }
  return { supabaseUrl, serviceRoleKey, bucket };
}

function makeClient(env: RequiredEnv): SupabaseClient {
  return createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function skinPngPath(uid: string, skinId: string): string {
  return `${uid}/${skinId}.png`;
}

function skinOgPath(uid: string, skinId: string): string {
  return `${uid}/${skinId}-og.webp`;
}

function publicUrl(env: RequiredEnv, path: string): string {
  return `${env.supabaseUrl}/storage/v1/object/public/${env.bucket}/${path}`;
}

export type UploadResult = {
  storageUrl: string;
  ogImageUrl: string | null;
};

export type UploadInput = {
  uid: string;
  skinId: string;
  pngBlob: Blob;
  ogBlob?: Blob | null;
};

export async function uploadSkinAssets({
  uid,
  skinId,
  pngBlob,
  ogBlob,
}: UploadInput): Promise<UploadResult> {
  const env = readEnv();
  const client = makeClient(env);
  const pngPath = skinPngPath(uid, skinId);
  const ogPath = skinOgPath(uid, skinId);

  const pngUpload = await client.storage
    .from(env.bucket)
    .upload(pngPath, pngBlob, {
      contentType: 'image/png',
      upsert: false,
    });
  if (pngUpload.error !== null) {
    throw new Error(`skin PNG upload failed: ${pngUpload.error.message}`);
  }
  const storageUrl = publicUrl(env, pngPath);

  let ogImageUrl: string | null = null;
  if (ogBlob !== undefined && ogBlob !== null) {
    const ogUpload = await client.storage
      .from(env.bucket)
      .upload(ogPath, ogBlob, {
        contentType: 'image/webp',
        upsert: false,
      });
    if (ogUpload.error !== null) {
      // Roll back the PNG so we don't leave an orphan.
      await client.storage
        .from(env.bucket)
        .remove([pngPath])
        .catch(() => {
          /* best-effort cleanup — if it fails the orphan is visible,
             but we still surface the original error to the caller */
        });
      throw new Error(`OG upload failed: ${ogUpload.error.message}`);
    }
    ogImageUrl = publicUrl(env, ogPath);
  }

  return { storageUrl, ogImageUrl };
}

export type DeleteInput = {
  uid: string;
  skinId: string;
};

/**
 * Fail-soft delete — removes whichever files exist, ignores 404s.
 * Used by the /api/skins/publish route when the Firestore commit
 * fails after uploads succeeded.
 */
export async function deleteSkinAssets({
  uid,
  skinId,
}: DeleteInput): Promise<void> {
  const env = readEnv();
  const client = makeClient(env);
  const paths = [skinPngPath(uid, skinId), skinOgPath(uid, skinId)];
  // Supabase's .remove accepts a list and returns the per-path result.
  // 404-equivalent (file not found) is not treated as an error by the
  // storage API — it's silently skipped. So a single call is enough.
  const res = await client.storage.from(env.bucket).remove(paths);
  if (res.error !== null) {
    // Log but do not throw — partial cleanup is acceptable; the caller
    // has already failed and re-throwing here would mask the original
    // cause.
    console.warn('storage-server: deleteSkinAssets partial failure', res.error);
  }
}
