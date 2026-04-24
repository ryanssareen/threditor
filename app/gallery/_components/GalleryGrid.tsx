'use client';

/**
 * M12 Unit 2/3/4/5: gallery grid with optimistic likes, tag filter,
 * sort toggle, and auth redirect on anonymous like.
 *
 * Receives the ISR-fetched skins + initial sort from the Server
 * Component parent. Owns:
 *   - tag filter state (Unit 4, client-side per constraint #4)
 *   - sort toggle state (Unit 5, navigates to ?sort=... for ISR)
 *   - liked-set state (fetched from /api/skins/liked on mount)
 *   - AuthDialog for anonymous like → sign-in prompt
 */

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { AuthDialog } from '@/app/_components/AuthDialog';
import { useAuth } from '@/app/_providers/AuthProvider';
import type { GallerySkin, GallerySort } from '@/lib/firebase/gallery';

import { SkinCard } from './SkinCard';

type Props = {
  initialSkins: GallerySkin[];
  initialSort: GallerySort;
};

/**
 * Union of tags present across the ISR-fetched skins. Stable-sorted
 * by frequency (most-used first), capped at 20 so the scroller stays
 * manageable. The empty "All" pseudo-tag is prepended by the caller.
 */
function deriveTags(skins: readonly GallerySkin[]): string[] {
  const counts = new Map<string, number>();
  for (const skin of skins) {
    for (const tag of skin.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 20)
    .map(([t]) => t);
}

export function GalleryGrid({ initialSkins, initialSort }: Props) {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Tag is client-only state (never hits the server query).
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [likedSet, setLikedSet] = useState<Set<string>>(() => new Set());
  const [authOpen, setAuthOpen] = useState(false);

  // On mount OR when the signed-in user changes: fetch the liked set
  // for the current skin page so hearts render correctly filled.
  useEffect(() => {
    if (user === null) {
      setLikedSet(new Set());
      return;
    }
    if (initialSkins.length === 0) return;
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
          body: JSON.stringify({
            skinIds: initialSkins.map((s) => s.id),
          }),
        });
        if (cancelled) return;
        if (!res.ok) return;
        const data = (await res.json()) as { likedSkinIds?: unknown };
        if (Array.isArray(data.likedSkinIds)) {
          setLikedSet(
            new Set(
              data.likedSkinIds.filter((s): s is string => typeof s === 'string'),
            ),
          );
        }
      } catch {
        // Leave likedSet empty on failure — hearts render as outlined.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initialSkins, user]);

  // Respect `?tag=…` on load so a bookmarked filter restores state.
  useEffect(() => {
    const tagParam = searchParams.get('tag');
    setActiveTag(tagParam !== null && tagParam.length > 0 ? tagParam : null);
  }, [searchParams]);

  const tags = useMemo(() => deriveTags(initialSkins), [initialSkins]);

  const filteredSkins = useMemo(() => {
    if (activeTag === null) return initialSkins;
    return initialSkins.filter((skin) => skin.tags.includes(activeTag));
  }, [initialSkins, activeTag]);

  const handleTag = (next: string | null) => {
    setActiveTag(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === null) {
      params.delete('tag');
    } else {
      params.set('tag', next);
    }
    const query = params.toString();
    router.replace(query.length > 0 ? `/gallery?${query}` : '/gallery', {
      scroll: false,
    });
  };

  const handleSort = (next: GallerySort) => {
    if (next === initialSort) return;
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'newest') {
      params.delete('sort');
    } else {
      params.set('sort', next);
    }
    const query = params.toString();
    router.push(query.length > 0 ? `/gallery?${query}` : '/gallery', {
      scroll: false,
    });
  };

  return (
    <section data-testid="gallery-grid">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Sort"
          data-testid="gallery-sort"
          className="inline-flex rounded border border-ui-border bg-ui-surface p-0.5"
        >
          {(['newest', 'popular'] as const).map((option) => {
            const active = initialSort === option;
            return (
              <button
                key={option}
                role="tab"
                type="button"
                aria-selected={active}
                data-testid={`gallery-sort-${option}`}
                data-active={active ? 'true' : 'false'}
                onClick={() => handleSort(option)}
                className="rounded px-3 py-1 font-mono text-xs text-text-secondary transition-colors hover:text-text-primary data-[active=true]:bg-accent data-[active=true]:text-canvas"
              >
                {option === 'newest' ? 'Newest' : 'Popular'}
              </button>
            );
          })}
        </div>

        <p
          data-testid="gallery-count"
          className="font-mono text-xs text-text-muted"
        >
          {filteredSkins.length}{' '}
          {filteredSkins.length === 1 ? 'skin' : 'skins'}
        </p>
      </div>

      {tags.length > 0 && (
        <div
          role="tablist"
          aria-label="Filter by tag"
          data-testid="gallery-tag-bar"
          className="mb-4 flex flex-wrap gap-2"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTag === null}
            data-testid="gallery-tag-all"
            data-active={activeTag === null ? 'true' : 'false'}
            onClick={() => handleTag(null)}
            className="rounded-full border border-ui-border px-3 py-1 font-mono text-xs text-text-secondary transition-colors hover:border-accent/60 hover:text-accent data-[active=true]:border-accent data-[active=true]:bg-accent data-[active=true]:text-canvas"
          >
            All
          </button>
          {tags.map((tag) => {
            const active = tag === activeTag;
            return (
              <button
                key={tag}
                role="tab"
                type="button"
                aria-selected={active}
                data-testid={`gallery-tag-${tag}`}
                data-active={active ? 'true' : 'false'}
                onClick={() => handleTag(tag)}
                className="rounded-full border border-ui-border px-3 py-1 font-mono text-xs text-text-secondary transition-colors hover:border-accent/60 hover:text-accent data-[active=true]:border-accent data-[active=true]:bg-accent data-[active=true]:text-canvas"
              >
                {tag}
              </button>
            );
          })}
        </div>
      )}

      {filteredSkins.length === 0 ? (
        <div
          data-testid="gallery-tag-empty"
          className="rounded-lg border border-ui-border bg-ui-surface px-6 py-12 text-center text-sm text-text-secondary"
        >
          No skins match that tag yet.
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {filteredSkins.map((skin) => (
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
      )}

      <AuthDialog
        isOpen={authOpen}
        onClose={() => setAuthOpen(false)}
        initialHint="Sign in to like skins"
      />
    </section>
  );
}
