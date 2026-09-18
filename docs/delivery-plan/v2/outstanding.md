# What is actually left

The backlog register is [`../backlog.csv`](../backlog.csv), 124 tickets; the
current status of each is in [`delivery-status.xlsx`](delivery-status.xlsx). Most
are done and the plan records them. This lists only what is **not** done, with
the evidence for each, so nobody has to re-derive it.

Compiled 17 September 2026, against `main` at `0f8e99c`; the stage 5 section
added the same day after the platform pull requests.

---

## Blocked on the operator, and blocking everything downstream

### RESOLVED 18 September 2026 — the site was down on a wrong key name

**Fixed.** The key was renamed in Secrets Manager at 09:58 and deploy run 24
rolled both services; `/`, `/api/ready` and `/api/health` all return 200, and
both services sit at `runningCount` 1 with a `COMPLETED` rollout. The account
evidence below is kept because the diagnosis took two wrong turns before it
landed, and the shape of it is worth not repeating.

Checked against the live account on 18 September 2026, before the fix.
`legalworkflows.co.uk` returned **503** on `/`, `/api/ready` and `/api/health`.
Both ECS services had `desiredCount` 1 and `runningCount` 0, and both
deployment circuit breakers read `FAILED`.

The backend's stopped tasks say exactly why:

```
ResourceInitializationError: unable to pull secrets or registry auth:
execution resource retrieval failed: unable to retrieve secret from asm:
retrieved secret from Secrets Manager did not contain json key SUPABASE_SECRET_KEY
```

`legalworkflows-production/backend/operator` is a JSON object holding the keys
`service_role` and `ANTHROPIC_API_KEY`. The task definition asks it for
`SUPABASE_SECRET_KEY`, which is not there — the value appears to be present
under the wrong name. Nothing reached Supabase; the execution role could not
assemble the task's environment, which is the case
[`../../runbooks/database-unreachable.md`](../../runbooks/database-unreachable.md)
section 2 describes under "The secret must stay a JSON object". `ANTHROPIC_API_KEY`
in the same object is three characters long, so it is a placeholder too. A
separate secret named `service_role`, holding one key of the same name, also
exists and nothing references it.

The earlier reading of this — "the key is wrong or stale", from the catalogue
sync's `Invalid API key` on deploy runs 12 and 13 — was the right suspect for
the wrong reason. The key is not rejected; it is absent.

The frontend was down for a second, independent reason: its service still ran
task definition revision 1, whose image was the Terraform placeholder tag
`:bootstrap`, which does not exist in ECR
(`CannotPullContainerError: ... not found`). The deploy job that replaces it
with a real image had never completed, because it comes after the backend job
in the pipeline. Deploy run 24 registered revision 2 on a real image and rolled
it; no separate action was needed.

### Three deploys reported success while deploying nothing

Fixed in this change; recorded because the failure mode is the reason the
outage above went unnoticed.

Adding `build-dbtools` to `deploy.yml` for stage 5 gave it
`if: vars.PLATFORM_ENABLED == 'true'`, so it skips until the platform is
enabled. `migrate` was written to run past that skip and does. But "Deploy the
backend", "Deploy the frontend" and "Record the release" carried no condition
of their own, and GitHub's implicit `success()` is false once anything upstream
in the graph was skipped — even though every job they name succeeded. All three
skipped, on every push to `main` from run 21 onward, and each run still reported
success, because a skipped job is not a failed one.

Runs 21, 22 and 23 are green and deployed nothing. Run 20 is the last one whose
backend job actually ran, and it failed at the catalogue sync.

The three jobs now state their own requirements, and
`scripts/check-release-pipeline.mjs` (CI job "Release pipeline") fails the build
on any job that inherits a skip from an optional dependency. Deploy run 24 is
the proof: all three jobs ran, and the catalogue sync passed.

**Stage 4 from row 4.8 onward was blocked on the two faults above and is not
any more.** Rows 4.8/4.9 (load test), 4.10 and 4.14, and tickets 2044, 2052,
2095, 2098 and 2102, all needed a stack that serves and now have one. Row 4.13
is done: see below.

### `terraform apply` has not been run since three changes landed

- ECS Exec disabled on both services and both task roles (security review
  finding 2) — until applied, the running services still accept an exec session.
- ECR enhanced scanning.
- `workflows_repository`, if it is to be set to `""` (see 2014 below).

---

## Found by the first production smoke test

Plan row 4.13 and ticket 2106. The smoke test had never met a deployment; the
first run against one found two defects, both in the test.

### The origin check could never have passed

It demanded a `403` from a direct request to the load balancer, to prove the
`X-Origin-Verify` header gate refuses anything that did not come through
CloudFront. But the load balancer's security group admits port 443 only from
the managed prefix list `com.amazonaws.global.cloudfront.origin-facing`
(`pl-93a247fa`, confirmed against the account). A request from anywhere else is
dropped at the network layer: no handshake, no status, just a timeout.

So the check failed on an origin that was locked down harder than it asked for,
and would have gone on failing every production run. The header gate cannot be
observed from outside CloudFront, because the network gate fires first. A
network-level drop is now a pass, with a detail line saying which gate did the
refusing. A `2xx` is still a failure.

### The Corresponding Source check was reading the wrong link

Recorded in [`../../licence-compliance.md`](../../licence-compliance.md) under
"Signed off against production". It matched the first `https://github.com/...`
on `/legal`, which is upstream's attribution link, so it had never inspected
the actual offer. It now requires a link pinned to a full commit SHA, and
`--commit` asserts that SHA is the running build.

The service itself was compliant throughout. The evidence for it was not.

Both fixes carry self-test cases, so neither can regress quietly.

### RESOLVED 18 September 2026 — alerting had nowhere to go, and now does

**Fixed, and proven rather than assumed.** Sixteen CloudWatch alarms exist,
all with actions enabled and an action attached, covering 5xx rates, latency,
CPU, memory, unhealthy targets, running-task count and the readiness probe.
Fourteen read `OK`; the two that do not are the autoscaling low-CPU alarms,
which read that way on an idle service by design.

The gap was downstream of them. The alarms publish to
`legalworkflows-production-alerts` and `legalworkflows-production-alerts-urgent`,
and **neither topic had a single subscription**. The only subscription in the
account was an unrelated SES feedback address, so every alarm above would have
fired into a topic with no listeners. The alarms were not the problem and never
had been; nothing they said could reach a person.

Closed on 18 September 2026:

| Step | Evidence |
| --- | --- |
| Both topics subscribed to `fraser@legalutopia.co.uk` | `ListSubscriptionsByTopic` on each |
| Operator confirmed both | Both read a subscription ARN rather than `PendingConfirmation` |
| A test message published to each | Operator confirmed both arrived in the inbox |

The last row is the one that matters and the easy one to skip. SNS accepting a
publish proves the topic took the message, not that anyone received it. Only
the mailbox owner can see the other half, so the proof is their confirmation,
not the API's.

**Still open for 2107:** the ticket also asks for a monitoring window to pass
with no unresolved incident. That is a matter of elapsed time, not
configuration. Alerting itself is now proven working.

### The deployment circuit breaker did not roll back a broken deploy

Ticket 2052, drilled on 18 September 2026 with the operator's authorisation.
The backend was deliberately rolled onto a revision whose image tag does not
exist in ECR. Three tasks failed with `CannotPullContainerError` over six
minutes; the deployment then sat `IN_PROGRESS` for a further eleven with no
rollback and no further attempt, until it was restored by hand.

The breaker is configured correctly, with `enable` and `rollback` both true.
An unpullable image produces a *placement* failure rather than a task that
starts and fails, and the deployment stalls instead of being failed.

The acceptance criterion says "rolled back **without manual intervention**", so
this is not a pass. What the drill did establish is worth as much:

- Availability never moved. `minimumHealthyPercent` is 100, so the serving task
  was not drained for a replacement that never became healthy. The site
  answered 200 on all 33 probes across the drill.
- The release pipeline, not the breaker, is what catches this. `deploy.yml`'s
  "Roll the service" step bounds `wait services-stable` at ten minutes and then
  asserts the `PRIMARY` deployment is the revision it registered, so a stalled
  deployment turns the release red.

The timeline and the manual-restore command are in
[`../../runbooks/deploy-rolled-back.md`](../../runbooks/deploy-rolled-back.md)
under "Note for the record".

**Still open:** whether the breaker fires for a runtime failure, where the
image pulls and starts but fails its health checks. That is the case it is
designed for and this drill says nothing about it. A second drill would answer
it, and should be run when no release is in flight.

---

## Genuinely open tickets

### 2014 — Take ownership of the workflow catalogue *(Story, High)*

> *"Product content is therefore controlled by a third party."*
> AC: *"The catalogue syncs from a repository you control; upstream renaming or
> privatising theirs has no effect."*

`workflows_repository` still points at `Open-Legal-Products/mike-workflows`.
AGENTS.md fork rule 2 asks for a fork you own — the variable name is
configuration, the value is ownership.

This is **not** an availability problem today: the e2e workflow's "Sync Mike
workflow catalog" step passes on every pull request, which means that
repository is publicly readable without a token. It is a supply-chain problem —
the ticket's own framing — and it stays open until the catalogue is yours.

Needs a fork created under an account you control, which is outside what this
repository's tooling can do.

**The licence question the ticket raises is answered.** Checked on
17 September 2026 against `Open-Legal-Products/mike-workflows` at `ce62e6a`
(17 August 2026): the repository is **MIT** (`LICENSE`, and the README's
"License" section), with a `PROVENANCE.md` that requires each workflow to
carry its own `license` field and asks contributors to keep third-party
notices where a pack was adapted. MIT permits the fork, the copy and the
modification outright; the one obligation is to keep the MIT notice in the
fork, which forking does by construction. It is a separate repository from
the AGPL application, so the AGPL does not reach it and it does not reach
the AGPL.

Once the fork exists, the remaining steps are configuration: set
`workflows_repository` in `infra/terraform.tfvars` to the fork (and
`workflows_ref` to a commit SHA for a reproducible release), apply, and the
next release's catalogue sync reads from it (ticket 2016 is that release
passing its sync step against an empty catalogue and the five defaults
resolving in the product). The catalogue carries 23 assistant workflows and
the tabular-review packs; pinning the SHA is what stops an upstream edit
changing product content between releases.

### 2009 — Run a first upstream merge as a dry run *(Sub-task, Medium)*

> AC: *"Merge completes; full backend and frontend suites green afterwards."*

`upstream-main` exists and [`../../upstream-sync.md`](../../upstream-sync.md)
documents the routine (2004 and 2008 are done), but no merge from it appears in
this fork's history. The merge commits that mention "upstream" are inherited
from upstream's own history, not performed here.

The point of the ticket is to prove the mechanics while a conflict is still
impossible, so its value decays as the fork diverges. It has diverged
considerably.

---

## Done literally, not meaningfully

### 2020 — Configure Actions secrets and verify the e2e run *(Sub-task, High)*

> AC: *"e2e workflow completes green on a pull request."*

Met on the face of it: e2e runs on every pull request and passes.

**`ANTHROPIC_API_KEY` is not set, so four specs have never run in CI** — chat
rename, chat delete, chat submit, and the critical-path "ask a question". They
self-skip without the key and the run still reports green, which is deliberate
and documented in `e2e.yml`, `e2e/llm.ts` and
[`../../e2e-ci.md`](../../e2e-ci.md). The design is not the problem; the empty
secret is.

The evidence is in any e2e job log, in the env block of a step that exposes it:

```
ANTHROPIC_API_KEY:
```

GitHub renders a configured secret as `***` and an unset one as empty. It is
empty on run 35152758070, job 104984842558 — the e2e run for `89348ed`.

So the specs covering the product's central flow — send a message, get a
streamed answer — are green because they did not run. Setup is in
`docs/e2e-ci.md`, "Enable the LLM specs"; it wants a spend-capped, CI-scoped
key. Until then, treat e2e's green as covering the other 27 specs only.

---

## Stage 5: engineered, waiting on the operator

The self-hosted platform (tickets 2110–2126) was built on 17 September 2026
as six pull requests, every module gated on `platform_enabled` so the live
service is untouched. What is left is the sequence only the operator can
start, in the order `docs/runbooks/first-apply.md` §6 gives:

| Step | Ticket it closes | Who |
| --- | --- | --- |
| Approve the running cost; `platform_enabled = true`; apply | 2112 proven, 2111 | operator (Stage 5, Task 1) |
| `PLATFORM_ENABLED=true` on the repository; a release builds the dbtools image | — | operator |
| `run.sh bootstrap`; mint, verify and write the API keys | 2120 | operator with `docs/runbooks/api-keys.md` |
| Write the migration-source secret; add the Google redirect URI and write the client | — | operator (Stage 5, Tasks 2 and 3) |
| Rehearse: copy, verify, prove the switch and the way back | 2113, 2125 | operator with `docs/runbooks/platform-cutover.md` |
| Cut over: `platform_serves_backend = true`, `PLATFORM_SERVES_BACKEND=true`, smoke | 2114, 2116, 2118, 2119, 2122 | operator (Stage 5, Task 5) |
| Two weeks' soak, then delete the Supabase project | 2124 | operator (Stage 5, Task 6) |
| Remove the Supabase paragraphs from the documentation | 2126 | engineering, after Task 6 |

Nothing in this list is a code change. The one open engineering question the
platform work surfaced is recorded in `infra/modules/database/README.md`,
"Row-level security on RDS": whether the RDS master user can confer
`BYPASSRLS`. The bootstrap tries and says which; the policy migration that
ships with PostgREST covers the case where it cannot, so neither answer
blocks the cutover.

## Not in this repository

Seven backlog rows target `juralio-frontend`, the other side of the HTTP
boundary, and one epic with them. They cannot be done from here, and fork rule 1
means they must not be done by reaching across.

Row 4.12's security review is also only half done for the same reason: it
covers this repository and the seam from this side. See
[`../../security-review.md`](../../security-review.md).

---

## Verified done during this sweep

Checked against the tree rather than assumed, because the plan does not cite
them by number and they read as open:

| Ticket | Evidence |
| --- | --- |
| 2003 clone with history | the repository exists with history |
| 2004 `upstream-main` branch | exists on the remote |
| 2005 branch protection | plan row 4.5, set in GitHub settings |
| 2006 fork rules in AGENTS.md | the four fork rules are there |
| 2008 upstream sync documented | `docs/upstream-sync.md` |
| 2011 SheetJS CDN removed | no `cdn.sheetjs`/`sheetjs.com` reference in any source tree |
| 2019 scorecard.yml deleted | absent from `.github/workflows/` |
| 2021 Dependabot | `.github/dependabot.yml` |
| 2022 CodeQL | `.github/workflows/codeql.yml` |
| 2035 do-not-rename register | the table in AGENTS.md fork rule 2 |
| 2062 production security baseline | trusted origins, 24 rate-limit settings in `app.ts`, `docs/data-retention.md`, `docs/security-review.md` |
