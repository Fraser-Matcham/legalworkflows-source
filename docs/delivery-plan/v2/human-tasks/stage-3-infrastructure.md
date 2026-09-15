# Stage 3 — your tasks (infrastructure)

Ten tasks. Do them **in order** — each builds on the one before.

This is the longest runbook. Tasks 1 to 3 create the AWS account and lock it
down; tasks 4 to 6 give me the access I need to build the infrastructure;
tasks 7 to 9 connect the domain and turn on billing safety; task 10 requests
production email sending.

**Total time: about 3 hours**, spread over two days because Task 10 waits on
an email from AWS approving production access for SES — submit it as soon as
Task 7's domain work is done, so the wait runs alongside everything else
rather than sitting at the end.

> **Two ground rules for this stage.**
>
> 1. **Never share your AWS root password with anyone, including me.** I do
>    not need it and will never ask. Task 3 creates a separate limited
>    credential for me to use.
> 2. **Do not skip Task 2.** An AWS account without multi-factor
>    authentication on the root user is the single most common way a cloud
>    account gets taken over and run up a five-figure bill.

---

## Task 1 — Create the AWS account

**Why:** everything in this stage lives in it — the servers, the file storage,
the network, the certificates.

**Time:** 30 minutes, plus up to 24 hours for AWS to verify you.

**Cost:** nothing to open. Billing starts when resources are created, in
Task 4 onwards. See `architecture.md` for the expected monthly figure.

### Steps

1. Go to **https://aws.amazon.com** and click **Create an AWS Account**.
2. Enter an email address you control and will keep. This becomes the **root
   user** — the account owner. Use a role address such as
   `aws@legalworkflows.co.uk` rather than a personal one, so it survives if you later
   bring someone else in.
3. Choose an **AWS account name**: `legalworkflows`.
4. Verify the email with the code AWS sends.
5. Set a root password. Use a password manager and generate a long random one.
   You will need it rarely, which is exactly why it must not be memorable.
6. Choose **Personal** account type unless you are registered as a limited
   company. As a sole trader, **Personal** is correct.
7. Enter your contact details and a payment card. AWS places a small temporary
   authorisation, usually £1, and refunds it.
8. Complete identity verification — AWS calls or texts a code.
9. Choose the **Basic support — Free** plan.
10. Wait for the confirmation email saying the account is ready. Usually
    minutes; occasionally up to 24 hours.

### Tell me

- **"AWS account created"** and the account ID. Find it by signing in and
  clicking your account name at the top right — it is a 12-digit number. It is
  not secret.

---

## Task 2 — Turn on multi-factor authentication for the root user

**Why:** the root user can do anything in the account, including deleting all
of it and running up unlimited charges. A password alone is not adequate
protection. Do this before creating anything else.

**Time:** 10 minutes.

**You will need:** your phone with an authenticator app installed — Google
Authenticator, Microsoft Authenticator, or 1Password all work.

### Steps

1. Sign in to **https://console.aws.amazon.com** as the root user, using the
   email address from Task 1.
2. Click your account name at the top right, then **Security credentials**.
3. Find **Multi-factor authentication (MFA)** and click **Assign MFA device**.
4. Give it a name such as `fraser-phone`, choose **Authenticator app**, and
   click **Next**.
5. Click **Show QR code**, and scan it with your authenticator app.
6. The app now shows a 6-digit code that changes every 30 seconds. Enter the
   current code, wait for it to change, then enter the next one. AWS asks for
   two consecutive codes.
7. Click **Add MFA**.
8. Sign out and sign back in, to confirm it works. Do not skip this — if the
   MFA was set up wrongly you want to find out now, while you can still fix it.

### Tell me

- **"Root MFA enabled"**.

---

## Task 3 — Create an administrator user for day-to-day use

**Why:** AWS's own guidance is that the root user should be used only for a
handful of account-level tasks. Everything else uses a separate user. This
also gives you a credential you can rotate or delete without touching the
account itself.

**Time:** 15 minutes.

**Before you start:** Task 2 must be complete.

### Steps

1. Signed in as root, go to **https://console.aws.amazon.com/iam/**.
2. Click **Users** in the left sidebar, then **Create user**.
3. **User name:** `fraser-admin`.
4. Tick **Provide user access to the AWS Management Console**.
5. Choose **I want to create an IAM user**.
6. Choose **Custom password**, set one from your password manager, and untick
   **Users must create a new password at next sign-in**.
7. Click **Next**.
8. On the permissions page choose **Attach policies directly**, then search for
   and tick **AdministratorAccess**.
9. Click **Next**, then **Create user**.
10. On the confirmation page, copy the **Console sign-in URL**. It looks like
    `https://123456789012.signin.aws.amazon.com/console`. Save it — this is how
    you sign in from now on.
11. Sign out of root. Sign in again using that URL, as `fraser-admin`.
12. Repeat Task 2's MFA steps for this user as well: **Security credentials →
    Assign MFA device**. Name it `fraser-phone-admin`.

### Tell me

- **"Admin user created and MFA enabled"**.

---

## Task 4 — Create the Terraform state storage

**Why:** Terraform is the tool that builds the infrastructure from code. It
keeps a record of what it has built, called *state*. That record has to live
somewhere before Terraform can manage anything — so this one piece is created
by hand, and everything else is created by Terraform.

**Time:** 15 minutes.

**Before you start:** Task 3 must be complete, and you must be signed in as
`fraser-admin`, not root.

### Steps

1. In the AWS console, use the search bar at the top to find **S3** and open
   it.
2. Click **Create bucket**.
3. **Bucket name:** `legalworkflows-terraform-state-` followed by your 12-digit
   account ID, with no spaces — for example
   `legalworkflows-terraform-state-123456789012`. *Bucket names must be unique
   across all of AWS, which is why the account number is appended.*
4. **AWS Region:** choose the region you decided in Stage 2, Task 7 — for
   example **Europe (London) eu-west-2**.
5. Leave **Block all public access** ticked. This is critical: the state file
   contains infrastructure details and must never be public.
6. Under **Bucket Versioning**, choose **Enable**. This means a corrupted state
   file can be rolled back.
7. Leave everything else as default and click **Create bucket**.

That is the whole task. An earlier draft also had you create a DynamoDB table
for state locking; Terraform now locks with a small lock file in this same
bucket, so there is one fewer thing to create and one fewer thing to pay for.

### Tell me

- The exact bucket name you created.
- The exact region.

---

## Task 5 — Connect GitHub to AWS without a password

**Why:** the deployment pipeline needs to push to AWS. The old way was to
store an AWS key in GitHub, which means a long-lived credential sitting in a
settings page forever. Instead we let GitHub prove its identity to AWS
directly for each deploy. Nothing long-lived is stored anywhere.

**Time:** 20 minutes.

**Before you start:** Task 3 must be complete.

### Steps

1. In the AWS console, go to **IAM** → **Identity providers** in the left
   sidebar → **Add provider**.
2. Choose **OpenID Connect**.
3. **Provider URL:** type `https://token.actions.githubusercontent.com`
4. Click **Get thumbprint**.
5. **Audience:** type `sts.amazonaws.com`
6. Click **Add provider**.
7. Still in IAM, click **Roles** → **Create role**.
8. Choose **Web identity**.
9. **Identity provider:** select the `token.actions.githubusercontent.com` you
   just created.
10. **Audience:** select `sts.amazonaws.com`.
11. **GitHub organisation:** type `Fraser-Matcham`
12. **GitHub repository:** type `legalworkflows`
13. Leave **GitHub branch** blank for now — I will tighten this to `main` in
    the Terraform code.
14. Click **Next**. On the permissions page, tick **AdministratorAccess** for
    now. *I will replace this with a narrower set of permissions in the
    Terraform code — starting broad avoids a frustrating sequence of
    permission errors while the infrastructure is still being written.*
15. Click **Next**. **Role name:** `github-actions-deploy`.
16. Click **Create role**.
17. Open the role you just created and copy its **ARN** from the top of the
    page. It looks like
    `arn:aws:iam::123456789012:role/github-actions-deploy`.

### Tell me

- The full role ARN.

---

## Task 6 — Give me a credential to build the infrastructure

**Why:** I need to run Terraform against your account to create and verify the
infrastructure. This creates a credential for that, which you delete in Stage
4 once the automated pipeline takes over.

**Time:** 10 minutes.

**Before you start:** Task 3 must be complete.

### Steps

1. In the AWS console go to **IAM** → **Users** → **Create user**.
2. **User name:** `terraform-build`
3. Do **not** tick console access. This user never signs in to a web page.
4. Click **Next**. Choose **Attach policies directly** and tick
   **AdministratorAccess**.
5. Click **Next**, then **Create user**.
6. Open the user you just created, click the **Security credentials** tab, and
   scroll to **Access keys**. Click **Create access key**.
7. Choose **Command Line Interface (CLI)**. Tick the confirmation box at the
   bottom and click **Next**, then **Create access key**.
8. You are shown an **Access key ID** and a **Secret access key**. The secret
   is shown **once only**. Copy both now.

### Tell me

Paste both, labelled:

```
AWS_ACCESS_KEY_ID:      AKIA....
AWS_SECRET_ACCESS_KEY:  ....
```

> **Diarise this.** In Stage 4, Task 4, you delete this credential. It exists
> only for the build. Once deploys run through the GitHub role from Task 5,
> this user is a standing risk with no remaining purpose.

---

## Task 7 — Point your domain at AWS

**Why:** the certificate that gives the site its padlock is issued by AWS, and
AWS has to be able to prove it controls the domain. That means AWS DNS.

**Time:** 20 minutes, plus up to 48 hours for the change to propagate.

**Before you start:** Stage 1, Task 1 must be complete.

### Steps

1. In the AWS console, search for **Route 53** and open it.
2. Click **Hosted zones** → **Create hosted zone**.
3. **Domain name:** enter `legalworkflows.co.uk`. No `www`, no `https://`.
4. **Type:** leave as **Public hosted zone**.
5. Click **Create hosted zone**.
6. The zone opens showing several records. Find the one with **Type: NS**. It
   lists four nameservers, each ending in a dot, like
   `ns-1234.awsdns-56.org.` — copy all four. On the same page, near the top
   right, copy the **Hosted zone ID** too — it starts with `Z`. Terraform
   adopts the zone you just made rather than creating a second one, and needs
   the ID to find it.
7. Open your domain registrar in another tab — Cloudflare, if you followed the
   Stage 1 suggestion.
8. Find the setting for **custom nameservers**. In Cloudflare Registrar this
   is under **Domain Registration → Manage Domains → your domain →
   Configuration → Nameservers → Manage**.
9. Replace the existing nameservers with the four from Route 53. Remove the
   trailing dot from each if the registrar rejects it.
10. Save.
11. Wait. This is DNS propagation and it genuinely can take up to 48 hours,
    though it is usually under an hour. You can check progress at
    **https://www.whatsmydns.net** — enter your domain, choose **NS**, and look
    for the AWS nameservers appearing worldwide.

### Tell me

- **"Nameservers switched"**, the four Route 53 nameservers, and the
  **Hosted zone ID**.
- Tell me again once whatsmydns.net shows them worldwide, as I cannot request
  the certificate until then.

---

## Task 8 — Set a billing alarm

**Why:** AWS bills by the hour with no cap. A misconfiguration — the classic
being a NAT gateway left running, or a runaway container restarting forever —
can cost hundreds before anyone notices. This is the seatbelt.

**Time:** 15 minutes.

**Before you start:** Task 3 must be complete.

### Steps

1. Sign in as **root** for this one task only — billing preferences are not
   available to other users by default.
2. Click your account name at the top right → **Billing and Cost Management**.
3. In the left sidebar click **Billing preferences**.
4. Tick **Receive AWS Free Tier alerts** and **Receive Billing alerts**. Enter
   your email address. Save.
5. Now go to **Budgets** in the left sidebar → **Create budget**.
6. Choose **Use a template (simplified)**, then **Monthly cost budget**.
7. **Budget name:** `monthly-ceiling`
8. **Enter your budgeted amount:** `200` — comfortably above the £110–140
   expected, so it alerts on something genuinely wrong rather than on normal
   variation.
9. **Email recipients:** your email address.
10. Click **Create budget**.
11. Sign out of root and back in as `fraser-admin`.

### Tell me

- **"Billing alarm set at $200"**, or the figure you chose if different.

---

## Task 9 — Choose how alerts reach you

**Why:** Stage 3 sets up alarms for things going wrong — the service failing
its health check, errors spiking, the queue backing up. They need somewhere to
go that you will actually see.

**Time:** 5 minutes.

### Steps

1. Decide the email address for operational alerts. This can be the same as
   your normal address, but a separate one is easier to filter and keeps alerts
   out of your main inbox.
2. Decide whether you want alerts by SMS as well. AWS charges a few pence per
   message. Worth it for "the site is down"; not worth it for routine warnings.
   If yes, note the mobile number including the country code, for example
   `+447700900123`.
3. Decide your tolerance for being woken up. Realistically, for a single-person
   operation, this comes down to: do you want a 3am text if the service goes
   down, or will the morning do? There is no wrong answer, but I need it to
   decide which alarms are urgent and which are informational.

### Tell me

- The email address for operational alerts.
- A mobile number for urgent SMS alerts, or **"email only"**.
- **"wake me"** or **"morning is fine"**.

---

## Task 10 — Request production access for Amazon SES

**Why:** a brand-new SES identity starts in a sandbox that can only send to
individually verified addresses. Production access lifts that limit so the
service can email real clients. See decision 6 in `../architecture.md` for
why SES was chosen over Resend, the provider named in an earlier draft of
Stage 2's runbook.

**Time:** 15 minutes to submit. Approval is manual on AWS's side and has no
fixed turnaround — often same-day, occasionally longer. This is the "email
from AWS" the runbook's introduction mentions, so submit this as soon as
Task 7's domain move is done rather than leaving it until last.

**Before you start:** Task 7 must be complete — SES verifies the domain
against the same Route 53 zone that task creates.

### Steps

1. In the AWS console, search for **SES** (Simple Email Service) and open it.
2. Confirm the **Region** selector at the top right matches the region you
   chose in Stage 2, Task 7 — SES's sandbox status is per-region.
3. On the **Account dashboard**, find **Sending statistics** or a banner
   reading **Your account is in the sandbox** — click **Request production
   access** (sometimes phrased **View Get Set Up Page** → **Request
   production access**).
4. Fill in the form. Suggested answers, adjust anything that doesn't match
   reality:
   - **Mail type:** Transactional
   - **Website URL:** `https://legalworkflows.co.uk`
   - **Use case description:** "Transactional account emails only —
     sign-up confirmation, password reset, and multi-factor authentication
     codes — for legalworkflows, a document-review SaaS product for UK law
     firms. No marketing email is sent through this account."
   - **Process for handling bounces and complaints:** "Amazon SNS
     notifications for bounces and complaints are routed to a monitored
     configuration set; repeated bounces or complaints for one recipient
     suppress further sends to that address."
   - **Additional contact addresses:** your own email address.
5. Submit the form.

### Tell me

- **"SES production access requested"**, and the region you submitted it in.
- **"SES production access approved"** once AWS's confirmation email arrives.
  Terraform creates the domain identity, its DKIM records and the SMTP
  credential regardless (`infra/modules/email`), but I will not hand the SMTP
  settings to Supabase until then: a sandboxed identity would prove it works
  for your own verified address and then fail on the first real client.

---

## When all ten are done

Send me the answers and I will build the infrastructure: the network, the
storage, the container services, the load balancer, the CDN, the certificate,
the secrets, the SES domain identity and SMTP credential, and the alarms —
all as Terraform code in the repository, reviewed in a pull request before
anything is created.

I will then run it against your account, prove a document can be uploaded and
downloaded through real S3, prove a database restore works, and give you the
handful of SMTP settings to paste into Supabase's **Authentication → SMTP
Settings** so sign-in emails send from your own domain — the step Task 5 in
Stage 2's runbook pointed here for.

Stage 4's runbook is the last one: it covers going live.
