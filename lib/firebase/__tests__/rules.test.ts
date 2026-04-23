// @vitest-environment node
//
// M9 Unit 5 — shape/content checks on firestore.rules.
//
// The authoritative rules test uses the Firebase Emulator Suite
// (@firebase/rules-unit-testing). M9 ships the rules file and the
// emulator wiring arrives in a later milestone. This file just
// confirms the committed rules file exists and encodes the access-
// control expectations DESIGN.md §11.5 describes.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rulesPath = resolve(process.cwd(), 'firestore.rules');
const rules = readFileSync(rulesPath, 'utf8');

describe('firestore.rules — shape + policy sanity', () => {
  it('declares rules_version 2', () => {
    expect(rules).toMatch(/rules_version\s*=\s*'2'/);
  });

  it('defines the service cloud.firestore block', () => {
    expect(rules).toContain('service cloud.firestore');
  });

  it('exposes isSignedIn + isOwner helpers', () => {
    expect(rules).toContain('function isSignedIn()');
    expect(rules).toContain('function isOwner(uid)');
  });

  it('users collection: public read, owner-only create, skinCount protected on update, no delete', () => {
    expect(rules).toMatch(/match \/users\/{uid}[^}]*allow read: if true/s);
    expect(rules).toMatch(/match \/users\/{uid}[^}]*allow create:[\s\S]*isOwner\(uid\)/s);
    expect(rules).toMatch(
      /match \/users\/{uid}[^}]*allow update:[\s\S]*skinCount/s,
    );
    expect(rules).toMatch(/match \/users\/{uid}[^}]*allow delete: if false/s);
  });

  it('skins collection: public read, signed-in create with ownership + tag cap, likeCount + ownerUid protected on update', () => {
    expect(rules).toMatch(/match \/skins\/{skinId}[^}]*allow read: if true/s);
    expect(rules).toMatch(
      /match \/skins\/{skinId}[^}]*allow create:[\s\S]*request\.resource\.data\.ownerUid == request\.auth\.uid/s,
    );
    expect(rules).toMatch(/match \/skins\/{skinId}[^}]*tags\.size\(\) <= 8/s);
    expect(rules).toMatch(
      /match \/skins\/{skinId}[^}]*allow update:[\s\S]*likeCount[\s\S]*ownerUid/s,
    );
  });

  it('likes collection: public read, create + delete gated on auth.uid, doc-id convention enforced on create, no updates allowed', () => {
    expect(rules).toMatch(/match \/likes\/{likeId}[^}]*allow read: if true/s);
    // Create: uid match + doc-id convention `${skinId}_${uid}`.
    expect(rules).toMatch(
      /match \/likes\/{likeId}[\s\S]*allow create:[\s\S]*request\.resource\.data\.uid == request\.auth\.uid/s,
    );
    expect(rules).toMatch(
      /match \/likes\/{likeId}[\s\S]*likeId == request\.resource\.data\.skinId \+ '_' \+ request\.auth\.uid/s,
    );
    // Delete: separate rule checks resource.data (existing doc), not
    // request.resource (null on delete).
    expect(rules).toMatch(
      /match \/likes\/{likeId}[\s\S]*allow delete:[\s\S]*resource\.data\.uid == request\.auth\.uid/s,
    );
    expect(rules).toMatch(/match \/likes\/{likeId}[\s\S]*allow update: if false/s);
  });
});
