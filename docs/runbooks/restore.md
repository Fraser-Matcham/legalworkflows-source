# Restore

The procedure ticket 2095 asks to prove, not assume: bring documents, chats
and reviews back from backup into a working application. Two stores, two
mechanisms, one drill.

| Store | Backup | Where | Granularity |
| --- | --- | --- | --- |
| Postgres (Supabase) | Supabase's automated daily backups | Dashboard → Database → Backups | one per day, seven kept on the Pro plan; point-in-time recovery is an add-on the operator can enable |
| Documents (S3) | continuous replication to `legalworkflows-production-documents-backup-<account-id>` | `infra/modules/backup` | every version of every object, kept 35 days after it is deleted or replaced in the live bucket |

Both are needed for the application to be whole: a document row without its
object opens nothing; an object without its row is unreachable.

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

## Accepted risks, written down

- Same-region backup. Protects against deletion and bugs, not against the
  loss of `eu-west-2`. Reasoning in `infra/modules/backup/README.md`.
- Daily database granularity unless PITR is enabled. Up to a day of writes
  lost on a full restore. The operator decides whether the add-on's cost is
  worth it once there are users whose day it would be.
- Thirty-five days. A deletion noticed later than that is permanent, and
  `docs/data-retention.md` says so.
