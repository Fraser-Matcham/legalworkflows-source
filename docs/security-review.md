# Security review of the deployment

Ticket 2104, plan row 4.12. What was looked at, what was found, and what each
finding's disposition is.

**This is the half of 4.12 that lives in this repository.** The ticket asks for
a review "across both repositories plus the integration seam". The Juralio
repository is not reachable from here, so the seam is reviewed from this side
only: what this service exposes, what it accepts, and what it would hand over.
The other half is outstanding and row 4.12 stays open until it is done.

Reviewed at `1ee976f`, 16 September 2026.

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

**Takes effect on `terraform apply`.** Until then the running services still
have it.

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
| Dependency advisories | `scripts/audit-gate.mjs`, four workspaces | No unallowlisted high or critical. One allowlisted (`adm-zip`, dev tooling, no in-range fix — see `docs/licence-compliance.md`). |

---

## What is still outstanding for row 4.12

1. **The Juralio side, and the seam from its end.** Not reachable from this
   session. This is the larger remaining half.
2. **Finding 2 needs `terraform apply`** before the running services stop
   accepting an exec session.
3. **The review is static.** Nothing here was tested against the running
   deployment — no authenticated probing of the deployed API, no check that the
   origin header gate actually refuses a direct ALB request in production.
   That belongs with the cutover smoke test (row 4.13).
4. **`buffers@0.1.1`** ships with no declared licence. Tracked as a licence
   item rather than a security one, in `docs/licence-compliance.md`.
