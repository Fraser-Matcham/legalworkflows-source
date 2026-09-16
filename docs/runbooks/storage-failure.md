# Storage failure

**Alarm:** `backend-readiness` (urgent) when the failing log lines say
`"check":"storage"`. Also reached from a user report — "download failed",
"upload stuck", a PDF that never renders — with no alarm, because the
storage helpers in `backend/src/lib/storage.ts` log and return `null`
rather than throw; those show up as `logged_errors_total{source="storage"}`
on `/metrics` and as `[storage]` lines in the log.

The readiness probe does a `HEAD` for a key that does not exist and
expects a 404. Anything else — a 403, a timeout, a KMS error — fails it.

## 1. Read the error shape

```sh
aws logs filter-log-events --log-group-name /ecs/legalworkflows-production-backend \
  --start-time "$(($(date +%s) - 900))000" \
  --filter-pattern '{ $.kind = "readiness" && $.check = "storage" }' \
  --query 'events[].message' --output text | tail -5
```

| Error shape | Cause | Fix |
| --- | --- | --- |
| `403` / `AccessDenied` / `InvalidAccessKeyId` | the access key in `legalworkflows-production/backend/storage` is not the storage user's current key — someone rotated it (`terraform taint module.storage.aws_iam_access_key.storage`) without a restart, or the user's policy changed | `terraform plan` to see whether Terraform agrees with AWS; apply if not; then force a new deployment so tasks read the current secret |
| `SignatureDoesNotMatch` | the signing region is wrong — `R2_REGION` is not the bucket's region | check the task definition's environment has `R2_REGION=eu-west-2` (`infra/modules/backend/ecs.tf`); it is set from the footprint's region, so this means someone overrode it |
| `KMS.DisabledException` / `KMS.KMSInvalidStateException` | the documents key is disabled or pending deletion | **cancel the deletion immediately**: `aws kms cancel-key-deletion --key-id alias/legalworkflows-production-documents`, then `aws kms enable-key`. Every object is unreadable until then. Find out who scheduled it. |
| `NoSuchBucket` | the bucket is gone | this is the restore procedure: [restore.md](restore.md) |
| timeout | the S3 gateway endpoint or the private route tables | `terraform plan`; `aws ec2 describe-vpc-endpoints` |

## 2. Prove it from outside the task

With the storage user's credentials (from the `storage` secret), the same
call the probe makes:

```sh
export AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=…   # from legalworkflows-production/backend/storage
aws s3api head-object --bucket legalworkflows-production-documents-<account-id> \
  --key readiness-probe-does-not-exist ; echo "exit $?"
```

Exit 254 with `Not Found` is *success* — that is what the probe wants. A
403 or a KMS error reproduces the fault with the task out of the picture.

## 3. A single document, not the whole bucket

If readiness is fine and one user cannot open one file, the object is
missing or its key in the database does not match. The version's storage
key is in `document_versions`; check it exists:

```sh
aws s3api head-object --bucket legalworkflows-production-documents-<account-id> --key "<storage_key>"
```

Missing means it was deleted (the log will show a `[storage]` delete, or an
`account.delete` / `storage.cleanup` job in `db_jobs`), or never uploaded
(an `upload-sessions/` object that was swept). If it was deleted within the
last 35 days it is in the backup bucket — [restore.md](restore.md), section
"One document".

## Afterwards

If the cause was a rotated key or a changed policy, the fix is
`terraform apply` followed by a restart. Terraform is the record of what
storage access should be; if AWS disagrees with it, AWS is what changed.
