import 'server-only';

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { getAdminFirebase } from '@/lib/firebase/admin';
import { buildSkinMetadata, type SkinForMetadata } from '@/lib/seo/skin-metadata';
import { buildSkinJsonLd, serializeJsonLd } from '@/lib/seo/skin-jsonld';
import { buildSkinShareText } from '@/lib/seo/share-text';
import { skinPermalink } from '@/lib/seo/site';

import { ShareButton } from './_components/ShareButton';
import { SkinDetailPreview } from './_components/SkinDetailPreview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ skinId: string }> };

type LoadedSkin = SkinForMetadata;

/**
 * M14: `loadSkin` is wrapped in React `cache()` so `generateMetadata()`
 * and the page body share one Firestore read per request. Without the
 * dedup wrapper the route fires two reads per pageview, halving the
 * Spark-plan ceiling for this page.
 *
 * The loader normalises the Firestore document into the plain-POJO
 * `SkinForMetadata` shape so the metadata builder stays pure (no
 * Firestore Timestamp / class instance at the boundary).
 */
const loadSkin = cache(async (skinId: string): Promise<LoadedSkin | null> => {
  if (!/^[a-f0-9-]{10,64}$/i.test(skinId)) return null;
  try {
    const { db } = getAdminFirebase();
    const snap = await db.collection('skins').doc(skinId).get();
    if (!snap.exists) return null;
    const raw = snap.data();
    if (raw === undefined) return null;

    const tsField = raw.createdAt as { toDate?: () => Date } | null | undefined;
    const createdAtMs =
      tsField !== null &&
      tsField !== undefined &&
      typeof tsField.toDate === 'function'
        ? tsField.toDate().getTime()
        : null;

    const thumbnailUrl =
      typeof raw.thumbnailUrl === 'string' && raw.thumbnailUrl.length > 0
        ? raw.thumbnailUrl
        : null;
    const ogImageUrl =
      typeof raw.ogImageUrl === 'string' && raw.ogImageUrl.length > 0
        ? raw.ogImageUrl
        : null;
    const tags = Array.isArray(raw.tags)
      ? (raw.tags.filter(
          (t: unknown): t is string => typeof t === 'string',
        ) as string[])
      : [];
    const variant: 'classic' | 'slim' =
      raw.variant === 'slim' ? 'slim' : 'classic';

    return {
      id: skinId,
      name: typeof raw.name === 'string' ? raw.name : '',
      ownerUsername:
        typeof raw.ownerUsername === 'string' ? raw.ownerUsername : '',
      variant,
      storageUrl: typeof raw.storageUrl === 'string' ? raw.storageUrl : '',
      thumbnailUrl,
      ogImageUrl,
      tags,
      likeCount: typeof raw.likeCount === 'number' ? raw.likeCount : 0,
      createdAtMs,
    };
  } catch {
    return null;
  }
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { skinId } = await params;
  const skin = await loadSkin(skinId);
  if (skin === null) {
    return {
      title: 'Skin not found · Threditor',
      robots: { index: false, follow: false },
    };
  }
  return buildSkinMetadata(skin, { shareUrl: skinPermalink(skin.id) });
}

export default async function SkinPage({ params }: Props) {
  const { skinId } = await params;
  const skin = await loadSkin(skinId);
  if (skin === null) notFound();

  const createdAtMs = skin.createdAtMs;
  const jsonLd = buildSkinJsonLd(skin);
  const shareUrl = skinPermalink(skin.id);
  const shareText = buildSkinShareText(skin);

  return (
    <main className="min-h-screen bg-canvas px-6 py-12 text-text-primary">
      <script
        type="application/ld+json"
        data-testid="skin-jsonld"
        // JSON content is server-controlled (fields come from Firestore
        // docs we write) but a malicious skin name could contain
        // `</script>` — serializeJsonLd escapes every `<` to `\u003c`
        // so the HTML tokenizer can't be fooled into closing the tag.
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <div className="mx-auto max-w-4xl">
        <Link
          href="/gallery"
          data-testid="skin-detail-back"
          className="mb-6 inline-block text-sm text-text-secondary hover:text-text-primary"
        >
          ← Back to gallery
        </Link>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left: always-on interactive 3D preview. */}
          <div
            data-testid="skin-detail-preview"
            className="overflow-hidden rounded-lg border border-ui-border bg-ui-surface"
          >
            <div className="aspect-square bg-ui-base p-8">
              <SkinDetailPreview
                skinUrl={skin.storageUrl}
                variant={skin.variant}
              />
            </div>
          </div>

          {/* Right: metadata panel. */}
          <div className="overflow-hidden rounded-lg border border-ui-border bg-ui-surface">
            <div className="px-6 py-4">
              <h1 className="mb-1 text-2xl font-semibold">{skin.name}</h1>
              <p className="text-sm text-text-secondary">
                by{' '}
                <Link
                  href={`/u/${skin.ownerUsername}`}
                  data-testid="skin-detail-owner"
                  className="hover:text-accent hover:underline"
                >
                  {skin.ownerUsername}
                </Link>
                {' '}· {skin.variant} model
              </p>

              {skin.tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {skin.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded bg-ui-base px-2 py-0.5 text-xs text-text-secondary"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-4 flex items-center justify-between text-xs text-text-secondary">
                <span>
                  {skin.likeCount} {skin.likeCount === 1 ? 'like' : 'likes'}
                </span>
                {createdAtMs !== null && (
                  <time dateTime={new Date(createdAtMs).toISOString()}>
                    {new Date(createdAtMs).toLocaleDateString()}
                  </time>
                )}
              </div>

              <div className="mt-6 flex gap-2">
                <a
                  href={skin.storageUrl}
                  download={`${skin.name}.png`}
                  className="flex-1 rounded bg-accent px-3 py-2 text-center text-sm font-medium text-canvas hover:bg-accent-hover"
                >
                  Download PNG
                </a>
                <ShareButton
                  shareUrl={shareUrl}
                  shareText={shareText}
                  skinName={skin.name}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
