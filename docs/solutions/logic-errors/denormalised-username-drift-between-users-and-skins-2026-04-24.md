---
title: Denormalised username drift between /users and /skins broke every /u/[username] profile URL
date: 2026-04-24
category: logic-errors
module: firebase-data-layer
problem_type: logic_error
component: database
symptoms:
  - /u/[username] returned 404 for every pre-M13 user despite the gallery "by <username>" label rendering the same string
  - /users/{uid}.username held a defaultUsername hash slug (user-q8xl00buxodf) while /skins/{id}.ownerUsername held the email-prefix form (ryanssareen) for the same owner
  - Unit tests for createSkinDoc passed because they asserted the write path in isolation, never cross-reading the two collections
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [denormalization, firestore, username, profile-pages, backfill-free-migration, read-write-consistency, m13]
---

# Denormalised username drift between /users and /skins broke every /u/[username] profile URL

## Problem

A denormalised `username` field drifted between `/skins/{skinId}.ownerUsername` and `/users/{uid}.username` because the two docs were bootstrapped from different sources in the same batch write, causing every profile link to 404 once the `/u/[username]` route shipped in M13.

## Symptoms

- Every gallery card's "by `<username>`" link pointed at `/u/ryanssareen`.
- Every click on that link returned 404 in preview.
- `/users/{uid}.username` held a `defaultUsername(uid)` hash slug (e.g. `user-q8xl00buxodf`), while `/skins/{id}.ownerUsername` held the email-prefix form (`ryanssareen`) for the same owner.
- Unit tests for `createSkinDoc` passed — they mocked writes and only asserted outgoing payloads, never round-tripped a query on the denormalised field.

## What Didn't Work

- **One-time data migration script.** Would have required Firebase CLI auth and a coordinated production deploy window; rejected in favour of a read-time fallback that ships with the same PR and needs no coordination.
- **Linking cards to `/u/{ownerUid}`.** Sidesteps the mismatch but produces ugly URLs and gives up the `@username` affordance the whole `/u/[username]` route was built around.
- **Querying `/users where displayName == X`.** `displayName` permits Unicode, spaces, and mixed casing — it is neither URL-safe nor guaranteed-unique, so it cannot serve as the slug.

## Solution

### Forward fix: align write-time derivation

Bootstrap `/users/{uid}.username` from the same `ownerUsername` already being written to `/skins/{skinId}`, lowercased and validated against the shared `USERNAME_PATTERN` constant (single source of truth — don't inline the regex). Fall back to the uid-derived default only when the lowered form fails the slug check (e.g. an email prefix like `first.last` contains a dot). `displayName` preserves the original casing for UI.

```typescript
// lib/firebase/skins.ts (modified)
import { USERNAME_PATTERN } from './profile';

const existing = await userRef.get();
if (!existing.exists) {
  const lowerOwner = input.ownerUsername.toLowerCase();
  const canonicalUsername = USERNAME_PATTERN.test(lowerOwner)
    ? lowerOwner
    : defaultUsername(input.uid);
  userPayload.username = canonicalUsername;
  userPayload.displayName = input.ownerUsername;
  userPayload.photoURL = null;
  userPayload.createdAt = now;
}
```

### Back-compat: read-time fallback for pre-existing drifted rows

Profile lookup tries the direct `/users` query first; on miss, it resolves the owner via `/skins.ownerUsername` and loads the user doc by uid. Two extra reads on the slow path, zero on the hot path, and no new Firestore index (single-field indexes are automatic).

**Reverse-check is required**, not optional: without it, a malicious user who publishes a skin with `ownerUsername: "alice"` (e.g. by registering `alice@gmail.com` before the real alice shows up) could hijack `/u/alice` routes after the real alice later claims the slug via a username rename. We only accept the fallback when the resolved user's CURRENT `username` matches the requested slug — or still has the pre-M13 `user-<slug>` default shape, meaning the owner never picked a real username.

```typescript
// lib/firebase/profile.ts
export async function getUserByUsername(
  username: string,
): Promise<ProfileUser | null> {
  const lower = username.toLowerCase();
  if (!USERNAME_PATTERN.test(lower)) return null;
  const { db } = getAdminFirebase();

  const direct = await db
    .collection('users')
    .where('username', '==', lower)
    .limit(1)
    .get();
  if (!direct.empty) return normalizeUser(direct.docs[0].data() as RawUser);

  // Fallback for pre-M13 drift.
  const skinSnap = await db
    .collection('skins')
    .where('ownerUsername', '==', username)
    .limit(1)
    .get();
  if (skinSnap.empty) return null;
  const ownerUid = (skinSnap.docs[0].data() as { ownerUid?: unknown }).ownerUid;
  if (typeof ownerUid !== 'string') return null;
  const userSnap = await db.collection('users').doc(ownerUid).get();
  if (!userSnap.exists) return null;
  const profile = normalizeUser(userSnap.data() as RawUser);
  if (profile === null) return null;

  // Reverse-check: accept only if the resolved user currently owns
  // the slug (either directly, or via the pre-M13 default shape).
  // Rejecting here prevents a stale /skins.ownerUsername row from
  // hijacking a slug after a username rename.
  if (profile.username === lower) return profile;
  if (profile.username.startsWith('user-')) return profile;
  return null;
}
```

## Why This Works

Root cause: the same logical concept (the username slug) was derived from two different expressions inside one batch write — `input.ownerUsername` for `/skins`, `defaultUsername(input.uid)` for `/users` — so the invariant "these fields agree" was never enforced. The write-time fix restores the invariant for every new row by tying both fields to one source.

But that alone leaves the drifted `/users` docs still un-queryable by slug. The read-time fallback heals those rows by routing through the one field that is already correct on them — `/skins.ownerUsername` — without requiring a migration or deploy window.

Neither fix alone is sufficient: write-time fixes the future, read-time fixes the past. The reverse-check on the fallback closes a third gap — a renamed user's stale denormalised rows can't route new `/u/<oldSlug>` traffic to their profile or (worse) to a different user who later claimed the slug.

## Prevention

- **Invariant: single constructor per denormalised field.** When two docs share a denormalised field, derive both values from a single variable at the call site — never re-derive one of them from a different source downstream. Codify this by accepting the value as a function parameter rather than computing it twice. Use a single exported constant (`USERNAME_PATTERN`) for any validation, not an inline regex.
- **Mutable-source policy.** If the source field is mutable (usernames can change, display names can change, etc.), pick an explicit stance up front:
  1. **Fan-out on rename**: a transactional update that rewrites every denormalised copy in the same batch. Required when the denormalised field is used as a routing key or a join key.
  2. **Historical snapshot**: treat the denormalised copy as point-in-time and never query it as a key. Safe for display-only fields.

  Don't leave the choice implicit — future code assumes whatever shape it finds.
- **Reverse-check fallbacks.** Any read-time fallback that routes through a denormalised field MUST verify the resolved record still owns the slug. The naive version — "any hit counts" — is a squatting vector: anyone who can set the denormalised field can hijack the route.
- **Read-back test**: Add a round-trip assertion at the service layer — not just the write assertion. For any field meant to be queryable after write, do "create, rename, then query by the stale value" in the test (not just "create then query"):

  ```typescript
  // pseudo-test — catches fan-out + reverse-check gaps
  await createSkinDoc({ uid, ownerUsername: 'alice', ... });
  await renameUser(uid, 'bob');
  const stillAlice = await getUserByUsername('alice');
  expect(stillAlice).toBeNull(); // stale slug must NOT route
  const nowBob = await getUserByUsername('bob');
  expect(nowBob?.uid).toBe(uid);
  ```

- **Review heuristic**: Grep for any doc shape that appears in multiple collection writes. When the same logical concept (a display name, a slug, a counter key) appears in both, enforce a single canonical source.
- **Preview-test every SEO/URL surface on existing data** before shipping a route that uses a denormalised field as a routing key. Unit tests catch write-path bugs; only end-to-end navigation catches cross-collection drift.
- **Bias toward write-time + read-time paired fixes** when refactoring denormalised data. A pure write-time fix creates a "works for new rows only" cliff; a pure read-time fix keeps the invariant broken. Pair them so you can deploy without a migration window.

## Related Issues

- `docs/solutions/COMPOUND.md` §M13 (2026-04-24) — narrative retrospective of the same milestone; this doc extracts the reusable denormalisation-drift pattern.
- PR: [threditor#16 "M13: Profile Pages with SSR"](https://github.com/ryanssareen/threditor/pull/16) — contains both fixes and the `/u/[username]` route.
- Files touched: `lib/firebase/skins.ts` (write-time fix), `lib/firebase/profile.ts` (read-time fallback), `lib/firebase/__tests__/skins.test.ts` + `lib/firebase/__tests__/profile.test.ts` (read-back tests).
