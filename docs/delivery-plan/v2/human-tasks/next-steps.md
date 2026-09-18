# What is left for you to do

Everything outstanding that needs a person, in one place and in the order to do
it. Six tasks. Nothing here is a code change — the engineering for all of it is
merged and waiting.

The service is up and serving. None of these is an outage; they are the gap
between "running" and "finished".

| # | Task | Time | Blocks |
| --- | --- | --- | --- |
| 1 | Run the queued `terraform apply` | 30 min | a security finding, alerting durability |
| 2 | Fork the workflow catalogue | 15 min | 2014, 2015, 2016 |
| 3 | Get an Anthropic key and put it in two places | 20 min | 2020, and the product's central feature |
| 4 | Make me a test account on the live stack | 5 min | 2044 |
| 5 | Two optional drills | 2 h | 2095, 2098 |
| 6 | Let the monitoring window elapse | nothing | 2107 |

**Task 1 first.** It carries a security finding that is live until it is
applied. Tasks 2 and 3 are independent of each other and of Task 1 — do them in
whichever order suits. Tasks 4, 5 and 6 can wait.

Stage 5, the self-hosted platform, is a separate and larger sequence with its
own runbook: [`stage-5-platform.md`](stage-5-platform.md). Nothing in it is a
prerequisite for anything here, and it starts by approving a monthly cost, so
it is a decision before it is a task.

---

## Task 1 — Run the apply that four changes are waiting on

**Why:** four merged changes are sitting in `infra/` unapplied. One of them is
a security review finding, so it is live in production until you apply:
**ECS Exec is still enabled on both services** (confirmed against the account —
the backend service reads `enableExecuteCommand: true` today), which means anyone holding the
deploy credentials can open an unrecorded shell inside a task that holds
decrypted secrets.

**Time:** 30 minutes, most of it reading the plan.

**Where:** a terminal with AWS credentials for the account, in `infra/`.

What is queued:

| Change | Effect |
| --- | --- |
| ECS Exec disabled on both services and both task roles | Closes security finding 2 |
| ECR enhanced scanning | Continuous CVE scanning of pushed images |
| `alert_email` | Puts the alert subscriptions in Terraform, so a rebuild keeps them |
| `workflows_repository` | Only if you have done Task 2 — see there |

### Steps

1. **Open a terminal in `infra/` with credentials for the account.**

   ```sh
   cd infra
   ```

   If you have not used Terraform on this machine before, the initialisation is
   in [`../../../../infra/README.md`](../../../../infra/README.md) under
   "Initialising" — copy `backend.hcl.example` and `terraform.tfvars.example`,
   then `terraform init -backend-config=backend.hcl`.

2. **Put the alert address in `terraform.tfvars`.**

   The file is gitignored, so this stays on your machine and in Terraform
   state, not in the repository. Add or edit the line:

   ```
   alert_email = "<the address you confirmed on 18 September>"
   ```

   Do this **before** the imports in step 4. The subscriptions are declared with
   `for_each` over a map that is empty while `alert_email` is null, so until the
   variable is set the resource address does not exist and the import fails with
   a misleading error.

3. **Find the two subscription ARNs.**

   ```sh
   for topic in legalworkflows-production-alerts legalworkflows-production-alerts-urgent; do
     aws sns list-subscriptions-by-topic \
       --topic-arn "arn:aws:sns:eu-west-2:<account id>:$topic" \
       --query 'Subscriptions[?Protocol==`email`].SubscriptionArn' --output text
   done
   ```

   Each should print a full ARN ending in a UUID. If either prints
   `PendingConfirmation`, that subscription was never confirmed from the inbox
   and cannot be imported — click the link in the confirmation email first.

4. **Import both subscriptions.**

   Terraform does not adopt a subscription it did not create. Both of these were
   made through the API during the 18 September incident, so without the import
   the apply creates a *second* pair and every alarm emails you twice.

   ```sh
   terraform import \
     'module.observability.aws_sns_topic_subscription.email["informational"]' \
     '<the ARN for legalworkflows-production-alerts>'

   terraform import \
     'module.observability.aws_sns_topic_subscription.email["urgent"]' \
     '<the ARN for legalworkflows-production-alerts-urgent>'
   ```

   The reasoning, and what to do if an import fails, is in
   [`../../../../infra/modules/observability/README.md`](../../../../infra/modules/observability/README.md)
   under "Adopting subscriptions that were made by hand".

5. **Plan, and read it.**

   ```sh
   terraform plan -out=tfplan
   ```

   **Check three things before applying:**

   - It reports **no changes** for the two `aws_sns_topic_subscription.email`
     resources. If it still wants to *create* them, the import did not take —
     stop. Applying from here gives you duplicate subscriptions and double
     emails.
   - It wants to **update** the two ECS services and the two task roles (Exec
     off), and the ECR repositories (scanning). Those are the intended changes.
   - Treat anything it wants to **destroy or replace** as a question, not a
     step. There is no staging environment; the plan is the rehearsal.

6. **Apply.**

   ```sh
   terraform apply tfplan
   ```

7. **Check the site still serves.** The ECS service update rolls both services.
   `minimumHealthyPercent` is 100, so the serving task is not drained for a
   replacement that has not become healthy — but confirm anyway:

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' https://legalworkflows.co.uk/
   curl -s -o /dev/null -w '%{http_code}\n' https://legalworkflows.co.uk/api/ready
   ```

   Both should be `200`.

### Tell me

- That the apply completed, and whether the plan contained anything you did not
  expect.
- If the plan wanted to create the subscriptions rather than leaving them
  alone — that is worth stopping on, and I will look at it before you apply.

---

## Task 2 — Fork the workflow catalogue

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

### Tell me

- The fork's `owner/name` and the SHA you pinned.
- That the deploy after it went green, including its catalogue-sync step. That
  closes 2016 as well as 2014.

---

## Task 3 — Get an Anthropic key, and put it in two places

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

## Task 4 — Make me a test account on the live stack

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
