# Repository Instructions

## Fork Rules

This repository is a private extraction of the AGPL-3.0 upstream
`open-legal-products/mike`, run as a standalone HTTP service that the Juralio
matter-management platform consumes. Four rules constrain every change made
here. They come before everything else in this file, and they override the
general guidance below wherever the two disagree. They exist to keep upstream
security fixes cheap to take and to keep the licence boundary intact.

### 1. The boundary to Juralio is HTTP, and only HTTP

Juralio reaches this service over HTTP and by no other means. Never introduce,
in either direction:

- an `import` or `require` that crosses the two repositories;
- a git submodule, npm workspace link, `file:` dependency, or path alias;
- a copied source file, type declaration, schema, or migration.

Re-declare shared types on each side rather than importing them; a duplicated
interface is the cost of the boundary, not a smell.

CI enforces this. `scripts/check-repo-boundary.mjs` fails the build on a
cross-repo import specifier, a submodule, a `file:`/`link:`/`portal:`
dependency, a tsconfig path alias, or a workflow that checks out both
repositories. Run it locally with `npm run boundary`.

This is a licensing boundary as much as an architectural one. AGPL-3.0
section 5(c) applies its terms to the work *as a whole* once the parts are
combined, and that combination cannot be undone afterwards. Juralio is
Apache-2.0 and must stay Apache-2.0. A single stray import relicenses it.

### 2. Rename what users can see, and nothing else

Debranding covers what a person or a link preview can see: rendered copy, the
wordmark, icon artwork, Open Graph metadata, the MFA issuer name, marketing
images.

Do **not** rename anything in the table below. Each is invisible to users, and
changing it costs either a migration against live data or a conflict on every
future upstream merge — for no user benefit.

| Do not rename | Reason |
| --- | --- |
| The `mike_workflows` and `mike_workflow_assets` tables — their indexes, unique and check constraints, the `replace_mike_workflows` function, and the `revoke`/`grant` statements in `backend/schema.sql` that keep them off `anon` and `authenticated` | A rename is a migration against live client data with real data-loss risk on rollback, and it touches the privilege grants the deny-all RLS posture depends on. |
| `MIKE_WORKFLOWS_REPOSITORY`, `MIKE_WORKFLOWS_REF`, `MIKE_WORKFLOWS_TOKEN`, `MIKE_WORKFLOWS_GITHUB_TOKEN` | Deployment configuration read by `backend/src/lib/workflowCatalogSource.ts`. Renaming breaks every environment simultaneously, and upstream keeps editing the file that reads them. |
| `frontend/src/app/lib/mikeApi.ts` (2,837 lines) and `word-addin/src/taskpane/api/mikeApi.ts`, and the symbols they export | Imported across the whole frontend and add-in. The rename is pure churn and conflicts with every upstream change to the API client. |
| The private package names in each `package.json` | Not published to any registry, never shown to a user. |

Point `MIKE_WORKFLOWS_REPOSITORY` at your own catalogue fork rather than
renaming the variable. The variable name is configuration; the value is
ownership.

A find-and-replace across this repository is always wrong. Over 300 files
mention the upstream name and only a few dozen of them are user-visible.

CI enforces the visible half. `scripts/check-trademarks.mjs` sweeps
`frontend/src`, `word-addin/src` and the add-in manifest for the upstream name,
wordmark and domain, ignoring comments so the identifiers this rule keeps do
not trip it. Run it locally with `npm run trademarks`.

It has an allowlist rather than a blanket ban because attribution is not
branding: AGPL-3.0 sections 5(a) and 5(b) *require* the modified work to name
the original, and `frontend/src/app/lib/legalNotice.ts` holds those strings.
Stripping them to finish a rename would breach the licence. Every allowlist
entry carries a written reason and prints on each run, and an entry marked
`"status": "deferred"` prints as `[DEFERRED]` — that is how a reference the
operator has chosen to leave in place stays visible instead of quietly becoming
permanent. Signatures include an occurrence count, so a *new* mark added to an
already-allowlisted file still fails the build.

### 3. Make changes additively, in new files, wherever you can

Upstream is active — 631 commits in its first four months — and this repository
tracks it. Every line changed inside an inherited file is a future merge
conflict; every new file is not.

Prefer, in this order: a new module beside the inherited one; a new exported
function in a new file that the inherited file calls once; a small, contained
edit. Reach for a rewrite of an inherited file only when there is no other way,
and say so in the pull request.

`upstream-main` is a pristine mirror of upstream's `main`. Nothing is ever
committed to it. See [docs/upstream-sync.md](docs/upstream-sync.md) for the
merge routine and the `package-lock.json` conflict convention.

### 4. `LICENSE` is never deleted, altered, or relicensed

The file at the repository root is the GNU Affero General Public License v3.0
and it stays exactly as it is. Do not remove it, do not edit it, do not add a
second licence file at the root that contradicts it, and do not add a header to
any inherited source file claiming different terms.

Removing or altering it does not change your obligations; it only removes the
evidence that you met them. AGPL section 2 lets you modify this code privately
for as long as you like, but section 13 obliges you to offer the Corresponding
Source to anyone who interacts with the running service over a network. Plan on
the basis that the source is reachable by every customer.

Adding your own copyright notice for your own new files is fine and expected.
Changing the terms is not.

## Scope

These instructions apply to the entire repository. Keep changes focused,
preserve unrelated work in the tree, and follow the more detailed guidance in
`CONTRIBUTING.md` and `docs/` when working in a documented subsystem.

The repository requires Node.js 22 or newer and contains three applications:

- `frontend/`: Next.js web application.
- `backend/`: Express API, document processing, database access, and LLM
  integration.
- `word-addin/`: Microsoft Word task-pane add-in.

The root `e2e/` directory contains the web application's Playwright tests.

## UI and Design

Read `docs/design-system.md` before making a non-trivial UI change. It is the
source of truth for tokens, spacing, surfaces, primitives, and accessibility.

Informational labels and statuses should normally be plain text rather than
decorative pill badges unless a pill is specifically requested. This does not
apply to established interactive pill controls such as `PillButton`,
`TabPillButton`, and `OptionPill`.

Before creating UI markup, search these locations in order:

1. `frontend/src/app/components/ui/` contains reusable web primitives such as
   buttons, inputs, dropdowns, search, empty states, and liquid-glass surfaces.
2. `frontend/src/shared/ui/` contains framework-light components rendered by
   both the web app and Word add-in. Files use the `XxxUI.tsx` convention, with
   thin web adapters or re-exports in `frontend/src/app/components/ui/` where
   appropriate. Code here must not import from `frontend/src/app/`.
3. `frontend/src/app/components/shared/` contains web-app building blocks that
   understand the application shell, including `PageHeader`,
   `TablePrimitive`, `TableToolbar`, `FileDirectory`, and side panels.
4. `frontend/src/app/components/modals/` and
   `frontend/src/app/components/popups/` contain the established modal,
   confirmation, and warning patterns.
5. `frontend/src/app/components/<feature>/` contains feature-specific web
   components. Keep one-off feature behavior here instead of turning it into a
   primitive prematurely.

For add-in-only work, low-level controls live in `word-addin/src/shared/ui/`
and reusable task-pane compositions live in
`word-addin/src/taskpane/components/primitives/`. If a component must render in
both the web app and add-in, prefer `frontend/src/shared/ui/`. When adding a
cross-target file there, also add its `@source` entry to
`word-addin/src/taskpane/styles.css` so Tailwind discovers its classes.

The web app is configured for shadcn's `new-york` style in
`frontend/components.json`. If no existing primitive fits a non-trivial
interaction, add the shadcn component from the `frontend/` directory so it
lands in `src/app/components/ui/`. Do not add a new UI dependency when an
existing primitive or Tailwind can solve the problem.

Design changes should follow the existing liquid-glass theme, use borders
sparingly, and use Lucide icons. Prefer the tokens and shared class constants
in `frontend/src/app/globals.css` and
`frontend/src/app/components/ui/liquid-surface.ts` over raw palette values,
custom hex colors, or copied shadow strings.

When changing layout or spacing, update the corresponding loading state at the
same time. Table skeleton helpers (`SkeletonLine` and `SkeletonDot`) live in
`frontend/src/app/components/shared/TablePrimitive.tsx`; the shared full-screen
gate is `frontend/src/app/components/shared/FullScreenLoader.tsx`. Many feature
loading states are colocated with their component, so search for
`animate-pulse`, `SkeletonLine`, and `SkeletonDot` in the affected feature.

Preserve the accessibility baseline:

- Every interactive element needs a visible focus indicator.
- Icon-only buttons need an accessible name, normally `aria-label`.
- Non-submit buttons inside forms need `type="button"`.
- Selection and toggle state must be represented with the appropriate ARIA
  attribute, not color alone.
- Use a native checkbox with `TABLE_CHECKBOX_CLASS` from
  `TablePrimitive.tsx` for standalone checkbox inputs. `CheckSquare` is the
  directory/picker row selection visual and is decorative by default.

## Frontend Structure

- Route and page components live in `frontend/src/app/`.
- Shared domain types live in
  `frontend/src/app/components/shared/types.ts`.
- Calls to the Express backend belong in `frontend/src/app/lib/mikeApi.ts` so
  authentication, API error parsing, and request behavior stay consistent.
- Reusable client behavior belongs in `frontend/src/app/hooks/` or
  `frontend/src/app/lib/`, with a colocated `*.test.ts` or `*.test.tsx` file.
- Use the `@/` alias for imports rooted at `frontend/src/`.

Do not expose raw backend, database, provider, or stack errors in the UI. Map
known 4xx responses to intentional messages and use the generic fallback
helpers in `frontend/src/app/lib/userFacingError.ts` for unexpected failures.

## Backend Structure

- `backend/src/app.ts` configures Express, middleware, rate limits, and route
  mounting.
- HTTP handlers live in `backend/src/routes/`.
- Reusable domain and infrastructure logic lives in `backend/src/lib/`.
- Authentication and other request middleware live in
  `backend/src/middleware/`.
- LLM provider creation is centralized in
  `backend/src/lib/llm/providers.ts`; shared AI SDK behavior lives alongside it
  in `backend/src/lib/llm/`.
- Backend unit and integration tests live under `backend/src/__tests__/` or
  beside the relevant module as `*.test.ts`.

Keep route handlers thin when logic is reusable. Preserve authorization checks
and ownership/project-sharing boundaries on every new query or mutation. CI
runs `npm run tenancy`, which fails the build on a route handler that queries
the database without ever using the caller's identity; genuinely global data
goes in `scripts/route-tenancy-allowlist.json` with a reason. Never
send internal exception messages to clients: use the helpers in
`backend/src/lib/httpError.ts`; logging must use the redaction helpers in
`backend/src/lib/safeError.ts`, which are documented with the request log
line in [docs/observability.md](docs/observability.md). Intentional
validation and permission failures should remain explicit 4xx responses.

## Database Migrations

`backend/schema.sql` is the complete fresh-install schema.
`backend/migrations/` contains incremental changes for existing deployments.

For every new migration:

1. Use the filename `YYYYMMDD_NN_<short_name>.sql`, where the date is the
   current date and `NN` is the next unused two-digit sequence for that date.
   Inspect the directory first; never create two migrations with the same date
   and sequence. Historical filenames do not all follow the current convention.
2. Add `-- Migration date: YYYY-MM-DD` at the top.
3. Make the new migration safe to re-run where possible: use `if exists` / `if
   not exists`, `create or replace` for functions, drop-before-create for
   policies and constraints, and guarded data backfills or type changes.
4. Update `backend/schema.sql` with the migration's final database shape in the
   same change.
5. Preserve RLS, grants, ownership, security-definer settings, and explicit
   `search_path` hardening when changing database objects.

Existing deployments apply only files newer than their recorded version, in
filename order. Do not assume every historical migration is safely replayable,
and do not apply migrations to a remote or production database unless the user
explicitly requests it and the target has been confirmed. See
`docs/deployment.md` for deployment procedure and `.github/workflows/schema-drift.yml`
for the fresh-versus-upgraded schema check.

## Verification

Choose the smallest verification that can catch the regression, and expand it
for cross-cutting or high-risk changes. A build is not required after every
small edit, but relevant tests are required for risky behavior changes and
when specifically requested.

Common commands from the repository root:

```bash
npm test --prefix backend
npm run build --prefix backend

npm test --prefix frontend
npm run test:coverage --prefix frontend
npm run lint --prefix frontend
npm run build --prefix frontend

npm run typecheck --prefix word-addin
npm run build --prefix word-addin
npm run test:e2e --prefix word-addin

npm run test:e2e
npm run test:e2e:local
npm run test:stack --prefix backend
```

Use targeted Vitest files while iterating, for example:

```bash
npm test --prefix backend -- src/__tests__/integration/tabular.routes.test.ts
npm test --prefix frontend -- src/app/components/ui/button.test.tsx
```

The stack and browser suites require their documented local services. Consult
`docs/frontend-testing.md`, `docs/e2e-ci.md`, and `docs/safe-local-testing.md`
before running them. New behavior should normally have a regression test at
the lowest useful layer: unit first, route integration second, and Playwright
only when a real browser flow is necessary.

When changing dependencies, update the `package-lock.json` belonging to the
affected package. Before handing off work, run `git diff --check`, inspect the
diff for unrelated changes, and report which verification commands were run.

## Pull Requests

Keep a pull request focused on one feature, bug, or cleanup. Write PR
descriptions in Markdown and include:

- Summary.
- What changed.
- Why it changed.
- Testing performed.

Do not commit secrets, API keys, private documents, `.env` files, build output,
or local test artifacts.
