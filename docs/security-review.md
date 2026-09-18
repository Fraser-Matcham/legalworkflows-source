# Security review of the deployment

Ticket 2104, plan row 4.12. What was looked at, what was found, and what each
finding's disposition is.

**This is the half of 4.12 that lives in this repository.** The ticket asks for
a review "across both repositories plus the integration seam". The Juralio
repository is not reachable from here, so the seam is reviewed from this side
only: what this service exposes, what it accepts, and what it would hand over.
The other half is outstanding and row 4.12 stays open until it is done.

Reviewed at `1ee976f`, 16 September 2026. Finding 3 was added later the same
day, from a path noticed during the review and not written up at the time.

---

## Findings

### 1. Client documents and provider API keys reached CloudWatch — fixed

**Severity: high.** The error-tracking bridge reduced everything reaching the
error-tracking transport through `safeErrorForLog`, and printed the raw
arguments to stdout. Stdout is CloudWatch.

`backend/src/lib/errorTracking/index.ts` opens by describing this leak: a
provider SDK error carries the outgoing request on `error.request`, that body
is the prompt, and the prompt is the client's document — with the API key in
the message beside it. The header presents that as the reason the
`unhandledRejection` handler was registered. The same payload reached stdout
through a deliberate `console.error(label, err)`, and `lib/chat/streaming.ts`
logs a failed model stream exactly that way, on the product's hot path.

Measured against an error shaped like Anthropic's, with a positive control
(the first attempt ran under Vitest, which replaces `console`, and reported no
leak on every path — the control is what showed the harness was broken rather
than the code clean):

| path | API key on stdout | client document text |
| --- | --- | --- |
| positive control | yes | yes |
| no bridge (baseline) | yes | yes |
| bridge + `console.error(label, err)` | **yes** | **yes** |
| bridge + `handleUnhandledRejection` | no | no |

The deploy role holds `logs:FilterLogEvents` on the service log groups
(`infra/modules/deploy/policy.tf`, `ReadServiceLogs`), so the audience is wider
than an operator at a console.

**Fixed** by reducing what the bridge prints, not only what it sends. The
bridge's stated principle — "never changes what is printed" — was dropped,
because it preserved the leak. Production log lines are now bounded: strings
truncate at 500 characters with a marker, objects are walked to a fixed depth
and width. A regression test fails if the key or the document text is printed
again.

### 2. An unrecorded shell into production — fixed

**Severity: medium.** Both Fargate services ran with
`enable_execute_command = true` and the task roles carried the SSM Messages
permissions, while the cluster had no `execute_command_configuration`. So
`aws ecs execute-command` opened an interactive shell in a task holding the
Secrets Manager values decrypted into its environment — the database URL and
every LLM provider key — plus the task role's access to the document bucket,
and nothing recorded what was typed or displayed. ECS records that a session
began; the contents go nowhere.

Reachable only by a principal holding `ecs:ExecuteCommand`, which the deploy
role does not have — so in practice an administrator. That is exactly the
session worth recording.

**Fixed** by removing the capability. One root variable, `enable_ecs_exec`,
defaulting to false, now controls the service setting on both services and the
`ecs-exec` policy on both task roles together; they were three independent
switches that had to agree, and the secrets module defaulted its own to true.

Enabling ECS Exec's session logging was the alternative and was rejected: it
would create a second CloudWatch store holding whatever a shell session
displays, which here is client documents, with nothing redacting it — unlike
the application logs. Nothing in `docs/` documents a procedure that uses ECS
Exec, and no automation holds `ecs:ExecuteCommand`, so removing it costs
nothing. Turning it on for a diagnosis is one variable and an apply.

**Applied 18 September 2026.** Both services read
`enableExecuteCommand: false`, and both task roles have no inline policies at
all — the `ecs-exec` policy was the only one on each, and its `count` went to
zero with the variable. Verified against the account after the apply, not
inferred from the plan.

### 3. Login MFA stopped being enforced without saying so — fixed

**Severity: low, but the shape is the point.** `requireAuth` reads
`user_profiles.mfa_on_login` to decide whether to require MFA at login. If that
read fails with Postgres `42703` (undefined_column) the request is allowed
through with the check skipped — deliberately, because failing closed on a
column a migration has not yet added would lock every user out of the product
over a schema that is merely behind.

What was wrong is that nothing said so. The branch logged only through
`devLog`, which is `if (isDev) console.log(...)` with
`isDev = NODE_ENV !== "production"` — a no-op in production. So a security
control could stop applying to every user, indefinitely, with no log line, no
error-tracking event and no metric. The very next error path in the same
function logs with `console.error` and fails closed; this one did neither.

The column exists (`20260610_02_user_profile_mfa_on_login.sql`), so this is
not a live exposure. It becomes one on a restore from a snapshot older than
that migration — a documented procedure, `docs/runbooks/restore.md` — or any
schema divergence that loses the column.

**Fixed** by keeping the fail-open and making it loud: a `console.error`
naming what has been skipped and for whom. That is the observable path in this
service — the error-tracking bridge reports it and counts it in
`loggedErrors`. Three tests in
`backend/src/middleware/__tests__/auth.mfaColumnMissing.test.ts` pin both
halves: the request still goes through, and it is no longer silent. The second
was confirmed to fail against the old code before the fix went in.

This is the class of problem ticket 2087 set out to remove, on a path it
missed.

---

## Reviewed, no finding

| Area | What was checked | Result |
| --- | --- | --- |
| Network exposure | `assign_public_ip`, subnet placement, ALB scheme | Tasks have no public IPs and sit in private subnets. The ALB is internet-facing but its security group admits only the CloudFront origin-facing managed prefix list. |
| Origin gating | ALB listener rules | Two independent gates: the prefix list, and a 40-character random `X-Origin-Verify` header. The prefix list alone admits every CloudFront distribution in the world, which is why the header exists. |
| Task ingress | Security group rules | Backend tasks accept traffic from the load balancer only. Egress is unrestricted, which LLM providers, Supabase and SES require. |
| Deploy role IAM | Every statement in `modules/deploy/policy.tf` | Scoped to named resources except where the API has no resource-level support (`ecr:GetAuthorizationToken`, the task-definition APIs) or is conditioned on the cluster ARN. `iam:PassRole` is conditioned on `ecs-tasks.amazonaws.com`. No Terraform permissions, no state bucket, no secrets. |
| Task role IAM | `modules/secrets/iam.tf` | Same shape. The two wildcards are APIs without resource-level support. |
| Bucket policy | `modules/storage/main.tf` | Denies any request with `aws:SecureTransport` false. The wildcard principal is correct for a Deny. |
| Bucket CORS | `cors_rule`, `allowed_origins` validation | `PUT` and `HEAD` only. The variable's own validation refuses an origin that is not `https://` or that contains a wildcard. |
| Credentials in source | `gitleaks` full history, and a sweep of `infra/` for literal-looking secrets | None. The origin-verify secret is generated by `random_password`, not written down. |
| Database privileges | Grants on `public` | No table is reachable by `anon` or `authenticated`; the service uses the service role and each handler scopes its own queries, which `npm run tenancy` gates in CI. |
| Rate limiting | `backend/src/app.ts` | Per-route windows, with chat and chat-create limited separately from the general limit. |
| Dependency advisories | `scripts/audit-gate.mjs`, four workspaces | No unallowlisted high or critical. One allowlisted (`adm-zip`, dev tooling, no in-range fix — see `docs/licence-compliance.md`), re-checked 18 September 2026 and still unfixable. |
| What ships in the images | `backend/Dockerfile`, `frontend/Dockerfile` | Reviewed 18 September 2026. The backend was shipping its devDependencies and npm; both are now removed after the build. One finding left open: the backend container runs as **root**. |

---

## Reviewed 18 September 2026 — what actually ships in the images

Prompted by "clear up the identified vulnerabilities". The advisories divide
three ways, and only one of the three was anybody's to fix.

### Fixed: the backend image was shipping things it never ran

`backend/Dockerfile` was a single stage running plain `npm ci`, and nothing
pruned afterwards. Two consequences, neither of which the release gate blocked
on, because neither produced a *fixable high* finding:

| Shipped | Brought with it | Now |
| --- | --- | --- |
| All 13 devDependencies — Stryker, Vitest, supertest, tsx, prettier, typescript | `qs` 6.15.1 and `typed-rest-client` 2.3.1, which are **every** moderate advisory `npm audit` reports against this workspace | `npm prune --omit=dev` after the build |
| npm itself | Its bundled `tar`, `brace-expansion` ×2 and `ip-address` — the four entries the image-scan allowlist was excusing | Deleted, as `frontend/Dockerfile` already does |

Express resolves its own `qs` at 6.16.0, outside the advisory range, so the
prune is the whole fix — no dependency bump was needed or made.

Removing npm was possible because a claim in the old allowlist was wrong. It
said the release pipeline runs `npm run sync:workflows` inside this container.
It does not: `deploy.yml` overrides the container command to
`["node","dist/jobs/syncWorkflows.js"]`. Both package scripts were already
plain `node` invocations, so npm was only the launcher for `CMD`, which now
calls `node` directly.

Effect on the scan, measured against the live findings rather than estimated:
**78 findings → 66, and 17 relevant → 13, all 13 allowlisted.** The four
allowlist entries were *deleted*, not left to rot: run the gate against the
old image and it now blocks on them, which is the correct failure if the
Dockerfile change is ever reverted without the allowlist.

### Not fixable: the `adm-zip` chain, re-verified

The allowlist entry carries a "REMOVE WHEN" test. It was run:
`npm view @microsoft/teamsfx-core dependencies` still returns
`office-addin-manifest: ^2.1.6`, `office-addin-project: ^1.0.10` and
`@microsoft/kiota: 1.31.1` — the exact pins the entry recorded. The condition
is unmet, so the seven high advisories in `word-addin` remain one dev-only
advisory with no working fix, and the entry stands as written.

### Left open, deliberately

- **The backend container runs as root.** `frontend/Dockerfile` ends with
  `USER node`; `backend/Dockerfile` has no `USER` line, so the service and the
  catalogue-sync task both run as uid 0. Fixing it is one line plus whatever
  LibreOffice needs for a writable profile directory — and that is exactly why
  it was not done blind: `soffice` is on the critical path for every DOCX→PDF
  conversion, and there was no Docker daemon available to test it. It needs a
  build and a conversion run, not a guess.
- **Four moderate advisories in `frontend`** — `@fortune-sheet/core`,
  `@fortune-sheet/react`, `exceljs` and a transitive `uuid` below 11.1.1. Three
  report no fix at all; `exceljs` offers only a *downgrade* across a major.
  The `uuid` advisory needs `buf` to be passed to v3/v5/v6, which neither
  consumer does. Worth an override attempt when the spreadsheet dependencies
  next move; not worth a forced major today.

## What is still outstanding for row 4.12

1. **The Juralio side, and the seam from its end.** Not reachable from this
   session. This is the larger remaining half.
2. **Finding 2 needs `terraform apply`** before the running services stop
   accepting an exec session.
3. **The review is static.** Nothing here was tested against the running
   deployment. The origin header gate refusing a direct ALB request, and the
   document bucket refusing an anonymous listing, are both asserted from the
   Terraform and never observed.

   `scripts/smoke-test.mjs` (row 4.13, `npm run smoke`) now checks exactly
   those two, from outside, against the deployed stack — and reports NOT
   CHECKED rather than success when it is run without the arguments they need.
   It is written and self-tested in both directions; it has not yet been run
   against a deployment, because there is not one. Running it is part of
   cutover, Stage 4 Task 5.

   What it still does not cover: any authenticated probing of the deployed
   API. Every request it makes is anonymous, so tenancy and authorisation on
   the live system remain covered by the test suite alone.
4. **`buffers@0.1.1`** ships with no declared licence. Tracked as a licence
   item rather than a security one, in `docs/licence-compliance.md`.
