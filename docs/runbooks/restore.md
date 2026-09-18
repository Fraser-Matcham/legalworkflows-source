# Restore

The procedure ticket 2095 asks to prove, not assume: bring documents, chats
and reviews back from backup into a working application. Two stores, two
mechanisms, one drill.

| Store | Backup | Where | Granularity |
| --- | --- | --- | --- |
| Postgres (Supabase) | **None today.** See the warning below | — | — |
| Documents (S3) | continuous replication to `legalworkflows-production-documents-backup-<account-id>` | `infra/modules/backup` | every version of every object, kept 35 days after it is deleted or replaced in the live bucket |

Both are needed for the application to be whole: a document row without its
object opens nothing; an object without its row is unreachable.

> ### ⚠ There is no database backup
>
> Found by the 18 September 2026 drill, and true until someone changes it.
>
> Supabase backs up **Pro, Team and Enterprise** projects daily. This
> organisation is on the **Free** plan, so the Backups page has nothing to
> restore, and "restore into a new project" is not offered either. Supabase's
> own guidance for free projects is to "regularly export their data using the
> Supabase CLI `db dump` command and maintain off-site backups" — which is not
> being done: there is no scheduled dump, no database credential in Secrets
> Manager, and no EventBridge rule. The only `pg_dump` in this repository is
> `infra/dbtools/dbtools.sh`, which is the Stage 5 migration tool, runs inside
> the VPC, and is gated behind `platform_enabled` (false).
>
> **So a database loss today is unrecoverable.** Documents are safe — that half
> is replicated, retained 35 days, and was proved by restoring a genuinely
> deleted document — but the rows that make them reachable are not.
>
> Two ways out, and the operator picks:
>
> | | What it buys | Cost |
> | --- | --- | --- |
> | Upgrade the org to **Pro** | 7 days of daily backups, restore from the dashboard, PITR available as an add-on | Supabase's published Pro price per month, per org |
> | **Scheduled `pg_dump`** to the existing backup bucket | A dump on whatever schedule is set, kept beside the documents under the same 35-day retention | Needs a database credential in Secrets Manager and a job to run it |
>
> Everything below the warning assumes one of those is in place. Until then,
> the "The database" and "The drill" sections cannot be carried out.

## Which page you are actually on

| Situation | Go to |
| --- | --- |
| one document deleted or overwritten by mistake, database fine | [One document](#one-document) |
| the bucket, or a prefix of it, is gone | [Many documents](#many-documents) |
| the database is damaged (bad migration, bad delete, wrong deploy) | [The database](#the-database) — and then check documents, because a database restore can reference objects deleted since |
| the annual drill | [The drill](#the-drill) |

## One document

Find the version's storage key in the database (`document_versions`), then
its history in the backup bucket:

```sh
BACKUP=legalworkflows-production-documents-backup-<account-id>
LIVE=legalworkflows-production-documents-<account-id>
aws s3api list-object-versions --bucket "$BACKUP" --prefix "<storage_key>" \
  --query '{versions: Versions[].[VersionId,LastModified,Size,IsLatest], deletes: DeleteMarkers[].[VersionId,LastModified]}'
```

Copy the version you want back to the live bucket. The live bucket's default
encryption re-encrypts it under the documents key:

```sh
aws s3api copy-object --bucket "$LIVE" --key "<storage_key>" \
  --copy-source "$BACKUP/<storage_key>?versionId=<VersionId>"
```

Verify by opening the document in the application. If the row was deleted
as well, the row comes back with the database (below) — the object alone is
not enough.

## Many documents

The backup's *current view* is what was live at the moment of loss (delete
markers are replicated, so a deleted object is not current there either).
For loss of the bucket or a prefix with no deletes involved:

```sh
aws s3 sync "s3://$BACKUP/documents/" "s3://$LIVE/documents/"
# repeat for generated/, extracted-text/, exports/ as needed; never upload-sessions/
```

For a mass *deletion* — the current view is empty too — restore the
versions that were current before it, per key. Script it from
`list-object-versions` on each prefix, taking the newest `Versions` entry
older than the deletion time. Do this with the application's write paths
stopped (scale the backend to zero desired count, or take the storage
secret away) so nothing writes into the middle of it.

## The database

Supabase's restore replaces the live database with the backup — the project
is unavailable while it runs (minutes for this size), and **everything
written since the backup is lost**: sign-ups, chats, reviews, document
rows. That is the trade, and it is why this is a last resort after
[failed-migration.md](failed-migration.md) has been exhausted.

1. Take the application down first so no writes land during the restore:

   ```sh
   aws ecs update-service --cluster legalworkflows-production --service legalworkflows-production-backend --desired-count 0
   ```

   (Autoscaling's minimum is `desired_count`; set it back the same way
   afterwards and Terraform will not fight you — the service ignores
   `desired_count` drift.)

2. Dashboard → Database → Backups → the backup from before the damage →
   **Restore**. Confirm. Wait for the project to report healthy.

3. Bring the backend back (`--desired-count 1`) and check `/api/ready`.

4. **Reconcile documents.** Any document deleted between the backup and now
   has a row again but no object; any uploaded in that window has an object
   but no row. The first case is [One document](#one-document) for each — the
   objects are in the backup bucket. The second is unrecoverable as rows;
   the objects are still in both buckets and can be re-uploaded by their
   owners.

5. Auth: the `auth` schema is in the backup, so accounts and MFA factors come
   back with it. Sessions issued after the backup are invalid; users sign in
   again.

If point-in-time recovery has been enabled on the project, step 2 offers a
timestamp instead of a daily backup, and step 4's window shrinks to minutes.
PITR is a Pro-and-above add-on, so it presupposes the upgrade in the warning
at the top.

## The drill

Once, after the footprint is applied, and then yearly. The acceptance
criterion (2095): "a restore drill completes with the application fully
functional against the restored data." Into a *clean environment*, so
production is untouched:

1. **Database.** In the Supabase dashboard, restore the latest daily backup
   into a **new project** (the Backups page offers this on plans that
   support it; if it does not, download the backup and load it into a new
   project with `psql`). Note the new project's URL and keys.
2. **Documents.** Create a scratch bucket and `aws s3 sync` the backup
   bucket's current view into it, or point the drill at the backup bucket
   read-only — the restored database's storage keys resolve there
   unchanged.
3. **Application.** Run the local Docker Compose stack
   (`docs/local-development.md`, `docs/safe-local-testing.md`) with
   `SUPABASE_URL`, the keys, `R2_ENDPOINT_URL`, `R2_BUCKET_NAME` and
   `R2_REGION` pointed at the restored project and the scratch bucket, and
   `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` for a temporary IAM user with
   read on that bucket.
4. **Prove it.** Sign in as a test account that existed in the backup. Open a
   project; open a document and its PDF rendition; open a chat and read its
   history; open a tabular review and its cells; download an export and
   verify its manifest (`docs/tamper-evident-exports.md`). Each of those is a
   different table joined to a different object prefix — the criterion's
   "documents, chats and reviews all come back intact and readable".
5. **Record.** Date, backup used, time taken, what did not work. Then delete
   the drill project, the scratch bucket and the temporary user.
6. **Tick** row 3.11 in `docs/delivery-plan/v2/plan.md`.

## Drill record

### 18 September 2026 — partial. Documents proved, database impossible.

Ticket 2095, run against the live account. Production was not touched: every
call was a read, and nothing was written to either bucket or to the database.

**Documents — passed.** The decisive case was a real one rather than a
contrived one. A document uploaded at 14:02 and deleted at 14:05 the same day:

| | |
| --- | --- |
| Key | `documents/cb493838…/80772384…/source.docx` |
| In the live bucket | **404 — gone** |
| In the backup bucket | one surviving version, 19,275 bytes, ETag `34ce7a75a1b032f433188d0289e4c1b1`, written 14:03:38, with the replicated delete marker above it |
| Read back by version id | `ContentLength` 19,275 and ETag both match the listing exactly; content type `…wordprocessingml.document`; `aws:kms` |

So a document deleted in production is recoverable, byte for byte, by version
id. Supporting checks, all against the live account:

- Live and backup hold the same 8 objects, 326,913 bytes, **every key matching
  on size and ETag**, no drift in either direction.
- Every object reports `ReplicationStatus: COMPLETED`.
- The backup holds **74 versions (66 noncurrent) and 7 delete markers** — real
  history, and deeper than the live bucket, whose noncurrent tail is one day.
- "Write-locked" is accurate, though not via S3 Object Lock: the backup
  bucket's policy statement `OnlyReplicationWritesObjects` denies `PutObject`,
  `DeleteObject` and the tagging and ACL actions to every principal except
  `…:role/service/legalworkflows-production-s3-replication`.
- Replication is current, not historical: the six `mike-workflows/` templates
  written by deploy run 37 at 18:47 were already replicated with matching
  ETags when checked minutes later.

**Database — could not be attempted.** Step 1 has no input. The organisation
is on the Supabase Free plan; Supabase backs up Pro and above. There is no
self-managed dump either — no credential in Secrets Manager, no schedule, no
rule. The warning at the top of this file is the finding.

**What was at risk at the time:** 1 auth user, 1 project, 1 document,
1 document version, 0 chats, 141 `mike_workflows` rows and 6 assets. Small,
because there are no clients yet. The catalogue rows rebuild from the fork on
any deploy; the rest would not.

**Not attempted, and why:** step 3 runs the application against restored data
in Docker Compose. There was no restored database to point it at, and the
Docker daemon is unavailable in the environment the drill ran from. That step
stays unproven, so the acceptance criterion — "the application fully
functional against the restored data" — is **not met**, and 2095 stays open.
Row 3.11 is not ticked.

**Time:** about 25 minutes, all of it investigation; the drill proper never
started.

**Next drill:** when the database has a backup to restore. Re-run both halves
then, and do step 3 somewhere with a working Docker daemon.

## Accepted risks, written down

- Same-region backup. Protects against deletion and bugs, not against the
  loss of `eu-west-2`. Reasoning in `infra/modules/backup/README.md`.
- Daily database granularity unless PITR is enabled. Up to a day of writes
  lost on a full restore. The operator decides whether the add-on's cost is
  worth it once there are users whose day it would be.
- Thirty-five days. A deletion noticed later than that is permanent, and
  `docs/data-retention.md` says so.
