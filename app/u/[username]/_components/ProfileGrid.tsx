'use client';

/**
 * M13 Unit 3: profile skin grid.
 *
 * Same layout + liked-set hydration pattern as
 * `app/gallery/_components/GalleryGrid.tsx`, minus the sort toggle
 * and tag filter (not meaningful for a single-user view). Reuses
 * `SkinCard` verbatim so likes work identically here and in the
 * gallery.
 *
 * When the viewer is signed in we POST the current skinIds to
 * `/api/skins/liked` to get a filled-heart hint for each card. One
 * request, up to {PROFILE_PAGE_SIZE} ids.
 */

import { useEffect, useState } from 'react';

import { AuthDialog } from '@/app/_components/AuthDialog';
import { useAuth } from '@/app/_providers/AuthProvider';
import { SkinCard } from '@/app/gallery/_components/SkinCard';
import type { GallerySkin } from '@/lib/firebase/gallery';

type Props = {
  skins: GallerySkin[];
};

export function ProfileGrid({ skins }: Props) {
  const { user } = useAuth();
  const [likedSet, setLikedSet] = useState<Set<string>>(() => new Set());
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    if (user === null) {
      setLikedSet(new Set());
      return;
    }
    if (skins.length === 0) return;

    let cancelled = false;
    (async () => {
      try {
        const idToken = await user.getIdToken(false);
        const res = await fetch('/api/skins/liked', {
          method: 'POST',
          credentials: 'include',
          headers: {
            Authorization: `Bearer ${idToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ skinIds: skins.map((s) => s.id) }),
        });
        if (cancelled) return;
        if (!res.ok) return;
        const data = (await res.json()) as { likedSkinIds?: unknown };
        if (Array.isArray(data.likedSkinIds)) {
          setLikedSet(
            new Set(
              data.likedSkinIds.filter(
                (s): s is string => typeof s === 'string',
              ),
            ),
          );
        }
      } catch {
        // Leave likedSet empty on failure — hearts render outlined.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [skins, user]);

  if (skins.length === 0) {
    return null;
  }

  return (
    <>
      <ul
        data-testid="profile-grid"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
      >
        {skins.map((skin) => (
          <li key={skin.id}>
            <SkinCard
              skin={skin}
              initialLiked={likedSet.has(skin.id)}
              isSignedIn={user !== null}
              onRequestSignIn={() => setAuthOpen(true)}
            />
          </li>
        ))}
      </ul>

      <AuthDialog
        isOpen={authOpen}
        onClose={() => setAuthOpen(false)}
        initialHint="Sign in to like skins"
      />
    </>
  );
}
