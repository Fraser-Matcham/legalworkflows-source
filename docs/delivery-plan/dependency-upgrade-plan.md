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

#6 additionally carries `typescript` 5.4 → 7.0 and `@types/node` 22 → 26. That
half is *desirable*: the rest of the repository is already on TS 7, and the
add-in is the only component still on 5. Worth separating and taking.

The two real advisories behind #13 (`@xmldom/xmldom` 0.8.13 → 0.8.15, `tmp`
0.0.33 → 0.2.7) are **transitive under `office-addin-debugging`** and are
build-host tooling, not runtime code shipped to users.

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

## Frontend — PR #7

`Frontend build and tests` fails at lint:

```
Error: typescript-eslint does not support TS 7.0.
```

The group pulls `eslint` into 10.x while `eslint-plugin-import`,
`eslint-plugin-jsx-a11y` and `typescript-eslint` are all still on the `^9`
generation. **Nothing to fix on this side** — it clears when
`eslint-config-next` ships a `typescript-eslint` that supports TS 7.

## The plan

Four waves. Each is independently mergeable and independently revertible, and
nothing in wave 1 or 2 blocks the delivery plan's own tickets.

### Wave 1 — free wins (done, or ~1 hour)

- ✅ `codeql-action` 3 → 4 (#5, #10), `setup-node` 4 → 7 (#2), root dev deps (#3)
- `actions/checkout` 4 → 7 (#1) — merge on green
- **Remove `@openrouter/sdk`** from `frontend/package.json`. Zero imports; this
  deletes a major-version problem rather than solving it.

### Wave 2 — the two verified migrations (~1 day)

- **Express 5 + backend group (#9).** Land the `routeParams` helper and the
  rename as one reviewable change, then the dependency bump on top. Already
  verified green locally.
- **Word add-in group (#8).** One-line `webpack.config.js` alias fix, which also
  unblocks the `@tiptap/*` family and closes the TipTap half of #13.

### Wave 3 — deliberate, individually ticketed (~2–3 days, not urgent)

- `pdfjs-dist` 4 → 6, together with moving `STANDARD_FONT_DATA_URL` off unpkg.
- `docx-preview`, `marked`, `katex` — small surfaces, but user-visible
  rendering; each wants a visual check.
- `typescript` 5 → 7 for the add-in, aligning it with the rest of the tree.

### Wave 4 — deferred

- `office-addin-debugging` 6 and the toolchain migration behind it. The add-in
  is not deployed in these 24 weeks (assumption 15) and the advisories are
  build-host only.
- `eslint` 10 — blocked upstream. Nothing to do but wait.

### Configuration change that stops this recurring

Add `ignore` entries for the `version-update:semver-major` update-type on the
packages that repeatedly take a whole group down — `express`, `pdfjs-dist`,
`office-addin-debugging`, `eslint`. Majors then arrive as their own pull
requests instead of poisoning fifteen routine bumps, and the grouped updates
start flowing again on their weekly schedule.

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
