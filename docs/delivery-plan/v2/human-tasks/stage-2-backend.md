# Stage 2 — your tasks (backend)

Seven tasks. Do them **in order** — tasks 2 to 5 all happen inside the project
that task 1 creates.

Each task is self-contained. Where a task ends with **"Tell me"**, that is
information I need to configure the backend — send it back in the chat.

> **A note on secrets.** Several tasks produce long random-looking strings.
> These are passwords. Paste them into the chat when asked — this conversation
> is private to your account — but do not put them in a document you share, an
> email, or a public repository. I will store them in AWS Secrets Manager in
> Stage 3, and they will never be committed to the repository.

---

## Task 1 — Create the Supabase production project

**Why:** Supabase is the database and the login system. Everything else waits
on it. The local Docker version you may have seen is for testing only and
holds no real data.

**Time:** 15 minutes, plus about 5 minutes while the project starts.

**Cost:** the Pro plan is $25/month (about £20). The free plan pauses projects
after a week of inactivity and has no automatic backups, so it is not suitable
for a live service.

### Steps

1. Go to **https://supabase.com** and click **Start your project**. Sign in
   with GitHub, or create an account.
2. Once in the dashboard, click **New project**.
3. Fill in the form:
   - **Name:** `legalworkflows-production`
   - **Database Password:** click **Generate a password**, then copy it
     somewhere safe immediately. It is shown once. This is the master
     database password.
   - **Region:** choose **London (eu-west-2)** if your clients are in the UK.
     If not, pick the region closest to them. *This cannot be changed later
     without recreating the project.*
   - **Pricing Plan:** choose **Pro**.
4. Click **Create new project** and wait. It takes 3–5 minutes.

### Tell me

- The **Region** you chose.
- Confirmation that you saved the database password somewhere safe. Do not
  send me the database password itself — I do not need it, and the application
  does not use it.

---

## Task 2 — Collect the Supabase connection keys

**Why:** the backend authenticates to Supabase with these. Without them it
cannot start.

**Time:** 5 minutes.

**Before you start:** Task 1 must show the project as ready.

### Steps

1. In your Supabase project, click the **gear icon** (Project Settings) at the
   bottom of the left sidebar.
2. Click **API** in the settings menu.
3. You will see three things. Copy each one:
   - **Project URL** — looks like `https://abcdefghijkl.supabase.co`
   - **Project API keys → `anon` `public`** — a long string starting `eyJ`
   - **Project API keys → `service_role` `secret`** — click **Reveal** first.
     Also a long string starting `eyJ`.
4. Keep the `service_role` key particularly safe. It bypasses all database
   security. It belongs only in the backend server, never in a browser, never
   in the frontend, and never in a public repository.

### Tell me

Paste all three, labelled:

```
Project URL:   https://....supabase.co
anon key:      eyJ....
service_role:  eyJ....
```

---

## Task 3 — Load the database structure

**Why:** the project starts empty. This creates the 51 tables the application
needs, along with their security rules.

**Time:** 10 minutes.

**Before you start:** Task 2 must be complete.

### Steps

1. In your Supabase project, click the **SQL Editor** icon in the left sidebar
   (it looks like a database with a terminal prompt).
2. Click **New query**.
3. You now need the contents of the file `backend/schema.sql` from the
   repository. Get it this way:
   - Open **https://github.com/Fraser-Matcham/legalworkflows** in a browser.
   - Click the **backend** folder, then click **schema.sql**.
   - Click the **Raw** button at the top right of the file view.
   - Select everything on the page (Ctrl+A on Windows, Cmd+A on Mac) and copy
     it (Ctrl+C / Cmd+C).
4. Click into the Supabase SQL Editor box and paste.
5. Click **Run** (or press Ctrl+Enter / Cmd+Enter).
6. Wait. It takes 10–30 seconds. You are looking for **"Success. No rows
   returned"** at the bottom.
7. If you see an error in red, **stop and paste the error into the chat**. Do
   not run it a second time — running it twice can leave the database in a
   half-built state that is harder to fix than the original error.

### Tell me

- **"Schema loaded"**, or the exact error text if it failed.

---

## Task 4 — Turn on multi-factor authentication

**Why:** the application supports MFA and the code expects it to be available.
For a service holding client legal documents, it should be on.

**Time:** 3 minutes.

**Before you start:** Task 3 must be complete.

### Steps

1. In your Supabase project, click **Authentication** in the left sidebar.
2. Click **Sign In / Providers** (in some versions this is **Providers**).
3. Find **Multi-Factor Authentication** — it may be under a **Configuration**
   or **Advanced** heading.
4. Enable **TOTP (Authenticator app)**. This is the mode the application uses:
   the user scans a QR code with an app such as Google Authenticator or 1Password.
5. Leave any "Phone / SMS" option switched off. The application does not use
   it and it costs money per message.

### Tell me

- **"MFA enabled"**.

---

## Task 5 — Configure how sign-in emails are sent

**Why:** Supabase sends the password-reset and email-confirmation messages. Its
built-in sender is rate-limited to a handful of emails per hour and delivers
from a shared address that often lands in spam. That is fine for testing and
not fine for real users.

**Time:** 30 minutes.

**Cost:** free at low volume — Resend's free tier covers 3,000 emails a month.

**Before you start:** Task 1 of Stage 1 (the domain) must be complete, because
you have to prove you own the domain.

### Steps

1. Go to **https://resend.com** and create an account.
2. In the Resend dashboard click **Domains**, then **Add Domain**.
3. Enter `legalworkflows.co.uk` — just the domain itself, with no `https://`
   and no `www`.
4. Resend shows you a set of DNS records to add — normally three: one `MX` and
   two `TXT`. Keep this page open.
5. In a second browser tab, open your domain registrar (Cloudflare, if you
   followed the suggestion) and go to the **DNS** section for your domain.
6. Add each record Resend showed you, one at a time. For each: copy the
   **Type**, **Name** and **Value** exactly. If Cloudflare shows an orange
   cloud "Proxy" toggle, switch it **off** for these records — email records
   must not be proxied.
7. Return to Resend and click **Verify**. It may take a few minutes. Wait until
   the domain shows **Verified**.
8. In Resend, click **API Keys**, then **Create API Key**. Name it
   `supabase-smtp`, give it **Sending access**, and copy the key it shows you.
   It starts `re_` and is shown once.
9. Back in Supabase, go to **Project Settings → Authentication → SMTP
   Settings**, and switch on **Enable Custom SMTP**. Enter:
   - **Sender email:** `noreply@legalworkflows.co.uk`
   - **Sender name:** `legalworkflows`
   - **Host:** `smtp.resend.com`
   - **Port:** `465`
   - **Username:** `resend`
   - **Password:** the `re_...` key from step 8
10. Click **Save**.

### Tell me

- **"Custom SMTP configured"**, and the sender address you used.

---

## Task 6 — Obtain an AI provider API key

**Why:** the application's core function — summarising and drafting — calls an
AI model. Without a key, it starts but cannot do anything useful.

**Time:** 15 minutes.

**Cost:** pay per use. Expect a few pounds a month in testing. Set a spending
limit in step 5 so it cannot surprise you.

### Steps

1. Decide which provider. The application supports Anthropic, OpenAI and
   Google, and you can add more than one later. **Anthropic is suggested** —
   the application was built against Claude models and its prompts are tuned
   for them.
2. Go to **https://console.anthropic.com** and create an account.
3. Click **Get API keys** (or **API Keys** in the left sidebar), then **Create
   Key**. Name it `legalworkflows-production`. Copy the key it shows — it
   starts `sk-ant-` and is shown once.
4. Click **Billing** and add a payment method. Add an initial credit of $20;
   that is ample for testing.
5. Still in **Billing**, find **Usage limits** and set a monthly limit you are
   comfortable with — $50 is a sensible starting point. This is the safety net
   that stops a runaway loop becoming a large bill.

### Tell me

- Which provider you chose.
- The API key, pasted into the chat.
- The monthly spending limit you set.

---

## Task 7 — Decide the document storage region

**Why:** uploaded documents are stored in Amazon S3, provisioned in Stage 3.
The region is fixed at creation and cannot be changed afterwards without
copying every file. Deciding now avoids a rebuild later.

**Time:** 5 minutes of thought.

### Steps

1. The default recommendation is **eu-west-2 (London)**, for two reasons: it
   keeps client documents in the UK, which is the easier answer for a UK law
   firm's due-diligence questionnaire, and it sits beside the Supabase London
   region if you chose that in Task 1.
2. Choose differently only if you have a specific reason — for example, if
   your clients are in the EU and require data to stay inside the EU proper, in
   which case **eu-west-1 (Ireland)** is the usual choice.
3. Consider whether any client contract you have signed, or expect to sign,
   specifies where data must be held. If one does, that overrides the default.

### Tell me

- The AWS region for document storage, for example `eu-west-2`.
- Whether any client contract constrains it, so I can note the reason in the
  architecture record.

---

## When all seven are done

Send me the answers and I will configure the backend against your Supabase
project and wire in the AI provider — the last two pieces this runbook feeds.
Everything else engineering could do without those answers is already done:
the audit and authorisation gaps are closed, the health and readiness
endpoints exist, and the spreadsheet library stays as it is — replacing it
turned out to be a functional regression, not a cleanup, so that ticket is
closed as won't-do rather than carried into this step. See
`docs/delivery-plan/v2/plan.md`'s Stage 2 table for the full account of what
shipped and why.

Stage 3's runbook then opens — the AWS account and the infrastructure. It is
the longest of the four, so it is worth starting it once Stage 2's answers are
sent rather than waiting for the engineering to finish.
