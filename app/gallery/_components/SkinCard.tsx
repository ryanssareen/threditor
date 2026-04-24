'use client';

/**
 * M12 Unit 3: gallery SkinCard with optimistic likes.
 *
 * Renders a thumbnail + name + owner + tags + like button. The like
 * button implements the optimistic pattern from COMPOUND (M11 lessons):
 *
 *   1. On click: flip `liked` + adjust `count` locally immediately.
 *   2. Fire POST /api/skins/[id]/like with a fresh Firebase ID token.
 *   3. On success: reconcile state with server-authoritative response.
 *   4. On failure: roll back to pre-click state + surface a toast via
 *      console.warn (no toast library in the codebase yet).
 *
 * Anonymous users get redirected to sign-in via the parent-owned
 * AuthDialog (passed through `onRequestSignIn`) rather than a
 * direct hard redirect — keeps the user's gallery scroll position.
 *
 * In-flight clicks are ignored (a single in-flight toggle at a time),
 * so rapid double-clicks don't get both hyper-like and hyper-unlike.
 */

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useCallback, useState, useTransition } from 'react';

import type { GallerySkin } from '@/lib/firebase/gallery';

// M13.1: lazy-load the 3D preview. three.js + R3F + drei total ~750 KB;
// gallery renders up to 60 cards so we must not pull that bundle up-front.
// The chunk downloads on first hover and is cached for subsequent cards.
const SkinPreview3D = dynamic(
  () => import('./SkinPreview3D').then((mod) => ({ default: mod.SkinPreview3D })),
  { ssr: false },
);

type Props = {
  skin: GallerySkin;
  /** Initial liked state for the signed-in viewer (from /api/skins/liked). */
  initialLiked: boolean;
  /** Called when an anonymous user clicks the heart. */
  onRequestSignIn: () => void;
  /** Whether a viewer is signed in. Controls heart-click behaviour. */
  isSignedIn: boolean;
};

async function callToggleLike(
  skinId: string,
): Promise<{ liked: boolean; likeCount: number }> {
  // Pull a fresh Firebase ID token for the Bearer header. Cookie-free
  // auth matches the /api/skins/publish pattern (M11 handler) so
  // like-from-gallery works on hosts where Set-Cookie is stripped.
  const { getFirebase } = await import('@/lib/firebase/client');
  const { auth } = getFirebase();
  const currentUser = auth.currentUser;
  if (currentUser === null) {
    throw new Error('not-signed-in');
  }
  const idToken = await currentUser.getIdToken(false);

  const res = await fetch(`/api/skins/${encodeURIComponent(skinId)}/like`, {
    method: 'POST',
    credentials: 'include',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok) {
    throw new Error(`http-${res.status}`);
  }
  const data = (await res.json()) as { liked: boolean; likeCount: number };
  return data;
}

export function SkinCard({
  skin,
  initialLiked,
  isSignedIn,
  onRequestSignIn,
}: Props) {
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(skin.likeCount);
  const [, startTransition] = useTransition();
  const [inFlight, setInFlight] = useState(false);
  // M13.1: hover-to-3D state. Only fires on devices with real hover
  // (desktop mice); touch devices never enter this branch so a tap
  // still navigates to /skin/[id] without getting hijacked by
  // OrbitControls swallowing the tap as a rotation gesture.
  const [show3D, setShow3D] = useState(false);

  const handleLike = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (inFlight) return;
      if (!isSignedIn) {
        onRequestSignIn();
        return;
      }

      const priorLiked = liked;
      const priorCount = count;
      const nextLiked = !priorLiked;
      const nextCount = priorLiked
        ? Math.max(0, priorCount - 1)
        : priorCount + 1;

      startTransition(() => {
        setLiked(nextLiked);
        setCount(nextCount);
      });
      setInFlight(true);

      try {
        const server = await callToggleLike(skin.id);
        // Reconcile with server truth; usually identical to optimistic.
        setLiked(server.liked);
        setCount(server.likeCount);
      } catch (err) {
        // Roll back.
        setLiked(priorLiked);
        setCount(priorCount);
        console.warn('SkinCard: like toggle failed, rolled back', err);
      } finally {
        setInFlight(false);
      }
    },
    [count, inFlight, isSignedIn, liked, onRequestSignIn, skin.id],
  );

  return (
    <article
      data-testid={`skin-card-${skin.id}`}
      data-skin-id={skin.id}
      onMouseEnter={() => setShow3D(true)}
      onMouseLeave={() => setShow3D(false)}
      className="group overflow-hidden rounded-lg border border-ui-border bg-ui-surface transition-colors hover:border-accent/40"
    >
      <Link
        href={`/skin/${skin.id}`}
        prefetch={false}
        className="block"
        data-testid={`skin-card-link-${skin.id}`}
      >
        <div
          data-testid={`skin-card-preview-${skin.id}`}
          data-preview-3d={show3D ? 'true' : 'false'}
          className="relative flex h-48 items-center justify-center bg-ui-base p-4"
        >
          {show3D ? (
            <SkinPreview3D
              skinUrl={skin.storageUrl}
              variant={skin.variant}
              className="absolute inset-0"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={skin.thumbnailUrl}
              alt={skin.name}
              width={128}
              height={128}
              loading="lazy"
              style={{ imageRendering: 'pixelated' }}
              className="h-32 w-32"
            />
          )}
        </div>
      </Link>

      <div className="px-3 py-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <Link
              href={`/skin/${skin.id}`}
              prefetch={false}
              className="block truncate text-sm font-medium text-text-primary hover:text-accent"
            >
              {skin.name}
            </Link>
            <p className="truncate text-xs text-text-secondary">
              by{' '}
              <Link
                href={`/u/${skin.ownerUsername}`}
                prefetch={false}
                data-testid={`skin-card-owner-${skin.id}`}
                className="hover:text-accent hover:underline"
              >
                {skin.ownerUsername}
              </Link>
            </p>
          </div>

          <button
            type="button"
            data-testid={`skin-card-like-${skin.id}`}
            data-liked={liked ? 'true' : 'false'}
            aria-label={liked ? 'Unlike' : 'Like'}
            aria-pressed={liked}
            disabled={inFlight}
            onClick={handleLike}
            className="flex shrink-0 items-center gap-1 rounded border border-ui-border px-2 py-1 font-mono text-xs text-text-secondary transition-colors hover:border-accent/60 hover:text-accent disabled:opacity-60 data-[liked=true]:border-accent data-[liked=true]:text-accent"
          >
            <span aria-hidden="true">{liked ? '♥' : '♡'}</span>
            <span data-testid={`skin-card-like-count-${skin.id}`}>{count}</span>
          </button>
        </div>

        {skin.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {skin.tags.slice(0, 4).map((t) => (
              <span
                key={t}
                data-testid={`skin-card-tag-${t}`}
                className="rounded bg-ui-base px-1.5 py-0.5 text-[10px] text-text-muted"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
