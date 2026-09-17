# `gotrue`

Rows 5.4, 5.5 and 5.6 of the Stage 5 table (tickets 2116–2119). GoTrue —
the authentication server Supabase runs — as a Fargate service on the
existing cluster, sending its email through SES and signing users in with
Google. Created only when the root `platform_enabled` is true.

```
CloudFront ── /auth/v1/* (prefix stripped at the edge, ticket 2123) ──▶ ALB :443
                X-Origin-Verify: <secret>                                 │ rule 40
                X-Origin-Target: gotrue                                   ▼
                                                                gotrue target group ──▶ task :9999
                                                                task ── 5432 ──▶ RDS as supabase_auth_admin
                                                                task ── 587  ──▶ SES (STARTTLS)
                                                                task ── 443  ──▶ accounts.google.com
```

## Why nothing in the application changes

The backend's 32 auth call sites — sign-up, sign-in, OAuth, password reset,
MFA enrolment and verification, admin user lookup and deletion — are
supabase-js calls against GoTrue's API, and the schema's 43 foreign keys
point at the `auth.users` table GoTrue owns. Running the same release
(`v2.189.0`, the tag `docker-compose.yml` pins) keeps sessions, JWT
issuance, MFA and the Google provider exactly as the application expects.
Cognito would have broken all of it; `docs/delivery-plan/v2/plan.md`,
"Why not Cognito".

## Configuration

Values come from `docs/deployment.md`'s Supabase dashboard instructions,
translated into GoTrue's environment. The ones worth knowing:

| Setting | Value | Why |
| --- | --- | --- |
| `GOTRUE_DB_DATABASE_URL` | `AUTH_ADMIN_URI` from `<prefix>/database/roles` (secret) | connects as `supabase_auth_admin`, which owns the `auth` schema |
| `GOTRUE_JWT_SECRET` | `JWT_SECRET` from `<prefix>/platform/jwt` (secret) | the same secret PostgREST verifies with |
| `API_EXTERNAL_URL` + `GOTRUE_MAILER_URLPATHS_*` | `https://<domain>` + `/auth/v1/verify` | every email link resolves to the edge, which routes `/auth/v1` here |
| `GOTRUE_SITE_URL`, `GOTRUE_URI_ALLOW_LIST` | `https://<domain>`, `https://<domain>/**` (+ `extra_redirect_urls`) | the backend builds its callbacks on the request origin, so one glob covers `/auth/callback`, `/reset-password` and the add-in dialog |
| `GOTRUE_JWT_EXP`, `_AUD`, `_ADMIN_ROLES` | 3600, `authenticated`, `service_role` | as the local stack and hosted Supabase |
| `GOTRUE_MAILER_AUTOCONFIRM` | `false` | production sign-ups confirm their address |
| `GOTRUE_MAILER_SECURE_EMAIL_CHANGE_ENABLED` | `true` | an email change is confirmed from both addresses |
| `GOTRUE_PASSWORD_MIN_LENGTH` | 10 | `docs/deployment.md` |
| `GOTRUE_SMTP_*` | the `email` module's host, port 587, credential (secret), sender | ticket 2118, below |
| `GOTRUE_EXTERNAL_GOOGLE_*` | on when `google_oauth_enabled`; client from `<prefix>/platform/google-oauth` (secret) | ticket 2119, below |
| `GOTRUE_MFA_TOTP_*` | enrol and verify on | the MFA the application implements |

The full list is `main.tf`; `extra_environment` exists for the exceptions.

## Email through SES (ticket 2118)

The `email` module already provisions everything Supabase's SMTP page was
going to be given: a verified domain identity with DKIM, a custom MAIL FROM
with SPF, DMARC, a TLS-required configuration set with bounce and complaint
suppression, and an IAM SMTP credential scoped to sending from the domain.
This module reads that credential's secret (`SMTP_USERNAME`,
`SMTP_PASSWORD`) into `GOTRUE_SMTP_USER` and `GOTRUE_SMTP_PASS`, and sends
as the module's `no-reply@<domain>` address. Port 587 is STARTTLS, which
GoTrue negotiates; SES refuses plaintext, so a misconfiguration fails rather
than downgrades.

The account left the SES sandbox on 16 September 2026 (`email` module
README), so confirmation and recovery mail reaches any address. If this is
ever rebuilt in another region, the sandbox applies again and Stage 5, Task
4 says what to check.

## Google sign-in (ticket 2119)

The OAuth client lives in the operator's Google account, and its
**authorised redirect URI** has to name the address GoTrue answers at:
`https://<domain>/auth/v1/callback` (the `google_redirect_uri` output).
Stage 5, Task 3 walks the operator through adding it beside the Supabase
one, which stays until the soak period is over so the rollback keeps
working.

The client id and secret are operator-held. This module creates the
`<prefix>/platform/google-oauth` secret as an empty container, the operator
writes `{"GOOGLE_CLIENT_ID": "…", "GOOGLE_CLIENT_SECRET": "…"}` into it, and
then the root `gotrue_google_oauth_enabled` flips to `true`. The order
matters: with the flag on and the secret empty, the task references a
missing key and does not start — the same loud early failure the operator
secret gives.

## Choices worth knowing about

**The health check is liveness, not the database.** `/health` says the
process is up. A database outage pages through the `backend-readiness`
alarm and should not cycle the auth tasks — the same reasoning as the
backend's target group, and the opposite of PostgREST's, whose only job is
the database.

**Migrations run at start.** GoTrue applies its own migrations to the
`auth` schema when it starts, as `supabase_auth_admin`, which the
`database` module's bootstrap made the schema's owner. On a restored
database the migrations table is already populated and nothing runs; on an
empty one the schema is built in seconds.

**Why through the edge.** The same reason as PostgREST: supabase-js takes
one base URL and appends `/auth/v1`, and GoTrue cannot serve under a prefix,
so CloudFront routes and strips (ticket 2123). Unlike PostgREST, GoTrue
*must* be public in any design: email links and the Google callback arrive
from browsers.

**Refresh token rotation on, reuse interval ten seconds.** A stolen refresh
token is usable once; a legitimate client retrying inside ten seconds is not
signed out. Hosted Supabase's defaults.

## Alarms

Added to the `observability` module's per-service set once it exists:
unhealthy targets and no running task (urgent), CPU and memory
(informational). A run of SES bounces or complaints reaches the alerts
topic through the `email` module.

## Inputs and outputs

See `variables.tf` and `outputs.tf`. `google_oauth_secret_name` and
`google_redirect_uri` are what Stage 5, Task 3 needs; `service_name` is what
a JWT-secret rotation redeploys (`docs/runbooks/api-keys.md`).
