# ce:review run artifact — M9 scaffolding

**Mode:** autofix
**Scope:** branch `m9-scaffolding`, 10 commits ahead of main
**Plan:** docs/plans/m9-scaffolding.md
**Reviewers dispatched:** correctness, security, testing, maintainability, project-standards, kieran-typescript, learnings-researcher

## Applied fixes (safe_auto → review-fixer)

| # | Finding | Severity | File | Applied |
|---|---------|----------|------|---------|
| 1 | admin.ts needs server-only barrier | P1 | lib/firebase/admin.ts | ✅ add `import 'server-only'` |
| 2 | likes rule doesn't enforce `${skinId}_${uid}` ID | P1 | firestore.rules | ✅ add likeId == skinId + '_' + uid |
| 3 | likes delete uses null request.resource | P2 | firestore.rules | ✅ split create/delete, delete reads resource.data |
| 4 | skins.create crashes on missing tags field | P3 | firestore.rules | ✅ add `'tags' in request.resource.data` guard |
| 5 | AuthProvider loading=true on init throw | P3 | app/_providers/AuthProvider.tsx | ✅ try/catch + setLoading(false) in catch |
| 6 | `existing[0] as App` unnecessary cast | P3 | lib/firebase/admin.ts | ✅ remove cast |
| 7 | getStorageBucket missing return type | P3 | lib/supabase/client.ts | ✅ ReturnType<SupabaseClient['storage']['from']> |
| 8 | Missing-env-var failure tests (3 modules) | P2 | tests | ✅ 3 new throw tests + idempotency |
| 9 | server-only breaks vitest import | blocker of #1 | vitest.config.ts | ✅ alias to node_modules/server-only/empty.js |

## Residual work (manual → downstream-resolver)

| # | Finding | Owner | Defer to |
|---|---------|-------|----------|
| A | skins.create doesn't validate storageUrl ownership | design | M10 or server-route migration |
| B | skins.update rule blocks DESIGN §11.4 like transaction | design | Cloud Function for likeCount OR rules rewrite |
| C | `skinCount == 0` drift from DESIGN §11.5 | docs | update DESIGN.md §11.5 |
| D | Supabase RLS policies doc-only | ops | commit as supabase/migrations/*.sql in M11 |
| E | firestore emulator suite runtime tests | testing | M10 |
| F | `src/dataconnect-generated/` is Movies example boilerplate | cleanup | user decision; was explicitly committed |
| G | deployment instructions rot in firestore.rules top comment | docs | move to docs/firebase-setup.md in M10 |
| H | emulator port 8080 collision risk | ops | M10 — pin explicit UI/hub/auth ports |

## Advisory (report-only, owner: human)

- Firebase User object is a wide PII surface (email, phoneNumber, providerData) — document in COMPOUND, consider narrowing context type in M10.
- Firebase API + Supabase anon keys shipping to client is by design; comment in firebase/client.ts could make this explicit.
- Empty-string env-var fallback surfaces confusing SDK errors far from mis-config point; a fail-fast validator in each get*() would be clearer.

## Verdict

**Ready with fixes.** All safe_auto fixes applied. P1 security gaps (#A storageUrl validation) and P2 correctness of like transaction (#B) are design-level; captured in this artifact for M10 follow-up. 579/579 tests pass. Bundle unchanged at 375 kB /editor.
