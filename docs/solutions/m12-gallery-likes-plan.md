# M12: Gallery + Likes — Implementation Plan

**Milestone:** M12 (Phase 2, Milestone 3)  
**Status:** Planning  
**Methodology:** Compound Engineering  
**Estimated time:** 8-10 hours (6 work + 2 review + compound)  
**Created:** 2026-04-23  
**Dependencies:** M11 (Skin Upload) deployed and verified  

---

## Executive Summary

M12 implements the public-facing discovery layer: a gallery page where anyone (authenticated or not) can browse published skins, filter by tags, sort by trending/recent, and like skins they appreciate. This is the first feature that creates network effects — users discover others' work, creators get validation through likes, and the platform becomes a destination rather than just a tool.

**Key architectural decision:** Gallery uses ISR (Incremental Static Regeneration) with 60-second revalidation to stay within Firestore's 50K reads/day Spark limit. Like toggles use optimistic UI updates with Firestore transactions for eventual consistency.

---

## Prerequisites Verification

### Required M11 Infrastructure

From COMPOUND.md M11 learnings:

- [x] Firestore `/skins` collection populated (at least 1 test skin published)
- [x] Skin documents match schema (DESIGN.md §4.1)
- [x] Tags lowercased in Firestore (enables case-insensitive filtering)
- [x] `likeCount` initialized to 0 (required for trending sort)
- [x] `ownerUsername` denormalized (enables display without user query)
- [x] Supabase Storage URLs accessible (public read policy)
- [ ] Composite index created: `(tags CONTAINS, createdAt DESC)`
- [ ] Composite index created: `(likeCount DESC, createdAt DESC)`

**CRITICAL:** Firestore composite indexes MUST be created BEFORE M12 deployment or queries fail immediately. Indexes take ~60 seconds to build after first query triggers creation.

### Production Environment

- [x] M11 deployed to `threditor.vercel.app`
- [x] Firebase Auth configured
- [x] Supabase Storage CORS enabled
- [ ] Verify at least 5-10 test skins published (for realistic gallery testing)

### Codebase State

Expected files from M11:
```
lib/
├── firebase/
│   ├── firestore.ts          # createSharedSkin, typed wrappers
│   └── client.ts             # Browser Firebase SDK
├── supabase/
│   └── storage.ts            # uploadSkinPNG, uploadOGImage
app/
├── api/
│   └── publish/route.ts      # Publish flow (M11)
└── editor/
    └── _components/
        └── PublishDialog.tsx # Publish UI (M11)
```

---

## M12 Scope

### What Users Will See

**Before M12:**
- Users can publish skins, but cannot discover others' work
- No way to see what's popular or trending
- Published skins only visible in Firebase console

**After M12:**
- `/gallery` page accessible to everyone (no auth required)
- Grid of skin cards with thumbnails (128×128)
- Tag filtering: click tag → filter by that tag
- Sort options: "Trending" (by likes) and "Recent" (by date)
- Like button on each card (auth-gated)
- Like count visible to all users
- Pagination: 20 skins per page
- Responsive: 1 column mobile, 3 columns tablet, 4 columns desktop

**Not in scope for M12:**
- User profiles (M13)
- Skin detail pages (M14)
- Search by name (Phase 3)
- Advanced filters (multiple tags, variant type) — deferred
- Infinite scroll — using pagination instead

### What Gets Built

**8 Implementation Units:**

| Unit | Component/File | Purpose |
|------|----------------|---------|
| 0 | Composite indexes | Create Firestore indexes before queries |
| 1 | Thumbnail generation | Client-side 128×128 WebP at publish time |
| 2 | `/app/gallery/page.tsx` | ISR gallery page with grid layout |
| 3 | `SkinCard.tsx` | Individual skin card component |
| 4 | `TagFilter.tsx` | Tag selection UI |
| 5 | `SortToggle.tsx` | Trending/Recent toggle |
| 6 | Like toggle logic | Firestore transaction + optimistic UI |
| 7 | Pagination | Next/Previous navigation |

**5 Test Files:**

| File | Coverage |
|------|----------|
| `tests/thumbnail.test.ts` | Thumbnail generation (size, dimensions, quality) |
| `tests/gallery-queries.test.ts` | Firestore query correctness (tag filter, sort) |
| `tests/like-toggle.test.ts` | Transaction atomicity, optimistic rollback |
| `tests/isr-cache.test.ts` | ISR revalidation behavior |
| `tests/gallery-ui.test.ts` | Component rendering, responsive layout |

---

## Technical Architecture

### ISR (Incremental Static Regeneration) Strategy

**Why ISR:**
From COMPOUND.md M9: "50K reads/day ÷ 20 skins per page = 2,500 page loads/day ceiling."

Without caching, every gallery load = 1 Firestore query (20-50 reads). At 100 concurrent users, quota exhausts in minutes.

**ISR solution:**
```typescript
// app/gallery/page.tsx
export const revalidate = 60; // Seconds

export default async function GalleryPage() {
  // This query runs ONCE per 60-second window
  const skins = await getPublishedSkins({ sort: 'recent', limit: 20 });
  return <GalleryGrid skins={skins} />;
}
```

**Cache behavior:**
- First request: Executes Firestore query, caches result for 60s
- Subsequent requests (within 60s): Serves cached HTML, zero Firestore reads
- After 60s: Next request triggers revalidation (background rebuild)
- User always sees stale-while-revalidate (fast response)

**Read budget analysis:**

At 60s revalidation:
- 1 query per minute = 1,440 queries/day
- 20 reads per query = 28,800 reads/day
- Headroom: 50K - 28.8K = 21.2K reads (for likes, profiles, etc.)

At 30s revalidation (if traffic grows):
- 2,880 queries/day × 20 reads = 57,600 reads/day
- **Exceeds Spark limit** — do not reduce below 60s

**Tag filtering breaks ISR:**

Dynamic routes like `/gallery?tag=armor` cannot use ISR (query params change per request). Two options:

**Option A (recommended):** Client-side filtering
- Fetch all recent skins via ISR
- Filter in browser by selected tag
- Pro: Zero additional reads, instant filtering
- Con: Shows max 20 skins (pagination limit)

**Option B:** Server component with dynamic query
- Each tag filter = new Firestore query
- 50 unique tags × 100 loads = 5,000 queries/day
- Pro: Can paginate filtered results
- Con: Consumes 100K reads/day (exceeds Spark)

**Decision:** Use Option A (client-side filtering) for M12. Phase 3 can add server-side tag filtering if traffic justifies Blaze plan.

---

### Thumbnail Generation

**Why not server-side:**
- Vercel Hobby has no serverless functions (same M11 constraint)
- Client-side generation at publish time is $0

**Reuse M11 OG rendering pattern:**
```typescript
// lib/editor/thumbnail.ts
export async function generateThumbnail(
  texture: THREE.CanvasTexture,
  variant: SkinVariant
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true, // From M11 COMPOUND
  });
  renderer.setSize(128, 128);
  
  // Reuse M11 lighting setup (key + fill + back + ambient)
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a0a);
  
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
  keyLight.position.set(5, 5, 5);
  scene.add(keyLight);
  
  const fillLight = new THREE.DirectionalLight(0xaaccff, 0.4);
  fillLight.position.set(-3, 2, 4);
  scene.add(fillLight);
  
  const backLight = new THREE.DirectionalLight(0xffffff, 0.6);
  backLight.position.set(0, 3, -5);
  scene.add(backLight);
  
  scene.add(new THREE.AmbientLight(0xffffff, 0.3));
  
  // Same 3/4 isometric camera as OG
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(2.5, 1.5, 3.5);
  camera.lookAt(0, 0.8, 0);
  
  scene.add(buildPlayerModelMesh(texture, variant));
  renderer.render(scene, camera);
  
  // WebP at 0.75 quality (smaller than OG's 0.85)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => b ? resolve(b) : reject(new Error('Thumbnail encoding failed')),
      'image/webp',
      0.75 // Lower quality than OG (10-20 KB target)
    );
  });
  
  // CRITICAL: Dispose to prevent memory leaks (from M11 COMPOUND)
  renderer.dispose();
  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      if (Array.isArray(obj.material)) {
        obj.material.forEach(m => m.dispose());
      } else {
        obj.material.dispose();
      }
    }
  });
  
  return blob;
}
```

**Performance target:**
- M11 OG (1200×630): 390ms average
- M12 thumbnail (128×128): **~80ms average** (16x fewer pixels)

**Size target:**
- M11 OG: 125 KB average
- M12 thumbnail: **10-20 KB target** (lower resolution + 0.75 quality)

**Integration with M11 publish flow:**

```typescript
// app/api/publish/route.ts (modify M11 code)
export async function POST(req: NextRequest) {
  // ... existing M11 validation ...
  
  // Generate OG (M11)
  const ogBlob = base64ToBlob(body.ogData, 'image/webp');
  
  // NEW: Generate thumbnail (M12)
  const thumbnailBlob = base64ToBlob(body.thumbnailData, 'image/webp');
  
  // Upload all three files in parallel
  const [storageRef, ogImageRef, thumbnailRef] = await Promise.all([
    uploadSkinPNG(uid, skinId, skinBlob),
    uploadOGImage(skinId, ogBlob),
    uploadThumbnail(skinId, thumbnailBlob), // NEW
  ]);
  
  // Update Firestore doc
  await createSharedSkin(skinId, uid, {
    // ... existing fields ...
    thumbnailRef, // NEW (was empty placeholder in M11)
  });
  
  return NextResponse.json({ skinId, publicUrl: storageRef, ogUrl: ogImageRef });
}
```

**Storage path:**
```
thumbnails/{skinId}.webp
```

**Why not in user folder:**
- Thumbnails are public (like OG images)
- User folder path: `skins/{uid}/{skinId}.png` (for actual skins only)
- Flat thumbnail structure simplifies CDN caching

---

### Like Toggle Transaction

From DESIGN.md §11.4:

```typescript
// lib/firebase/likes.ts
import { doc, runTransaction, increment, serverTimestamp } from 'firebase/firestore';
import { db } from './client';

export async function toggleLike(skinId: string, uid: string): Promise<boolean> {
  const likeRef = doc(db, 'likes', `${skinId}_${uid}`);
  const skinRef = doc(db, 'skins', skinId);
  
  return await runTransaction(db, async (tx) => {
    const likeDoc = await tx.get(likeRef);
    
    if (likeDoc.exists()) {
      // Unlike: delete like doc, decrement counter
      tx.delete(likeRef);
      tx.update(skinRef, { likeCount: increment(-1) });
      return false; // Now unliked
    } else {
      // Like: create like doc, increment counter
      tx.set(likeRef, {
        skinId,
        uid,
        createdAt: serverTimestamp(),
      });
      tx.update(skinRef, { likeCount: increment(1) });
      return true; // Now liked
    }
  });
}

export async function checkIfLiked(skinId: string, uid: string): Promise<boolean> {
  const likeDoc = await getDoc(doc(db, 'likes', `${skinId}_${uid}`));
  return likeDoc.exists();
}
```

**Transaction guarantees:**
- Like doc + counter update are atomic
- Concurrent likes don't cause counter drift
- Auto-retry with exponential backoff (Firestore built-in)

**Cost per toggle:**
- 2 reads (like doc + skin doc)
- 2 writes (like doc + skin counter update)
- At Spark limits: 10K toggles/day max (20K writes ÷ 2)

**Optimistic UI pattern:**

```typescript
// app/gallery/_components/SkinCard.tsx
'use client';

export function SkinCard({ skin, initialLiked }: Props) {
  const [liked, setLiked] = useState(initialLiked);
  const [likeCount, setLikeCount] = useState(skin.likeCount);
  const [isToggling, setIsToggling] = useState(false);
  const { user } = useAuth();
  
  async function handleToggle() {
    if (!user) {
      toast.error('Sign in to like skins');
      return;
    }
    
    // Optimistic update
    setLiked(prev => !prev);
    setLikeCount(prev => liked ? prev - 1 : prev + 1);
    setIsToggling(true);
    
    try {
      const newLikedState = await toggleLike(skin.id, user.uid);
      
      // Server confirms, update to match (handles race conditions)
      setLiked(newLikedState);
      
      // Fetch latest count from server (in case of concurrent likes)
      const skinDoc = await getDoc(doc(db, 'skins', skin.id));
      setLikeCount(skinDoc.data()?.likeCount || 0);
      
    } catch (error) {
      // Rollback optimistic update
      setLiked(prev => !prev);
      setLikeCount(prev => liked ? prev + 1 : prev - 1);
      toast.error('Failed to update like');
    } finally {
      setIsToggling(false);
    }
  }
  
  return (
    <button
      onClick={handleToggle}
      disabled={isToggling}
      className={liked ? 'text-accent' : 'text-text-muted'}
    >
      <HeartIcon className={liked ? 'fill-current' : ''} />
      <span>{likeCount}</span>
    </button>
  );
}
```

**Why fetch count after toggle:**
- User A likes → count = 1
- User B likes (concurrently) → count = 2
- User A's optimistic UI shows 1 (wrong)
- After server response: re-fetch shows 2 (correct)

---

### Firestore Queries

**Query 1: Recent skins (default sort)**

```typescript
// lib/firebase/gallery.ts
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';

export async function getRecentSkins(count: number = 20) {
  const q = query(
    collection(db, 'skins'),
    orderBy('createdAt', 'desc'),
    limit(count)
  );
  
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}
```

**Cost:** 20 reads (1 per skin)

**Index required:** Single-field index on `createdAt` (auto-created by Firestore)

---

**Query 2: Trending skins (sort by likes)**

```typescript
export async function getTrendingSkins(count: number = 20) {
  const q = query(
    collection(db, 'skins'),
    orderBy('likeCount', 'desc'),
    orderBy('createdAt', 'desc'), // Tie-breaker for same like count
    limit(count)
  );
  
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}
```

**Cost:** 20 reads

**Index required:** Composite index on `(likeCount DESC, createdAt DESC)`

**Must create via Firebase Console or `firestore.indexes.json`:**

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
    }
  ]
}
```

Deploy via:
```bash
firebase deploy --only firestore:indexes
```

---

**Query 3: Filter by tag (client-side)**

```typescript
// app/gallery/page.tsx
'use client';

export function GalleryClient({ initialSkins }: Props) {
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  
  const filteredSkins = selectedTag
    ? initialSkins.filter(skin => skin.tags.includes(selectedTag))
    : initialSkins;
  
  return (
    <>
      <TagFilter
        tags={extractUniqueTags(initialSkins)}
        selected={selectedTag}
        onSelect={setSelectedTag}
      />
      <GalleryGrid skins={filteredSkins} />
    </>
  );
}
```

**Cost:** Zero additional Firestore reads (filters in-memory)

**Limitation:** Can only filter within current page (20 skins). If user wants "all armor skins across all pages", requires server-side query (Phase 3).

---

**Query 4: Filter by tag (server-side, deferred to Phase 3)**

```typescript
// Phase 3 only (if Blaze plan adopted)
export async function getSkinsByTag(tag: string, count: number = 20) {
  const q = query(
    collection(db, 'skins'),
    where('tags', 'array-contains', tag.toLowerCase()),
    orderBy('createdAt', 'desc'),
    limit(count)
  );
  
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}
```

**Cost:** 20 reads per query

**Index required:** Composite index on `(tags CONTAINS, createdAt DESC)`

**Problem:** Each unique tag = separate query. 50 tags × 100 loads = 5,000 queries = 100K reads/day (exceeds Spark).

**Solution:** Defer to Phase 3 when Blaze plan enables unlimited reads.

---

### Pagination Strategy

**Two approaches considered:**

**Option A: Cursor-based pagination**
```typescript
const q = query(
  collection(db, 'skins'),
  orderBy('createdAt', 'desc'),
  startAfter(lastDoc), // Cursor from previous page
  limit(20)
);
```

**Pro:** Consistent results (no duplicates/gaps if data changes mid-pagination)  
**Con:** ISR breaks cursor continuity (cached page has stale cursor)

**Option B: Offset-based pagination**
```typescript
const q = query(
  collection(db, 'skins'),
  orderBy('createdAt', 'desc'),
  limit(20),
  offset(page * 20) // Skip first N results
);
```

**Pro:** Works with ISR (page number is static)  
**Con:** Firestore charges for skipped documents (offset 40 = 60 reads for 20 results)

**Decision:** Use **client-side pagination** (Option C):

```typescript
// app/gallery/page.tsx
export default async function GalleryPage() {
  // Fetch 100 skins once (ISR cached)
  const allSkins = await getRecentSkins(100);
  
  return <GalleryClient initialSkins={allSkins} />;
}

// Client component handles pagination
function GalleryClient({ initialSkins }: Props) {
  const [page, setPage] = useState(0);
  const pageSize = 20;
  
  const paginatedSkins = initialSkins.slice(
    page * pageSize,
    (page + 1) * pageSize
  );
  
  return (
    <>
      <GalleryGrid skins={paginatedSkins} />
      <Pagination
        current={page}
        total={Math.ceil(initialSkins.length / pageSize)}
        onPageChange={setPage}
      />
    </>
  );
}
```

**Cost:**
- 100 reads once per 60 seconds (ISR)
- 1,440 queries/day × 100 reads = 144K reads/day
- **Exceeds Spark limit**

**Revised decision:** Fetch only 60 skins, paginate client-side into 3 pages (20 each):

- 60 reads once per 60 seconds
- 1,440 queries/day × 60 reads = 86,400 reads/day
- Still exceeds Spark (50K/day)

**Final decision:** Fetch 20 skins, **no pagination in M12**. Phase 3 adds infinite scroll with cursor-based queries (requires Blaze plan).

**M12 gallery:** Single page, 20 most recent skins, refreshes every 60s.

---

## Implementation Units

### Unit 0: Firestore Composite Indexes

**Why first:**
- Indexes take ~60 seconds to build after first query
- Deployment will fail if indexes missing
- Must create BEFORE any code that uses these queries

**Create index file:**

```json
// firestore.indexes.json
{
  "indexes": [
    {
      "collectionGroup": "skins",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "likeCount", "order": "DESCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

**Deploy:**
```bash
firebase deploy --only firestore:indexes --project threditor-2ea3c
```

**Verify:**
- Navigate to: https://console.firebase.google.com/project/threditor-2ea3c/firestore/indexes
- Confirm index status: "Enabled" (not "Building")
- If "Building": wait 60 seconds, refresh

**Acceptance:**
- [ ] `firestore.indexes.json` created in project root
- [ ] Index deployed via Firebase CLI
- [ ] Index status: "Enabled" in Firebase Console

---

### Unit 1: Thumbnail Generation

**Modify M11 publish flow to generate thumbnails at publish time.**

**File:** `lib/editor/thumbnail.ts`

```typescript
import * as THREE from 'three';
import { SkinVariant } from './types';
import { buildPlayerModelMesh } from '@/lib/three/PlayerModel';

const THUMBNAIL_SIZE = 128;

export async function generateThumbnail(
  texture: THREE.CanvasTexture,
  variant: SkinVariant
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = THUMBNAIL_SIZE;
  canvas.height = THUMBNAIL_SIZE;
  
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true, // CRITICAL from M11 COMPOUND
  });
  renderer.setSize(THUMBNAIL_SIZE, THUMBNAIL_SIZE);
  
  // Reuse M11 lighting (from COMPOUND.md)
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a0a);
  
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
  keyLight.position.set(5, 5, 5);
  scene.add(keyLight);
  
  const fillLight = new THREE.DirectionalLight(0xaaccff, 0.4);
  fillLight.position.set(-3, 2, 4);
  scene.add(fillLight);
  
  const backLight = new THREE.DirectionalLight(0xffffff, 0.6);
  backLight.position.set(0, 3, -5);
  scene.add(backLight);
  
  scene.add(new THREE.AmbientLight(0xffffff, 0.3));
  
  // Same camera as OG
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(2.5, 1.5, 3.5);
  camera.lookAt(0, 0.8, 0);
  
  scene.add(buildPlayerModelMesh(texture, variant));
  renderer.render(scene, camera);
  
  // Lower quality than OG (0.85 → 0.75)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => b ? resolve(b) : reject(new Error('Thumbnail encoding failed')),
      'image/webp',
      0.75
    );
  });
  
  // Dispose (from M11 COMPOUND memory leak section)
  renderer.dispose();
  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      if (Array.isArray(obj.material)) {
        obj.material.forEach(m => m.dispose());
      } else {
        obj.material.dispose();
      }
    }
  });
  
  return blob;
}
```

**Update PublishDialog:**

```typescript
// app/editor/_components/PublishDialog.tsx
async function handlePublish() {
  // ... existing validation ...
  
  setIsPublishing(true);
  try {
    // Generate OG (M11)
    const ogBlob = await generateOGImage(texture, variant);
    
    // NEW: Generate thumbnail (M12)
    const thumbnailBlob = await generateThumbnail(texture, variant);
    
    const skinBlob = await textureManager.exportPNG();
    
    const [skinData, ogData, thumbnailData] = await Promise.all([
      blobToBase64(skinBlob),
      blobToBase64(ogBlob),
      blobToBase64(thumbnailBlob), // NEW
    ]);
    
    const response = await fetch('/api/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skinData,
        ogData,
        thumbnailData, // NEW
        name: metadata.name,
        variant,
        tags: metadata.tags,
      }),
    });
    
    // ... rest unchanged ...
  } finally {
    setIsPublishing(false);
  }
}
```

**Update API route:**

```typescript
// app/api/publish/route.ts
export async function POST(req: NextRequest) {
  // ... existing auth/validation ...
  
  const { skinData, ogData, thumbnailData, name, variant, tags } = body;
  
  const skinBlob = base64ToBlob(skinData, 'image/png');
  const ogBlob = base64ToBlob(ogData, 'image/webp');
  const thumbnailBlob = base64ToBlob(thumbnailData, 'image/webp'); // NEW
  
  // Validate thumbnail size
  const MAX_THUMBNAIL_SIZE = 50 * 1024; // 50 KB
  if (thumbnailBlob.size > MAX_THUMBNAIL_SIZE) {
    return NextResponse.json(
      { error: 'Thumbnail exceeds 50 KB limit' },
      { status: 413 }
    );
  }
  
  const skinId = nanoid();
  
  // Upload all three in parallel
  const [storageRef, ogImageRef, thumbnailRef] = await Promise.all([
    uploadSkinPNG(uid, skinId, skinBlob),
    uploadOGImage(skinId, ogBlob),
    uploadThumbnail(skinId, thumbnailBlob), // NEW
  ]);
  
  await createSharedSkin(skinId, uid, {
    name: name.trim(),
    variant,
    storageRef,
    ogImageRef,
    thumbnailRef, // NEW (was empty in M11)
    tags,
  });
  
  return NextResponse.json({ skinId, publicUrl: storageRef });
}
```

**Add Storage upload helper:**

```typescript
// lib/supabase/storage.ts
export async function uploadThumbnail(
  skinId: string,
  blob: Blob
): Promise<string> {
  const path = `thumbnails/${skinId}.webp`;
  
  const { error } = await supabase.storage
    .from('skins')
    .upload(path, blob, {
      contentType: 'image/webp',
      upsert: false,
    });
  
  if (error) throw new Error(`Thumbnail upload failed: ${error.message}`);
  
  const { data: urlData } = supabase.storage
    .from('skins')
    .getPublicUrl(path);
  
  return urlData.publicUrl;
}
```

**Update Storage policy:**

```sql
-- storage.rules
-- Add thumbnail path to existing policy
match /thumbnails/{skinId}.webp {
  allow read: if true;
  allow write: if request.auth != null
               && request.resource.size < 50 * 1024
               && request.resource.contentType == 'image/webp';
}
```

**Acceptance:**
- [ ] `generateThumbnail` function created
- [ ] PublishDialog calls thumbnail generation
- [ ] API route accepts `thumbnailData`
- [ ] Storage helper uploads to `thumbnails/{skinId}.webp`
- [ ] Firestore `thumbnailRef` field populated
- [ ] Thumbnail size < 50 KB
- [ ] Publish flow time increase < 200ms (thumbnail generation ~80ms)

---

### Unit 2: Gallery Page (ISR)

**File:** `app/gallery/page.tsx`

```typescript
import { getRecentSkins } from '@/lib/firebase/gallery';
import { GalleryGrid } from './_components/GalleryGrid';
import { SortToggle } from './_components/SortToggle';

// ISR configuration (CRITICAL for Spark quota)
export const revalidate = 60; // Seconds

export const metadata = {
  title: 'Gallery | Skin Editor',
  description: 'Discover and like community-created Minecraft skins',
};

export default async function GalleryPage() {
  // This query runs once per 60-second window
  const skins = await getRecentSkins(20);
  
  return (
    <main className="min-h-screen bg-canvas">
      <div className="max-w-7xl mx-auto px-4 py-12">
        <header className="mb-8">
          <h1 className="text-4xl font-bold text-text-primary mb-2">
            Community Gallery
          </h1>
          <p className="text-text-secondary">
            Discover skins created by the community
          </p>
        </header>
        
        <div className="mb-6">
          <SortToggle />
        </div>
        
        <GalleryGrid skins={skins} />
        
        {skins.length === 0 && (
          <div className="text-center py-16">
            <p className="text-text-muted text-lg">
              No skins published yet. Be the first!
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
```

**Gallery query helper:**

```typescript
// lib/firebase/gallery.ts
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from './client';
import { SharedSkin } from './types';

export async function getRecentSkins(count: number = 20): Promise<SharedSkin[]> {
  const q = query(
    collection(db, 'skins'),
    orderBy('createdAt', 'desc'),
    limit(count)
  );
  
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
  } as SharedSkin));
}

export async function getTrendingSkins(count: number = 20): Promise<SharedSkin[]> {
  const q = query(
    collection(db, 'skins'),
    orderBy('likeCount', 'desc'),
    orderBy('createdAt', 'desc'), // Tie-breaker
    limit(count)
  );
  
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
  } as SharedSkin));
}
```

**Acceptance:**
- [ ] `/gallery` page accessible without auth
- [ ] ISR `revalidate: 60` configured
- [ ] Firestore query executes server-side
- [ ] Empty state shows when no skins
- [ ] Metadata tags present (SEO)

---

### Unit 3: SkinCard Component

**File:** `app/gallery/_components/SkinCard.tsx`

```typescript
'use client';

import { useState } from 'react';
import Image from 'next/image';
import { HeartIcon } from 'lucide-react';
import { useAuth } from '@/lib/firebase/auth';
import { toggleLike } from '@/lib/firebase/likes';
import { getDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { toast } from 'sonner';
import type { SharedSkin } from '@/lib/firebase/types';

type Props = {
  skin: SharedSkin;
  initialLiked: boolean;
};

export function SkinCard({ skin, initialLiked }: Props) {
  const [liked, setLiked] = useState(initialLiked);
  const [likeCount, setLikeCount] = useState(skin.likeCount);
  const [isToggling, setIsToggling] = useState(false);
  const { user } = useAuth();
  
  async function handleToggle() {
    if (!user) {
      toast.error('Sign in to like skins');
      return;
    }
    
    // Optimistic update
    const wasLiked = liked;
    setLiked(!liked);
    setLikeCount(prev => wasLiked ? prev - 1 : prev + 1);
    setIsToggling(true);
    
    try {
      await toggleLike(skin.id, user.uid);
      
      // Sync with server (handles concurrent likes)
      const skinDoc = await getDoc(doc(db, 'skins', skin.id));
      const serverCount = skinDoc.data()?.likeCount || 0;
      setLikeCount(serverCount);
      
    } catch (error) {
      // Rollback optimistic update
      setLiked(wasLiked);
      setLikeCount(prev => wasLiked ? prev + 1 : prev - 1);
      toast.error('Failed to update like');
    } finally {
      setIsToggling(false);
    }
  }
  
  return (
    <div className="group relative bg-ui-surface rounded-lg overflow-hidden border border-ui-border hover:border-accent transition-colors">
      {/* Thumbnail */}
      <div className="aspect-square bg-ui-base relative">
        <Image
          src={skin.thumbnailRef}
          alt={skin.name}
          fill
          className="object-cover"
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 33vw, 25vw"
        />
      </div>
      
      {/* Info */}
      <div className="p-4">
        <h3 className="text-lg font-semibold text-text-primary mb-1 truncate">
          {skin.name}
        </h3>
        
        <p className="text-sm text-text-secondary mb-3">
          by {skin.ownerUsername}
        </p>
        
        {/* Tags */}
        {skin.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {skin.tags.slice(0, 3).map(tag => (
              <span
                key={tag}
                className="px-2 py-1 text-xs bg-ui-base rounded text-text-muted"
              >
                {tag}
              </span>
            ))}
            {skin.tags.length > 3 && (
              <span className="px-2 py-1 text-xs text-text-muted">
                +{skin.tags.length - 3}
              </span>
            )}
          </div>
        )}
        
        {/* Like button */}
        <button
          onClick={handleToggle}
          disabled={isToggling}
          className={`flex items-center gap-2 transition-colors ${
            liked ? 'text-accent' : 'text-text-muted hover:text-text-secondary'
          }`}
          aria-label={liked ? 'Unlike' : 'Like'}
        >
          <HeartIcon
            className={`w-5 h-5 ${liked ? 'fill-current' : ''}`}
          />
          <span className="text-sm font-medium">{likeCount}</span>
        </button>
      </div>
    </div>
  );
}
```

**Grid component:**

```typescript
// app/gallery/_components/GalleryGrid.tsx
'use client';

import { SkinCard } from './SkinCard';
import { useAuth } from '@/lib/firebase/auth';
import { useEffect, useState } from 'react';
import { checkIfLiked } from '@/lib/firebase/likes';
import type { SharedSkin } from '@/lib/firebase/types';

type Props = {
  skins: SharedSkin[];
};

export function GalleryGrid({ skins }: Props) {
  const { user } = useAuth();
  const [likedMap, setLikedMap] = useState<Record<string, boolean>>({});
  
  // Fetch user's likes on mount
  useEffect(() => {
    if (!user) return;
    
    async function fetchLikes() {
      const checks = await Promise.all(
        skins.map(skin => checkIfLiked(skin.id, user!.uid))
      );
      
      const map: Record<string, boolean> = {};
      skins.forEach((skin, i) => {
        map[skin.id] = checks[i];
      });
      setLikedMap(map);
    }
    
    fetchLikes();
  }, [user, skins]);
  
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {skins.map(skin => (
        <SkinCard
          key={skin.id}
          skin={skin}
          initialLiked={likedMap[skin.id] || false}
        />
      ))}
    </div>
  );
}
```

**Like helpers:**

```typescript
// lib/firebase/likes.ts
import { doc, runTransaction, increment, serverTimestamp, getDoc } from 'firebase/firestore';
import { db } from './client';

export async function toggleLike(skinId: string, uid: string): Promise<void> {
  const likeRef = doc(db, 'likes', `${skinId}_${uid}`);
  const skinRef = doc(db, 'skins', skinId);
  
  await runTransaction(db, async (tx) => {
    const likeDoc = await tx.get(likeRef);
    
    if (likeDoc.exists()) {
      tx.delete(likeRef);
      tx.update(skinRef, { likeCount: increment(-1) });
    } else {
      tx.set(likeRef, {
        skinId,
        uid,
        createdAt: serverTimestamp(),
      });
      tx.update(skinRef, { likeCount: increment(1) });
    }
  });
}

export async function checkIfLiked(skinId: string, uid: string): Promise<boolean> {
  const likeDoc = await getDoc(doc(db, 'likes', `${skinId}_${uid}`));
  return likeDoc.exists();
}
```

**Acceptance:**
- [ ] Card displays thumbnail, name, username, tags, like count
- [ ] Like button shows filled heart when liked
- [ ] Clicking like toggles state optimistically
- [ ] Transaction updates Firestore atomically
- [ ] Concurrent likes sync correctly
- [ ] Non-authenticated users see "Sign in" toast
- [ ] Responsive: 1 col mobile, 2 tablet, 3-4 desktop

---

### Unit 4: Tag Filter (Client-Side)

**File:** `app/gallery/_components/TagFilter.tsx`

```typescript
'use client';

import { useState } from 'react';

type Props = {
  tags: string[];
  onSelect: (tag: string | null) => void;
};

export function TagFilter({ tags, onSelect }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  
  function handleClick(tag: string) {
    const newSelection = selected === tag ? null : tag;
    setSelected(newSelection);
    onSelect(newSelection);
  }
  
  return (
    <div className="flex flex-wrap gap-2">
      <span className="text-sm text-text-secondary self-center">
        Filter by tag:
      </span>
      
      {tags.map(tag => (
        <button
          key={tag}
          onClick={() => handleClick(tag)}
          className={`px-3 py-1.5 rounded text-sm transition-colors ${
            selected === tag
              ? 'bg-accent text-canvas'
              : 'bg-ui-surface text-text-secondary hover:bg-ui-border'
          }`}
        >
          {tag}
        </button>
      ))}
      
      {selected && (
        <button
          onClick={() => handleClick(selected)}
          className="px-3 py-1.5 text-sm text-accent hover:underline"
        >
          Clear filter
        </button>
      )}
    </div>
  );
}
```

**Update gallery page to use filter:**

```typescript
// app/gallery/page.tsx (client component wrapper)
'use client';

import { useState } from 'react';
import { TagFilter } from './_components/TagFilter';
import { GalleryGrid } from './_components/GalleryGrid';
import type { SharedSkin } from '@/lib/firebase/types';

export function GalleryClient({ initialSkins }: { initialSkins: SharedSkin[] }) {
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  
  // Extract unique tags
  const allTags = [...new Set(initialSkins.flatMap(skin => skin.tags))].sort();
  
  // Filter skins client-side
  const filteredSkins = selectedTag
    ? initialSkins.filter(skin => skin.tags.includes(selectedTag))
    : initialSkins;
  
  return (
    <>
      {allTags.length > 0 && (
        <div className="mb-6">
          <TagFilter tags={allTags} onSelect={setSelectedTag} />
        </div>
      )}
      
      <GalleryGrid skins={filteredSkins} />
      
      {filteredSkins.length === 0 && selectedTag && (
        <div className="text-center py-16">
          <p className="text-text-muted text-lg">
            No skins found with tag "{selectedTag}"
          </p>
        </div>
      )}
    </>
  );
}
```

**Wrap server component:**

```typescript
// app/gallery/page.tsx
export default async function GalleryPage() {
  const skins = await getRecentSkins(20);
  
  return (
    <main className="min-h-screen bg-canvas">
      <div className="max-w-7xl mx-auto px-4 py-12">
        {/* ... header ... */}
        
        <GalleryClient initialSkins={skins} />
      </div>
    </main>
  );
}
```

**Acceptance:**
- [ ] Tags extracted from all skins
- [ ] Clicking tag filters grid (client-side)
- [ ] Selected tag highlighted
- [ ] "Clear filter" button appears when filtered
- [ ] Empty state shows when no matches
- [ ] Zero additional Firestore reads

---

### Unit 5: Sort Toggle

**File:** `app/gallery/_components/SortToggle.tsx`

```typescript
'use client';

import { useRouter, useSearchParams } from 'next/navigation';

export function SortToggle() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentSort = searchParams.get('sort') || 'recent';
  
  function handleSort(sort: 'recent' | 'trending') {
    const params = new URLSearchParams(searchParams);
    params.set('sort', sort);
    router.push(`/gallery?${params.toString()}`);
  }
  
  return (
    <div className="flex gap-2">
      <button
        onClick={() => handleSort('recent')}
        className={`px-4 py-2 rounded transition-colors ${
          currentSort === 'recent'
            ? 'bg-accent text-canvas'
            : 'bg-ui-surface text-text-secondary hover:bg-ui-border'
        }`}
      >
        Recent
      </button>
      
      <button
        onClick={() => handleSort('trending')}
        className={`px-4 py-2 rounded transition-colors ${
          currentSort === 'trending'
            ? 'bg-accent text-canvas'
            : 'bg-ui-surface text-text-secondary hover:bg-ui-border'
        }`}
      >
        Trending
      </button>
    </div>
  );
}
```

**Update gallery server component to handle sort:**

```typescript
// app/gallery/page.tsx
export default async function GalleryPage({
  searchParams,
}: {
  searchParams: { sort?: string };
}) {
  const sort = searchParams.sort || 'recent';
  
  const skins = sort === 'trending'
    ? await getTrendingSkins(20)
    : await getRecentSkins(20);
  
  return (
    <main className="min-h-screen bg-canvas">
      <div className="max-w-7xl mx-auto px-4 py-12">
        {/* ... header ... */}
        
        <div className="mb-6">
          <SortToggle />
        </div>
        
        <GalleryClient initialSkins={skins} />
      </div>
    </main>
  );
}
```

**CRITICAL: ISR with query params**

Problem: `/gallery?sort=trending` and `/gallery?sort=recent` are different cache keys. Each creates separate ISR entry.

Solution: Both queries share same 60s revalidation, so 2× the reads:
- Recent query: 1,440/day × 20 reads = 28,800
- Trending query: 1,440/day × 20 reads = 28,800
- **Total: 57,600 reads/day** (exceeds Spark 50K)

Mitigation:
- Increase revalidation to 90s: 960 queries/day × 2 sorts × 20 reads = 38,400 reads/day (within Spark)
- OR: Remove trending sort (M12 ships with "Recent" only, trending deferred to M13)

**Decision:** Ship M12 with "Recent" only. Add "Trending" in M13 when traffic justifies longer revalidation.

**Acceptance:**
- [ ] Sort toggle displays "Recent" and "Trending" buttons
- [ ] Clicking toggle updates URL query param
- [ ] Server component fetches correct query based on param
- [ ] ISR caches each sort separately (2× reads documented)

---

### Unit 6: Like Toggle Integration Test

**File:** `tests/like-toggle.test.ts`

```typescript
import { describe, test, expect, beforeEach } from 'vitest';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { toggleLike, checkIfLiked } from '@/lib/firebase/likes';
import { nanoid } from 'nanoid';

describe('Like Toggle', () => {
  const testSkinId = nanoid();
  const testUid = 'test-user-123';
  
  beforeEach(async () => {
    // Create test skin document
    await setDoc(doc(db, 'skins', testSkinId), {
      id: testSkinId,
      name: 'Test Skin',
      likeCount: 0,
      // ... other required fields ...
    });
  });
  
  test('toggles like from unliked to liked', async () => {
    const initialLiked = await checkIfLiked(testSkinId, testUid);
    expect(initialLiked).toBe(false);
    
    await toggleLike(testSkinId, testUid);
    
    const finalLiked = await checkIfLiked(testSkinId, testUid);
    expect(finalLiked).toBe(true);
    
    const skinDoc = await getDoc(doc(db, 'skins', testSkinId));
    expect(skinDoc.data()?.likeCount).toBe(1);
  });
  
  test('toggles like from liked to unliked', async () => {
    // Like first
    await toggleLike(testSkinId, testUid);
    
    // Unlike
    await toggleLike(testSkinId, testUid);
    
    const finalLiked = await checkIfLiked(testSkinId, testUid);
    expect(finalLiked).toBe(false);
    
    const skinDoc = await getDoc(doc(db, 'skins', testSkinId));
    expect(skinDoc.data()?.likeCount).toBe(0);
  });
  
  test('concurrent likes increment counter correctly', async () => {
    const uid1 = 'user-1';
    const uid2 = 'user-2';
    const uid3 = 'user-3';
    
    // Three users like simultaneously
    await Promise.all([
      toggleLike(testSkinId, uid1),
      toggleLike(testSkinId, uid2),
      toggleLike(testSkinId, uid3),
    ]);
    
    const skinDoc = await getDoc(doc(db, 'skins', testSkinId));
    expect(skinDoc.data()?.likeCount).toBe(3);
  });
  
  test('transaction retries on conflict', async () => {
    // Simulate conflict by rapid toggles
    const promises = Array(10).fill(null).map(() => 
      toggleLike(testSkinId, testUid)
    );
    
    await Promise.all(promises);
    
    // Final state should be consistent (either liked or unliked, not both)
    const finalLiked = await checkIfLiked(testSkinId, testUid);
    const skinDoc = await getDoc(doc(db, 'skins', testSkinId));
    const likeCount = skinDoc.data()?.likeCount || 0;
    
    if (finalLiked) {
      expect(likeCount).toBeGreaterThanOrEqual(1);
    } else {
      expect(likeCount).toBe(0);
    }
  });
});
```

**Acceptance:**
- [ ] Like toggle works (unliked → liked)
- [ ] Unlike toggle works (liked → unliked)
- [ ] Counter increments atomically
- [ ] Concurrent likes handled correctly
- [ ] Transaction retries resolve conflicts

---

### Unit 7: Production Deployment

**Pre-deployment checklist:**

1. **Firestore indexes created:**
   ```bash
   firebase deploy --only firestore:indexes --project threditor-2ea3c
   ```
   Verify: https://console.firebase.google.com/project/threditor-2ea3c/firestore/indexes

2. **Storage policy updated:**
   ```bash
   firebase deploy --only storage --project threditor-2ea3c
   ```
   Verify thumbnail path allowed in policy

3. **Test skins published:**
   - Manually publish 5-10 test skins via editor
   - Verify thumbnails generated and uploaded
   - Verify Firestore docs created with `thumbnailRef`

4. **Environment variables verified:**
   - Vercel dashboard → Settings → Environment Variables
   - All Firebase + Supabase vars present

5. **Build locally:**
   ```bash
   npm run build
   ```
   Check bundle size: `.next/static/chunks/app/gallery/page-*.js` should be < 150 KB

**Deploy:**
```bash
git add .
git commit -m "M12: Gallery + Likes with ISR"
git push origin main
# Vercel auto-deploys
```

**Smoke test:**

Navigate to: `https://threditor.vercel.app/gallery`

Verify:
- [ ] Page loads without errors
- [ ] Skins display in grid
- [ ] Thumbnails load (check Network tab)
- [ ] Like button toggles (if signed in)
- [ ] Like count updates optimistically
- [ ] ISR cache header present: `x-vercel-cache: HIT` (after 2nd load)
- [ ] Sort toggle switches between Recent/Trending
- [ ] Tag filter works client-side
- [ ] Responsive layout: 1 col mobile, 3-4 desktop

**Rollback plan:**
```bash
vercel rollback
```

**Acceptance:**
- [ ] Gallery deployed to production
- [ ] ISR working (cache hit on 2nd load)
- [ ] Firestore queries succeed
- [ ] Thumbnails display
- [ ] Like toggle functional
- [ ] No console errors
- [ ] Mobile responsive

---

## Edge Cases & Gotchas

### 1. ISR Cache Invalidation

**Problem:** User publishes new skin → gallery still shows old 20 skins for up to 60 seconds.

**Mitigation:**
- Publish success toast: "Skin published! It may take up to 1 minute to appear in gallery."
- Phase 3: On-demand revalidation via `revalidatePath('/gallery')` in publish API route

**Acceptable for M12:** 60-second delay is tolerable for MVP.

---

### 2. Like Count Desyncs

**Problem:** User A likes → count shows 1. User B likes (concurrent) → count stays 1 (stale). After refresh: count shows 2.

**Mitigation:**
- Optimistic UI shows immediate feedback
- After transaction: re-fetch count from server
- `SkinCard` syncs with server count post-toggle

**Confirmed in Unit 3 implementation.**

---

### 3. Thumbnail Generation Failure

**Problem:** WebGL context loss during thumbnail generation → publish fails.

**Mitigation:**
```typescript
try {
  const thumbnail = await generateThumbnail(texture, variant);
} catch (error) {
  console.error('Thumbnail generation failed:', error);
  
  // Fallback: Use OG image resized (acceptable degradation)
  const fallbackThumbnail = await resizeOGToThumbnail(ogBlob);
  
  // OR: Publish without thumbnail (gallery shows placeholder)
  const thumbnailRef = '';
}
```

**Decision for M12:** If thumbnail fails, publish without it. Gallery shows generic placeholder icon.

---

### 4. Empty Gallery State

**Problem:** Zero skins published → gallery page is blank.

**Mitigation:** Empty state UI (already in Unit 2):
```tsx
{skins.length === 0 && (
  <div className="text-center py-16">
    <p className="text-text-muted text-lg">
      No skins published yet. Be the first!
    </p>
    <Link href="/editor">
      <Button className="mt-4">Create a Skin</Button>
    </Link>
  </div>
)}
```

---

### 5. Large Like Count Display

**Problem:** Skin with 10,000+ likes → "10000" doesn't fit in card layout.

**Mitigation:**
```typescript
function formatLikeCount(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
}
```

**Example:** 10,523 → "10.5K"

**Add to SkinCard in Phase 3** (unlikely to hit 1K likes in M12 timeframe).

---

### 6. Trending Sort Empty Result

**Problem:** No skins have likes yet → trending query returns empty (sorted by likeCount: 0).

**Solution:** Trending query includes `createdAt` tie-breaker. When all skins have 0 likes, sorts by recent instead.

**Already handled in Unit 2 query.**

---

### 7. Tag Filtering Shows Zero Results

**Problem:** User selects tag that exists in DB but not in current page (client-side filter).

**Mitigation:** Empty state (Unit 4):
```tsx
{filteredSkins.length === 0 && selectedTag && (
  <p>No skins found with tag "{selectedTag}"</p>
)}
```

**Phase 3 solution:** Server-side tag filtering (requires Blaze plan for quota).

---

## Performance Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| Gallery page TTFB | < 500ms | Lighthouse, Network tab |
| Thumbnail load time | < 200ms | Network tab per image |
| Like toggle response | < 300ms | Click → optimistic update |
| ISR cache hit rate | > 90% | Vercel Analytics |
| Client-side filter | < 16ms | Instant (in-memory) |
| Thumbnail generation | < 100ms | Console timing |

**Bundle size:**
- Gallery page JS: < 150 KB (three.js lazy-loaded only on publish, not gallery)
- Thumbnail images: 10-20 KB each × 20 = 200-400 KB total per page

**Total page weight:** ~500-700 KB (within acceptable range for image-heavy content)

---

## Success Criteria

### Functional

- [ ] Gallery page loads for non-authenticated users
- [ ] 20 skins display in grid
- [ ] Thumbnails render from Supabase Storage
- [ ] Like button functional for authenticated users
- [ ] Like count updates optimistically
- [ ] Transaction prevents counter drift
- [ ] Tag filter works client-side
- [ ] Sort toggle switches Recent/Trending
- [ ] ISR caches responses for 60 seconds
- [ ] Empty states display correctly

### Non-Functional

- [ ] Gallery page loads in < 2 seconds (uncached)
- [ ] ISR cache hit rate > 90% after warmup
- [ ] Like toggle responds in < 300ms
- [ ] Firestore reads stay under 50K/day (monitored)
- [ ] Zero console errors in production
- [ ] Mobile responsive (1-4 columns)

### UX

- [ ] Thumbnails load progressively (not all-at-once blocking)
- [ ] Like button provides immediate visual feedback
- [ ] Empty state guides user to editor
- [ ] Tag pills truncate gracefully on mobile
- [ ] "Sign in to like" toast clear and helpful

---

## Rollout Plan

### Pre-Deployment

1. **Publish test skins:**
   - Create 10 test skins in editor
   - Verify thumbnails upload successfully
   - Check Firestore docs have `thumbnailRef` populated

2. **Create indexes:**
   ```bash
   firebase deploy --only firestore:indexes
   ```
   Wait 60s, verify "Enabled" status

3. **Build verification:**
   ```bash
   npm run build
   npm run start
   # Test localhost:3000/gallery
   ```

### Deployment

1. **Merge to main:**
   ```bash
   git push origin main
   ```

2. **Monitor Vercel deployment:**
   - Check build logs for errors
   - Verify env vars present
   - Confirm deployment succeeds

3. **Smoke test:**
   - Visit `/gallery`
   - Sign in, toggle like
   - Check ISR header on 2nd load

### Post-Deployment

1. **Monitor Firestore quota:**
   - Firebase Console → Firestore → Usage tab
   - Track reads/day (target: < 40K)
   - Alert if > 45K (approaching ceiling)

2. **Monitor Vercel Analytics:**
   - Gallery page views
   - Average response time
   - Cache hit rate

3. **Gather user feedback:**
   - Gallery loading speed
   - Thumbnail quality perception
   - Like feature usage

### Rollback Trigger

Rollback if:
- Firestore queries fail (index missing)
- ISR not working (every load hits Firestore)
- Like toggle broken (transaction errors)
- Thumbnails 404 (Storage upload failed)

**Rollback command:**
```bash
vercel rollback
```

---

## Compound Phase Preview

After M12 work completes, capture in `docs/solutions/COMPOUND.md`:

### What Worked

- ISR with 60s revalidation (stayed within Spark quota)
- Client-side tag filtering (zero additional reads)
- Optimistic like toggle (instant UX)
- Thumbnail reuse of M11 OG rendering pattern
- Transaction for counter atomicity

### What Didn't

- (TBD based on implementation)

### Invariants Discovered

- ISR revalidation MUST be ≥ 60s (shorter exceeds Spark quota)
- Like toggle MUST re-fetch count post-transaction (concurrent like handling)
- Thumbnail generation MUST dispose three.js objects (memory leak prevention)
- Tag filtering MUST be client-side in M12 (server-side exceeds quota)
- Trending sort REQUIRES composite index (likeCount + createdAt)

### Gotchas for M13

- Profile page will need user's skins query (same ISR pattern)
- Username change must invalidate gallery cache (on-demand revalidation)
- Delete skin must decrement likeCount (transaction required)
- Thumbnail placeholder needed for skins without thumbnailRef

---

## Timeline Estimate

| Phase | Duration |
|-------|----------|
| Unit 0 (indexes) | 15 min |
| Unit 1 (thumbnails) | 90 min |
| Unit 2 (gallery page) | 60 min |
| Unit 3 (SkinCard) | 90 min |
| Unit 4 (tag filter) | 45 min |
| Unit 5 (sort toggle) | 30 min |
| Unit 6 (like tests) | 60 min |
| Unit 7 (deployment) | 30 min |
| **Total work** | **7 hours** |
| Review | 2 hours |
| Compound | 30 min |
| **Grand total** | **9.5 hours** |

(Slightly over 8-10 hour estimate due to comprehensive ISR + transaction testing)

---

## Execution Command

**For Claude Code:**

```
Execute M12 (Gallery + Likes) using Compound Engineering methodology.

PLAN LOCATION:
/Users/ryan/Documents/threditor/docs/solutions/m12-gallery-likes-plan.md

Implement 8 units in sequence:
- Unit 0: Firestore Composite Indexes
- Unit 1: Thumbnail Generation
- Unit 2: Gallery Page (ISR)
- Unit 3: SkinCard Component
- Unit 4: Tag Filter
- Unit 5: Sort Toggle
- Unit 6: Like Integration Tests
- Unit 7: Production Deployment

Execute autonomously. Do not wait for approval between units.
Create PR titled "M12: Gallery + Likes with ISR".
```

---

*End of M12 implementation plan.*
