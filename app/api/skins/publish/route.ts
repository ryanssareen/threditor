import 'server-only';

/**
 * M11 Unit 5: POST /api/skins/publish
 *
 * Orchestrates the skin publish pipeline:
 *   1. Verify session cookie (getServerSession)
 *   2. Parse + validate multipart body
 *   3. Generate UUID v7 skinId
 *   4. Upload PNG + OG to Supabase Storage (service-role)
 *   5. Write /skins/{skinId} + bump /users/{uid}.skinCount (Admin SDK batch)
 *   6. On partial failure: delete uploaded Storage objects
 *   7. Return { skinId, permalinkUrl, storageUrl, ogImageUrl, thumbnailUrl }
 *
 * Node runtime only (firebase-admin needs crypto.KeyObject).
 */

export const runtime = 'nodejs';
// Force per-request handling. Without this Next.js/Vercel may treat
// the route as cacheable and apply `Cache-Control: public, …`, which
// can interact badly with session cookies at the edge.
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { getServerSession } from '@/lib/firebase/auth';
import { createSkinDoc, defaultUsername } from '@/lib/firebase/skins';
import { generateUuidV7 } from '@/lib/firebase/uuid-v7';
import { validateName, validateTags } from '@/lib/editor/tags';
import {
  deleteSkinAssets,
  uploadSkinAssets,
} from '@/lib/supabase/storage-server';

const MAX_PNG_BYTES = 100 * 1024; // 100 KB — Minecraft skins are ~1 KB typically
const MAX_OG_BYTES = 300 * 1024; // 300 KB — generous for 1200×630 WebP@0.85
const ALLOWED_VARIANTS = new Set(['classic', 'slim']);

type PublishResponse =
  | {
      skinId: string;
      permalinkUrl: string;
      storageUrl: string;
      ogImageUrl: string | null;
      thumbnailUrl: string;
    }
  | { error: string };

function json(body: PublishResponse, status: number): NextResponse {
  const res = NextResponse.json(body, { status });
  res.headers.set(
    'Cache-Control',
    'private, no-store, no-cache, must-revalidate',
  );
  return res;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // 1. Session.
    const session = await getServerSession();
    if (session === null) {
      // Distinguish "no cookie sent" from "cookie rejected" so the
      // Vercel log viewer surfaces the useful detail. The
      // getServerSession helper returns null for both. We probe the
      // raw cookie header (works on both NextRequest and plain
      // Request in tests) to log which branch fired.
      const cookieHeader = req.headers.get('cookie') ?? '';
      const hasSessionCookie = /(?:^|;\s*)session=/.test(cookieHeader);
      console.error(
        `publish: 401 — session ${hasSessionCookie ? 'cookie present but verify failed (likely revoked/expired — user must re-sign-in)' : 'cookie missing from request'}`,
      );
      return json({ error: 'Unauthorized — please sign in again' }, 401);
    }
    const uid = session.uid;

    // 2. Parse + validate body. Next's Request.formData() is supported
    // on Node runtime in 15+.
    const form = await req.formData();

    const nameRaw = form.get('name');
    const nameResult = validateName(typeof nameRaw === 'string' ? nameRaw : '');
    if (!nameResult.ok) {
      return json({ error: nameResult.error }, 400);
    }

    // Tags arrive as either a single comma-separated string OR
    // multiple repeated fields. Accept both shapes.
    const tagsField = form.getAll('tags');
    let tagsNormalized: string[];
    if (tagsField.length === 0) {
      tagsNormalized = [];
    } else if (tagsField.length === 1 && typeof tagsField[0] === 'string') {
      const tr = validateTags(tagsField[0]);
      if (!tr.ok) return json({ error: tr.error }, 400);
      tagsNormalized = tr.tags;
    } else {
      const list = tagsField.filter((t): t is string => typeof t === 'string');
      const tr = validateTags(list);
      if (!tr.ok) return json({ error: tr.error }, 400);
      tagsNormalized = tr.tags;
    }

    const variant = form.get('variant');
    if (typeof variant !== 'string' || !ALLOWED_VARIANTS.has(variant)) {
      return json({ error: 'variant must be "classic" or "slim"' }, 400);
    }

    const skinPng = form.get('skinPng');
    if (!(skinPng instanceof Blob)) {
      return json({ error: 'skinPng file is required' }, 400);
    }
    if (skinPng.size === 0 || skinPng.size > MAX_PNG_BYTES) {
      return json(
        { error: `skinPng must be 1-${MAX_PNG_BYTES} bytes` },
        400,
      );
    }
    if (skinPng.type !== 'image/png') {
      return json(
        { error: `skinPng content-type must be image/png (got ${skinPng.type})` },
        400,
      );
    }

    const ogWebpRaw = form.get('ogWebp');
    let ogBlob: Blob | null = null;
    if (ogWebpRaw instanceof Blob && ogWebpRaw.size > 0) {
      if (ogWebpRaw.size > MAX_OG_BYTES) {
        return json(
          { error: `ogWebp must be ≤ ${MAX_OG_BYTES} bytes` },
          400,
        );
      }
      if (ogWebpRaw.type !== 'image/webp') {
        return json(
          { error: `ogWebp content-type must be image/webp (got ${ogWebpRaw.type})` },
          400,
        );
      }
      ogBlob = ogWebpRaw;
    }

    // 3. skinId.
    const skinId = generateUuidV7();

    // 4. Upload. Any throw here means Storage is clean (uploadSkinAssets
    // rolls back internally on OG-after-PNG failure).
    let storageUrl: string;
    let ogImageUrl: string | null;
    try {
      const uploaded = await uploadSkinAssets({
        uid,
        skinId,
        pngBlob: skinPng,
        ogBlob,
      });
      storageUrl = uploaded.storageUrl;
      ogImageUrl = uploaded.ogImageUrl;
    } catch (err) {
      console.error('publish: upload failed', { uid, skinId, err });
      return json({ error: 'Upload failed' }, 500);
    }

    // 5. Firestore. If this throws, roll back Storage.
    try {
      const ownerUsername = session.email?.split('@')[0] ?? defaultUsername(uid);
      await createSkinDoc({
        skinId,
        uid,
        ownerUsername,
        name: nameResult.name,
        variant: variant as 'classic' | 'slim',
        storageUrl,
        thumbnailUrl: storageUrl,
        ogImageUrl,
        tags: tagsNormalized,
      });
    } catch (err) {
      console.error('publish: firestore failed, rolling back storage', {
        uid,
        skinId,
        err,
      });
      await deleteSkinAssets({ uid, skinId }).catch(() => {
        // Best-effort — logged inside deleteSkinAssets.
      });
      return json({ error: 'Publish failed, please retry' }, 500);
    }

    // 6. Success.
    return json(
      {
        skinId,
        permalinkUrl: `/skin/${skinId}`,
        storageUrl,
        ogImageUrl,
        thumbnailUrl: storageUrl,
      },
      200,
    );
  } catch (err) {
    // Catch-all for unexpected failures (bad multipart, env missing, etc.)
    console.error('publish: unexpected failure', err);
    return json({ error: 'Internal error' }, 500);
  }
}
