import 'server-only';

/**
 * M12 Unit 2: public gallery, ISR-rendered.
 *
 * `revalidate = 60` is binding (M12 constraint #1). Shorter values
 * would exceed Firestore Spark read quota; longer values would delay
 * new-skin discovery past what users notice.
 *
 * Rendering is Server Component → 60 skins fetched via Admin SDK on
 * revalidation, handed to a small Client Component shell
 * (<GalleryGrid>) that owns tag + sort state and the individual
 * <SkinCard> instances.
 *
 * Tag + sort come from the URL (`?sort=newest|popular`). The initial
 * sort drives the query, so a bookmarked `?sort=popular` renders the
 * popular list without a client-side refetch.
 *
 * Fail-soft: if the Firestore read throws (e.g. the service account
 * is broken in preview deployments), we render the empty-state page
 * with an inline diagnostic rather than a 500. Prevents the gallery
 * from being unreachable when the rest of the app is healthy.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import {
  GALLERY_PAGE_SIZE,
  queryGallery,
  type GallerySkin,
  type GallerySort,
} from '@/lib/firebase/gallery';

import { GalleryGrid } from './_components/GalleryGrid';

export const runtime = 'nodejs';
export const revalidate = 60;
export const dynamic = 'force-static';
export const dynamicParams = false;

export const metadata: Metadata = {
  title: 'Gallery · Threditor',
  description: 'Browse published Minecraft skins made with Threditor.',
};

function parseSort(value: string | string[] | undefined): GallerySort {
  const v = Array.isArray(value) ? value[0] : value;
  return v === 'popular' ? 'popular' : 'newest';
}

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function fetchSkinsFailSoft(
  sort: GallerySort,
): Promise<{ skins: GallerySkin[]; error: string | null }> {
  try {
    const skins = await queryGallery(sort);
    return { skins, error: null };
  } catch (err) {
    const msg =
      err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
    console.error(`gallery: query failed sort=${sort} message=${msg}`);
    return { skins: [], error: msg };
  }
}

export default async function GalleryPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const sort = parseSort(params.sort);
  const { skins, error } = await fetchSkinsFailSoft(sort);

  return (
    <main className="min-h-dvh bg-ui-base text-text-primary">
      <header className="border-b border-ui-border px-6 py-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div>
            <Link
              href="/"
              className="font-mono text-xs uppercase tracking-[0.2em] text-text-secondary hover:text-text-primary"
              data-testid="gallery-home"
            >
              ← threditor
            </Link>
            <h1 className="mt-1 text-2xl font-semibold">Gallery</h1>
          </div>
          <Link
            href="/editor"
            prefetch={false}
            data-testid="gallery-new-skin"
            className="rounded bg-accent px-4 py-2 text-sm font-semibold text-canvas hover:bg-accent-hover"
          >
            Make a skin
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8">
        {error !== null && (
          <div
            role="alert"
            data-testid="gallery-error"
            className="mb-6 rounded border border-red-500/20 bg-red-500/10 p-3 font-mono text-xs text-red-400"
          >
            Gallery is temporarily unavailable. Try again in a moment.
          </div>
        )}

        {skins.length === 0 ? (
          <div
            data-testid="gallery-empty"
            className="rounded-lg border border-ui-border bg-ui-surface px-6 py-16 text-center"
          >
            <p className="text-lg font-semibold">No skins yet.</p>
            <p className="mt-2 text-sm text-text-secondary">
              Be the first — publish a skin and it shows up here within a
              minute.
            </p>
            <Link
              href="/editor"
              prefetch={false}
              className="mt-6 inline-block rounded bg-accent px-4 py-2 text-sm font-semibold text-canvas hover:bg-accent-hover"
            >
              Open the editor
            </Link>
          </div>
        ) : (
          <GalleryGrid initialSkins={skins} initialSort={sort} />
        )}

        <p
          className="mt-8 text-center font-mono text-xs text-text-muted"
          data-testid="gallery-page-size-info"
        >
          Showing up to {GALLERY_PAGE_SIZE} skins · refreshed every 60 s
        </p>
      </div>
    </main>
  );
}
