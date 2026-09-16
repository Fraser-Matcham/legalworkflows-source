# Manual and production deployment

Use this path when connecting Mike to managed Supabase and S3-compatible
storage instead of the infrastructure bundled with Docker Compose.

## Prerequisites

- Node.js 22 or newer
- npm and Git
- A Supabase project
- A Cloudflare R2, MinIO, or other S3-compatible bucket
- At least one supported model-provider API key, or an accessible Ollama server
- Optional: a CourtListener API token for case-law tools
- LibreOffice when DOC/DOCX-to-PDF conversion is required

## Database setup

For a fresh Supabase database, run the contents of `backend/schema.sql` in the
Supabase SQL editor. The schema file contains the complete current database
shape.

For an existing deployment, do not run the complete schema over production
data. Back up the database first, identify the last migration already applied,
then apply each newer file in `backend/migrations/` in filename order.
Migration filenames follow `YYYYMMDD_NN_<name>.sql`.

Keep the last applied migration filename with your deployment records. Do not
blindly replay the directory against production: migrations are written for an
expected starting schema, and a successful fresh install from `schema.sql` is
not evidence that an older database has completed every upgrade step. The
repository's schema-drift CI separately checks that its pinned historical
baseline converges with the fresh schema after all later migrations run.

Apply the workflow catalog migration before deploying the matching backend
release, then run the dedicated ingestion job from the built backend artifact:

```bash
cd backend
npm run sync:workflows
```

The job resolves `MIKE_WORKFLOWS_REF`, downloads and validates the raw
`Open-Legal-Products/mike-workflows` archive, uploads reference assets to the
configured S3-compatible storage, and transactionally replaces the active
`mike_workflows` catalog. Temporary archive and JSON files are deleted when the
job exits. Run this as a release job before directing traffic to the new
backend; backend startup itself only reads the database. Docker Compose runs
this sequence automatically for local/self-hosted deployments.

### The sync gates the release, and the catalogue is configured as optional

`.github/workflows/deploy.yml` runs this job on ECS from the newly built image
and treats its exit code as the verdict: a sync that cannot reach its catalogue
fails the deploy, after both images are built and before any traffic moves.

Everything around it says the opposite. `MIKE_WORKFLOWS_GITHUB_TOKEN` is an
optional operator secret — `backend_extra_secret_keys` defaults to `[]`, it is
commented out in `infra/terraform.tfvars.example`, and
`docs/runbooks/first-apply.md` says to add it "if you have them".
`workflows_repository` defaults to the upstream
`Open-Legal-Products/mike-workflows`, which a given deployment may or may not
be able to read. So an operator can follow the setup exactly as written and
still have every release fail at this step — which is what happened to deploy
run 12 on `main`.

The two are not reconciled yet, and reconciling them is a decision rather than
a bug fix. Either the catalogue becomes a documented prerequisite of
deploying, or the sync learns the difference between "not configured" — skip,
and say so — and "configured and failing" — stop the release. The second is
the better shape, because a catalogue that was never set up is not a release
failure, while a token that expired certainly is. It needs a way to tell those
apart that does not exist today: there is no "no catalogue" value, only a
default pointing at somebody else's repository.

Until it is settled, treat the catalogue as required. A failing sync now
prints the task's own output into the workflow log, so the reason is in the
run rather than a log stream you have to go and find.

## Environment

Copy the maintained examples:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

Edit both files with the credentials and URLs for your deployment. At runtime,
the frontend server needs only `API_BASE_URL`; browsers call the same-origin
`/api` gateway and receive no Supabase URL, key, or session token. The variable
is not needed while building the frontend.

Use:

- `NODE_ENV=production` so startup enforces HTTPS and secure-cookie invariants;
- the Supabase project URL for backend `SUPABASE_URL`;
- the anon/publishable key for backend `SUPABASE_PUBLISHABLE_KEY`;
- the service-role key for backend `SUPABASE_SECRET_KEY`; and
- the internal Mike backend origin for frontend `API_BASE_URL`.

Set backend `API_PUBLIC_URL` to the browser-reachable frontend gateway, including
its `/api` prefix (for example, `https://app.example.com/api`). OAuth providers,
including MCP connectors, must return through that public gateway; never use an
internal container hostname such as `http://backend:3001` for callbacks.

Never expose Supabase session tokens, the service-role key, model-provider
keys, or storage secrets in frontend JavaScript.

Production web auth cookies are `Secure`, `HttpOnly`, `SameSite=Lax`, path `/`,
and use the `__Host-` prefix. Word task-pane cookies additionally use
`SameSite=None` and `Partitioned` so an HTTPS pane embedded in Word on the web
can authenticate without exposing tokens to JavaScript. The add-in serves and
proxies `/api` from one origin; the backend still validates the original
`Origin` header. Terminate TLS at both public origins, and set `FRONTEND_URL`
plus `WORD_ADDIN_URL` to their exact values.

When `WORD_ADDIN_URL` is configured, also set a dedicated, high-entropy
`AUTH_HANDOFF_ENCRYPTION_SECRET`. Google OAuth transfers from its Office dialog
to the task pane using a request-bound, encrypted, single-use database ticket
that expires after two minutes. Apply
`20260825_01_auth_handoff_tickets.sql` before enabling this flow.

The first deployment intentionally signs out sessions created by older builds:
the web app deletes legacy Supabase local/session-storage entries and the Word
add-in deletes legacy OfficeRuntime access/refresh tokens. Users authenticate
once to establish the new cookie; tokens are not copied through JavaScript.

### Object-storage CORS for direct uploads

Mike's upload-session API gives an authenticated browser a short-lived signed
`PUT` URL for one specific staging object. The bucket must therefore allow
browser `PUT` requests from each deployed frontend origin. Configure the
equivalent of this CORS policy in Cloudflare R2, MinIO, RustFS, or the selected
S3-compatible provider:

```json
[
  {
    "AllowedOrigins": ["https://your-mike.example"],
    "AllowedMethods": ["PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type", "x-amz-*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

List exact trusted origins; do not use `*` for a production deployment. The
signed URL authorizes only its generated object key and expires independently
of the CORS cache. The backend still verifies the uploaded byte count and
copies accepted bytes to a non-signed, sealed key before queuing processing.
Each file is verified and queued as soon as its individual `PUT` completes;
the remaining files in the same session may continue uploading while the
worker creates documents or document versions from earlier files. Success and
definite transfer failure are both reported through the file's idempotent
completion endpoint. The client retries that control request and then polls the
session, whose status is derived from its file rows; there is no separate
session-wide completion request.

Upload sessions accept at most 50 supported files, 100 MB per file, and 2 GB
in total. Users may run multiple independent upload sessions concurrently and,
by default, may create at most 50 sessions per hour. Upload-session mutation,
polling, and hourly creation limits can be overridden with the
`RATE_LIMIT_UPLOAD_SESSION_*` environment variables documented in
`backend/.env.example`; missing or invalid values use the documented defaults.
Sessions that update the same mutable document version remain mutually
exclusive. Sessions
expire after 30 minutes, extended by a further 30 minutes each time a file
completes so a slow batch is not destroyed mid-upload, up to four hours from
creation; individual signed URLs expire after 15 minutes and can
be refreshed while the session is pending. These limits are enforced atomically
in PostgreSQL, not only in the browser.

The Express process also runs a durable upload-processing pool. By default,
each backend replica claims up to 8 jobs concurrently while PostgreSQL limits
each user to two active jobs across all replicas. Override these defaults with
`UPLOAD_PROCESSING_CONCURRENCY` (capped at 64) and
`UPLOAD_PROCESSING_MAX_RUNNING_PER_USER`; every claim loop polls the database,
so raising the pool raises idle query load in proportion. Workers claim jobs
with database leases, retry a failed file up to three times, and clean expired,
cancelled, and terminally failed temporary objects. A single document
conversion is killed after `UPLOAD_CONVERT_TIMEOUT_MS` (default 120000, clamped
to 10000-600000) and a worker stops renewing its lease after
`UPLOAD_JOB_WALL_CLOCK_MS` (default 900000, clamped to 60000-3600000) so a
wedged job is recovered by another worker instead of holding its slot. Terminal session metadata is retained
for seven days so clients can inspect outcomes, then deleted in bounded cleanup
batches.
Deployments must therefore run `backend/src/index.ts`
(the normal `npm start` entry point), rather than importing the Express app
without starting its worker.

Model-provider keys and the CourtListener token can be configured globally in
`backend/.env` or per user under **Settings > API Keys**. When a key is
configured globally, its matching field is read-only.

## Production configuration

### Origins — the backend refuses to start on a bad one

Two boot checks, and it is worth knowing which owns what, because they report
different faults and duplicating them would send you looking for two problems.

**`validateRuntimeConfiguration`** (`backend/src/lib/runtimeConfig.ts`,
inherited) already requires, in production:

| Variable | Rule |
| --- | --- |
| `FRONTEND_URL` | required, and must be HTTPS |
| `API_PUBLIC_URL` | required, and must be HTTPS |
| `WORD_ADDIN_URL` | must be HTTPS if set |

**`assertProductionConfiguration`** (`backend/src/lib/productionConfig.ts`)
covers the two things that one does not, both of which reach the CORS
allowlist:

| Gap | Why it matters |
| --- | --- |
| **`ALLOWED_ORIGINS` is not validated at all.** Its entries are split on commas and pushed straight into `configuredAllowedOrigins`. | Measured: with `ALLOWED_ORIGINS=http://evil.example.com`, a deployment that passes every existing check trusts that plain-HTTP origin for credentialed cross-origin requests. |
| **Loopback is not rejected.** `requireHttps` is satisfied by `https://localhost:3000`. | A copy-pasted development origin survives into production and trusts a page served from the caller's own machine. |

Both are quiet failures — nothing in the server's own logs shows either, which
is why they are a boot check rather than a note here. Any entry that is
unparseable, non-HTTPS, or loopback stops the process with a non-zero exit.

Nothing is checked outside production: local development legitimately serves
over plain HTTP on localhost.

For this deployment:

```
NODE_ENV=production
FRONTEND_URL=https://legalworkflows.co.uk
API_PUBLIC_URL=https://legalworkflows.co.uk
ALLOWED_ORIGINS=
WORD_ADDIN_URL=
```

`ALLOWED_ORIGINS` is normally empty. It exists for an additional trusted
origin, and every entry widens what may make credentialed calls, so add one
only for a reason you can name.

### Rate limits

Twelve limiters, all environment-driven, attached in `backend/src/app.ts`
before the routers. The defaults are development-shaped. These are **starting
values for a first production deployment**, not tuned figures — nobody has
traffic data yet, and the honest thing is to set them deliberately, watch, and
revise.

The principle: authentication limits are tight because they guard credential
stuffing and account enumeration; work limits are loose enough that a
legitimate heavy user never meets them, because a limiter that fires on real
work trains people to retry, which costs more than it saves.

| Limiter | Default | Production | Reasoning |
| --- | --- | --- | --- |
| `RATE_LIMIT_AUTH_LOGIN_MAX` (per IP / 15 min) | 30 | **20** | An office behind one NAT address shares this. 20 covers a handful of people fumbling passwords; credential stuffing needs orders of magnitude more. |
| `RATE_LIMIT_AUTH_ACCOUNT_MAX` (per account / 15 min) | 10 | **10** | Keyed by a one-way digest of the address, so it survives an attacker rotating IPs. Ten is already generous for one human. |
| `RATE_LIMIT_AUTH_EMAIL_MAX` (per hour) | 10 | **5** | Sign-up and password-reset send mail. This is the spend limit on the email provider as much as a security control. |
| `RATE_LIMIT_AUTH_MFA_MAX` (per 15 min) | 20 | **10** | A TOTP code is six digits; brute force needs far more than ten attempts, and no honest user needs them. |
| `RATE_LIMIT_AUTH_FLOW_MAX` (per 15 min) | 30 | 30 | OAuth and handoff. Unchanged — retries here are usually legitimate. |
| `RATE_LIMIT_GENERAL_MAX` (per 15 min) | 300 | **600** | The catch-all sits under every route. A document-heavy session makes many small calls, and this firing looks like the application is broken. |
| `RATE_LIMIT_CHAT_MAX` (per 15 min) | 30 | 30 | Each call is an LLM request with real cost. Unchanged. |
| `RATE_LIMIT_CHAT_CREATE_MAX` (per 15 min) | 60 | 60 | Unchanged. |
| `RATE_LIMIT_TOOL_RESULT_MAX` (per 15 min) | 2000 | 2000 | One assistant turn posts many tool results. Unchanged. |
| `RATE_LIMIT_UPLOAD_MAX` (per hour) | 50 | **200** | A due-diligence bundle is routinely more than fifty documents, and hitting this mid-upload is the worst moment to meet a limiter. |
| `RATE_LIMIT_EXPORT_MAX` (per hour) | 10 | 10 | Exports are expensive to build. Unchanged. |
| `RATE_LIMIT_DATA_DELETE_MAX` (per hour) | 20 | 20 | Unchanged. |

Exceeding a limiter returns **429**.

> Revisit these once there is a week of real traffic. The figures above are
> reasoned, not measured, and saying so is part of the record.

### Error tracking

Optional, and off unless `ERROR_TRACKING_DSN` is set. The redaction of
unhandled rejections and uncaught exceptions happens either way, so a
deployment that never configures a DSN still gains the part that matters most
for confidentiality — see
[docs/observability.md](observability.md#error-tracking) for why there is no
SDK and what the raw dump used to leak.

| Variable | Default | Production |
| --- | --- | --- |
| `ERROR_TRACKING_DSN` | unset (tracking off) | The project DSN. A malformed value disables tracking with a warning rather than failing the boot: a misspelled telemetry endpoint must not become an outage. |
| `ERROR_TRACKING_ENVIRONMENT` | `NODE_ENV` | `production` |
| `ERROR_TRACKING_RELEASE` | unset | The deployed commit sha, so an event points at a build. |
| `ERROR_TRACKING_SERVER_NAME` | unset | Distinguishes the API task from the worker task when both report. |
| `ERROR_TRACKING_MAX_EVENTS_PER_MINUTE` | 60 | 60. A failure loop must not flood the ingest or the egress budget. Suppression is logged once per window, so "quiet" is distinguishable from "throttled". |

The DSN's public key is not a secret — it is designed to ship in browser
bundles — but it still belongs in the secrets store with everything else,
because a leaked DSN lets a stranger fill the project's event quota.

### Metrics

`GET /metrics` serves Prometheus text exposition, and is **absent unless
`METRICS_TOKEN` is set** — with no token the endpoint answers 404, the same as
any unrouted path.

That default is deliberate. A metrics endpoint is not neutral data: route
labels enumerate the API surface, counts of 401s and 429s tell an attacker when
a probe is working, and queue depth and token spend describe the business. 404
rather than 401 also means a scan cannot learn the endpoint exists but is
locked.

| Variable | Default | Production |
| --- | --- | --- |
| `METRICS_TOKEN` | unset (endpoint absent) | A random 32-byte hex value, in the secrets store. `openssl rand -hex 32`. |

Scrape it with `Authorization: Bearer $METRICS_TOKEN`. Keep the route off the
public listener as well as behind the token — defence in depth, since the token
is the only thing standing between a scan and the exposition.

What is collected, and the cardinality rule that keeps it bounded, is in
[docs/observability.md](observability.md#metrics).

## Authentication email

Supabase Auth sends signup, email-change, and password-recovery messages.
Configure production SMTP in the Supabase dashboard; Mike does not require a
Resend API key for these messages.

In **Authentication > URL Configuration**, set the Site URL to the deployed
frontend origin and add that origin's `/auth/callback` URL to the redirect
allow list. For example:

```text
https://your-mike.example/auth/callback
```

Enable email confirmation for production signups. Keep secure email change
enabled so Supabase requires confirmation from both the current and proposed
addresses. Set the minimum password length to 10; this applies when passwords
are created or changed and does not invalidate existing shorter passwords. The
same callback handles signup confirmation, confirmed email
changes, and password-recovery links before sending the user to the appropriate
Mike page.

Review the Supabase email templates after changing the public Site URL, and
test every link against the deployed frontend before inviting users. Existing
deployments must also apply the latest migration so confirmed email changes are
mirrored into `user_profiles`.

## Google authentication

Create a **Web application** OAuth client in Google Auth Platform. Its
authorized redirect URI is the Supabase Auth callback shown on the Google
provider page, not Mike's frontend callback. For hosted Supabase it normally
has this form:

```text
https://<project-ref>.supabase.co/auth/v1/callback
```

Enable Google under **Supabase > Authentication > Providers**, then enter the
Google client ID and secret. In **Authentication > URL Configuration**, allow
both deployed Mike clients:

```text
https://your-mike.example/auth/callback
https://your-word-addin.example/oauth-dialog.html
```

The Word add-in completes authentication in an Office Dialog. The dialog gives
the task pane only an opaque, short-lived, single-use handoff ticket. The task
pane redeems it through the same-origin add-in proxy, and the backend writes its
HttpOnly cookie. No Supabase access or refresh token enters add-in JavaScript or
OfficeRuntime storage. The add-in also does not retain Google's provider access
token or request Google Drive or Gmail access.

## Install and run

Install dependencies:

```bash
npm install --prefix backend
npm install --prefix frontend
npm install --prefix word-addin
```

For development, start the packages in separate terminals:

```bash
npm run dev --prefix backend
```

```bash
npm run dev --prefix frontend
```

For production, build both packages and run their `start` scripts through your
process manager or deployment platform:

```bash
npm run build --prefix backend
npm run build --prefix frontend
```

The repository includes Dockerfiles for the backend, frontend, and Word add-in.
Build and run the production add-in host with its public URLs baked into the
static bundle and its private backend origin supplied only at runtime:

```bash
docker build -t mike-word-addin \
  --build-arg REACT_APP_WEB_APP_URL=https://app.example.com \
  --build-arg WORD_ADDIN_PUBLIC_URL=https://word.example.com \
  word-addin
docker run --rm -p 3200:3200 \
  -e WORD_ADDIN_BACKEND_ORIGIN=http://backend:3001 \
  mike-word-addin
```

Put an HTTPS ingress or reverse proxy in front of port 3200. The included host
serves `dist/` and streams `/api/*` to the backend while preserving cookies,
`Set-Cookie`, `Origin`, request bodies, and SSE responses.

## Background jobs and Redis

Mike runs durable background jobs (document conversion, tabular extraction,
audit recording, account deletion, storage cleanup, export builds) through one
of two interchangeable transports:

- **With Redis** (`REDIS_URL` set): jobs are delivered instantly through
  BullMQ, and tabular reviews stream live progress over Redis pub/sub. The
  bundled Docker Compose stack ships a Redis service and enables this by
  default for new installs.
- **Without Redis**: the same jobs run through a Postgres-backed queue
  (`db_jobs`, created by the schema/migrations) with a polling worker. No
  extra infrastructure is required — an existing deployment that upgrades in
  place keeps working with no configuration changes and no Redis. Progress
  streaming falls back to short database polls.

The transport is selected automatically; `QUEUE_DRIVER=postgres` forces the
database queue even when `REDIS_URL` is set.

By default, workers run in a worker thread inside the backend process, so no
extra process management is needed. To run them on separate hardware, start
`node dist/worker.js` (any number of instances — work is partitioned safely)
and set `WORKERS_MODE=none` on the API process. The compose file contains a
commented `worker` service demonstrating this.

## Deployment safety

- Generate unique, high-entropy signing and encryption secrets.
- Use production Supabase credentials rather than the local demo values.
- Keep backend secrets out of `NEXT_PUBLIC_*` variables.
- Configure spending limits for model-provider keys where supported.
- Confirm LibreOffice is available on the backend process path if document
  conversion is enabled.
- Review storage, logging, retention, and deletion behavior before processing
  confidential documents.

See [Safe local testing](safe-local-testing.md), the [security policy](../SECURITY.md),
and [Troubleshooting](troubleshooting.md) for related guidance.
