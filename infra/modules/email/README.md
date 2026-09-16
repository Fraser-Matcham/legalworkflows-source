# `email`

Architecture decision 6: Supabase Auth sends its sign-up, password-reset and
MFA email through Amazon SES on our own domain, not through a second vendor.
This module is the domain identity, the DNS that makes it deliverable, the
configuration set that handles bounces, and the SMTP credential Supabase is
given.

## What it creates

| Thing | Where | Why |
| --- | --- | --- |
| Domain identity for `<domain>` | SES | proves we own the sending domain |
| Three `*._domainkey` CNAMEs | Route 53 | Easy DKIM — SES signs every message and rotates the keys itself |
| `mail.<domain>` MX and SPF TXT | Route 53 | a custom MAIL FROM, so the envelope sender is ours and SPF aligns with the From header |
| `_dmarc.<domain>` TXT | Route 53 | `p=none` to start: report, do not enforce |
| Configuration set `<prefix>-transactional` | SES | TLS required, reputation metrics on, bounce/complaint suppression on |
| Event destination → alerts topic | SES → SNS | bounces, complaints and rejects reach a person |
| IAM user `<prefix>-smtp` + access key | IAM | may send only from `*@<domain>` |
| Secret `<prefix>/email/smtp` | Secrets Manager | the six values Supabase's SMTP page asks for |

## The sandbox, and the order of operations

A new SES identity is in the **sandbox**: it can send only to addresses that
have themselves been verified in SES. Stage 3, Task 10 is the operator's
request to leave it. **That request was approved on 16 September 2026**, so
the account is out of the sandbox and step 2 below is already satisfied —
the sequence is kept because it is the order to follow if this is ever
rebuilt in another region, where sandbox status starts again.

Nothing here waits for that approval. The identity, DNS, configuration set
and credential can all be created first, and DKIM verification (which needs
the CNAMEs to propagate) is better started early. What waits is the
hand-over: giving Supabase the SMTP settings before approval would make
sign-up work for the operator's own verified address and fail for the first
real client, which is worse than not working at all. So:

1. Apply this module. Wait for the identity to show **Verified** in the SES
   console (DKIM CNAMEs resolving; minutes to an hour).
2. Submit the production-access request (Task 10) if not already done.
3. On approval, read the secret and paste it into Supabase:

   ```sh
   aws secretsmanager get-secret-value \
     --secret-id "$(terraform output -raw smtp_secret_name)" \
     --query SecretString --output text
   ```

   Supabase **Authentication → SMTP Settings**: enable custom SMTP; Sender
   email and name, Host, Port `587`, Username, Password from the JSON.
4. Send yourself a password reset. Check the headers for `DKIM-Signature`
   with `d=<domain>` and `dmarc=pass`.

## DMARC, deliberately loose

`p=none` means receivers *report* misaligned mail and deliver it anyway.
Move to `quarantine` (a variable) once a few weeks of reports — set
`dmarc_report_address` to receive them — show that everything sending as
the domain is aligned; then `reject`. Both alignment modes are strict
(`adkim=s; aspf=s`) because only SES sends as this domain and both DKIM and
the MAIL FROM are exactly it. If a second sender is ever added (a
newsletter tool, a helpdesk), it needs its own DKIM here first.

## Rotation

`terraform taint module.email.aws_iam_access_key.smtp` then apply; the
secret follows. Supabase keeps sending with the old password until the new
one is pasted in, and the old key is deleted on the same apply — so paste
promptly, or apply the taint at a quiet hour.

## What is not here

- **The sending region's quota.** Sandbox and production limits are
  per-region account settings AWS controls; the request in Task 10 is the
  whole of that.
- **Inbound mail.** Nothing receives at this domain. `no-reply@` is a
  statement, not a mailbox, and the MX record is on `mail.<domain>` for
  bounce handling by SES, not on the apex.
- **Application mail from the backend.** The backend sends no email of its
  own today (`docs/deployment.md`); if it starts to, it should use this
  configuration set through the task role rather than the SMTP user.
