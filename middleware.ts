import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * M13: CDN cache headers for SSR profile pages.
 *
 * Next.js 15 sets `Cache-Control: no-store` by default on
 * `dynamic = 'force-dynamic'` routes. That's appropriate for API
 * endpoints but not for public profile pages — we want Vercel's edge
 * to cache the HTML between requests so the Admin-SDK Firestore
 * lookup (~1 read on /users + up to 50 reads on /skins) fires once
 * per CDN window instead of once per pageview.
 *
 *   s-maxage=300         → 5 min fresh at the edge (zero reads)
 *   stale-while-revalidate=600 → 10 min of serving stale HTML
 *                               while a background rebuild hits
 *                               Firestore
 *
 * Budget math (see docs/solutions/m13-profile-pages-plan.md):
 *   100 users × 10 views/day, with 90% CDN hit rate = ~100 reads/day
 *   for users + ~5K reads/day for skins lookups — well under Spark.
 *
 * `router.refresh()` from EditProfileDialog invalidates the per-path
 * cache entry for the owner's in-flight request, so the first view
 * after an edit hits Firestore and re-populates the cache.
 *
 * Scoped to `/u/:path*` only — the matcher config below prevents this
 * from touching API routes, Vercel internals, or the editor.
 */
export function middleware(req: NextRequest): NextResponse {
  const res = NextResponse.next();
  if (req.nextUrl.pathname.startsWith('/u/')) {
    res.headers.set(
      'Cache-Control',
      'public, s-maxage=300, stale-while-revalidate=600',
    );
  }
  return res;
}

export const config = {
  matcher: ['/u/:path*'],
};
