# Backend unit-test coverage

The backend has a Vitest unit-test harness over `backend/src/lib/**`. This doc
tracks what is covered, what still needs tests, and how the coverage ratchet
works — so you can pick up a checkbox below and land it as a small PR.

## Running the tests

```bash
cd backend
npm install
npm test              # run all unit tests
npm run test:coverage # same, plus the per-file coverage table + floor check
```

Tests live throughout `backend/src/**/*.test.ts`, including `lib/__tests__/`,
nested feature directories, `routes/__tests__/`, and `src/__tests__/integration/`.
Read a couple of the existing suites first (`lib/__tests__/access.test.ts`,
`lib/__tests__/userDataCleanup.test.ts`) and match their conventions: plain
in-memory Supabase query mocks for unit tests, no real network, one `describe`
block per function or concern, and assertions on current behavior. Tests that
need a real local Supabase stack are explicitly gated.

## Current coverage (measured 2026-09)

Global: **64.08% statements / 54.51% branches / 67.03% functions / 66.43%
lines** — 5349/8347 statements, 3846/7055 branches, 917/1368 functions,
4981/7498 lines.

Per-directory statement coverage from `npm run test:coverage`:

| Area | % statements | Where the gap is |
| --- | ---: | --- |
| `lib/maintenance` | 81 | `staleWork.ts`, the only file |
| `lib/queue` | 79 | `runProgress.ts` (0) is the one hole |
| `lib/dbq` | 78 | `runner.ts` (59) drags down an otherwise covered area |
| `lib/llm` | 74 | strong except `rawStreamLog.ts` (9) |
| `lib/` (root, 56 files) | 73 | see the per-file list below |
| `lib/chat` | 70 | `contextBuilders.ts` (46), `streaming.ts` (54) |
| `lib/chat/tools` | 57 | `toolDispatcher.ts` (41), `documentOps.ts` (59) |
| `lib/tabular` | 36 | largest remaining block after `lib/mcp` |
| `lib/mcp` | 7 | `servers.ts` 0, `oauth.ts` 3, `client.ts` 23 |

The lowest-covered individual files, which is where the remaining ratchet
headroom actually is:

| File | % statements |
| --- | ---: |
| `lib/officeText.ts`, `lib/spreadsheet.ts`, `lib/mcp/servers.ts`, `lib/queue/runProgress.ts`, `lib/tabular/tabular.prompt.ts`, `lib/pdfjs.ts` | 0 |
| `lib/courtlistener.ts` | 2 |
| `lib/mcp/oauth.ts` | 3 |
| `lib/tabular/tabular.extract.ts`, `lib/llm/rawStreamLog.ts` | 9 |
| `lib/sseHeartbeat.ts` | 13 |
| `lib/mcp/client.ts` | 23 |
| `lib/tabular/tabular.generateStream.ts` | 26 |

The global figure sits below most of the per-area ones because `src/lib/**`
includes several large, lightly tested feature libs — `courtlistener.ts`, the
MCP client and OAuth flow, `toolDispatcher.ts`, `documentOps.ts`, and the
tabular extract/stream pipeline — that dominate the line count.

**A file missing from the table is not an untested file.** The `% Coverage
report` table does not always list every file, and what it omits depends on
where you run it: 20 of the 101 files under `src/lib/**` are at 100% on all
four metrics, and some local environments drop exactly those rows while the CI
runner prints them. `documentTypes.ts` and `chat/prompts.ts` are two of them —
both fully covered, both ticked in the list below, and both absent from some
local runs. `coverage/lcov.info` always carries all 101 files; read it when the
table and the TODO list look like they disagree.

## TODO — untested libs, in priority order

Each item is meant to be one self-contained PR: add the suite, then raise the
floors in `backend/vitest.config.mts` to just below the new measured numbers.
Size is a rough guess: S ~ an hour, M ~ an afternoon.

Landed since this list was first written:

- [x] `lib/documentTypes.ts`, `lib/chat/prompts.ts` — both 100%.
- [x] `lib/docxTrackedChanges.ts` — 89%. Tracked-changes XML round-trip.
- [x] `lib/workflowCatalogSource.ts` (73%), `lib/workflowCatalogSync.ts` (96%).
- [x] `lib/chat/tools/toolSchemas.ts` — 100%.
- [x] `lib/userApiKeys.ts` — 81%, up from 13%.
- [x] `lib/userDataExport.ts` — 83%, up from 43%.
- [x] `lib/llm/aiSdk.ts` (87%), `lib/llm/providers.ts` (83%).

`lib/upload.ts` no longer exists — it was deleted upstream in 3663a10 ("add
direct upload sessions") and its replacement `lib/uploadSessions.ts` is at 95%.
That item is dropped rather than carried.

Still open:

- [ ] `lib/sseHeartbeat.ts` — 13%; 28 lines around one interval timer. Assert
      the keepalive is written on cadence, that a closed response is skipped,
      and that `stop()` clears the timer. Fake timers. (S)
- [ ] `lib/queue/runProgress.ts` — 0%; small progress-tracking helper. (S)
- [ ] `lib/userSettings.ts` — 63% of statements but only 40% of functions; the
      title/tabular model resolution paths are the untested half. Reuse the
      Supabase mock pattern from `userLookup.test.ts`. (S)
- [ ] `lib/officeText.ts` — 0%; office XML text extraction. Build a tiny
      in-memory zip fixture with JSZip and assert extracted/decoded text. (S)
- [ ] `lib/llm/rawStreamLog.ts` — 9%; log path construction and redaction with
      a mocked fs. (S)
- [ ] `lib/spreadsheet.ts` — 0%; parse a small in-memory xlsx fixture and
      assert sheet and cell extraction, including empty and edge cells. (M)
- [ ] `lib/tabular/**` — 36% across the directory and the biggest single block
      of untested code outside `lib/mcp`. Start with `tabular.prompt.ts` (0%,
      pure string building) and `tabular.rows.ts` (55%), not the extract and
      stream pipeline. (M)
- [ ] `lib/mcp/servers.ts` — 0%; server config validation and allow-listing
      logic. Security relevant. (M)
- [ ] `lib/mcp/client.ts` (23%) + `lib/mcp/oauth.ts` (3%) — connection
      lifecycle and OAuth token handling with a mocked MCP SDK. Security
      relevant. (M)
- [ ] `lib/courtlistener.ts` — 2%; API client with mocked fetch: query
      building, pagination, and error paths. Legal-research correctness. (M)
- [ ] `lib/contentAccess.ts` (59%) and `lib/projectAccess.ts` (60% of
      statements, 44% of functions) — authorization helpers, so the uncovered
      branches are the ones that matter most. (M)
- [ ] `lib/storage.ts` — 54%; S3 upload/download/list/delete wrappers with a
      mocked AWS SDK client. (M)
- [ ] `lib/dbq/runner.ts` — 59%; job runner loop, retry, and failure handling.
      (M)
- [ ] `lib/chat/contextBuilders.ts` — 46%; context assembly from doc stores.
      Assert doc labels, truncation, and ordering. (M)
- [ ] `lib/chat/tools/toolDispatcher.ts` — 41%, and still the largest drag on
      `lib/chat/tools`. Characterisation tests now pin the dispatch loop's
      fall-through behaviour; what remains is the body of each tool branch.
      Cover them with stubbed tools rather than trying to exercise every tool
      end to end. (M)
- [ ] `lib/chat/tools/documentOps.ts` — 59%; the pure helpers
      (`safeGeneratedFilename`, `normalizeWithMap`, `findTextMatches`, the
      turn-read helpers) are now characterised. What remains is the generation
      and edit paths, which need a mocked storage layer. (M)
- [ ] `lib/chat/streaming.ts` — 54%; streaming loops are the hardest to unit
      test here. Consider extracting pure chunk-parsing helpers first. (M)

Not worth unit testing directly: `lib/convert.ts` is a thin wrapper around
LibreOffice, and `lib/pdfjs.ts` is a type facade whose only executable
statement is a dynamic `import()` — its 0% is structural, not a gap. Both are
better exercised by the e2e suite.

## Cross-tenant denial coverage (ticket 2059)

The backend runs as service role against a policy-free schema, so tenancy is
whatever the handler remembers to check. There is no database backstop: a route
that forgets `.eq("user_id", …)` hands over another tenant's row and nothing
underneath objects. 2059's acceptance is therefore "every route with a
tenant-scoped resource has a test proving another tenant is denied".

Each cross-tenant suite uses a Supabase fake that **enforces `.eq()` filters**,
so removing a tenancy filter turns the tests red rather than leaving them
quietly passing.

| Router | Denial coverage | Where |
| --- | --- | --- |
| `documents` | yes | `documents.crossTenant.test.ts` |
| `workflows` | yes | `workflows.crossTenant.test.ts`, `workflows.routes.test.ts` |
| `library` | yes | `library.crossTenant.test.ts` |
| `downloads`, `quickActions` | yes | `smallRouters.crossTenant.test.ts` |
| `uploadSessions` | yes | `uploadSessions.crossTenant.test.ts` |
| `projects` | yes | `projects.routes.test.ts` |
| `tabular` | yes | `tabular.routes.test.ts` |
| `chat`, `projectChat`, `wordChat` | yes | their `*.routes.test.ts` |
| `user` | yes | `user.routes.test.ts` |
| `documentsUpload` | yes | `documentsUpload.routes.test.ts` |
| `orgs` | yes | `orgs.routes.test.ts` — "404s an org the caller does not belong to", "hides the resource inventory from non-members", "404s somebody else's invitation rather than confirming it exists" |
| `audit` | yes | `routes/__tests__/audit.test.ts` — scoping is asserted where it is decided, on the query builder: "scopes to own events OR accessible project events", "falls back to own-events-only when no projects are accessible" |

Deliberately **not** covered, because they hold no tenant-scoped resource:

| Router | Why |
| --- | --- |
| `auth` | Authentication itself. There is no other tenant's resource to reach. |
| `models` | Provider catalogues (OpenRouter, Vercel AI Gateway, OpenCode). Global data behind a server-side key. Per-user model choices live in `user`. |
| `sourceDocuments` | Public case law from CourtListener, keyed by cluster id. The in-flight dedupe map is keyed `${userId}:${documentId}`, so one caller's fetch cannot serve another's. |
| `workflowAddons` | Reads a global add-on catalogue and writes only the caller's own rows — the imported workflow is created with `user_id: userId`. |

> **A warning about measuring this by grep.** Counting `404`/`403` assertions
> and literal `"u1"`/`"u2"` identities gets it wrong in both directions. It
> reported `orgs` as uncovered (it uses a mutable `currentUser`, not literals)
> and `audit` as uncovered (it asserts scoping on the query builder rather than
> over HTTP), while a high count proves nothing about *which* denial is
> asserted. Read the test titles.

## Ratchet policy

`backend/vitest.config.mts` enforces global coverage **floors**. They are a
no-regression ratchet, not a target. The "Backend build and tests" CI job runs
`npm run test:coverage`, so a drop below a floor fails the build. (It ran plain
`npm test` until the floors were raised to the measured numbers, which meant the
thresholds were never evaluated in CI at all.)

The config is the only place the numbers live. This section deliberately does
not repeat them: it used to, and the copy here drifted more than thirteen
points out of date before anyone noticed, which is worse than not stating them
at all.

- **Floors only go up.** Never lower them to get a PR green — that means your
  change removed tested behavior or added a large untested lib; add tests
  instead.
- **Raise them in the same PR that adds tests.** After your suite passes, run
  `npm run test:coverage`, take the new global numbers, and set each floor to
  the measured value rounded down to a whole percent.
- Keep the measured numbers in the config comment and in the sections above
  honest when you do.
- Coverage is scoped to `src/lib/**` (`coverage.include`). Route tests move the
  global numbers only where they reach lib code that was not already covered,
  so a route-level PR can legitimately produce a 0.00 delta.

### When an upstream merge drops the measured numbers

This repository tracks an active upstream, so a merge can land a large,
untested file through no fault of the merging PR. That is the one case where
the measured number falls without anyone removing a test, and floors rounded
down to whole percents leave under a point of margin to absorb it.

Do not quietly lower a floor inside a merge commit. Either cover the incoming
code, or lower the floor in a separate commit that names the upstream file
responsible — so the lowering is visible in the history instead of buried in a
merge diff — and raise it again in the PR that adds the tests.
