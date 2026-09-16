# Data retention, storage and deletion

What this service stores, where, for how long, what it logs, and what actually
happens when something is deleted.

This describes the code as it is, not an intention. Every claim below is
traceable to a named file, and where the behaviour is surprising or incomplete
it says so rather than rounding up. It is written to be usable as the basis of
an answer to a client security questionnaire; the [Known
gaps](#known-gaps) section exists because a policy that omits its own
exceptions is worse than none.

## Where data lives

Two places, and nothing else holds client content:

| Store | What it holds |
| --- | --- |
| PostgreSQL, via Supabase | Every row: documents and their version metadata, chats and messages, tabular reviews and cells, workflows, organizations, access grants, audit events. |
| S3-compatible object storage (Cloudflare R2 by default; `R2_BUCKET_NAME`, default bucket `mike`) | Every byte of file content: uploaded source files, PDF renditions, generated documents, extracted text, export artifacts. |

Object keys are structured by owner:

| Prefix | Contents | Written by |
| --- | --- | --- |
| `documents/<userId>/<docId>/source.<ext>` | The uploaded file as it arrived | `storageKey()` |
| `documents/<userId>/<docId>/<stem>.pdf` | PDF rendition for the viewer | `pdfStorageKey()` |
| `documents/<userId>/<docId>/versions/<slug>.<ext>` | Each subsequent version | `versionStorageKey()` |
| `documents/<userId>/<docId>/edits/<versionId>.docx` | Assistant edits awaiting accept or reject | `documentOps.ts` |
| `generated/<userId>/<docId>/generated.<ext>` | Documents the assistant produced | `generatedDocKey()` |
| `extracted-text/<versionId>.txt` | Cached plain text of a version | `extractedTextKey()` |
| `exports/<userId>/<jobId>-<filename>` | Full account exports | `dbq/handlers.ts` |
| `workflow-references/<userId>/…` | Legacy workflow reference files. Nothing writes this prefix now — `20260901_03` gave each one a version row carrying its original path — but objects under it still exist and the deletion sweep still reads it | (historical) |

`extracted-text/` is the one prefix keyed by version rather than by user,
which is why the delete paths handle it explicitly — a per-user prefix sweep
cannot reach it.

## Who can read it

The backend connects as the Supabase **service role**, which bypasses row-level
security entirely. RLS is therefore not what protects client data; the route
handlers are. Two CI checks hold that line:

- `npm run tenancy` fails the build on a route handler that queries the
  database without ever using the caller's identity.
- `npm run schema-privileges` fails the build on a table in `schema.sql` that
  is not revoked from `anon` and `authenticated`, so PostgREST — reachable by
  anyone holding the publishable key — cannot serve a row at all.

Cross-tenant denial tests assert the runtime half — that one user's identity
cannot reach another user's rows through any router. They live beside the
other integration tests, as `*.crossTenant.test.ts`.

## How long data is kept

**There is no automatic content retention or expiry.** No TTL, no scheduled
purge, no archival tier. A document, chat, review or generated file lives until
something explicitly deletes it: a user action, an organization action, or
account deletion. `backend/src/lib/maintenance/staleWork.ts` is the only
scheduled sweep, and it does not delete anything — it flips transient statuses
that lost their owner ("processing", "generating") to a terminal error so the
UI stops showing a spinner.

Four things do expire, and none of them is content:

| Thing | Lifetime | Defined in |
| --- | --- | --- |
| Upload session | 30 minutes | `UPLOAD_SESSION_TTL_SECONDS` |
| Pre-signed upload URL | 15 minutes | `UPLOAD_URL_TTL_SECONDS` |
| Auth handoff ticket | 120 seconds (configurable 30–300) | `authHandoff.ts` |
| Signed download token | Per token, checked on use | `downloadTokens.ts` |

If a client asks "what is your retention period", the honest answer is that
there is not one: the service keeps what the customer keeps, and deletes on
request. Whether that is the right answer is a policy decision, not a code
one — see [Known gaps](#known-gaps).

## What is logged

Covered in full by [docs/observability.md](observability.md). In summary: one
JSON line per HTTP request carrying request id, user **id** (never email),
matched route pattern (never the concrete path), status and duration. Request
bodies, response bodies, headers, cookies, query strings and remote IP are
never written. Redaction helpers in `backend/src/lib/safeError.ts` scrub
secrets from anything else that reaches a log, and a probe test plants canary
values in each position to prove it.

Separately, `audit_events` rows are a deliberate, durable record, and they are
**not** content-free. A chat-turn event stores a `title`, and when the chat has
no title yet that title is the first 120 characters of the user's message
(`backend/src/routes/chat.ts`, capped again at 300 by `audit.ts`). Document
events store filenames. So an audit row can carry a prompt excerpt and a
client's document name, alongside the user's id and email.

That is a deliberate trade — an audit trail that cannot say what happened is
not an audit trail — but it means audit rows are client data and are treated
as such: account deletion removes them.

## What deletion actually does

### Deleting one version of a document

`DELETE /single-documents/:documentId/versions/:versionId`

This is a **soft delete of the row and a hard delete of the bytes**, and the
distinction matters:

- The objects are deleted from storage, through the durable
  `storage.cleanup` job rather than inline: `storage_path`,
  `pdf_storage_path`, **and** the cached `extracted-text/<versionId>.txt`,
  which holds the version's full plain text. The path columns are nulled in
  the same handler, so a swallowed failure would leave the bytes with nothing
  pointing at them; the queue is what stops that.
- The row survives, with `deleted_at` and `deleted_by` set and both path
  columns nulled.
- Therefore the **content is gone but the metadata is not**: filename, file
  type, size in bytes, page count, `content_sha256`, version number, and who
  deleted it when all remain indefinitely.

A `content_sha256` of a deleted file is a fingerprint of client content. It
cannot reconstruct the document, but it can confirm whether a given file was
once uploaded. Treat it as retained metadata, not as nothing.

The last remaining version of a document cannot be deleted this way (400).

### Deleting a document

`DELETE /single-documents/:documentId`

Hard delete. Every version's `storage_path`, `pdf_storage_path` and cached
`extracted-text/<versionId>.txt` are collected first, the `documents` row is
deleted (cascading to `document_versions`), and only then are the objects
removed — through the durable `storage.cleanup` job, so a storage outage
retries rather than silently leaking. Row first, bytes second: if the row
delete fails nothing has been touched, and if the process dies in between the
queued job still finishes the work.

### Deleting a project

`deleteProjectsByIds()` gathers the project's documents, chats, tabular reviews
and subfolders and deletes them along with the project.

### Deleting an account

`deleteUserAccountData()` in `backend/src/lib/userDataCleanup.ts` is the real
definition. Its ordering is deliberate and worth stating, because each step
protects the next:

1. **Partition owned projects** into personal and organization-owned.
   Retention follows the *organization's* projects, not the user's: content
   inside an org project is kept and detached, so a colleague's work does not
   vanish when a person leaves.
2. **Collect version storage paths up front**, before any row is deleted — the
   version rows are the only record of those paths, and they are about to
   cascade away.
3. **Revoke grants** addressed to the user's email (project access, chat and
   review invitations), which can outlive the account, and delete export
   artifacts under `exports/<userId>/`.
4. **Detach org project content** to the organization *before* the by-user
   deletions run, so those deletions no longer match the kept rows.
5. **Delete rows**: documents, tabular reviews and their chats, chats, word
   documents, subfolders, hidden workflows, open-source submissions, workflow
   shares (both directions), quick actions, default workflow installations,
   projects, workflows, and `audit_events` for that user.
6. **Delete the bytes** only once every doomed row is gone. Doing this earlier
   left a live account whose documents all 404 on any failure; in this order a
   failure leaves orphaned bytes instead, which the next step reclaims.
7. **Sweep orphans** under `documents/<userId>/` and
   `workflow-references/<userId>/`, deleting anything no surviving row claims.
8. **Settle organization membership**, promoting the longest-standing
   remaining member to admin where the departing user was the only one.

Audit rows are deleted with the account because they carry the user's id and
email, chat and document titles, and prompt excerpts. Note that
`audit_events.user_id` is also `on delete cascade` against `auth.users`, so
deleting the auth user erases the audit trail whether or not this function
runs.

## Sub-processors

Document text and prompts are sent to whichever model provider the user or
deployment selects. `providerForModel()` in `backend/src/lib/llm/models.ts`
routes by model id prefix to Anthropic, Google, OpenAI, OpenRouter, the Vercel
AI Gateway, opencode-go, or a self-hosted Ollama endpoint. Which of these is
reachable depends entirely on which API keys the deployment sets; a deployment
that configures only Ollama sends nothing to a third party.

This service does not train on customer content: there is no training
pipeline in this repository and no path that feeds stored content back to a
provider for that purpose.

Prompts are retained in the chat and review rows described above, and — as
noted under [What is logged](#what-is-logged) — in `audit_events.title` as an
excerpt of up to 120 characters. They are not retained anywhere else.

Provider-side retention is the provider's, governed by whatever agreement the
operator holds with them; that is a question about your provider contracts,
not about this code.

## Known gaps

Stated plainly because a client questionnaire will find them anyway.

- **No retention policy exists to enforce.** Nothing expires content. If a
  contractual retention limit is ever agreed, there is currently no mechanism
  to honour it.
- **Deleted-version metadata is kept forever.** Filename, size, page count and
  content hash of a deleted version survive with no expiry, and nothing
  purges soft-deleted rows.
- **The orphan sweep does not cover every prefix.** It reads
  `documents/<userId>/` and `workflow-references/<userId>/` only — and the
  second of those is a legacy prefix nothing writes any more, since
  `20260901_03` gave every reference file a version row carrying its original
  path. Objects under `generated/<userId>/` are reached only through their
  version rows, so an interrupted generation that uploaded bytes before
  writing its row leaves an orphan nothing will ever collect.
  `extracted-text/` is keyed by version id rather than by user and is
  likewise reachable only through the row. One prefix is now swept
  bucket-side as well: the production bucket (`infra/modules/storage`)
  expires anything left under `upload-sessions/` after eight days, a backstop
  behind the backend's own cleanup of staging and sealed upload objects. That
  rule is scoped to the scratch prefix alone — the content prefixes above are
  deliberately not in it, so "nothing expires content" remains true.
- **`deleteOrphanedUserStorage` swallows its errors** by design, as documented
  best-effort cleanup. A failure there used to be invisible; ticket 2087
  closed that specific gap — see below.
- **Backups keep deleted content for a bounded window.** Deletion here means
  deletion from the live database and bucket. In the production footprint
  (`infra/`), the document bucket is versioned so it can be backed up, and a
  deleted or replaced file's bytes remain there as a noncurrent version for at
  most **one day** before a lifecycle rule removes them; the replicated backup
  bucket keeps that version for **35 days** (`infra/modules/backup`). Supabase's
  automated database backups follow the plan's retention (seven days of daily
  backups on Pro). Those windows belong in any answer about erasure timelines.

### Disposition of each silent failure path (ticket 2087)

The plan's own "done when" for this ticket is narrower than the ticket text:
every path below either **alerts** or is **documented as accepted**. Firing an
alert needs a destination, which is the SNS topic in stage 3's `observability`
Terraform module — not built yet, because it needs the AWS account. So
"alerts" below means the metric or log line an alert rule will attach to in
stage 3, not a rule that fires today. Nothing here is a drill; ticket 2087's
own acceptance criterion ("each alert has fired at least once") is unmet by
construction until that module exists.

| Failure path | Disposition |
| --- | --- |
| Queue backlog growth | **Signal exists.** `job_queue_depth` gauge, read live from `db_jobs`. See [observability.md](observability.md#metrics). |
| Repeated job failures | **Signal exists.** `job_outcomes_total{outcome="failed"}` separately from `"retry"`, so a rising failure rate is distinguishable from ordinary retry noise. |
| Model provider errors | **Signal exists.** `llm_calls_total{outcome="error"}`, by provider and model. |
| Storage failures | **Signal exists**, but by a different route: `lib/storage.ts`'s helpers log and return `null` rather than throwing, so the log line was always the only signal a caller saw. `logged_errors_total{source="storage"}` now counts those lines without editing the five call sites individually — the error-tracking bridge in `lib/errorTracking/` derives the counter from the same bracketed label every subsystem already logs under. |
| `deleteOrphanedUserStorage` swallowing its errors | **Fixed, not just signalled.** This was the one genuinely invisible path — a bare `catch {}` with no log line at all, so not even `logged_errors_total` could see it. It now logs (redacted) and increments `storage_cleanup_failures_total{operation="orphan_user_storage"}`, distinguishing a sweep-level failure (`stage="sweep"`) from per-file delete failures (`stage="delete"`, with the failed count). The tolerance itself — this must never fail an account deletion — is unchanged; only its silence is fixed. |
| Migration failures | **Accepted, deferred to stage 4.** Migrations are applied manually against production today, outside the running service's process (see [deployment.md](deployment.md)), so there is nothing in `backend/src` for a metric to observe. Stage 4's deploy workflow (`4.3`, tickets 2051/2052) is what runs a migration as part of a deploy; that workflow's exit code is the signal, and it belongs there, not here. |
| No retention policy / metadata never expires / orphan sweep's uncovered prefixes | **Accepted design gaps, not failure paths.** Nothing is failing silently here — these are things the system does not attempt, stated in the bullets above so a questionnaire finds them stated rather than discovered. Alerting does not apply to work that is not attempted. |
| Backups out of scope | **Accepted**, and explicitly not a failure path — it is a scope boundary of this document, restated above. |

Three of the six alertable paths already had metrics from ticket 2086; the
fourth (storage) was covered for free by routing through the existing
`console.error` bridge rather than by adding a call at each of the five
storage helpers. The fifth (the account-cleanup sweep) was the one actual bug
this ticket found: silence that was assumed to be merely a missing metric
turned out, on inspection, to have no log line either.
