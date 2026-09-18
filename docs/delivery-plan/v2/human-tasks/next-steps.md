# What is left for you to do

Everything outstanding that needs a person, in one place and in the order to do
it. Six tasks. Nothing here is a code change — the engineering for all of it is
merged and waiting.

The service is up and serving. None of these is an outage; they are the gap
between "running" and "finished".

| # | Task | Time | Blocks |
| --- | --- | --- | --- |
| ~~1~~ | ~~Run the queued `terraform apply`~~ — **done 18 September 2026** | — | — |
| ~~2~~ | ~~Fork the workflow catalogue~~ — **done 18 September 2026**, proved by deploy run 37 | — | — |
| 3 | Get an Anthropic key and put it in two places — **[DEFERRED]** by the operator, 18 September 2026 | 20 min | 2020, and the product's central feature |
| ~~4~~ | ~~A test account on the live stack~~ — **done 18 September 2026** | — | — |
| 5 | Two optional drills | 2 h | 2095, 2098 |
| 6 | Let the monitoring window elapse | nothing | 2107 |

**Tasks 1, 2 and 4 are done** (18 September 2026). Task 1's steps are kept
below because the sign-in, import and plan-reading sequence is the same for any
future apply. **Only Task 3 is still yours**, and it is paused by choice —
Tasks 5 and 6 are optional and can wait.

Stage 5, the self-hosted platform, is a separate and larger sequence with its
own runbook: [`stage-5-platform.md`](stage-5-platform.md). Nothing in it is a
prerequisite for anything here, and it starts by approving a monthly cost, so
it is a decision before it is a task.

---

## Task 1 — Run the apply that four changes are waiting on ✅

> **Done 18 September 2026.** Three of the four landed: ECS Exec off on both
> services and both task roles, ECR enhanced scanning, and `alert_email` with
> both subscriptions imported rather than duplicated. The fourth,
> `workflows_repository`, needs the fork from Task 2 first.
>
> Verified against the account afterwards: `enableExecuteCommand: false` on
> both services, zero inline policies on either task role, registry
> `scanType: ENHANCED` with both rules, exactly one email subscription per
> topic at the original ARNs, both services 1/1 with `COMPLETED` rollouts on
> the deployed revisions (backend `:20`, frontend `:7` — not `bootstrap`), and
> the site answering 200 on `/` and `/api/ready`.
>
> **The image scan gate is live for the first time.** Read "What this actually
> turns on" below before the next deploy: it may go red, and that would be the
> gate working.
>
> The steps below are kept for the next apply — Task 2 needs one.


**Why:** four merged changes are sitting in `infra/` unapplied, and two of them
are live security gaps:

- **ECS Exec is enabled on both services.** Confirmed against the account —
  `legalworkflows-production-backend` and `-frontend` both read
  `enableExecuteCommand: true` today. Anyone holding the deploy credentials can
  open an unrecorded shell inside a task that holds decrypted secrets.
- **The release's image scan gate currently passes everything.** See "What this
  actually turns on", below. This is the one worth reading before you start.

**Time:** 30 minutes, most of it reading the plan.

### Before you start

| You need | Value |
| --- | --- |
| Terraform | `~> 1.16` (`required_version` in `infra/versions.tf`) |
| AWS credentials | For account `119462788248`, region `eu-west-2`. **Not** the deploy role — it deliberately cannot touch state. |
| State bucket | `lmm-terraform-state-119462788248` |
| State key | `legalworkflows/production/terraform.tfstate` |

### Steps

**1. Confirm you are pointed at the right account.**

```sh
aws sts get-caller-identity --query Account --output text
```

It must print `119462788248`. If it prints anything else, stop and fix your
credentials — every command below acts on whatever account answers here.

**2. Initialise, if this machine has not run Terraform on this stack before.**

```sh
cd infra
cp backend.hcl.example backend.hcl
```

Edit `backend.hcl` to read:

```hcl
bucket = "lmm-terraform-state-119462788248"
key    = "legalworkflows/production/terraform.tfstate"
region = "eu-west-2"
```

Then:

```sh
terraform init -backend-config=backend.hcl
```

Both `backend.hcl` and `terraform.tfvars` are gitignored, so neither leaves your
machine. If you have run Terraform here before, `terraform init` alone is enough.

**3. Put the alert address in `terraform.tfvars`.**

```
alert_email = "<the address you confirmed on 18 September>"
```

**Do this before step 4, not after.** `aws_sns_topic_subscription.email` is a
`for_each` over a map that is empty while `alert_email` is null, so until the
variable is set the resource address does not exist in the configuration and the
import fails with an error that does not say why.

**4. Find the two subscription ARNs.**

```sh
aws sns list-subscriptions-by-topic \
  --topic-arn arn:aws:sns:eu-west-2:119462788248:legalworkflows-production-alerts \
  --query 'Subscriptions[?Protocol==`email`].SubscriptionArn' --output text

aws sns list-subscriptions-by-topic \
  --topic-arn arn:aws:sns:eu-west-2:119462788248:legalworkflows-production-alerts-urgent \
  --query 'Subscriptions[?Protocol==`email`].SubscriptionArn' --output text
```

Each prints one ARN ending in a UUID. Both were confirmed from your inbox on
18 September, so neither should read `PendingConfirmation` — a subscription in
that state has no ARN and cannot be imported.

**5. Import both.**

Terraform does not adopt a subscription it did not create. Both of these were
made through the API during the 18 September incident, so without the import the
apply creates a *second* pair and every alarm emails you twice.

```sh
terraform import \
  'module.observability.aws_sns_topic_subscription.email["informational"]' \
  '<the ARN from the first command above>'

terraform import \
  'module.observability.aws_sns_topic_subscription.email["urgent"]' \
  '<the ARN from the second command above>'
```

`informational` is the plain `-alerts` topic; `urgent` is `-alerts-urgent`.
Getting them the wrong way round imports each subscription under the other's
address, and the next plan will want to destroy and recreate both — which is one
of the things step 6 asks you to look for.

**6. Plan, and read it.**

```sh
terraform plan -out=tfplan
```

**This plan contains two deliberate destroys.** They are correct. You are
turning a capability off, and the IAM policies that granted it go with it:

| Change | Resource | Why |
| --- | --- | --- |
| **destroy** | `module.secrets.aws_iam_role_policy.backend_task_ecs_exec[0]` | `enable_ecs_exec` is `false`, so its `count` goes 1 → 0 |
| **destroy** | `module.secrets.aws_iam_role_policy.frontend_task_ecs_exec[0]` | Same |
| update | the backend `aws_ecs_service` | `enable_execute_command: true → false` |
| update | the frontend `aws_ecs_service` | Same |
| **create** | `aws_ecr_registry_scanning_configuration.this` | Registry moves `BASIC` → `ENHANCED` |
| *no change* | both `aws_sns_topic_subscription.email` entries | The imports in step 5 |

Three things to check before applying:

- The two SNS subscriptions report **no changes**. If the plan wants to
  *create* them, the import did not take — **stop**. Applying from there gives
  you duplicate subscriptions and double emails on every alarm.
- The only destroys are those two IAM role policies. Anything else it wants to
  destroy or replace is a question, not a step — send it to me.
- It is not touching the ECS task definitions. Terraform and the deploy
  pipeline each own different fields of those; a plan that wants to roll them
  back to an older image means something has drifted.

**7. Apply.**

```sh
terraform apply tfplan
```

**8. Verify.** Three commands, and all three should agree:

```sh
# ECS Exec off on both services — expect: False False
aws ecs describe-services --cluster legalworkflows-production \
  --services legalworkflows-production-backend legalworkflows-production-frontend \
  --query 'services[].enableExecuteCommand' --output text

# Registry scanning — expect: ENHANCED
aws ecr get-registry-scanning-configuration \
  --query 'scanningConfiguration.scanType' --output text

# The site still serves — expect: 200 and 200
curl -s -o /dev/null -w '%{http_code}\n' https://legalworkflows.co.uk/
curl -s -o /dev/null -w '%{http_code}\n' https://legalworkflows.co.uk/api/ready
```

The apply rolls both ECS services. `minimumHealthyPercent` is 100, so the
serving task is never drained for a replacement that has not become healthy —
but check anyway.

### What this actually turns on

**The image scan gate in `deploy.yml` cannot refuse anything until this apply
runs.** (In its current form. An earlier form of it did refuse an image —
`backend/Dockerfile` records it rejecting the full LibreOffice suite at 31
findings, which is why only Writer is installed.)

The gate counts findings under `.imageScanFindings.enhancedFindings[]` with
`fixAvailable == "YES"`. Enhanced findings only exist under enhanced scanning,
and the registry is still `BASIC`. Basic findings live under a different key
(`.findings[]`) and carry no `fixAvailable` field at all, so the `[]?` in the
gate's jq yields an empty list, `BLOCKING` computes to `0`, and the step prints
"no fixable high or critical findings" and passes.

Checked against the running image rather than inferred. The live backend image
in ECR reports:

```
severityCounts: {"CRITICAL": 5, "HIGH": 24, "MEDIUM": 17, "LOW": 2}
basic findings:    48
enhanced findings:  0
```

Forty-eight findings, twenty-nine of them high or critical, and a gate that
reported the image clean. That is not a bug in the gate — the design is
deliberate and the reasoning is in `deploy.yml`'s comment: basic scanning cannot
say whether a fix exists, a Debian base ships with CVEs Debian will not fix, and
a gate that can never pass is not a gate. Enhanced scanning is what supplies
`fixAvailable`, so the gate can refuse what is actionable and let through what
nobody can act on.

**So expect the next deploy after this apply to behave differently**, and
possibly to go red. If it does, that is the gate working for the first time, and
the finding it names will have a fix available. Do not route around it — send it
to me.

Two smaller consequences of the same change:

- Inspector bills per image scanned, and continuous scanning re-scans when a
  relevant CVE is published. This enables scanning for the **whole registry**,
  which is shared with the matter-management platform, not just this project's
  repositories. `infra/scanning.tf` explains why the wildcard rule has to be
  there: under `ENHANCED`, a repository matching no filter has scanning off
  entirely rather than downgraded.
- The first scan after enabling can lag a few minutes. `deploy.yml` polls for
  15 minutes and says so in its error text, so a re-run is safe.

### Tell me

- That the apply completed, and whether the plan held anything beyond the six
  rows in the table above.
- If the plan wanted to **create** the SNS subscriptions rather than leave them
  alone — stop there and tell me before applying.
- What the next deploy's "Build and scan" jobs say. That is the first honest
  reading anyone has had of what is in these images.

## Task 2 — Fork the workflow catalogue ✅

**Why:** `workflows_repository` still points at
`Open-Legal-Products/mike-workflows`, which is upstream's. The product's
content — 23 assistant workflows and the tabular-review packs — is therefore
controlled by a third party who can rename or privatise it. Ticket 2014's
acceptance criterion is that the catalogue syncs from a repository you control.

This is a supply-chain problem, not an availability one: that repository is
publicly readable today and the sync passes on every pull request. Nothing
breaks while you wait. It just is not yours.

**The licence question is answered.** The catalogue repository is MIT, checked
on 17 September 2026 at `ce62e6a`. MIT permits the fork, the copy and the
modification outright; the one obligation is to keep the MIT notice, which
forking does by itself. It is a separate repository from the AGPL application,
so neither licence reaches the other.

**Time:** 15 minutes, plus a release.

**Why you and not me:** creating a repository under an account you own is
outside what I can do from here — my GitHub access is scoped to the three
repositories of this project.

### Steps

1. Go to **https://github.com/Open-Legal-Products/mike-workflows**.
2. Click **Fork**. Owner: your account or organisation. Keep the name
   `mike-workflows` or rename it — the value is configuration either way.
3. Note the commit SHA the fork is at: on the fork, **Commits**, and copy the
   full 40-character SHA of the top commit.
4. In `infra/terraform.tfvars`, set both:

   ```
   workflows_repository = "<your-account>/mike-workflows"
   workflows_ref        = "<the full 40-character SHA>"
   ```

   Pin the SHA rather than `main`. That is what stops an edit to the catalogue
   changing product content between releases without a deploy.
5. `terraform plan -out=tfplan` and `terraform apply tfplan`, reading the plan
   as in Task 1. If you are doing this before Task 1, fold it into that apply
   instead of running a second one.
6. Merge anything to `main` — or re-run the latest deploy — so a release picks
   up the new value. The release's catalogue-sync step is what proves it: it
   runs `npm run sync:workflows` as a one-off task before the service rolls, and
   its exit code decides whether the deploy continues.

### Done — 18 September 2026

Forked to **`Fraser-Matcham/mike-workflows`**, pinned at
`ce62e6a2d3f47e1d3567a4f2edc61898cfe9e78a`, applied, and proved by deploy
run 37 at `0a9d7d08`:

| | Before (`:20`) | After (`:22`, live) |
| --- | --- | --- |
| `MIKE_WORKFLOWS_REPOSITORY` | `Open-Legal-Products/mike-workflows` | `Fraser-Matcham/mike-workflows` |
| `MIKE_WORKFLOWS_REF` | `main` | `ce62e6a2…` |

The catalogue-sync task ran from the new revision and exited clean, the
service rolled `COMPLETED` 1/1, and readiness passed through the edge.
Closes **2014**, **2015** and **2016**.

The release did not go green on the first attempt. Four runs were spent on
faults in the image scan gate — a gate that could not pass, a half-fixed
image, a permission failure hidden behind a shell redirect, and a paginated
status read. All five are recorded in
[`outstanding.md`](../outstanding.md); none of them were this task's doing,
and production served on `:20` throughout.

---

## Task 3 — Get an Anthropic key, and put it in two places ⏸

> **[DEFERRED]** by the operator on 18 September 2026. Recorded as a decision,
> not an omission, so it stays visible rather than quietly becoming permanent.
>
> What stays true while it is deferred: ticket 2020 is open, the four LLM e2e
> specs continue to self-skip so e2e's green covers 27 specs and not 31, and any
> request reaching the model provider fails at request time. `/api/ready` keeps
> answering 200 throughout, because readiness probes the database and storage
> and deliberately does not probe the provider — so nothing about the service
> looks wrong from outside. Nothing degrades further by waiting.


**Why:** there is no model provider key anywhere, and the product's central
feature is asking a question and getting a streamed answer.

Two separate consequences, and they need the key in two different places:

- **In CI**, four end-to-end specs have never run — chat rename, chat delete,
  chat submit, and the critical-path "ask a question". They self-skip without
  the key and the run still reports green. That is deliberate and documented,
  but it means e2e's green covers the other 27 specs only.
- **In production**, any request that reaches the model provider fails. The
  readiness check does not probe the provider — it checks the database and
  storage only — so `/api/ready` answers 200 and the site looks healthy. The
  failure appears when a user asks a question.

**Time:** 20 minutes.

**Cost:** yours, metered by Anthropic. Set a spend cap on the key.

### Steps

**a. Mint the key**

1. Go to **https://console.anthropic.com/settings/keys**.
2. Create a key. Name it for where it is going, so the two are distinguishable
   later — for instance `legalworkflows-ci` and `legalworkflows-production`.
3. Set a **spend limit** on each. The CI key drives four specs per run; the
   production key serves real usage.

Two keys rather than one is worth the extra minute: it means revoking the CI
key after a leak in a build log does not take production down with it.

**b. The CI key — a GitHub repository secret**

1. Open **https://github.com/Fraser-Matcham/legalworkflows** → **Settings**.
2. Sidebar: **Secrets and variables → Actions**.
3. **Secrets** tab → **New repository secret**.
4. **Name:** `ANTHROPIC_API_KEY` — exactly this. Both the workflow env and
   `e2e/llm.ts` read that name. **Secret:** the CI key.
5. **Add secret**.

   The CLI equivalent, if you prefer:

   ```sh
   gh secret set ANTHROPIC_API_KEY --repo Fraser-Matcham/legalworkflows
   ```

6. Prove it took: **Actions → e2e → Run workflow** on `main`. In the run's job
   log, the env block of a step that exposes the secret should read
   `ANTHROPIC_API_KEY: ***` rather than empty, and the four specs should run
   instead of skipping.

   Note the caveat in [`../../../e2e-ci.md`](../../../e2e-ci.md): GitHub
   withholds repository secrets from pull requests opened from **forks**, so
   those runs stay keyless and keep skipping the four specs by design. Runs from
   branches in this repository, and manual runs, get the secret.

**c. The production key — the operator secret in Secrets Manager**

The running service does not read GitHub secrets. Runtime secrets live in
Secrets Manager and reach the tasks from there; the pipeline never sees them.

The key already exists — the backend task definition references
`ANTHROPIC_API_KEY` from `legalworkflows-production/backend/operator`, and the
task is running, so the JSON carries that key with an empty or placeholder
value. You are **replacing a value, not adding a key**.

That distinction matters. A task definition referencing a JSON key that is not
present fails to start with `ResourceInitializationError` naming the missing
key, and the service never rolls. That is what took the site down on
18 September. Editing the value of a key that is already there cannot cause it;
renaming or removing the key can.

1. Open the AWS console → **Secrets Manager** →
   `legalworkflows-production/backend/operator`.
2. **Retrieve secret value** → **Edit**.
3. Replace the value of the existing `ANTHROPIC_API_KEY` key with the production
   key. Leave every other key exactly as it is, and do not change the key's
   name.
4. **Save**.
5. Roll the backend so a new task picks the value up — merge anything to `main`,
   or re-run the latest deploy. The value is read when the task starts, so the
   running task keeps the old one until it is replaced.
6. Ask the product a question and check you get an answer.

Nothing breaks in the meantime: the provider client is built at request time and
only checks the key is non-empty, so an empty value fails the request that needs
it rather than the service.

### Tell me

- That both are set, and that the e2e run showed `***` and ran the four specs.

Then I can close 2020 properly rather than as "green because it did not run".

---

## Task 4 — Make me a test account on the live stack ✅

> **Done 18 September 2026**, and by the better route: the operator ran the
> round trip themselves, so no production login was created for me to hold.
>
> A document uploaded through the product downloaded again with its contents
> intact. Confirmed server-side rather than from the UI — two objects landed in
> `legalworkflows-production-documents` at 14:02 and 14:03, a `.docx` and its
> converted `.pdf`, at real sizes and encrypted under the documents KMS key.
>
> The configuration half checked out too: `R2_REGION` is `eu-west-2` and the
> bucket's own region is `eu-west-2`, which is what `storageRegion.ts` resolves
> the signing region from. A mismatch is the fault the ticket exists to catch,
> and it reads like a permissions error rather than a region error.


**Why:** ticket 2044 is the signed-URL round trip against real S3. The code half
is done and tested — `backend/src/lib/storageRegion.ts` resolves the signing
region, with unit coverage. What is missing is the live half: upload a document
through the product, confirm the presigned URL it hands back actually fetches
the bytes from the real bucket.

A presigned URL signed for the wrong region is rejected by S3 with what reads
like a permissions error, which is exactly the kind of fault that only a real
round trip catches.

**Time:** 5 minutes for you.

### Steps

1. Sign up at **https://legalworkflows.co.uk** with an address you can receive
   mail at, or create the account from the Supabase dashboard.
2. Send me the credentials **here in this session** — not in the repository, not
   in a commit, not in a pull request.
3. Use a throwaway password and delete the account afterwards. It is a test
   account on production, so treat it as disposable from the start.

Alternatively, do it yourself: upload a document in the product and confirm it
downloads again. If it downloads, 2044 passes. Tell me and I will record it.

---

## Task 5 — Two drills, when you want them

Both need your authorisation because both touch production. Neither is urgent,
and you have already declined them once — this is here so they are not
forgotten, not to press.

### 2095 — The restore drill

**Why:** backups are configured and verified as configured — the document bucket
is versioned and continuously replicated into a write-locked backup bucket with
35-day retention, and Supabase takes daily database backups. What has never been
done is restoring from them. A backup that has not been restored from is a
hypothesis.

The procedure is [`../../../runbooks/restore.md`](../../../runbooks/restore.md).
**Time:** about an hour.

### 2098 — The load test

**Why:** `loadtest/sse-stream.js` and its workflow exist and have never been
run. It is a ramping-VU scenario over the `/chat` SSE stream measuring
time-to-first-byte and whether streams reach `[DONE]` under concurrency.

It needs two things you would have to decide on:

- **A stack it is safe to point at.** Every iteration creates a real chat row
  and spends real provider tokens on the target. Against production that is
  real money and real rows in the live database.
- **A `LOADTEST_AUTH_TOKEN` secret.**

It also needs Task 3 done first — without a provider key the scenario measures
how fast the service can fail.

**Time:** about an hour, plus whatever the thresholds surface (ticket 2099).

---

## Task 6 — Let the monitoring window elapse

**Nothing to do.** Ticket 2107 asks for a post-launch monitoring window to pass
with no unresolved incident. That is elapsed time, not configuration.

The configuration half is done and proven: both alert topics were subscribed and
confirmed on 18 September 2026, and a test publish to each was confirmed
received. Before that, all sixteen alarms fired into silence — which is why the
site served 503 for a morning with nobody told.

If an alert arrives, it is real. Send it to me.

---

## What I am doing while you do these

Nothing here blocks me, and nothing I am doing blocks these. When you have done
Task 1, tell me and I will verify the apply landed — ECS Exec off on both
services, the ECR scanning configuration, and the two subscriptions in state
rather than duplicated.
