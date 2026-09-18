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

### RESOLVED 18 September 2026 — the queued apply is applied

Three of the four changes that had been sitting in `infra/` unapplied are now
live. The operator ran it; each result below was read back from the account
afterwards rather than taken from the plan.

| Change | Verified |
| --- | --- |
| ECS Exec disabled (security review finding 2) | `enableExecuteCommand: false` on both services, and **zero** inline policies on either task role — `ecs-exec` was the only one, and its `count` went to zero with the variable |
| ECR enhanced scanning | Registry `scanType: ENHANCED`, with both rules: `CONTINUOUS_SCAN` filtered to `legalworkflows-production`, `SCAN_ON_PUSH` on `*` so the shared registry keeps coverage |
| `alert_email`, with the two subscriptions imported first | Exactly **one** email subscription per topic, at the same ARNs as before — no duplicate pair, which was the failure the import existed to prevent |
| `workflows_repository` | **Done since**, in a second apply — the fork exists and `:22` carries it (2014, below) |

The plan was `1 to add, 4 to change, 2 to destroy`. Two of those changes were
the imported subscriptions acquiring `confirmation_timeout_in_minutes` and
`endpoint_auto_confirms` — Terraform-side bookkeeping that makes no SNS call,
and an update in place rather than a replacement, so neither subscription ARN
moved and neither needed re-confirming.

**The image scan gate is now real.** In the form it had carried since the
`fixAvailable` rewrite it could not refuse anything — though an *earlier* form
of it could and did: `backend/Dockerfile` records it refusing the full
LibreOffice suite at 31 findings, which is why only Writer is installed. An
earlier draft of this page said flatly that the gate had never refused an
image. That was too strong, and the Dockerfile had the counter-example in a
comment the whole time.

The gate counts findings under `.imageScanFindings.enhancedFindings[]`
with `fixAvailable == "YES"`. Enhanced findings exist only under enhanced
scanning; the registry was `BASIC`, whose findings live under `.findings[]` and
carry no `fixAvailable` at all. The `[]?` yielded an empty list, `BLOCKING`
computed to `0`, and the step printed "no fixable high or critical findings" on
every release. Checked against the running image before the apply:
`legalworkflows-production-backend:main` reported 5 critical and 24 high across
48 basic findings, 0 enhanced — and the gate called it clean.

The design was never the fault; `deploy.yml` explains why the gate needs
`fixAvailable`, and a zero-high-or-critical gate against a Debian base is
unpassable rather than strict. What was missing was the registry setting it
depends on.

### The first gated release, and what it found

Deploy run 30 stopped at "Build and scan (backend)" with **25 fixable high or
critical findings**. The frontend job cancelled with it, and migrate and both
deploy jobs skipped. Production never moved: the gate refuses an image before
anything rolls, so the service stayed on `:20` and kept serving. The catalogue
sync never ran either, so ticket 2016 waits for a release that gets past this.

The 25 split two ways, and only one way was actionable:

| Finding | Rows | Actionable here? |
| --- | --- | --- |
| `openssl/openssl` 3.5.7, fix in 4.0.2 | 15 | **No.** Statically linked inside the Node binary; no Node 22 image ships OpenSSL 4.x |
| `go/stdlib` 1.26.4 and `golang.org/x/text` | 8 | **No.** Vendored into a base-image binary this repository does not build |
| npm's own bundled `tar`, `pacote`, `sigstore`, `brace-expansion`, `picomatch`, `ip-address` | 12 | **Yes**, by upgrading npm |

**None of the twelve are our dependencies.** The backend lockfile already
carries `brace-expansion` 5.0.9, `picomatch` 4.0.7 and `ip-address` 10.7.0, all
at or ahead of the versions Inspector wants, and has no `tar`, `pacote` or
`sigstore` at all. `pacote` appears twice at two versions, which is the
bundled-inside-npm signature. So the fix is `npm install -g npm@latest` in
`backend/Dockerfile`, not a dependency bump.

And the first thirteen made the gate unpassable — the same fault the
`fixAvailable` filter was written to cure, reached by a different route.
`fixAvailable: YES` means the maintainer published a fix, not that we can
obtain it. `scripts/image-scan-allowlist.json` now carries those thirteen with
a written reason and a 90-day expiry each, printed on every run, with an
expired entry failing the build and an entry matching nothing printed as stale.
`scripts/check-image-scan.mjs` enforces it, and fails outright on a scan result
that is BASIC rather than silently passing it.

One thing the apply deliberately did not do: roll either service back to the
`bootstrap` image tag. Both `aws_ecs_service` resources carry
`ignore_changes = [task_definition, desired_count]`, so the redeployment that
the Exec change triggered reused the revisions the pipeline had deployed —
backend `:20`, frontend `:7`, both `COMPLETED` and 1/1. A `bootstrap` tag that
does not exist in ECR is what took the site down on 18 September, and it is a
placement failure, which the circuit breaker does not catch.

### Four more, found by reading the scans instead of waiting for the gate

Run 34 was the first release whose deploy role could actually read a scan
result. Rather than watch it, the scans for the images already sitting in ECR
were read directly and `scripts/check-image-scan.mjs` run against them
locally — which is how these four were found before the run reached them.

The backend passes at 17 of 17 relevant findings allowlisted. The frontend
carried **four `openssl/openssl` findings that were not on the allowlist**:
CVE-2026-75803 (critical), CVE-2026-54874, CVE-2026-63072 and CVE-2026-63076.

They are the same OpenSSL 3.5.7 vendored inside the Node binary as the five
already allowlisted, with the same unobtainable fix in 4.0.2. What differs is
only how Inspector reports them:

| | Debian `openssl` also implicated? | `fixAvailable` | Gate sees |
| --- | --- | --- | --- |
| Backend | Yes, 3.0.20, `fixedInVersion: NotAvailable` | `PARTIAL` | not relevant |
| Frontend | No — `apt-get upgrade` took it out of range | `YES` | blocking |

So the backend was passing these four partly because *its* Debian OpenSSL is
unfixable, and the frontend was failing them because it had been patched more
thoroughly. That is a genuine oddity in ticket 2050's `fixAvailable` rule, and
worth knowing about; it is not a reason to withhold the fix from the frontend.
All four are now allowlisted with the reason stating both readings.

The stale line changed with them. One allowlist serves two images that do not
carry the same packages — the backend keeps npm and reports its bundled
dependencies, the frontend deletes it and reports none — so an entry unmatched
on one image is routinely live on the other. The line used to end "remove the
entry", which on the frontend's run would have advised deleting twelve entries
the backend depends on. It now reads "not reported on this image".

### The fifth fault: the poll could not read a status it had permission to read

Run 34 got past the permission problem and then hung anyway. Both scan steps
polled for nine minutes on images whose scans had been `ACTIVE` before the job
started, and would have spent the full thirty before reporting a timeout that
was not one. Run 35 was queued behind it on the `production-deploy` concurrency
group and carried the same code, so both were cancelled rather than left to
burn an hour between them.

CloudTrail settled what it was not. In the twenty minutes covering the hang:
**every call from the deploy role succeeded, with no error code at all** —
`DescribeImageScanFindings`, `ListFindings` and `ListCoverage` alike. The
permissions work. What the trace showed instead was the shape of the fault:
each poll iteration made *two* calls, one plain and one carrying a `nextToken`.

The response pages. The poll asked for one small field out of it:

```
--query 'imageScanStatus.status' --output text
```

The AWS CLI applies `--query` to *each page* and concatenates. The first page
carries `imageScanStatus`; the second does not, so it yields `None`. Run 34's
log shows the result exactly, 56 times:

```
scan status: ACTIVE
None — waiting
```

`$status` was the two-line string `ACTIVE\nNone`. It matched no branch of the
`case`, and an unmatched status fell through to "wait". Two changes, because
the bug needed both:

- `--no-paginate` on the status poll. One call, first page, raw response. The
  full read further down keeps paging, because it genuinely needs every
  finding.
- An unrecognised status now **fails, printing the value in brackets**, rather
  than being treated as "not yet". This is the same lesson as the
  `2>/dev/null` one directly above: the loop's silence about a state it did
  not understand is what turned a five-second answer into a thirty-minute
  timeout, twice.

### And the hole that would have hidden a short read

The same pagination has a nastier form. If the *findings* read had stopped at
its first page instead of the status read, the gate would have judged a subset
and passed the image — because a short read looks like a cleaner image. That is
the third time this project has met a failure that is silent in the direction
that ships.

`findingSeverityCounts` is the only field that says how many findings a scan is
supposed to have, and it is exact: 39+26+3+3+7 = 78 on the backend, 17+8+2+5 =
32 on the frontend, matching the arrays precisely. The gate now compares the
two and refuses a findings list shorter than the tally. Dropping just the four
blocking OpenSSL findings from the frontend's 32 — the exact shape of a short
read that would otherwise pass — is refused with `only 28 of 32 findings were
read`.

### Run 37: the release the five faults were in the way of

Deploy run 37, 18 September 2026 at `0a9d7d08`, is the first release to
complete every stage of the pipeline. It also closes 2014, 2015 and 2016.

| Stage | Result |
| --- | --- |
| Backend scan | **5 seconds.** 78 findings, tally `{HIGH:39, MEDIUM:26, LOW:3, UNTRIAGED:3, CRITICAL:7}`, 17 relevant, all 17 allowlisted, no blocking findings |
| Frontend scan | 20 seconds, clean |
| Migrations | applied |
| Catalogue sync | ran from the new revision against the fork, 65 seconds, exit clean |
| Backend service | `:20` → `:22`, `COMPLETED` 1/1 |
| Frontend service | `:7` → `:8`, `COMPLETED` 1/1 |
| Edge | `/` and `/api/ready` both 200 |

The gate's output in CI matched, line for line, what running
`scripts/check-image-scan.mjs` against the live ECR findings had predicted an
hour earlier: same tally, same 17 allowlisted entries, same four stale ones.

**The catalogue is no longer upstream's.** From the task definitions:

| | `:20` | `:22` (live) |
| --- | --- | --- |
| `MIKE_WORKFLOWS_REPOSITORY` | `Open-Legal-Products/mike-workflows` | `Fraser-Matcham/mike-workflows` |
| `MIKE_WORKFLOWS_REF` | `main` | `ce62e6a2d3f47e1d3567a4f2edc61898cfe9e78a` |

Pinned to a SHA rather than `main`, so an edit to the catalogue cannot change
product content between releases.

Runs 34, 35 and 36 were cancelled deliberately. Each predated the pagination
fix and would have spent thirty minutes polling a scan that was already
`ACTIVE`, holding the `production-deploy` concurrency group — which has
`cancel-in-progress: false` — against the run that carried the fix. Run 36 was
Dependabot's, merged ten minutes ahead of the fix and already at the scan step.

Production served on `:20` throughout all five faults and all four failed
runs. The gate refuses an image before anything rolls, which is the property
that made a fortnight of broken releases survivable.

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
| Both topics subscribed to the operator's address | `ListSubscriptionsByTopic` on each |
| Operator confirmed both | Both read a subscription ARN rather than `PendingConfirmation` |
| A test message published to each | Operator confirmed both arrived in the inbox |

The last row is the one that matters and the easy one to skip. SNS accepting a
publish proves the topic took the message, not that anyone received it. Only
the mailbox owner can see the other half, so the proof is their confirmation,
not the API's.

### Declaring it, rather than leaving it in the account

The subscriptions above were made through the API, so they work but are not in
Terraform state. A rebuild would recreate the topics and the alarms and quietly
leave them with no subscribers again, which is the same silent failure in a new
costume.

The module has always supported this: `alert_email` creates a subscription on
both topics, and the root passes it straight through. It had simply never been
set, and `terraform.tfvars.example` did not mention it, so nobody setting the
stack up would have known to. The example now documents it.

What it needs is an import rather than a plain apply, because Terraform does
not adopt a subscription it did not create — it makes a second one, and every
alarm then emails twice. The commands are in the module README under "Adopting
subscriptions that were made by hand", and the apply is the operator's.

**Still open for 2107:** the ticket also asks for a monitoring window to pass
with no unresolved incident. That is a matter of elapsed time, not
configuration. Alerting itself is now proven working.

### RESOLVED 18 September 2026 — the circuit breaker works, for the failures that reach it

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

**Answered the same day.** A second drill at 11:51 used the real image with the
entry point replaced by `sleep 3600`, so the container pulls, starts, registers
as a target, and never listens on port 3001. Three health-check failures at
11:54, 12:00 and 12:05, and at 12:06 the breaker failed the deployment and
rolled back to the good revision unaided. `rolloutStateReason` reads "ECS
deployment circuit breaker: rolling back to deploymentId ...". The site answered
200 on all 60 probes across both drills.

So 2052's acceptance criterion is met for the failure mode that matters. The
distinction is where the failure happens:

| Failure | Breaker fires? | What catches it |
| --- | --- | --- |
| Image cannot be pulled | No — the deployment stalls | `wait services-stable` in `deploy.yml` |
| Container runs but fails its health check | Yes, after 3 failures, about 15 minutes | The breaker, unaided |

A release that fails the way releases usually fail — bad code, a missing
variable, a process that never listens — rolls itself back. One that cannot pull
its image at all does not, and the pipeline catches that instead. Both are
covered. Only one is covered by the breaker, and it is worth knowing which.

---

## Genuinely open tickets

### 2014 — Take ownership of the workflow catalogue *(Story, High)*

> *"Product content is therefore controlled by a third party."*
> AC: *"The catalogue syncs from a repository you control; upstream renaming or
> privatising theirs has no effect."*

**Closed 18 September 2026**, with 2015 and 2016, by deploy run 37 at
`0a9d7d08`. `MIKE_WORKFLOWS_REPOSITORY` on the live backend revision `:22` is
`Fraser-Matcham/mike-workflows`, pinned at
`ce62e6a2d3f47e1d3567a4f2edc61898cfe9e78a`; revision `:20` had
`Open-Legal-Products/mike-workflows` at `main`. The release's catalogue-sync
task ran from the new revision against the fork and exited clean, which is
2016's acceptance criterion. The account below records how it stood before.

It was never an availability problem: the e2e workflow's "Sync Mike workflow
catalog" step passed on every pull request, so that repository was publicly
readable without a token. It was a supply-chain problem — the ticket's own
framing — and the fork is what answers it. Creating a repository under an
account the operator owns was outside what this repository's tooling can do,
which is why it sat in the human-task runbook rather than being automated.

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

What remained after the fork was configuration, and that is what was done:
`workflows_repository` and `workflows_ref` set in `infra/terraform.tfvars`,
applied, and the next release's catalogue sync read from the fork. The catalogue carries 23 assistant workflows and
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
