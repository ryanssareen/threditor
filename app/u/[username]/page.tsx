import 'server-only';

/**
 * M13 Unit 1: public user profile page — SSR rendered.
 *
 * Why SSR, not ISR (plan §"SSR vs ISR Decision"):
 *   - Gallery has ~1 logical URL, ISR 60 s caches it once globally.
 *   - Profiles have N URLs. At 100 users × 10 views/day, ISR would
 *     create 100 cache entries each revalidating independently
 *     (~2,400 reads/day). SSR with CDN `s-maxage=300,
 *     stale-while-revalidate=600` serves most requests from the
 *     edge (~100 reads/day cold; 900 views free).
 *
 * The fetch path is: 1 read on `/users` (username → uid), then 1
 * query on `/skins` (up to {PROFILE_PAGE_SIZE} docs by ownerUid).
 * `computeTotalLikes` is an O(n) fold over those same skins — no
 * extra query.
 *
 * SEO: `generateMetadata` emits OpenGraph + Twitter tags, and we
 * inline a JSON-LD `ProfilePage` snippet so search engines pick up
 * the person-level structured data.
 *
 * Fail-soft: when the Admin SDK throws (bad service-account env in a
 * preview deploy, etc.), we 404 rather than 500 so crawlers don't
 * get stuck on transient server errors.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  computeTotalLikes,
  getSkinsByOwner,
  getUserByUsername,
  PROFILE_PAGE_SIZE,
  USERNAME_PATTERN,
  type ProfileUser,
} from '@/lib/firebase/profile';
import type { GallerySkin } from '@/lib/firebase/gallery';

import { ProfileGrid } from './_components/ProfileGrid';
import { ProfileHeader } from './_components/ProfileHeader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = false;

type PageProps = {
  params: Promise<{ username: string }>;
};

const SITE_ORIGIN = 'https://threditor.vercel.app';

async function loadProfile(rawUsername: string): Promise<
  | {
      user: ProfileUser;
      skins: GallerySkin[];
      totalLikes: number;
    }
  | null
> {
  const username = rawUsername.toLowerCase();
  if (!USERNAME_PATTERN.test(username)) return null;

  let user: ProfileUser | null;
  try {
    user = await getUserByUsername(username);
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 200) : String(err);
    console.error(`profile: user lookup failed username=${username} message=${msg}`);
    return null;
  }
  if (user === null) return null;

  // Skins query is decoupled from the user lookup: a missing composite
  // index (production deploy lag) or a transient Firestore error should
  // degrade the page to "profile header with empty grid" rather than
  // show a 404 for a user that definitely exists. The header is still
  // useful — discoverability matters more than the skin list here.
  let skins: GallerySkin[];
  try {
    skins = await getSkinsByOwner(user.uid);
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 200) : String(err);
    console.error(
      `profile: skins query failed uid=${user.uid} username=${username} message=${msg}`,
    );
    skins = [];
  }

  const totalLikes = computeTotalLikes(skins);
  return { user, skins, totalLikes };
}

function formatJoined(createdAtMs: number | null): string | null {
  if (createdAtMs === null) return null;
  try {
    return new Date(createdAtMs).toLocaleString('en-US', {
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { username } = await params;
  const profile = await loadProfile(username);
  if (profile === null) {
    return { title: 'Profile not found · Threditor', robots: { index: false } };
  }
  const { user, skins, totalLikes } = profile;
  const title = `${user.displayName} (@${user.username}) · Threditor`;
  const description = `${skins.length} ${skins.length === 1 ? 'skin' : 'skins'}, ${totalLikes} ${totalLikes === 1 ? 'like' : 'likes'} · Minecraft skins by ${user.displayName}.`;
  const url = `${SITE_ORIGIN}/u/${user.username}`;
  const avatar = user.photoURL;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'profile',
      title,
      description,
      url,
      images: avatar !== null ? [{ url: avatar, width: 400, height: 400 }] : [],
    },
    twitter: {
      card: 'summary',
      title,
      description,
      images: avatar !== null ? [avatar] : [],
    },
    // Cache-Control for CDN caching is set in middleware.ts (Next.js
    // injects its own no-store header on force-dynamic routes, so
    // metadata.other can't override it reliably).
  };
}

export default async function ProfilePage({ params }: PageProps) {
  const { username: rawUsername } = await params;
  const profile = await loadProfile(rawUsername);
  if (profile === null) notFound();

  const { user, skins, totalLikes } = profile;
  const joinedLabel = formatJoined(user.createdAtMs);
  // `skinCount` from `/users` may be stale (Cloud Function lag) — the
  // actual number of skins we just read is authoritative for this page.
  const displayedSkinCount = skins.length;

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    dateCreated:
      user.createdAtMs !== null ? new Date(user.createdAtMs).toISOString() : undefined,
    mainEntity: {
      '@type': 'Person',
      name: user.displayName,
      alternateName: user.username,
      identifier: user.username,
      image: user.photoURL ?? undefined,
      url: `${SITE_ORIGIN}/u/${user.username}`,
    },
  };

  return (
    <main className="min-h-dvh bg-ui-base text-text-primary">
      <script
        type="application/ld+json"
        data-testid="profile-jsonld"
        // Safe: we control every field above, no user-writable data in
        // the JSON outside of displayName/username which React auto-escapes
        // as a string. dangerouslySetInnerHTML is unavoidable for
        // JSON-LD because Next.js strips <script> with children.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <header className="border-b border-ui-border px-6 py-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link
            href="/"
            className="font-mono text-xs uppercase tracking-[0.2em] text-text-secondary hover:text-text-primary"
            data-testid="profile-home"
          >
            ← threditor
          </Link>
          <Link
            href="/gallery"
            prefetch={false}
            data-testid="profile-gallery"
            className="rounded border border-ui-border px-3 py-1.5 font-mono text-xs text-text-secondary hover:border-accent/60 hover:text-accent"
          >
            Gallery
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8">
        <ProfileHeader
          uid={user.uid}
          username={user.username}
          displayName={user.displayName}
          photoURL={user.photoURL}
          joinedLabel={joinedLabel}
          skinCount={displayedSkinCount}
          totalLikes={totalLikes}
        />

        {skins.length === 0 ? (
          <div
            data-testid="profile-empty"
            className="rounded-lg border border-ui-border bg-ui-surface px-6 py-16 text-center"
          >
            <p className="text-lg font-semibold">No skins yet.</p>
            <p className="mt-2 text-sm text-text-secondary">
              {user.displayName} hasn&apos;t published anything. Check back soon.
            </p>
          </div>
        ) : (
          <ProfileGrid skins={skins} />
        )}

        {skins.length >= PROFILE_PAGE_SIZE && (
          <p
            data-testid="profile-page-size-info"
            className="mt-8 text-center font-mono text-xs text-text-muted"
          >
            Showing the {PROFILE_PAGE_SIZE} most recent skins.
          </p>
        )}
      </div>
    </main>
  );
}
