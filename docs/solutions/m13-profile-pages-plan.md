# M13: Profile Pages — Implementation Plan

**Milestone:** M13 (Phase 2, Milestone 4)  
**Status:** Planning  
**Methodology:** Compound Engineering  
**Estimated time:** 6-8 hours (5 work + 2 review + compound)  
**Created:** 2026-04-24  
**Dependencies:** M12 (Gallery + Likes) deployed and verified  

---

## Executive Summary

M13 implements user profile pages at `/u/[username]`, creating a dedicated space for each creator to showcase their published skins. This milestone transforms the platform from a gallery of anonymous content to a community of identifiable creators — users can now build a portfolio, track their impact (total likes), and be discovered by others.

**Key architectural decision:** Profile pages use SSR (Server-Side Rendering) with aggressive caching instead of ISR. Unlike the gallery (which shows all skins), profiles are user-specific and visited less frequently, so per-user caching is more efficient than time-based revalidation.

---

## Prerequisites Verification

### Required M12 Infrastructure

From COMPOUND.md M12 learnings:

- [x] Gallery page deployed at `/gallery`
- [x] Firestore `/skins` collection has `ownerUsername` denormalized
- [x] Firestore `/users` collection populated (from M10 auth)
- [x] Like system working (M12)
- [x] Thumbnail URLs in Firestore `thumbnailRef` field
- [ ] Verify at least 2-3 users have published skins (for realistic profile testing)

### Production Environment

- [x] M12 deployed to `threditor.vercel.app/gallery`
- [x] Firebase Auth working (M10)
- [x] Session cookies functional (M10)
- [ ] Test: Can access `/u/testuser` without auth (public profile)
- [ ] Test: Can access own profile at `/u/myusername` when signed in

### Codebase State

Expected files from M12:
```
lib/
├── firebase/
│   ├── firestore.ts          # getRecentSkins, getTrendingSkins
│   ├── gallery.ts             # Gallery queries
│   └── likes.ts               # toggleLike, checkIfLiked
app/
├── gallery/
│   └── page.tsx               # ISR gallery (M12)
└── skin/
    └── [skinId]/
        └── page.tsx           # Skin detail page (M11, basic version)
```

---

## M13 Scope

### What Users Will See

**Before M13:**
- Users can publish skins and see them in gallery
- No way to view all skins by a specific creator
- No creator identity or portfolio concept

**After M13:**
- `/u/[username]` page for each user
- User's display name, join date, total skins, total likes across all skins
- Grid of user's published skins (newest first)
- "Edit Profile" button visible only to profile owner
- SEO-friendly: indexed by search engines, shareable links
- Profile URL visible in gallery skin cards ("by @username" links to profile)

**Not in scope for M13:**
- Profile photo upload (uses Firebase Auth photoURL from Google OAuth)
- Bio/description field (deferred to Phase 3)
- Follower/following system (Phase 3)
- Activity feed (Phase 3)
- Username change flow (Phase 3, requires batch update of denormalized data)
- Private/public profile toggle (all profiles public in M13)

### What Gets Built

**6 Implementation Units:**

| Unit | Component/File | Purpose |
|------|----------------|---------|
| 0 | Firestore indexes | Query optimization for user's skins |
| 1 | `/app/u/[username]/page.tsx` | SSR profile page |
| 2 | `ProfileHeader.tsx` | User stats, display name, avatar |
| 3 | `ProfileGrid.tsx` | User's skins in grid layout |
| 4 | Gallery integration | Add username links to skin cards |
| 5 | Edit profile | Modal for display name update |

**4 Test Files:**

| File | Coverage |
|------|----------|
| `tests/profile-queries.test.ts` | User skins query, stats aggregation |
| `tests/profile-seo.test.ts` | Meta tags, OG tags, structured data |
| `tests/profile-auth.test.ts` | Edit button visibility, permission checks |
| `tests/username-validation.test.ts` | Username format, uniqueness, reserved words |

---

## Technical Architecture

### SSR vs ISR Decision

**Why SSR instead of ISR:**

From M12 COMPOUND.md: "ISR revalidation MUST be ≥60s (shorter exceeds Spark quota)."

**Gallery:** High traffic, same content for all users → ISR with 60s revalidation efficient  
**Profile:** Low traffic, unique content per user → SSR with Cache-Control headers more efficient

**Traffic analysis:**
- Gallery: 1,000 views/day → 1 ISR cache = 1,000 hits
- Profile (100 users): 10 views each/day → 100 ISR caches = 1,000 hits + 100 revalidations
- **Result:** Profile ISR would create 100× cache entries, each revalidating separately

**SSR solution:**
```typescript
// app/u/[username]/page.tsx
export const dynamic = 'force-dynamic'; // SSR, not static
export const revalidate = false; // No time-based revalidation

export default async function ProfilePage({ params }: Props) {
  const { username } = params;
  
  // Query runs on every request, but cached at CDN level
  const user = await getUserByUsername(username);
  const skins = await getUserSkins(user.uid);
  
  return <ProfileContent user={user} skins={skins} />;
}
```

**Cache-Control strategy:**
```typescript
// Set in response headers
export async function generateMetadata({ params }: Props) {
  return {
    other: {
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
    },
  };
}
```

**Why this works:**
- `s-maxage=300`: Vercel CDN caches for 5 minutes
- `stale-while-revalidate=600`: Can serve stale content for up to 10 minutes while revalidating in background
- Result: Most requests served from CDN (zero Firestore reads), revalidation only when cache expires

**Read budget analysis:**

At 100 users, 10 views each/day:
- Cold requests (cache miss): 100 users × 1 query = 100 reads
- Cache hits: 900 views served from CDN = 0 reads
- **Total: 100 reads/day** (0.2% of Spark limit)

Compare to ISR:
- 100 caches × 24 revalidations/day = 2,400 reads/day
- **SSR is 24× more efficient** for profile pages

---

### Profile Data Schema

**User profile (from M10, `/users/{uid}`):**
```typescript
type UserProfile = {
  uid: string;
  username: string;           // Unique, lowercase, [a-z0-9_-]+
  displayName: string;         // User-visible name
  photoURL: string | null;     // From Firebase Auth
  createdAt: Timestamp;
  skinCount: number;           // Denormalized (updated on publish)
};
```

**Derived stats (computed at query time):**
```typescript
type ProfileStats = {
  totalSkins: number;          // Query skins collection
  totalLikes: number;          // Aggregate likeCount from all skins
  joinedDate: string;          // Format createdAt as "Joined April 2026"
};
```

**Why not denormalize totalLikes:**
- Requires updating user doc on every like (2 writes → 3 writes per like)
- At 10K likes/day, adds 10K writes (50% of Spark limit)
- Better to compute on profile load (cheap query, infrequent access)

---

### Firestore Queries

**Query 1: Get user by username**

```typescript
// lib/firebase/users.ts
import { collection, query, where, getDocs, limit } from 'firebase/firestore';

export async function getUserByUsername(username: string): Promise<UserProfile | null> {
  const q = query(
    collection(db, 'users'),
    where('username', '==', username.toLowerCase()),
    limit(1)
  );
  
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;
  
  return snapshot.docs[0].data() as UserProfile;
}
```

**Cost:** 1 read (username is unique, limit prevents over-reading)

**Index required:** Single-field index on `username` (auto-created)

---

**Query 2: Get user's skins**

```typescript
export async function getUserSkins(uid: string): Promise<SharedSkin[]> {
  const q = query(
    collection(db, 'skins'),
    where('ownerUid', '==', uid),
    orderBy('createdAt', 'desc'),
    limit(50) // Max 50 skins per profile page (pagination in Phase 3)
  );
  
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SharedSkin));
}
```

**Cost:** N reads where N = user's skin count (max 50)

**Index required:** Composite index on `(ownerUid ASC, createdAt DESC)`

**Must create in `firestore.indexes.json`:**
```json
{
  "indexes": [
    {
      "collectionGroup": "skins",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "ownerUid", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    }
  ]
}
```

---

**Query 3: Compute total likes**

```typescript
export async function getUserTotalLikes(uid: string): Promise<number> {
  const skins = await getUserSkins(uid);
  return skins.reduce((sum, skin) => sum + skin.likeCount, 0);
}
```

**Cost:** Zero additional reads (reuses skins from Query 2)

**Why no aggregation query:**
- Firestore doesn't support `SUM()` aggregation
- Must fetch all skins to sum `likeCount` fields
- Since we're already fetching for display, no extra cost

---

### SEO Implementation

**Meta tags for profile:**
```typescript
// app/u/[username]/page.tsx
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const user = await getUserByUsername(params.username);
  
  if (!user) {
    return {
      title: 'User Not Found | Skin Editor',
    };
  }
  
  const skins = await getUserSkins(user.uid);
  const totalLikes = skins.reduce((sum, s) => sum + s.likeCount, 0);
  
  return {
    title: `${user.displayName} (@${user.username}) | Skin Editor`,
    description: `View ${user.displayName}'s Minecraft skins. ${skins.length} skins created, ${totalLikes} likes received.`,
    openGraph: {
      title: `${user.displayName} on Skin Editor`,
      description: `${skins.length} skins, ${totalLikes} likes`,
      url: `https://threditor.vercel.app/u/${user.username}`,
      type: 'profile',
      images: [
        {
          url: user.photoURL || 'https://threditor.vercel.app/og-default.png',
          width: 400,
          height: 400,
        },
      ],
    },
    twitter: {
      card: 'summary',
      title: `${user.displayName} (@${user.username})`,
      description: `${skins.length} skins, ${totalLikes} likes`,
      images: [user.photoURL || 'https://threditor.vercel.app/og-default.png'],
    },
  };
}
```

**Structured data (JSON-LD):**
```typescript
export default async function ProfilePage({ params }: Props) {
  const user = await getUserByUsername(params.username);
  
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    "mainEntity": {
      "@type": "Person",
      "name": user.displayName,
      "identifier": user.username,
      "image": user.photoURL,
      "url": `https://threditor.vercel.app/u/${user.username}`,
      "memberOf": {
        "@type": "Organization",
        "name": "Skin Editor Community"
      }
    }
  };
  
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <ProfileContent user={user} skins={skins} />
    </>
  );
}
```

---

### Edit Profile Flow

**Display name update only (username change deferred to Phase 3):**

**Why defer username change:**
- Requires batch update of ALL `/skins` docs with denormalized `ownerUsername`
- User with 100 skins = 100 writes (5% of daily Spark limit)
- Requires Cloud Function trigger (not available on Spark plan)
- Phase 3 solution: Blaze plan + Cloud Function on `users/{uid}` update

**Display name update (M13):**
```typescript
// lib/firebase/users.ts
export async function updateDisplayName(uid: string, displayName: string): Promise<void> {
  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, {
    displayName: displayName.trim(),
    updatedAt: serverTimestamp(),
  });
}
```

**Cost:** 1 write

**Validation:**
- Display name: 1-50 characters
- No profanity check (deferred to Phase 3)
- Unicode allowed (international names)

---

## Implementation Units

### Unit 0: Firestore Composite Index

**Why first:**
- Query for user's skins requires composite index: `(ownerUid ASC, createdAt DESC)`
- Without index, profile page query fails immediately

**Update `firestore.indexes.json`:**

```json
{
  "indexes": [
    {
      "collectionGroup": "skins",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "likeCount", "order": "DESCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "skins",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "ownerUid", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    }
  ]
}
```

**Deploy:**
```bash
firebase deploy --only firestore:indexes --project threditor-2ea3c
```

**Verify:** Firebase Console → Firestore → Indexes → Status: "Enabled"

**Acceptance:**
- [ ] Index added to `firestore.indexes.json`
- [ ] Deployed via Firebase CLI
- [ ] Status: "Enabled" in console

---

### Unit 1: Profile Page (SSR)

Create profile page with SSR, metadata, and structured data.

See plan for full implementation details.

**Acceptance:**
- [ ] `/u/[username]` accessible without auth
- [ ] 404 page shown for non-existent users
- [ ] Meta tags populated correctly
- [ ] JSON-LD structured data present
- [ ] Cache-Control header set
- [ ] SSR confirmed (no static generation)

---

### Unit 2: ProfileHeader Component

User avatar, stats (skins, likes, join date), and edit button.

**Acceptance:**
- [ ] Avatar displays (photo or initial fallback)
- [ ] Display name and username shown
- [ ] Stats accurate (skins count, total likes)
- [ ] Join date formatted correctly
- [ ] "Edit Profile" button visible only to profile owner

---

### Unit 3: ProfileGrid Component

Grid of user's skins, reuses SkinCard from M12.

**Acceptance:**
- [ ] Reuses `SkinCard` from M12 gallery
- [ ] Grid layout matches gallery (1-4 columns responsive)
- [ ] Like functionality works
- [ ] Empty state handled by parent component

---

### Unit 4: Gallery Integration (Username Links)

Add clickable username links to gallery skin cards.

**Acceptance:**
- [ ] Username clickable in gallery skin cards
- [ ] Links to `/u/[username]`
- [ ] Hover state shows accent color
- [ ] Doesn't break existing card layout

---

### Unit 5: Edit Profile Modal

Modal for display name updates.

**Acceptance:**
- [ ] Modal opens when "Edit Profile" clicked
- [ ] Display name editable, character count shown
- [ ] Username field disabled (grayed out)
- [ ] "Save" button disabled when no changes or invalid
- [ ] Updates Firestore on save
- [ ] Page refreshes to show new display name
- [ ] Toast notification on success/error

---

## Edge Cases & Gotchas

1. **Username Case Sensitivity:** Store lowercase, query lowercase
2. **Reserved Usernames:** Block `admin`, `api`, `gallery`, `editor`, etc.
3. **Display Name XSS:** React auto-escapes (safe by default)
4. **Profile Photo Missing:** Fallback to first initial
5. **Empty Profile:** Personalized empty state
6. **Large Like Count:** Format as "10.5K" (deferred to Phase 3)
7. **SSR Cache Invalidation:** `router.refresh()` after edit

---

## Performance Targets

| Metric | Target |
|--------|--------|
| Profile page TTFB | < 800ms |
| Profile page FCP | < 1.5s |
| Edit modal open | < 100ms |
| Display name update | < 500ms |
| CDN cache hit rate | > 80% |
| Firestore reads/day | < 500 |

---

## Success Criteria

### Functional
- [ ] Profile page loads at `/u/[username]`
- [ ] User info displays correctly
- [ ] Skins grid shows user's published skins
- [ ] Like functionality works
- [ ] Edit profile updates display name
- [ ] Username links work from gallery
- [ ] 404 for non-existent users

### SEO
- [ ] Meta tags populated
- [ ] OG tags present
- [ ] JSON-LD structured data included

### UX
- [ ] Profile loads progressively
- [ ] Edit modal provides feedback
- [ ] Empty states clear
- [ ] Mobile responsive

---

## Rollout Plan

1. **Pre-deployment:** Create Firestore index
2. **Deploy:** Merge to main, Vercel auto-deploys
3. **Smoke test:** Profile URLs, edit flow, gallery links
4. **Monitor:** Firestore quota, CDN cache hit rate

---

## Compound Phase Preview

After M13, capture in COMPOUND.md:

**What Worked:**
- SSR with CDN caching (24× more efficient than ISR)
- Display name-only editing
- Component reuse (SkinCard)
- `router.refresh()` cache invalidation

**Invariants:**
- Profile pages MUST use SSR (not ISR)
- Username MUST be lowercase in DB
- Display name updates MUST call `router.refresh()`
- Total likes MUST be computed (no aggregation)

**Gotchas for M14:**
- Username change needs batch updates
- Reserved username list must expand

---

## Timeline Estimate

| Phase | Duration |
|-------|----------|
| Units 0-5 | 5 hours |
| Review | 2 hours |
| Compound | 30 min |
| **Total** | **7.5 hours** |

---

## Execution Command

```
Execute M13 (Profile Pages) using Compound Engineering methodology.

PLAN: /Users/ryan/Documents/threditor/docs/solutions/m13-profile-pages-plan.md
COMPOUND: /Users/ryan/Documents/threditor/docs/solutions/COMPOUND.md

Implement 6 units. Create PR titled "M13: Profile Pages with SSR".
```

---

*End of M13 implementation plan.*
