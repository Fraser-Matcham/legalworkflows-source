# `keys`

Row 5.7 of the Stage 5 table (tickets 2120, 2121). The JWT secret the
self-hosted platform signs with, and the container for the two API keys
minted from it. Created only when the root `platform_enabled` is true.

## Why this module exists

The `anon` and `service_role` keys the backend presents to PostgREST and
GoTrue are JWTs: a header, a payload naming a `role`, and an HMAC-SHA256
signature over both using the JWT secret. On Supabase that secret lived
outside this account, so a key could only be checked by trying it against
the live project — which is how deploy runs 12 to 14 each failed on a value
nobody could inspect. Holding the secret here means:

- a key can be **verified offline** before it is written anywhere
  (`scripts/platform-keys.mjs verify --secret-stdin`);
- the keys can be **re-minted** without touching the services, since they
  only verify signatures;
- the secret can be **rotated**, which re-mints the keys and signs every
  user out — a deliberate, documented act rather than an impossibility.

## The two secrets

| Secret | Keys | Written by |
| --- | --- | --- |
| `<prefix>/platform/jwt` | `JWT_SECRET` | Terraform, from `random_password` (64 alphanumeric characters) |
| `<prefix>/platform/api-keys` | `ANON_KEY`, `SERVICE_ROLE_KEY`, `ISSUED_AT`, `EXPIRES_AT` | the operator, following [`docs/runbooks/api-keys.md`](../../../docs/runbooks/api-keys.md) — **Terraform creates the container and never writes a value** |

Terraform has no HMAC function and so cannot sign a JWT; the keys are the
output of `scripts/platform-keys.mjs mint`, fed the secret through a pipe.
Until the runbook has been followed once, a task definition that references
`ANON_KEY` or `SERVICE_ROLE_KEY` fails to start with the same clear
"did not contain json key" error the operator secret produces, which is the
intended failure: loud, early, and naming the key.

## Who reads what

The `ecs_secrets` output maps variable names to `valueFrom` entries:

| Variable | Read by | From |
| --- | --- | --- |
| `PGRST_JWT_SECRET` | PostgREST (`postgrest` module) | `jwt` |
| `GOTRUE_JWT_SECRET` | GoTrue (`gotrue` module) | `jwt` |
| `SUPABASE_PUBLISHABLE_KEY` | the backend, after the cutover (2122) | `api-keys` |
| `SUPABASE_SECRET_KEY` | the backend, after the cutover (2122) | `api-keys` |

The publishable key is public by design (on Supabase it ships in browser
bundles) and lives in the secret only so both keys are written and rotated
as one object. Until the cutover the backend keeps reading its Supabase
values from the root variable and the operator secret, so creating this
module changes nothing about the running service.

Both secrets use the account's `aws/secretsmanager` managed key, for the
reason the `secrets` module gives: a customer key adds a KMS grant to every
reader for no gain until there is a requirement to audit at the key level.

## Rotation

In the runbook. The short version: rotating the **keys** is mint, verify,
write, redeploy the backend; rotating the **secret** is `terraform taint
'module.keys[0].random_password.jwt_secret'`, apply, then the same, plus a
new deployment of PostgREST and GoTrue — and every signed-in user has to sign
in again, because their access tokens were signed with the old secret.
