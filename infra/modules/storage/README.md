# `storage`

Row 3.3 of the Stage 3 table (tickets 2042, 2043). The document bucket, the
key that encrypts it, and the one identity allowed to touch it.

## What is in the bucket

Every byte of file content, keyed as `backend/src/lib/storage.ts` decides:

| Prefix | Holds | Expires? |
| --- | --- | --- |
| `documents/<userId>/<docId>/…` | source files, PDF renditions, versions, edits | never |
| `generated/<userId>/<docId>/…` | assistant-generated documents | never |
| `extracted-text/<versionId>.txt` | cached extracted text | never |
| `exports/<userId>/…` | account export archives | never |
| `upload-sessions/<userId>/<sessionId>/<fileId>/{staging,sealed}` | in-flight uploads | backstop after 8 days |

"Never" is a property of the service, not an oversight: `docs/data-retention.md`
states that nothing expires content and the privacy policy is written from it.
The lifecycle rules here are written so that adding a content prefix to them
would be a visible, reviewable change rather than a default.

## Choices worth knowing about

**SSE-KMS with a customer-managed key, bucket key on.** The key can be
rotated and every use is logged; the bucket key keeps the KMS bill trivial
despite the many small objects. Deleting the key makes every object
unreadable, so its deletion window is the 30-day maximum.

**No versioning.** A versioned bucket keeps deleted bytes as noncurrent
versions, which would make "deleting a document removes the file" false.
Backups of content are a separate question for row 3.11 and are not answered
by versioning.

**TLS only.** The bucket policy denies any request over plain HTTP. Presigned
URLs and the SDK are both HTTPS, so this only ever blocks a misconfiguration.

**One IAM user with a static key.** The backend's client passes
`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` explicitly and will not start
without them, so a key has to exist. It is scoped to object operations on
this bucket plus the three KMS actions those need. Moving to the ECS task
role — no long-lived key at all — needs the code to stop passing credentials
so the SDK default chain takes over; that is scheduled after row 3.10 proves
the bucket end to end, and the policy moves to the role unchanged.

**Region.** `storage.ts` signs with `region: "auto"`, an R2 convention.
Real S3 rejects that at signature verification, so a small code change to
make the region configurable is due before row 3.10. Nothing in this module
depends on it; it is recorded here so it is not rediscovered at apply time.

## Wiring to the backend

| Backend variable | Comes from |
| --- | --- |
| `R2_ENDPOINT_URL` | `endpoint_url` output |
| `R2_BUCKET_NAME` | `bucket_name` output |
| `R2_ACCESS_KEY_ID` | `access_key_id` output (sensitive), via Secrets Manager |
| `R2_SECRET_ACCESS_KEY` | `secret_access_key` output (sensitive), via Secrets Manager |
| `R2_PUBLIC_ENDPOINT_URL` | unset — the regional endpoint is browser-reachable |

The variable names are inherited configuration and stay as they are
(AGENTS.md, rule 2).

## Inputs

| Name | Default | Purpose |
| --- | --- | --- |
| `name_prefix` | — | Resource name prefix |
| `account_id` | — | Suffix that makes the bucket name globally unique |
| `allowed_origins` | — | Exact `https://` origins for browser PUTs; no wildcards |
| `upload_session_backstop_days` | `8` | Minimum 8; see variables.tf |
| `kms_deletion_window_in_days` | `30` | Maximum, deliberately |
