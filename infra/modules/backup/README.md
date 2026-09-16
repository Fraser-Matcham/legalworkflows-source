# `backup`

Row 3.11 of the Stage 3 table, the object-storage half of ticket 2095
("Database and object storage both"). Every object written to the documents
bucket is replicated, as it is written, into a second bucket that only the
replication role can write to, under its own key, and kept there for
`retention_days` (35) after it is deleted or overwritten in the live bucket.

The database half is Supabase's own daily backups, which the plan already
includes; the restore procedure for both is `docs/runbooks/restore.md`, and
the drill that proves it is a Stage 3 "done when" item once the footprint is
applied.

## How a delete behaves, end to end

1. The backend deletes `documents/<id>/v1.pdf`. The live bucket writes a
   delete marker; the bytes become a noncurrent version there.
2. The `storage` module's lifecycle expires that noncurrent version after
   **one day** — the shortest S3 allows — and clears the marker. The live
   bucket has now honoured `docs/data-retention.md`.
3. Replication carried the marker here. The bytes are a noncurrent version in
   this bucket and stay for **35 days**, then this bucket's lifecycle expires
   them.

So "deleted" means: gone from the live bucket within a day, gone from the
backup after 35. The retention document states that window.

## Why versioning, given the deletion promise

Every AWS mechanism that can back an S3 bucket up requires versioning on
the source: replication, AWS Backup, batch replication. The earlier decision
to leave it off ("No versioning", in the storage module's first revision)
protected the deletion promise; a backup that cannot exist protects nothing.
The one-day noncurrent expiry is the reconciliation.

## Why replication rather than AWS Backup

Replication is continuous — a document is protected seconds after upload,
not at the next scheduled snapshot — costs only the second copy's storage,
and restores with `aws s3 cp`/`sync`, which anyone can run. AWS Backup adds
a vault, a plan and per-request pricing for a point-in-time abstraction the
versioned copy already provides. Revisit if a compliance regime asks for
vault lock or cross-account isolation.

## Why the same region

The failure this guards against is a bug or a person deleting the wrong
thing, which is common; a region-wide loss of S3 durability is not something
that has happened. Cross-region would add transfer cost and a second KMS
key region. `docs/runbooks/restore.md` names this as an accepted risk.

## Who can write

Only the replication role writes objects. The bucket policy denies
`PutObject`, `DeleteObject`, `DeleteObjectVersion` and the tagging writes to
every principal except that role, whatever IAM would otherwise allow. Bucket
configuration is left to IAM on purpose: Terraform runs as an ordinary user,
not the account root, and must keep managing the bucket it created. A
restore is a *read* from here and a write to the live bucket, which is why
the storage user does not need — and does not have — any permission on this
bucket.

## Restoring

Covered step by step in `docs/runbooks/restore.md`. In outline: identify the
version to recover with `aws s3api list-object-versions`, copy it back to
the live bucket with `aws s3api copy-object --version-id`, and confirm the
application can open it. For a whole-prefix restore, `aws s3 sync` from the
backup's current view returns everything that was live at the time of the
loss; deleted versions need the per-version copy.
