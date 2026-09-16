# Stage 4 — your tasks (deployment, CI and launch)

Eight tasks. Do them **in order**. Tasks 1 to 3 finish the repository setup,
task 4 closes a security hole opened deliberately in Stage 3, and tasks 5 to 8
are the launch itself.

By this stage the application is running on your infrastructure but is not yet
open to anyone. These tasks make it deployable, make it safe, and then make it
live.

---

## Task 1 — Store the deployment credentials in GitHub

**Why:** the automated pipeline needs to know which AWS account and role to
use. These are settings, not passwords — the actual credential is proved per
deploy using the role you created in Stage 3, Task 5.

**Time:** 10 minutes.

**Before you start:** Stage 3 must be complete.

### Steps

1. Go to **https://github.com/Fraser-Matcham/legalworkflows**.
2. Click **Settings** (the tab along the top of the repository, not your
   account settings).
3. In the left sidebar click **Secrets and variables**, then **Actions**.
4. Click the **Variables** tab, then **New repository variable**. Add these one
   at a time — click **Add variable** after each:

   *If you would rather keep them with the environment — **Settings** →
   **Environments** → **production**, then **Add environment variable** and
   **Add environment secret** — that works too, and gives the same names the
   same meaning. The pipeline reads them with the environment resolved, so it
   does not mind which you choose. What it cannot do is find them under a
   different repository, or under an organisation that has not granted this
   repository access.*
   - Name `AWS_REGION`, value: your region, for example `eu-west-2`
   - Name `AWS_ROLE_ARN`, value: the role ARN from Stage 3, Task 5
   - Name `AWS_ACCOUNT_ID`, value: your 12-digit account number
   - Name `APP_URL`, value: `https://legalworkflows.co.uk`
   - Name `SOURCE_MIRROR_REPOSITORY`, value: the mirror from Task 3 below, in
     the form `owner/repository` — for example
     `Fraser-Matcham/legalworkflows-source`
5. Now click the **Secrets** tab, then **New repository secret** — or the
   `production` environment, as above. Add these one at a time:
   - Name `SUPABASE_DB_URL`, value: the database connection string the
     pipeline applies migrations with. In the Supabase dashboard click
     **Connect** at the top of the project, choose **Session pooler**, copy
     the URI and replace `[YOUR-PASSWORD]` with the database password from
     Stage 2, Task 2. *Session pooler, not the direct connection: GitHub's
     machines cannot reach the direct host.*
   - Name `SOURCE_MIRROR_TOKEN`, value: the token from Task 3, step 8 below.

*The distinction: variables are visible in logs, secrets are masked. Anything
that would let someone act as you goes in Secrets.*

*The Supabase service key and the model provider key are deliberately **not**
here. They live in AWS Secrets Manager (Stage 3) and the running service reads
them from there; the deploy pipeline never needs them.*

### Tell me

- **"GitHub variables and secrets set"**, and list the names you added — not
  the values — so I can confirm nothing is missing or misnamed.

---

## Task 2 — Turn on branch protection

**Why:** at present anyone with write access — currently you, and me acting on
your behalf — can push directly to `main`, which deploys to production. Branch
protection means every change goes through a pull request and passes the 15 CI
checks first.

**Time:** 10 minutes.

**Before you start:** nothing.

### Steps

1. In the repository, go to **Settings** → **Rules** → **Rulesets** in the left
   sidebar.
2. Click **New ruleset** → **New branch ruleset**.
3. **Ruleset name:** `protect-main`
4. **Enforcement status:** set to **Active**.
5. Under **Target branches**, click **Add target** → **Include default
   branch**.
6. Under **Rules**, tick:
   - **Restrict deletions**
   - **Require a pull request before merging** — set **Required approvals** to
     `0`. *As the only developer, requiring an approval would block you
     entirely. The value here is that changes are reviewable and revertible,
     not that someone else signs them off.*
   - **Require status checks to pass** — then click **Add checks** and add, at
     minimum: `Backend build and tests`, `Frontend build and tests`,
     `Repository boundary`, `Route tenancy`, `Trademarks`, `Schema privileges`,
     `gitleaks (full history)`.
   - **Block force pushes**
7. Click **Create**.

### Tell me

- **"Branch protection active"**.

> **If this blocks something legitimate later**, tell me rather than switching
> it off. There is almost always a narrower fix.

---

## Task 3 — Create the public source mirror

**Why:** this is a legal obligation, not a nicety. The application is licensed
under the AGPL. Section 13 requires that anyone who uses the service over a
network can obtain its source code. That means a public repository, kept
current with what is actually deployed.

**Time:** 10 minutes.

**Before you start:** nothing.

### Steps

1. Go to **https://github.com/new**.
2. **Owner:** your account. **Repository name:** `legalworkflows-source`
3. **Description:** `Corresponding Source for the legalworkflows service, as
   required by AGPL-3.0 section 13.`
4. Choose **Public**. *This is the entire point — a private mirror satisfies
   nothing.*
5. Do **not** tick "Add a README", "Add .gitignore" or "Choose a license". The
   mirror is populated automatically and any starting file gets in the way.
6. Click **Create repository**.
7. Copy the repository URL from the address bar.
8. Now a token that can write to that repository and nothing else. Click your
   profile picture → **Settings** → **Developer settings** →
   **Personal access tokens** → **Fine-grained tokens** → **Generate new
   token**. Name it `legalworkflows-source-mirror`; set the expiry to the
   longest offered (you will be reminded to renew it); under **Repository
   access** choose **Only select repositories** and pick
   `legalworkflows-source`; under **Permissions → Repository permissions**
   set **both** of these to **Read and write**, leaving everything else at
   *No access*:
   - **Contents** — to push the tree and its history.
   - **Workflows** — because the mirror is a complete copy and therefore
     contains `.github/workflows/`. GitHub refuses to let *any* token write a
     workflow file without this, whatever its Contents permission, and the
     push is rejected per-ref with *"refusing to allow a Personal Access
     Token to create or update workflow ... without `workflow` scope"*.
     Stripping the workflows from the mirror is not the alternative: AGPL-3.0
     section 1 counts the scripts that control building and installation as
     part of the Corresponding Source.

   Click **Generate token** and copy it — it is shown once. This is the
   `SOURCE_MIRROR_TOKEN` secret in Task 1.

   *If you have already made the token and need to add a permission, edit it
   rather than regenerating: changing a token's permissions does not change
   its value, so the stored secret stays correct.*

### Tell me

- The URL of the public mirror repository, and **"mirror token stored"**.

The pipeline that pushes to it on every deploy, and refuses to deploy if
that push fails, is already in the repository (`docs/release-pipeline.md`);
these two settings are what switch it on. Until they exist, every deploy
stops at the mirror step — deliberately.

---

## Task 4 — Delete the temporary build credential

**Why:** in Stage 3, Task 6 you created an access key so I could build the
infrastructure. Deploys now run through the GitHub role instead. That key is a
standing risk with no remaining purpose.

**Time:** 5 minutes.

**Before you start:** Task 1 must be complete and at least one deploy must
have succeeded through the pipeline. **Do not do this before then** — you
would remove the ability to fix the pipeline if it fails.

### Steps

1. Sign in to the AWS console as `fraser-admin`.
2. Go to **IAM** → **Users**.
3. Click **terraform-build**.
4. Open the **Security credentials** tab.
5. Under **Access keys**, find the key, click **Actions** → **Deactivate**.
6. Wait 24 hours. If nothing has broken, come back and use **Actions** →
   **Delete**. *Deactivating first is reversible; deleting is not.*
7. Once the key is deleted, go back to **Users**, tick `terraform-build`, and
   click **Delete**.

### Tell me

- **"Build credential deactivated"** on the day you do it, then
  **"Build credential deleted"** when you complete step 6.

---

## Task 5 — Test the application yourself, before anyone else does

**Why:** the automated tests prove the code behaves. They cannot tell you
whether the product is usable. You are the first person who will find out.

**Time:** 1–2 hours.

**Before you start:** I will tell you the application is live at your domain.

### Steps

Work through this in order, on the real site, using a real document. Use a
document you do not mind being processed — a public one, or a synthetic one.

1. **Sign up** with a real email address you can receive mail at. Confirm the
   email arrives, is not in spam, and comes from your own domain rather than a
   Supabase address. *If it lands in spam, stop and tell me — that is Stage 2,
   Task 5 not having taken effect.*
2. **Set up multi-factor authentication** from Settings → Security. Scan the
   code with your authenticator app. Check the entry it creates says
   **legalworkflows** and not something inherited.
3. **Sign out and back in**, including the MFA code. This is the single most
   important flow in the application — if it breaks, nobody can use anything.
4. **Upload a document.** Watch it convert and become readable in the viewer.
5. **Ask the assistant a question** about that document. Confirm the answer
   references the document and is not obviously wrong.
6. **Create a tabular review** with two or three columns and run it.
7. **Download a document**, and confirm the file that arrives opens correctly.
8. **Delete a document**, then confirm it is gone from the list.
9. **Delete your test account** from Settings, then try to sign in again to
   confirm it is really gone.
10. On your phone, open the site and repeat steps 3 and 4. Layout problems show
    up on a small screen that a desktop hides.

### Tell me

- Anything that did not work, or felt wrong, one item per line. Small things
  count — awkward wording, a slow page, a confusing button. This is the only
  point at which fresh eyes are available.

---

## Task 6 — Walk the rebrand checklist

**Why:** automated checks stop the old name reaching a screen. They cannot
judge whether the new one looks right. This is the manual pass described in
`docs/rebrand-verification.md`.

**Time:** 30 minutes.

**Before you start:** Task 5 must be complete, so you are already signed in.

### Steps

1. Open `docs/rebrand-verification.md` in the repository — or ask me to paste
   its checklist into the chat.
2. Work down the **"Screens to look at"** tables. On the live site you are at
   tier 2, so every row is reachable except the link preview.
3. For the link preview specifically: paste your live URL into a WhatsApp
   message to yourself, or into Slack. Look at the card that appears — the
   title, description and image. This is the one thing that could not be
   checked before the site was public.
4. Check the browser tab icon (the favicon) is the new mark and not a
   placeholder.
5. Open the Word add-in if you use it, and check the ribbon button and its
   icon.

### Tell me

- Any screen where the branding looks wrong, with the screen name from the
  checklist.

---

## Task 7 — Confirm the licence compliance position

**Why:** the AGPL places obligations on you as the operator, and only you can
confirm they are met. I have implemented the mechanisms; signing them off is a
judgement about your own compliance.

**Time:** 30 minutes.

**Before you start:** Task 3 must be complete and the mirror must have
received at least one push.

### Steps

1. Open your live site and go to `/legal`. Read the page. Confirm it says: it
   is a modified version of the upstream work, who modified it (you), when
   modification began, and that it is licensed under AGPL-3.0.
2. Confirm the link to the Corresponding Source on that page resolves to your
   public mirror from Task 3, and that the mirror contains current code — check
   the date of its most recent commit.
3. Open the `LICENSE` file in the public mirror and confirm it is the full
   AGPL-3.0 text.
4. Open `THIRD-PARTY-NOTICES.md` in the mirror and confirm it exists and is
   populated.
5. Decide whether you are content with the one unresolved dependency I flagged
   earlier: `buffers@0.1.1` has no declared licence. It is a transitive
   dependency, meaning something else you use pulls it in. Options are to
   accept the risk and record that you did, or ask me to find a way to remove
   it. For a first launch, accepting and recording is defensible.

### Tell me

- **"Licence position confirmed"**, or which of the five points is not
  satisfied.
- Your decision on `buffers@0.1.1`.

---

## Task 8 — Authorise going live

**Why:** everything up to now has been reversible. This is the point where the
service becomes something real people depend on, and it should be a deliberate
decision rather than a drift.

**Time:** 15 minutes.

**Before you start:** Tasks 5, 6 and 7 must be complete and their findings
resolved.

### Steps

1. Re-read what you wrote in Task 5. Confirm every item is either fixed or
   consciously accepted for launch. A known rough edge is fine; a forgotten one
   is not.
2. Confirm the alerts from Stage 3, Task 9 are reaching you. Ask me to trigger
   a test alarm if you have not seen one.
3. Confirm you know how to reach me, or how to roll back, if something breaks
   in the first week.
4. Decide your first-week plan. Realistically for a sole trader: how many users
   do you let in at once? Letting in three people you know beats opening to
   the public and discovering a problem at scale.
5. Say the word.

### Tell me

- **"Go live"**, plus how many initial users and who they are.
- Or what still needs to happen first.

---

## After launch

I will watch the service for the first period after cutover — errors, latency,
queue depth, failed jobs — and report what the monitoring shows rather than
waiting for you to notice something.

The things deliberately left out of scope, which become the next plan:

- A staging environment, once there is client data worth rehearsing against.
- Redis for the job queue, once volume justifies it over the database queue.
- The Juralio HTTP integration, as a second consumer of the same API.
- The narrower IAM permissions to replace the broad `AdministratorAccess`
  grants that Stage 3 used to get moving.
