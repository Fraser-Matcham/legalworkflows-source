# Email not delivered

Sign-up confirmations, password resets and MFA codes are sent by Supabase
Auth over SMTP through Amazon SES, from `no-reply@legalworkflows.co.uk`
(`infra/modules/email`). Two things can go wrong: SES did not accept the
message, or it accepted it and the recipient's server did not.

**How it shows up.** A user cannot sign up or reset a password
(`docs/troubleshooting.md`, "Production authentication email does not
arrive"). Or a message on the informational alerts topic from SES: a JSON
notification with `notificationType` `Bounce`, `Complaint` or `Reject`.

## 1. Which side

**Supabase's side.** Dashboard → Logs → Auth. A send that Supabase's SMTP
client failed to hand to SES logs there with the SMTP error. Also
Authentication → Rate Limits: custom SMTP has an hourly email cap that a
sign-up burst can hit; the log says so.

**SES's side.**

```sh
aws sesv2 get-account --query '[ProductionAccessEnabled,SendQuota,SendingEnabled]'
aws sesv2 get-email-identity --email-identity legalworkflows.co.uk \
  --query '[VerifiedForSendingStatus,DkimAttributes.Status,MailFromAttributes.MailFromDomainStatus]'
```

| Result | Meaning | Fix |
| --- | --- | --- |
| `ProductionAccessEnabled` false | still in the sandbox: only verified recipients receive anything | Stage 3, Task 10 — the request has to be approved. Nothing here can shortcut it |
| identity not `VerifiedForSending`, DKIM not `SUCCESS` | the DKIM CNAMEs are not resolving | `cd infra && terraform plan -target=module.email`; also `dig +short NS legalworkflows.co.uk` against `terraform output name_servers` |
| `SendingEnabled` false | AWS paused sending for reputation | the SES console's reputation dashboard says why; it is bounces or complaints, below |
| quota exhausted | more than the daily limit | request an increase in the SES console; at this product's volume that would itself be a sign something is looping |

## 2. Bounces and complaints

SES adds an address that hard-bounced or complained to the account's
**suppression list** and will not send to it again — that is the
configuration set's `suppression_options`. A legitimate user who mistyped
their address once and then fixed it can still be stuck behind the first
attempt:

```sh
aws sesv2 list-suppressed-destinations --query 'SuppressedDestinationSummaries[].[EmailAddress,Reason,LastUpdateTime]' --output table
aws sesv2 delete-suppressed-destination --email-address user@example.com
```

Remove an address only when you know why it bounced and that it is now
right. Do not clear the list wholesale: the complaints in it are people who
asked not to be emailed, and re-sending to them is how a domain gets
blocked.

Bounce *rate* above 5% or complaint rate above 0.1% puts the account under
review. At low volume a handful of bad addresses can do that; the
notification you received is the early warning.

## 3. The DMARC report, if you set one up

`dmarc_report_address` in `infra/main.tf` receives aggregate reports.
`p=none` means nothing is blocked; a report showing failures from a source
that is not SES means someone is spoofing the domain, which is the moment
to move to `quarantine`.

## Rotating the SMTP credential

`terraform taint module.email.aws_iam_access_key.smtp && terraform apply`,
then paste the new username and password from the `legalworkflows-production/email/smtp`
secret into Supabase (Authentication → SMTP Settings). Auth email fails
between the apply and the paste, so do them together.
