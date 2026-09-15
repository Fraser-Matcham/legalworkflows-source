# `secrets`

Row 3.4 of the Stage 3 table (tickets 2045, 2046). Where every backend secret
lives, and the roles that let a task start and run.

## The three secrets

| Secret | JSON keys | Written by |
| --- | --- | --- |
| `<prefix>/backend/generated` | `DOWNLOAD_SIGNING_SECRET`, `USER_API_KEYS_ENCRYPTION_SECRET`, `AUTH_HANDOFF_ENCRYPTION_SECRET`, `MANIFEST_SIGNING_KEY`, `METRICS_TOKEN` | Terraform, from `random_bytes` (32 bytes as hex — the `openssl rand -hex 32` ticket 2046 asks for) |
| `<prefix>/backend/operator` | `SUPABASE_SECRET_KEY`, `ANTHROPIC_API_KEY`, and optionally `ERROR_TRACKING_DSN`, `MIKE_WORKFLOWS_GITHUB_TOKEN`, `COURTLISTENER_API_TOKEN` | The operator, out of band — **Terraform creates the container and never writes a value** |
| `<prefix>/backend/storage` | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Terraform, from the `storage` module's access key |

Three secrets rather than one per variable because Secrets Manager charges
per secret, ECS reads a single JSON key with `valueFrom = "<arn>:<key>::"`,
and the groups rotate by different hands. The `backend_ecs_secrets` output is
that `valueFrom` map, so the `backend` module maps variables without knowing
which secret holds what.

Values that are not secret — `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
`R2_ENDPOINT_URL`, `R2_BUCKET_NAME`, the origins, the rate limits — are plain
environment on the task definition, not here.

## Setting the operator values

Terraform never sees these; they go straight from wherever the operator holds
them into the secret. Once, after the first apply and before the first task
starts:

```sh
aws secretsmanager put-secret-value \
  --secret-id "$(terraform output -raw operator_secret_name)" \
  --secret-string '{
    "SUPABASE_SECRET_KEY": "…",
    "ANTHROPIC_API_KEY": "…"
  }'
```

Add `ERROR_TRACKING_DSN`, `MIKE_WORKFLOWS_GITHUB_TOKEN` or
`COURTLISTENER_API_TOKEN` to that JSON when they exist. A task definition that
references a key missing from the JSON fails to start with a clear error, so
the `backend` module only maps the keys it is told are present.

The command runs in a shell whose history should not keep it; prefix it with a
space under bash's default `HISTCONTROL=ignorespace`, or paste the JSON from a
file that is deleted afterwards. Ticket 2045's acceptance criterion — no
secret in a repo or a shell history — is met by the process, not by a check.

## Rotation

- **Generated:** `terraform taint 'module.secrets.random_bytes.generated["METRICS_TOKEN"]'`
  then apply; the new value is written and running tasks pick it up on their
  next start (a deploy, or a forced new deployment). Rotating
  `USER_API_KEYS_ENCRYPTION_SECRET` re-keys nothing: per-user provider keys
  already stored are unreadable afterwards and users must re-enter them —
  rotate it only with that consequence in mind.
- **Operator:** run `put-secret-value` again; same restart rule.
- **Storage:** rotate the key in the `storage` module (taint
  `module.storage.aws_iam_access_key.storage`); this secret follows.

## Roles

| Role | Used by | May |
| --- | --- | --- |
| `<prefix>-backend-execution` | ECS agent, starting a backend task | pull `<prefix>-*` ECR images, write to `/ecs/<prefix>*` log groups, **read the three secrets** |
| `<prefix>-frontend-execution` | ECS agent, starting a frontend task | pull images, write logs — no secrets, because the frontend has none |
| `<prefix>-backend-task` | the backend process | ECS Exec (SSM Messages) only; storage moves here from the static key later |
| `<prefix>-frontend-task` | the frontend process | ECS Exec only |

Every trust policy carries an `aws:SourceAccount` condition, closing the
confused-deputy gap ECS documents for task roles. The ECR and log-group ARN
patterns are a naming contract with the `backend`, `frontend` and
`observability` modules: repositories are `<prefix>-*`, log groups
`/ecs/<prefix>*`.

Secrets are encrypted with the account's `aws/secretsmanager` managed key. A
customer key would add a KMS grant to every execution role for no benefit
until there is a requirement to audit or revoke at the key level.

## Inputs

| Name | Default | Purpose |
| --- | --- | --- |
| `name_prefix`, `account_id`, `region` | — | Naming and ARN patterns |
| `storage_access_key_id`, `storage_secret_access_key` | — | From the `storage` module (sensitive) |
| `operator_secret_keys` | the five above | Keys the task definition may reference in the operator secret |
| `recovery_window_in_days` | `30` | Maximum, deliberately |
| `enable_ecs_exec` | `true` | Set false to remove the shell-into-a-task capability |
