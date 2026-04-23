# M9: Firebase + Supabase Scaffolding — Implementation Plan

**Milestone:** M9 (Phase 2 Infrastructure)  
**Status:** Planning  
**Created:** 2026-04-23  
**Compound Engineering Phase:** Plan

---

## 1. Objectives

Establish foundational infrastructure for Phase 2 social features by integrating Firebase Authentication, Firestore database, and Supabase Storage into the existing Phase 1 codebase. No user-facing UI changes — this milestone creates the plumbing that M10-M14 will build upon.

**Success metrics:**
- All SDK initialization modules compile without TypeScript errors
- Security rules deployed and enforce access control as specified
- Auth context provider renders without breaking existing editor
- Zero regression in Phase 1 functionality (549 tests still passing)
- Bundle size increase under 50 kB (Firebase SDK is ~40 kB gzipped)

---

## 2. Dependencies Analysis

### 2.1 Required packages

```json
{
  "dependencies": {
    "firebase": "^11.0.0",
    "@supabase/supabase-js": "^2.45.0"
  },
  "devDependencies": {
    "@firebase/app-types": "^0.9.2",
    "@supabase/auth-helpers-nextjs": "^0.10.0"
  }
}
```

**Rationale:**
- `firebase@11.0.0`: Latest stable (released April 2026), includes tree-shakable modular SDK
- `@supabase/supabase-js@2.45.0`: Client library for storage + real-time (though we only use storage)
- `@firebase/app-types`: Type definitions for Firebase Admin SDK
- `@supabase/auth-helpers-nextjs`: Server-side helpers for Next.js App Router (used in M10, installed now to avoid version conflicts)

**Compatibility verification needed:**
- Firebase 11 + Next.js 15 App Router (verify ESM imports work)
- Supabase 2.45 + Node 20.x (verify Buffer polyfills not needed)
- Firebase Admin SDK + service account JSON (verify private key parsing)

**Known issues to watch:**
- Firebase SDK sometimes triggers Webpack warnings about `optional require()` for crypto modules — add to `next.config.ts` if needed
- Supabase imports may trigger Next.js "use client" boundary errors if imported in server components — ensure proper separation

### 2.2 Environment variables inventory

**Current state (from .env.local):**
```
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...

FIREBASE_ADMIN_PROJECT_ID=...
FIREBASE_ADMIN_CLIENT_EMAIL=...
FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----..."

NEXT_PUBLIC_SUPABASE_URL=https://hpuqdgftumcfngxkzdah.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
SUPABASE_BUCKET_NAME=skins
```

**Validation requirements:**
- `NEXT_PUBLIC_*` vars must be accessible in browser environment
- `FIREBASE_ADMIN_PRIVATE_KEY` must preserve newlines (`\n` escape sequences)
- All vars must be present at build time (Next.js fails hard if missing)
- Service role keys must never be exposed to client bundle

**Testing approach:**
- Create `lib/__tests__/env.test.ts` to verify all vars are defined
- Check that `NEXT_PUBLIC_*` vars are in `process.env` client-side
- Check that non-public vars are `undefined` client-side

---

## 3. Architecture Decisions

### 3.1 Singleton pattern for SDK clients

**Decision:** Use singleton initialization pattern for both Firebase and Supabase clients.

**Rationale:**
- Firebase SDK internally deduplicates app instances, but explicit singleton prevents re-initialization warnings
- Supabase client is stateless; singleton reduces memory overhead
- Singleton enables lazy initialization — SDK only loads when imported, not at app boot

**Implementation pattern:**
```typescript
// lib/firebase/client.ts
let firebaseApp: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

export function getFirebase() {
  if (!firebaseApp) {
    firebaseApp = initializeApp({ /* config */ });
    auth = getAuth(firebaseApp);
    db = getFirestore(firebaseApp);
  }
  return { app: firebaseApp, auth, db };
}
```

**Edge cases:**
- Multiple rapid calls to `getFirebase()` — guard with null check prevents race
- Server vs client initialization — server components must use Admin SDK, not client SDK
- Hot module replacement in dev — Firebase SDK handles re-init gracefully, no special HMR logic needed

### 3.2 Client SDK vs Admin SDK separation

**Decision:** Strict separation — client SDK only in `'use client'` components, Admin SDK only in server components/route handlers.

**Directory structure:**
```
lib/
├── firebase/
│   ├── client.ts        # 'use client' — browser SDK
│   ├── admin.ts         # server-only — Admin SDK
│   ├── types.ts         # shared types (no runtime code)
│   └── auth.ts          # M10: server-side session helpers
├── supabase/
│   ├── client.ts        # 'use client' — Supabase client
│   └── storage.ts       # M11: upload/download wrappers
```

**Enforcement:**
- `client.ts` files explicitly marked `'use client'` at top
- `admin.ts` files have no directive (server-only by default)
- TypeScript paths prevent cross-import: client code cannot import admin modules

**Test verification:**
- Bundle analyzer confirms Admin SDK not in client bundle
- Server-side test imports Admin SDK successfully
- Client-side test cannot import Admin SDK (build error)

### 3.3 Type definitions strategy

**Decision:** Define Phase 2 types in `lib/firebase/types.ts` per DESIGN.md §4.1, not in a global `types/` folder.

**Rationale:**
- Colocation with Firebase logic improves discoverability
- Firestore-specific types (Timestamp, DocumentReference) live alongside business types
- Supabase types are simple (just URLs), no separate file needed

**Type export structure:**
```typescript
// lib/firebase/types.ts
import { Timestamp } from 'firebase/firestore';

export type SkinVariant = 'classic' | 'slim';

export type UserProfile = {
  uid: string;
  username: string;
  displayName: string;
  photoURL: string | null;
  createdAt: Timestamp;
  skinCount: number;
};

export type SharedSkin = {
  id: string;
  ownerUid: string;
  ownerUsername: string;
  name: string;
  variant: SkinVariant;
  storageUrl: string;      // Supabase URL: https://...supabase.co/storage/v1/...
  thumbnailUrl: string;
  ogImageUrl: string;
  tags: string[];
  likeCount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type Like = {
  skinId: string;
  uid: string;
  createdAt: Timestamp;
};
```

**Conversion helpers needed:**
- `Timestamp` → JS Date for client rendering
- Server-side: `serverTimestamp()` placeholder → actual Timestamp on write

---

## 4. Security Rules Implementation

### 4.1 Firestore rules

**File:** `firestore.rules` (project root)

**Rules from DESIGN.md §11.5:**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Helper functions
    function isSignedIn() {
      return request.auth != null;
    }
    
    function isOwner(uid) {
      return isSignedIn() && request.auth.uid == uid;
    }

    // Users collection
    match /users/{uid} {
      allow read: if true;  // Public profiles
      allow create: if isOwner(uid)
                    && request.resource.data.uid == uid
                    && request.resource.data.skinCount == 0;
      allow update: if isOwner(uid)
                    && !('skinCount' in request.resource.data.diff(resource.data).affectedKeys());
      allow delete: if false;  // Never allow profile deletion via client
    }

    // Skins collection
    match /skins/{skinId} {
      allow read: if true;  // Public gallery
      allow create: if isSignedIn()
                    && request.resource.data.ownerUid == request.auth.uid
                    && request.resource.data.likeCount == 0
                    && request.resource.data.tags.size() <= 8;
      allow update: if isOwner(resource.data.ownerUid)
                    && !('likeCount' in request.resource.data.diff(resource.data).affectedKeys())
                    && !('ownerUid' in request.resource.data.diff(resource.data).affectedKeys());
      allow delete: if isOwner(resource.data.ownerUid);
    }

    // Likes collection
    match /likes/{likeId} {
      allow read: if true;
      allow create, delete: if isSignedIn()
                            && request.resource.data.uid == request.auth.uid;
      allow update: if false;
    }
  }
}
```

**Deployment:**
```bash
firebase deploy --only firestore:rules --project threditor-2ea3c
```

**Testing approach:**
- Use Firebase Emulator Suite for local testing
- Create `tests/firestore-rules.test.ts` using `@firebase/rules-unit-testing`
- Test cases:
  - Unauthenticated read of skins → allowed
  - Unauthenticated write to skins → denied
  - User creating skin with wrong ownerUid → denied
  - User updating another user's skin → denied
  - User incrementing likeCount directly → denied (must use transaction)

### 4.2 Supabase Storage policies

**Bucket:** `skins` (already created, public bucket)

**Policies via Supabase Dashboard → Storage → Policies:**

**Policy 1: Public Read**
```sql
CREATE POLICY "Public skins are readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'skins');
```

**Policy 2: Authenticated Upload (owner-only)**
```sql
CREATE POLICY "Users can upload own skins"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'skins'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
```

**Path structure:** `skins/{uid}/{skinId}.png`  
Example: `skins/abc123/skin-xyz.png` → only user `abc123` can upload

**Policy 3: Owner-only Delete**
```sql
CREATE POLICY "Users can delete own skins"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'skins'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
```

**Testing approach:**
- Manual test in Supabase Dashboard Storage browser
- Automated test in M11 (upload integration test)
- Verify unauthenticated requests get 403 on upload
- Verify cross-user upload attempts fail

**Known limitation:**
- Supabase RLS uses Supabase Auth, not Firebase Auth
- We're using Firebase Auth for user identity
- **Solution for M11:** Server-side upload using `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS
- Public read still works (no auth needed)

---

## 5. Unit-by-Unit Implementation Plan

### Unit 0: Dependencies

**Commands:**
```bash
cd /Users/ryan/Documents/threditor
npm install firebase @supabase/supabase-js
npm install -D @firebase/app-types @supabase/auth-helpers-nextjs
```

**Validation:**
- `package.json` updated with exact versions
- `package-lock.json` has no peer dependency warnings
- `npm run build` succeeds (proves Next.js accepts new deps)

**Edge cases:**
- If Firebase triggers crypto polyfill warnings → add to `next.config.ts`:
  ```typescript
  webpack: (config) => {
    config.resolve.fallback = { ...config.resolve.fallback, crypto: false };
    return config;
  }
  ```

---

### Unit 1: Firebase Client SDK

**File:** `lib/firebase/client.ts`

**Implementation:**
```typescript
'use client';

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
};

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;

export function getFirebase() {
  if (!getApps().length) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(db);
  }
  return { app, auth, db };
}
```

**Test file:** `lib/firebase/__tests__/client.test.ts`
```typescript
import { describe, it, expect } from 'vitest';
import { getFirebase } from '../client';

describe('Firebase Client SDK', () => {
  it('initializes without error', () => {
    const { app, auth, db } = getFirebase();
    expect(app).toBeDefined();
    expect(auth).toBeDefined();
    expect(db).toBeDefined();
  });

  it('returns same instance on repeated calls', () => {
    const first = getFirebase();
    const second = getFirebase();
    expect(first.app).toBe(second.app);
  });
});
```

**Edge cases:**
- Missing env vars → throws at runtime with clear message
- HMR in dev mode → Firebase SDK handles re-init, no special logic
- Server-side import → Next.js build fails with `'use client'` directive error (expected)

---

### Unit 2: Firebase Admin SDK

**File:** `lib/firebase/admin.ts`

**Implementation:**
```typescript
// Server-side only — no 'use client' directive

import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

let app: App;
let adminAuth: Auth;
let adminDb: Firestore;

export function getAdminFirebase() {
  if (!getApps().length) {
    app = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID!,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL!,
        privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY!.replace(/\\n/g, '\n'),
      }),
    });
    adminAuth = getAuth(app);
    adminDb = getFirestore(app);
  }
  return { app, auth: adminAuth, db: adminDb };
}
```

**Critical detail:** `privateKey.replace(/\\n/g, '\n')` — env vars store escaped newlines, Admin SDK needs actual newlines.

**Test file:** `lib/firebase/__tests__/admin.test.ts`
```typescript
import { describe, it, expect } from 'vitest';
import { getAdminFirebase } from '../admin';

describe('Firebase Admin SDK', () => {
  it('initializes without error', () => {
    const { app, auth, db } = getAdminFirebase();
    expect(app).toBeDefined();
    expect(auth).toBeDefined();
    expect(db).toBeDefined();
  });

  it('can verify a session cookie (stub)', async () => {
    const { auth } = getAdminFirebase();
    // Stub test — actual verification tested in M10
    expect(typeof auth.verifySessionCookie).toBe('function');
  });
});
```

**Edge cases:**
- Private key parsing error → check for `\n` vs `\\n` mismatch
- Missing service account key → throws clear error at init
- Firestore permissions → Admin SDK has full access, no rules apply

---

### Unit 3: Supabase Client SDK

**File:** `lib/supabase/client.ts`

**Implementation:**
```typescript
'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let supabase: SupabaseClient;

export function getSupabase() {
  if (!supabase) {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return supabase;
}

// Convenience re-export for storage bucket
export function getStorageBucket() {
  return getSupabase().storage.from(process.env.SUPABASE_BUCKET_NAME || 'skins');
}
```

**Test file:** `lib/supabase/__tests__/client.test.ts`
```typescript
import { describe, it, expect } from 'vitest';
import { getSupabase, getStorageBucket } from '../client';

describe('Supabase Client SDK', () => {
  it('initializes without error', () => {
    const client = getSupabase();
    expect(client).toBeDefined();
  });

  it('provides storage bucket access', () => {
    const bucket = getStorageBucket();
    expect(bucket).toBeDefined();
    // Bucket name should match env var
    expect(bucket).toHaveProperty('bucketId');
  });
});
```

**Edge cases:**
- Missing env vars → throws at call time
- CORS errors → Supabase projects have CORS enabled by default for their own domain
- Anon key vs service role key → client uses anon (public), server uses service role (secret)

---

### Unit 4: Firebase Types

**File:** `lib/firebase/types.ts`

**Implementation:**
```typescript
import { Timestamp } from 'firebase/firestore';

export type SkinVariant = 'classic' | 'slim';

export type UserProfile = {
  uid: string;
  username: string;
  displayName: string;
  photoURL: string | null;
  createdAt: Timestamp;
  skinCount: number;
};

export type SharedSkin = {
  id: string;
  ownerUid: string;
  ownerUsername: string;
  name: string;
  variant: SkinVariant;
  storageUrl: string;
  thumbnailUrl: string;
  ogImageUrl: string;
  tags: string[];
  likeCount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type Like = {
  skinId: string;
  uid: string;
  createdAt: Timestamp;
};
```

**Test file:** `lib/firebase/__tests__/types.test.ts`
```typescript
import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import type { UserProfile, SharedSkin, Like } from '../types';

describe('Firebase Types', () => {
  it('UserProfile has required fields', () => {
    const profile: UserProfile = {
      uid: 'test-uid',
      username: 'testuser',
      displayName: 'Test User',
      photoURL: null,
      createdAt: Timestamp.now(),
      skinCount: 0,
    };
    expect(profile.uid).toBe('test-uid');
  });

  it('SharedSkin has storage URLs', () => {
    const skin: SharedSkin = {
      id: 'skin-123',
      ownerUid: 'user-abc',
      ownerUsername: 'bob',
      name: 'Cool Skin',
      variant: 'classic',
      storageUrl: 'https://...supabase.co/storage/v1/object/public/skins/user-abc/skin-123.png',
      thumbnailUrl: 'https://...supabase.co/.../thumb.png',
      ogImageUrl: 'https://...supabase.co/.../og.webp',
      tags: ['hoodie', 'blue'],
      likeCount: 5,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };
    expect(skin.variant).toBe('classic');
  });
});
```

**Edge cases:**
- `Timestamp` serialization → Firestore handles automatically
- `null` vs `undefined` for optional fields → TypeScript enforces `| null`
- Array types (`tags: string[]`) → Firestore supports natively

---

### Unit 5: Firestore Security Rules

**File:** `firestore.rules` (create in project root)

**Implementation:** Copy rules from §4.1 above.

**Deployment:**
```bash
# Install Firebase CLI if not present
npm install -g firebase-tools

# Login to Firebase
firebase login

# Initialize Firebase project (one-time)
firebase init firestore --project threditor-2ea3c

# Deploy rules
firebase deploy --only firestore:rules --project threditor-2ea3c
```

**Test approach:**
- Use Firebase Emulator Suite for local testing
- Create `tests/firestore-rules.test.ts`:

```typescript
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { describe, it, beforeAll, afterAll } from 'vitest';

let testEnv: any;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'threditor-test',
    firestore: {
      rules: fs.readFileSync('firestore.rules', 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });
});

afterAll(() => testEnv.cleanup());

describe('Firestore Security Rules', () => {
  it('allows public read of skins', async () => {
    const unauthedDb = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(unauthedDb.collection('skins').doc('test-skin').get());
  });

  it('denies unauthenticated write to skins', async () => {
    const unauthedDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(unauthedDb.collection('skins').doc('test-skin').set({ name: 'Hack' }));
  });

  it('allows user to create own skin', async () => {
    const authedDb = testEnv.authenticatedContext('user-123').firestore();
    await assertSucceeds(authedDb.collection('skins').add({
      ownerUid: 'user-123',
      name: 'My Skin',
      likeCount: 0,
      tags: ['test'],
    }));
  });

  it('denies user creating skin with wrong ownerUid', async () => {
    const authedDb = testEnv.authenticatedContext('user-123').firestore();
    await assertFails(authedDb.collection('skins').add({
      ownerUid: 'user-456',  // Different user
      name: 'Fake Skin',
      likeCount: 0,
      tags: [],
    }));
  });
});
```

**Edge cases:**
- Rules deployment requires active Firebase project → verify project ID in `.firebaserc`
- Emulator port conflicts → check 8080 not in use
- Rules syntax errors → Firebase CLI validates before deploy

---

### Unit 6: Supabase Storage Policies

**Implementation:** Via Supabase Dashboard (manual step, documented here)

**Steps:**
1. Navigate to: https://supabase.com/dashboard/project/hpuqdgftumcfngxkzdah/storage/buckets/skins
2. Go to "Policies" tab
3. Click "New Policy"
4. Select "For full customization" → "Create policy"
5. Policy name: "Public skins are readable"
6. Allowed operation: SELECT
7. Policy definition:
   ```sql
   bucket_id = 'skins'
   ```
8. Click "Review" → "Save policy"

**Repeat for upload policy:**
- Policy name: "Users can upload own skins"
- Allowed operation: INSERT
- WITH CHECK:
  ```sql
  bucket_id = 'skins' AND
  auth.uid()::text = (storage.foldername(name))[1]
  ```

**Repeat for delete policy:**
- Policy name: "Users can delete own skins"
- Allowed operation: DELETE
- USING:
  ```sql
  bucket_id = 'skins' AND
  auth.uid()::text = (storage.foldername(name))[1]
  ```

**Testing:**
- Manual test: Try uploading via Supabase Dashboard
- Automated test deferred to M11 (upload integration)

**Critical note:**
- Supabase RLS checks `auth.uid()` from Supabase Auth (JWT in Authorization header)
- We're using Firebase Auth, not Supabase Auth
- **For M11:** Server-side uploads use service role key → bypasses RLS entirely
- Public reads still work (SELECT policy allows anyone)

---

### Unit 7: Auth Context Provider

**File:** `app/_providers/AuthProvider.tsx`

**Implementation:**
```typescript
'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { type User, onAuthStateChanged } from 'firebase/auth';
import { getFirebase } from '@/lib/firebase/client';

type AuthContextValue = {
  user: User | null;
  loading: boolean;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { auth } = getFirebase();
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
```

**Integration:** Update `app/layout.tsx`

```typescript
import { AuthProvider } from './_providers/AuthProvider';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
```

**Test file:** `app/_providers/__tests__/AuthProvider.test.tsx`
```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthProvider, useAuth } from '../AuthProvider';

function TestComponent() {
  const { user, loading } = useAuth();
  return (
    <div>
      <div data-testid="loading">{loading ? 'loading' : 'ready'}</div>
      <div data-testid="user">{user ? user.uid : 'signed-out'}</div>
    </div>
  );
}

describe('AuthProvider', () => {
  it('provides auth context', () => {
    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );
    
    // Initially loading
    expect(screen.getByTestId('loading')).toHaveTextContent('loading');
    
    // After auth state resolves (signed out by default in tests)
    // This would need Firebase test setup to fully validate
  });

  it('throws error when used outside provider', () => {
    expect(() => {
      render(<TestComponent />);
    }).toThrow('useAuth must be used within AuthProvider');
  });
});
```

**Edge cases:**
- Auth state listener fires immediately with current state → `loading` flips to `false` quickly
- Unmount during auth check → cleanup function unsubscribes
- Multiple `AuthProvider` instances → each creates separate listener (not a problem, but wasteful)

---

## 6. Testing Strategy

### 6.1 Unit tests

**Coverage targets:**
- SDK initialization: 100% (critical path)
- Type definitions: 100% (compile-time verification)
- Auth provider: 80% (some Firebase internals untestable)

**Test files created:**
```
lib/firebase/__tests__/
  ├── client.test.ts
  ├── admin.test.ts
  └── types.test.ts
lib/supabase/__tests__/
  └── client.test.ts
app/_providers/__tests__/
  └── AuthProvider.test.tsx
tests/
  ├── firestore-rules.test.ts
  └── env.test.ts
```

### 6.2 Integration tests

**Firestore rules testing:**
- Use Firebase Emulator Suite
- Test all CRUD operations for each collection
- Verify denormalization rules (e.g., `skinCount` cannot be manually set)

**Supabase storage testing:**
- Deferred to M11 (requires actual upload flow)
- Manual verification in M9 via Dashboard

### 6.3 Regression testing

**Existing Phase 1 tests must pass:**
- 549 tests from M1-M8 should all still pass
- No new failures introduced by Firebase/Supabase imports
- Editor functionality unchanged

**Bundle size regression:**
- Current: 375 kB First Load JS
- Target: Under 425 kB after M9 (+50 kB budget for Firebase SDK)
- Verify via `npm run build` and check `.next/analyze` output

---

## 7. Edge Cases & Gotchas

### 7.1 Next.js App Router specific issues

**Issue:** `'use client'` boundary enforcement
- Firebase client SDK must only be imported in client components
- Admin SDK must only be imported in server components
- Shared types can be imported anywhere (no runtime code)

**Mitigation:**
- Explicit `'use client'` directive at top of `client.ts` files
- TypeScript path aliases prevent accidental cross-import
- Lint rule to catch server/client boundary violations (if available)

### 7.2 Environment variable loading

**Issue:** `.env.local` only loads in Next.js runtime, not in standalone Node scripts

**Mitigation:**
- All Firebase/Supabase access goes through Next.js (dev server, build, or API routes)
- For standalone scripts (e.g., seed script), use `dotenv`:
  ```typescript
  import 'dotenv/config';
  import { getAdminFirebase } from './lib/firebase/admin';
  ```

### 7.3 Firebase SDK tree-shaking

**Issue:** Firebase modular SDK is tree-shakable, but imports must be specific

**Bad:**
```typescript
import firebase from 'firebase/app';  // Imports entire SDK
```

**Good:**
```typescript
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
```

**Verification:**
- Bundle analyzer shows only `auth` and `firestore` modules, not `storage`, `functions`, etc.

### 7.4 Timestamp serialization

**Issue:** Firestore `Timestamp` objects don't serialize to JSON automatically

**Mitigation:**
- For server → client data transfer, convert to ISO string:
  ```typescript
  JSON.stringify({
    ...skin,
    createdAt: skin.createdAt.toDate().toISOString(),
  });
  ```
- For Firestore writes, use `serverTimestamp()`:
  ```typescript
  import { serverTimestamp } from 'firebase/firestore';
  await setDoc(docRef, { createdAt: serverTimestamp() });
  ```

### 7.5 Supabase Storage public URLs

**Issue:** Public URLs require bucket to be public + correct CORS

**Mitigation:**
- Bucket `skins` already created as public
- CORS automatically configured for `*.supabase.co` domain
- If custom domain added later, must update CORS in Supabase Dashboard

---

## 8. Acceptance Criteria

**Code quality:**
- [ ] All TypeScript compiles with zero errors
- [ ] All new tests pass (20+ tests added)
- [ ] All existing Phase 1 tests still pass (549/549)
- [ ] No ESLint warnings introduced
- [ ] Bundle size under 425 kB First Load JS

**Functionality:**
- [ ] Firebase client SDK initializes in browser
- [ ] Firebase Admin SDK initializes server-side
- [ ] Supabase client SDK initializes in browser
- [ ] Auth context provider renders without error
- [ ] Firestore rules deployed and enforcing access control
- [ ] Supabase storage policies configured (manual verification)

**Documentation:**
- [ ] `COMPOUND.md` entry created (after Review phase)
- [ ] All edge cases documented in this plan
- [ ] Type definitions match DESIGN.md spec

**User impact:**
- [ ] Editor still loads and functions identically to M8
- [ ] No visible UI changes
- [ ] No performance regression (FCP/LCP within 5% of M8)

---

## 9. Rollback Plan

**If M9 breaks Phase 1:**

1. Revert commits:
   ```bash
   git revert HEAD~7..HEAD  # Revert last 7 commits (7 units)
   git push origin main
   ```

2. Remove dependencies:
   ```bash
   npm uninstall firebase @supabase/supabase-js @firebase/app-types @supabase/auth-helpers-nextjs
   ```

3. Restore `.env.local` to M8 state (remove Supabase vars)

4. Redeploy Vercel:
   ```bash
   vercel --prod
   ```

**Rollback triggers:**
- Phase 1 test suite failure rate > 5%
- Bundle size increase > 100 kB
- Editor fails to load on deployment
- Critical security rule misconfiguration (data leak)

---

## 10. Post-Merge Validation

**After merge to `main`:**

1. Deploy to Vercel production
2. Verify editor still loads: https://threditor.vercel.app/editor
3. Check Vercel Analytics for any JS errors
4. Verify Firebase project has Firestore rules deployed
5. Verify Supabase bucket policies are active
6. Run Lighthouse audit (target: Performance score ≥ 95)

**Monitoring:**
- Firebase Console → Usage tab → check Firestore read/write quotas
- Supabase Dashboard → Reports → check storage usage
- Vercel Dashboard → Analytics → check bundle size reported

---

## 11. Dependencies for Next Milestones

**M10 (Auth Flow) depends on M9:**
- `getFirebase()` function from `lib/firebase/client.ts`
- `getAdminFirebase()` function from `lib/firebase/admin.ts`
- `useAuth()` hook from `app/_providers/AuthProvider.tsx`
- Firebase types from `lib/firebase/types.ts`

**M11 (Skin Upload) depends on M9:**
- `getSupabase()` function from `lib/supabase/client.ts`
- `getStorageBucket()` function for file uploads
- `SharedSkin` type for Firestore writes
- Supabase storage policies (must be configured)

**If M9 is incomplete:**
- M10-M14 cannot proceed
- Phase 2 is blocked

---

## 12. Time Estimate

**Per-unit estimates (solo dev):**
- Unit 0 (Dependencies): 15 minutes
- Unit 1 (Firebase Client): 30 minutes
- Unit 2 (Firebase Admin): 30 minutes
- Unit 3 (Supabase Client): 20 minutes
- Unit 4 (Types): 20 minutes
- Unit 5 (Firestore Rules): 45 minutes (includes deployment)
- Unit 6 (Supabase Policies): 30 minutes (manual Dashboard work)
- Unit 7 (Auth Provider): 45 minutes

**Total work phase:** ~4 hours  
**Review phase:** ~1 hour  
**Compound phase:** ~30 minutes  
**Total M9:** ~5.5 hours

**Risks to timeline:**
- Firebase Emulator setup unfamiliarity: +1 hour
- Supabase Dashboard UI changes: +30 minutes
- Next.js build errors from SDK imports: +1 hour

**Worst-case estimate:** 8 hours

---

**Plan phase complete. Ready to proceed to Work phase?**
