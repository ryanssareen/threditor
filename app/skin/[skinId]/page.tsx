import 'server-only';

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getAdminFirebase } from '@/lib/firebase/admin';

import { SkinDetailPreview } from './_components/SkinDetailPreview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ skinId: string }> };

type SkinDoc = {
  id: string;
  ownerUid: string;
  ownerUsername: string;
  name: string;
  variant: 'classic' | 'slim';
  storageUrl: string;
  thumbnailUrl: string;
  ogImageUrl: string | null;
  tags: string[];
  likeCount: number;
  createdAt: { toDate?: () => Date } | null;
};

async function loadSkin(skinId: string): Promise<SkinDoc | null> {
  if (!/^[a-f0-9-]{10,64}$/i.test(skinId)) return null;
  try {
    const { db } = getAdminFirebase();
    const snap = await db.collection('skins').doc(skinId).get();
    if (!snap.exists) return null;
    return snap.data() as SkinDoc;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { skinId } = await params;
  const skin = await loadSkin(skinId);
  if (skin === null) {
    return { title: 'Skin not found · Threditor' };
  }
  const title = `${skin.name} by ${skin.ownerUsername} · Threditor`;
  const ogImage = skin.ogImageUrl ?? skin.storageUrl;
  return {
    title,
    description: `Minecraft skin by ${skin.ownerUsername}`,
    openGraph: {
      title,
      images: [{ url: ogImage }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      images: [ogImage],
    },
  };
}

export default async function SkinPage({ params }: Props) {
  const { skinId } = await params;
  const skin = await loadSkin(skinId);
  if (skin === null) notFound();

  const createdAtMs =
    skin.createdAt !== null && typeof skin.createdAt?.toDate === 'function'
      ? skin.createdAt.toDate().getTime()
      : null;

  return (
    <main className="min-h-screen bg-canvas px-6 py-12 text-text-primary">
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
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
