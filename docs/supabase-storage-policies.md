# Supabase Storage Policies — Manual Setup

**Status:** Manual steps, documented here per M9 plan Unit 6.
**Deployed on:** _[record the date when the policies land in the dashboard]_

This project stores skin PNGs in a Supabase Storage bucket named
`skins`. RLS policies on that bucket need to be configured via the
dashboard — the Supabase dashboard is the source of truth, and the
steps below must be run once per project.

## Prerequisites

- Supabase project exists.
- `skins` bucket exists and is **public** (public bucket = anonymous
  GET is allowed on published files; RLS still gates INSERT + DELETE).
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` point
  at this project.

## RLS Policies to configure

Navigate to: Dashboard → Storage → `skins` bucket → "Policies" tab →
"New Policy" → "For full customization" → "Create policy".

### 1. Public read

- **Policy name:** `Public skins are readable`
- **Allowed operation:** `SELECT`
- **USING expression:**
  ```sql
  bucket_id = 'skins'
  ```

### 2. Authenticated upload (owner-only)

- **Policy name:** `Users can upload own skins`
- **Allowed operation:** `INSERT`
- **WITH CHECK expression:**
  ```sql
  bucket_id = 'skins'
  AND auth.uid()::text = (storage.foldername(name))[1]
  ```

Path convention: `skins/{uid}/{skinId}.png` — the first path segment
after the bucket root must match the uploader's Supabase user id.

### 3. Owner-only delete

- **Policy name:** `Users can delete own skins`
- **Allowed operation:** `DELETE`
- **USING expression:**
  ```sql
  bucket_id = 'skins'
  AND auth.uid()::text = (storage.foldername(name))[1]
  ```

## Critical note — Supabase Auth vs. Firebase Auth

This project uses **Firebase Auth** for user identity, not Supabase
Auth. The RLS policies above check `auth.uid()` which resolves
against Supabase's JWT. A browser request authenticated only via
Firebase will be seen by Supabase as **anonymous**.

Implications for the M9 → M11 pipeline:

- **Public reads (SELECT):** still work — the policy allows any
  `bucket_id = 'skins'` read regardless of auth state.
- **Writes (INSERT / DELETE):** must go through a server-side route
  using the **service-role key** (`SUPABASE_SERVICE_ROLE_KEY`). The
  service role bypasses RLS entirely; the server enforces ownership
  by verifying the Firebase session cookie (via the Admin SDK's
  `verifySessionCookie`) and only signing uploads for the verified
  uid.

A direct browser-to-Supabase upload using only the anon key will be
rejected by the INSERT policy. Do NOT design any M11 client code
around that path.

## Verification

After configuring policies, the following smoke checks apply:

1. **Public read:** from any browser, `GET` a known-good URL like
   `https://<project>.supabase.co/storage/v1/object/public/skins/test.png`
   returns 200 (or 404 if the object doesn't exist, but not 403).
2. **Anon upload denied:** a `curl -X POST` with only the anon key
   against the `/storage/v1/object/skins/test/foo.png` endpoint
   returns 403.
3. **Owner-only delete:** automated coverage lands in M11 alongside
   the first real upload flow.

## References

- Plan: `docs/plans/m9-scaffolding.md` §4.2 + §5 Unit 6.
- DESIGN.md §11.7 (quota analysis) + §3 (file structure).
