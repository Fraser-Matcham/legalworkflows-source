# Dependency upgrade: compatibility analysis and tactical plan

Dependabot opened twelve pull requests against the seeded tree. Five have
merged. The rest are blocked by major-version bumps bundled into grouped
updates, and the groups fail as a unit — one incompatible package takes fifteen
routine ones down with it.

This is a measured analysis of every major in play and a sequenced plan for
clearing them, so dependency drift stops blocking the delivery plan.

**Everything below was measured, not inferred from version numbers.** Each
major was installed against current `main`, compiled, and where possible run
through its own suite. Two of the three findings that matter contradict the
obvious reading of the changelog.

## Headline

| Assumed | Measured |
| --- | --- |
| Express 4 → 5 is a framework migration across 12 route files | One ~20-line helper plus a mechanical rename. Build clean, **117 test files / 1,383 tests pass**. |
| `lucide-react` 0.x → 1.x will break 80 icon imports | All 80 icons still exist. It breaks on **one line** of `word-addin/webpack.config.js`. |
| The `security-fixes` PR is a 3-package patch | ~200 packages. The advisories are transitive under a toolchain major. |

## Backend — PR #9

### `express` 4.21 → 5.2 (with `@types/express` 4 → 5)

`npm run build --prefix backend` fails with **160 errors across 12 route
files** — 105 × `TS2345`, 55 × `TS2322`, every one the same shape:

```
Type 'string | string[]' is not assignable to type 'string'.
```

`@types/express-serve-static-core` v5 widened `ParamsDictionary` values to
`string | string[]`, because Express 5's router supports repeatable parameters
(`/:id+`, `/:id*`) that capture more than one segment.

**This service defines none.** Scanned and confirmed zero matches for all of:

| Express 5 breaking change | Occurrences here |
| --- | --- |
| Repeatable / optional route params (`:id+`, `:id*`, `:id?`) | 0 |
| Wildcard route patterns (path-to-regexp 8) | 0 |
| `res.send(status)` legacy signature | 0 |
| `req.param()` method | 0 |
| `res.redirect("back")`, `res.sendfile` | 0 |

So the array arm is unreachable, and the 160 errors are pure type noise.

**Resolution, verified end to end.** A `routeParams(req)` helper returning
Express's own narrow `ParamsFlatDictionary`, plus a mechanical rename of the
159 `req.params` reads across 16 files — only 12 distinct destructure shapes,
so the rename is scriptable and reviews as a pure substitution.

Result: **build clean, 117 test files, 1,383 tests passed, 0 failed.**

That same run also exercised `bullmq` 5 → 6, `ioredis` 5 → 6 and
`html-to-text` 9 → 10, which ride in the same group. No failures.

**Caveat worth stating.** A green type check and unit suite do not cover two
Express 5 behaviour changes: rejected promises from async handlers are now
forwarded to error middleware automatically, and `req.body` is `undefined`
rather than `{}` when no body parser ran. Neither showed up in 1,383 tests, but
both touch the error-handling path. The `stack-tests` cross-tenant assertions
are the gate that matters here and they run on every pull request.

**Effort: ~half a day**, most of it re-reading the diff rather than writing it.

### Correction, found while executing this

The group is bigger than the headline packages suggest. Alongside Express it
also bundles `zod` 3 → **4**, `undici` 6 → **8**, `resend` 4 → **6** and
`pdfjs-dist` 4 → **6** — four more majors in a pull request whose title
mentions none of them. The first reading of this PR missed them by looking only
at what broke the build.

Backend exposure, measured: `zod` 3 files, `undici` 2, `bullmq` 8, `ioredis` 6,
`html-to-text` 1.

**`pdfjs-dist` needs particular care.** A naive grep says it is unused in the
backend. It is not: three files do
`await import("pdfjs-dist/legacy/build/pdf.mjs")`, and `chat/types.ts` does
`require.resolve("pdfjs-dist/package.json")`. Those are **deep paths into the
package rather than its public entry point** — exactly the fragility that broke
lucide-react, where a major silently moved the file being reached for. Any
`pdfjs-dist` bump must check that path still exists, in the backend as well as
the frontend.

**`resend` genuinely is unused.** Nothing imports the package anywhere, and
`routes/orgs.ts` says outright that the repository has no outbound email
infrastructure. The distinction worth keeping straight: `supabase/config.toml`
*does* use Resend, as an **SMTP provider** via `env(RESEND_API_KEY)`, and that
is unaffected by removing the npm SDK. Removing it also drops `react`,
`react-dom` and `@react-email/render` from the backend, which were present only
as its transitive dependencies.

Express, `zod`, `undici` and `pdfjs-dist` now carry major-version `ignore`
entries, so the routine `@ai-sdk/*` and `@aws-sdk/*` bumps in this group can
flow on their own. `bullmq` 6 and `ioredis` 6 came through the Express
verification run without failures.

## Word add-in — PR #8

### `lucide-react` 0.553 → 1.41

Every one of the **80 distinct icons** imported across `frontend/src` and
`word-addin/src` was checked against `lucide-react@1.43.0`. **All 80 exist.**
The icon rename risk is not real for this codebase.

What does break is a single line in `word-addin/webpack.config.js`:

```js
"lucide-react$": require.resolve("lucide-react/dist/esm/lucide-react.js"),
```

v1 reorganised `dist/`: the ESM entry moved from `lucide-react.js` to
`lucide-react.mjs`. The add-in's Playwright suite never starts —
`MODULE_NOT_FOUND` at `webpack.config.js:148`, webpack dev server exits 2, and
every test fails as a fixture error rather than an assertion.

**Resolution:** resolve through the package's declared `module` field instead
of a hardcoded path inside `dist/`, which is not a public API. Immune to the
next reorganisation.

`@tiptap/*` 3.29 → 3.31 (family), `react`/`react-dom` 19.2.0 → 19.2.8 and the
Radix bump are routine — `npm run typecheck --prefix word-addin` passes clean.

**Effort: under an hour.**

## Word add-in — PRs #6 and #13

Both bundle `office-addin-debugging` 5 → 6, which is where the size comes from:
~200 transitive package changes, including `@microsoft/teamsapp-cli` being
replaced by `@microsoft/m365agentstoolkit-cli`, `inquirer` 7 → 12, `glob`
7 → 13, `minimatch` 3 → 10, `@azure/msal-node` 2 → 5, and a fresh
`@modelcontextprotocol/sdk` tree.

**#13 also cannot install at all.** It bumps `@tiptap/core` alone; TipTap pins
its peers to exact versions, so `@tiptap/core@3.30.4` demands
`@tiptap/pm@3.30.4` while eleven siblings sit at 3.29.2. Hard `ERESOLVE`.
**PR #8 supersedes this** — it moves the family together, correctly.

#6 additionally carries `typescript` 5.4 → 7.0 and `@types/node` 22 → 26. The
first reading called the TS half desirable, on the premise that the rest of the
repository was already on 7. That premise was wrong — see the correction under
PR #22 below. The add-in's `npm run typecheck` fails on TS 7, and `typescript`
is now ignored at the major level in both `frontend/` and `word-addin/`.

The two real advisories behind #13 (`@xmldom/xmldom` 0.8.13 → 0.8.15, `tmp`
0.0.33 → 0.2.7) are **transitive under `office-addin-debugging`** and are
build-host tooling, not runtime code shipped to users.

**Re-read on the evening of 8 September, while clearing the queue.** #16's one
red check (`Typecheck and Playwright`) was a runner abort, not a test failure:
its `Run Playwright` step is recorded as still in progress, nothing after it
ran, and no test artefacts were uploaded. Its tree — `office-addin-debugging`
6.1.2 — passes `npm ci`, `typecheck`, `build:e2e` and the full add-in
Playwright suite (166/166) locally, and the `start`/`stop` CLI surface that
`scripts/start-dev.js` and `scripts/clear-sideload.js` use is identical
between 5 and 6. So the v6 migration was taken deliberately in #23 rather than
left as wave 4; #16 closes when `main` carries it. Of the two allowlisted
advisories it resolves `tmp` (0.2.7; that entry is removed) but not `adm-zip`:
6.1.2 still pins 0.5.12 exactly and the advisory covers everything below 0.6.0,
so that entry stays, with its reason rewritten for the new tree.

## Frontend — PR #11

| Package | Change | Exposure | Assessment |
| --- | --- | --- | --- |
| `pdfjs-dist` | 4.10.38 → **6.3.289** | 2 files | The real work. See below. |
| `lucide-react` | 0.553 → **1.41** | 128 imports | Safe — all icons exist, and the frontend has no `dist/` alias to break. |
| `@openrouter/sdk` | 0.3.11 → **1.2.106** | **0 files** | Unused. Not imported anywhere in `frontend/src`; "openrouter" appears only as a router identifier string. Removal candidate. |
| `@opennextjs/cloudflare` | 1.19 → 1.20 | 0 files | Build config only. |
| `marked` | 17 → **18** | 1 file | Small surface. |
| `katex` | 0.16 → 0.18 | 1 file | Small surface. |
| `docx-preview` | 0.3.7 → 0.4.0 | 4 files | Needs a visual pass on document rendering. |
| `@tiptap/*` | 3.22 → 3.31 | family | Correctly grouped. |

**`pdfjs-dist` carries a hidden coupling.**
`frontend/src/app/components/shared/views/highlightQuote.ts` hardcodes:

```ts
export const STANDARD_FONT_DATA_URL =
    "https://unpkg.com/pdfjs-dist@4.10.38/standard_fonts/";
```

Bumping the package without updating this line leaves the viewer loading fonts
from a 4.10.38 build against a 6.x runtime. It is also a **runtime dependency
on a third-party CDN** — the same class of problem as the SheetJS pin already
removed from the backend, and it will fail the same way on a restricted
network. Worth fixing regardless of the version bump: serve the fonts from the
application's own origin.

## Frontend — PR #7 (and its successor #22)

`Frontend build and tests` fails at lint:

```
Error: typescript-eslint does not support TS 7.0.
```

**Corrected after reproducing it.** The first reading of this blamed `eslint`
being pulled into 10.x. That was wrong on both counts, and the `ignore` entry it
produced was aimed at the wrong package.

Reproduced locally against #22: **eslint is 9.39.5 through the failure**, so its
major version is not involved. The actual trigger is `typescript`
**5.9.3 → 7.0.2**, and the copy of `typescript-eslint` that refuses to load is
the one nested under `eslint-config-next`.

The mistaken premise underneath was that the whole repository was already on
TS 7 and the add-in was the odd one out. Measured on `main`:

| Workspace | `typescript` | Resolved |
| --- | --- | --- |
| repo root | `^7.0.2` | 7.0.2 |
| `backend/` | `^7.0.2` | 7.0.2 |
| **`frontend/`** | **`^5`** | **5.9.3** |
| **`word-addin/`** | **`^5.4.5`** | **5.9.3** |

**Two** workspaces are on TS 5, not one, and the TS 7 that breaks lint is one
the pull request *introduces* rather than one already present. #17 fails
identically for the same reason — it bumps the add-in's `typescript`
`^5.4.5 → ^7.0.2` and `npm run typecheck` fails.

So `typescript` now carries a major-version `ignore` in both `frontend/` and
`word-addin/`. It lifts when `typescript-eslint` ships TS >= 7 support
([tracking issue](https://github.com/typescript-eslint/typescript-eslint/issues/10940)),
and both workspaces should move together at that point.

**Verified 8 September:** both pull requests are green once TypeScript is held
at 5. #22's frontend with `typescript` pinned back to `^5` and the lockfile
regenerated passes `test:coverage` (980 tests), `lint` (0 errors) and `build`,
so `vitest` 5, `jsdom` 30, `@testing-library/jest-dom` 7,
`@vitejs/plugin-react` 6 and `@types/node` 26 are all fine. #17's add-in with
the same pin passes typecheck, the webpack build and Playwright 166/166, so
`@types/node` 26, `webpack-cli` 7, `webpack-dev-server` 6 and
`@playwright/test` 1.63 are fine too. Once #23's ignores are on `main`, closing
#22 and #17 makes Dependabot regenerate both without the TS bump.

## The plan

Four waves. Each is independently mergeable and independently revertible, and
nothing in wave 1 or 2 blocks the delivery plan's own tickets.

### Wave 1 — free wins ✅ done

- ✅ `codeql-action` 3 → 4 (#5, #10), `setup-node` 4 → 7 (#2), root dev deps (#3)
- ✅ `actions/checkout` 4 → 7 (#1)
- ✅ **Removed `@openrouter/sdk`** (frontend) and **`resend`** (backend). Zero
  imports each, so these delete two major-version problems rather than solving
  them.
- ✅ `ignore` entries added for the majors that take whole groups down.

### Wave 2 — the two verified migrations ✅ done

- ✅ **Express 5.** `routeParams` helper plus the mechanical rename; express and
  `@types/express` only, not the other fifteen bumps #9 grouped with them.
  Build clean, 117 test files / 1,383 tests pass.
- ✅ **Word add-in group (#8).** The `webpack.config.js` alias fix landed first,
  then the `@tiptap/*` family, lucide-react 1.x, React 19.2.8 and Radix.
  `npm ci` clean, typecheck clean, 166/166 Playwright.

**#8 and #13 can now be closed** — #8's content is merged, and #13's TipTap half
is superseded by it. What remains of #13 is `office-addin-debugging`, which is
wave 4.

### Wave 3 — deliberate, individually ticketed (~2–3 days, not urgent)

- `pdfjs-dist` 4 → 6, together with moving `STANDARD_FONT_DATA_URL` off unpkg.
- `docx-preview`, `marked`, `katex` — small surfaces, but user-visible
  rendering; each wants a visual check.
- `typescript` 5 → 7 for the add-in **and** the frontend together, when
  `typescript-eslint` supports 7 (ignored at the major level until then).

### Wave 4 — deferred

- ~~`office-addin-debugging` 6~~ — ✅ taken in #23 after verifying it against
  the add-in suite (see the Word add-in section above).
- `eslint` 10 — blocked upstream. Nothing to do but wait.

### An `ignore` on a major does not stop a security update

`office-addin-debugging` carries a `version-update:semver-major` ignore, and
#13 was closed on the understanding that this would stop the group
regenerating in that shape. It did not: **#16 reopened it with the same
`^5.0.12 → ^6.1.2` bump and the same ~239 transitive changes.**

The reason is that `update-types: ["version-update:semver-major"]` filters
*version* updates only. The `security-fixes` group is declared
`applies-to: security-updates`, which is a different update type, and Dependabot
will still reach for a major when that is the only version resolving the
advisory.

Silencing it would need a `dependency-name` ignore with no `update-types`,
which suppresses the security update too — and hiding an advisory is worse than
carrying a red pull request. So #16 stayed open and visible until the migration
it proposed had been verified and taken deliberately (#23); Dependabot closes it
once `main` carries `office-addin-debugging` 6.

### Configuration change that stops this recurring

Add `ignore` entries for the `version-update:semver-major` update-type on the
packages that repeatedly take a whole group down — `express`, `pdfjs-dist`,
`office-addin-debugging`, `eslint`. Majors then arrive as their own pull
requests instead of poisoning fifteen routine bumps, and the grouped updates
start flowing again on their weekly schedule.

### Advisories are published against a lockfile, not a diff

Three high advisories were published during the few hours this queue was being
cleared, and each turned a green check red with no change to any diff:
`@xmldom/xmldom` 0.8.x (eight GHSAs, add-in), `js-yaml` <4.3.2 (add-in) and
`sharp` <0.35.4 (frontend, via `miniflare`). Every pull request audits the
merge with `main`, so a fresh advisory against `main`'s lockfile reddens the
whole queue at once, and a pull request that passed its audit at 22:07 can fail
the identical audit at 22:17.

The response is mechanical and should stay so. When a fix exists inside the
declared ranges, take it as a one-entry lockfile bump (`npm update <pkg>
--package-lock-only`, then the gate, `npm ci` and the workspace's own checks):
that was `@xmldom/xmldom` → 0.8.15 and `js-yaml` → 4.3.2. When no fix exists
anywhere — `sharp` is pinned exactly by `miniflare`, and even `miniflare@latest`
still pins the vulnerable version — allowlist it with a reason that says where
the code runs and a `REMOVE WHEN` that names the command to check. The gate
prints unused allowlist entries as `note:` lines rather than failing, so a
resolved entry (`tmp`, after `office-addin-debugging` 6) is removed in the same
change that resolves it.

## Two structural findings, unrelated to any single PR

**Runtime CDN dependencies.** The `pdfjs-dist` font URL is the second instance
of the pattern that made `npm ci` fail on the backend. Both are third-party
hosts fetched at runtime or install time, and both fail closed on a restricted
network. Worth an explicit sweep for others before the infrastructure phase.

**Action pinning is not what the repository says it is.** `security.yml`
carries the comment *"Pinned to commit SHAs, not tags — repo-wide posture since
#246"*. In fact **6 of 29** action uses are SHA-pinned; the other 23 are mutable
tags (`actions/checkout@v4`, `supabase/setup-cli@v3`, and so on). Inherited from
upstream rather than introduced here, but the comment overstates the reality and
should either be made true or reworded.
