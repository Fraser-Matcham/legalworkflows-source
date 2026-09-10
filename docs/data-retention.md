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

- The objects (`storage_path`, `pdf_storage_path`) are deleted from storage.
  The cached `extracted-text/<versionId>.txt` is **not** — see
  [Known gaps](#known-gaps).
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
- **Deleting one version leaves its extracted text behind.** The handler
  removes `storage_path` and `pdf_storage_path` but never
  `extracted-text/<versionId>.txt`, which holds the version's full plain
  text — arguably the most readable copy of the content. The document-delete
  path does remove it; version-delete does not. The bound: because
  `collectDocumentVersionPaths` does not filter soft-deleted rows, deleting
  the document or the account still collects it, so this is not a permanent
  erasure failure. But a user who deletes a single version specifically to
  remove sensitive text leaves that text in object storage until the whole
  document or account goes.
- **The version-delete route uses fire-and-forget storage deletes.**
  `deleteFile(path).catch(() => {})`, with the path columns nulled *before*
  the delete. If the storage call fails, the bytes survive with nothing left
  pointing at them. This is the exact failure the document-delete path already
  fixed by moving to the durable `storage.cleanup` job. The orphan sweep at
  account deletion covers `documents/<userId>/`, so these do not survive
  account erasure — but they can outlive the document by a long way.
- **The orphan sweep does not cover every prefix.** It reads
  `documents/<userId>/` and `workflow-references/<userId>/` only — and the
  second of those is a legacy prefix nothing writes any more, since
  `20260901_03` gave every reference file a version row carrying its original
  path. Objects under `generated/<userId>/` are reached only through their
  version rows, so an interrupted generation that uploaded bytes before
  writing its row leaves an orphan nothing will ever collect.
  `extracted-text/` is keyed by version id rather than by user and is
  likewise reachable only through the row.
- **`deleteOrphanedUserStorage` swallows its errors** by design, as documented
  best-effort cleanup. A failure there is invisible.
- **Backups are out of scope of this document.** Deletion here means deletion
  from the live database and bucket. Whatever your Supabase and object-storage
  backup retention is, deleted content persists in it until those backups age
  out; that window belongs in any answer about erasure timelines.
