# Stage 5 — your tasks (run the platform on AWS)

Six tasks. Tasks 1 to 4 can be done at any point once Stage 4 is live; they
prepare the move and none of them touches the running service. Task 5 is the
cutover itself. Task 6 is the only irreversible one, and it comes last on
purpose.

**Nothing here is needed to go live.** The service launches on Supabase at the
end of Stage 4 and moves afterwards. If Stage 5 never happens, the product
still works — it just keeps a dependency you have decided you do not want.

Read [`../plan.md`](../plan.md), stage 5, for what the engineering work is and
why this is an infrastructure change rather than an application rewrite.

---

## Task 1 — Approve the running cost

**Why:** today the database, the REST API and the authentication server cost
one Supabase subscription. After the move they are AWS resources on your bill,
and one of them — the database — runs whether or not anyone uses the product.
This is the decision that makes the rest of Stage 5 worth doing, so make it
before, not after.

**Time:** 20 minutes.

**Before you start:** nothing.

### Steps

1. Decide the database size. The starting recommendation is a single-AZ
   `db.t4g.small` with 20 GB of storage and seven days of automated backups.
   Single-AZ because the rollback target during the move is Supabase, not a
   standby; you can switch to multi-AZ later without downtime.
2. Decide whether you want multi-AZ from the start. It roughly doubles the
   database cost and removes an hour or so of downtime from an unplanned
   failure. For a product that is not yet carrying client work, single-AZ is
   the honest answer.
3. Tell me both answers. They go into the Terraform module as variables, so
   changing your mind later is an edit and an apply, not a rebuild.
4. Raise the billing alarm you set in Stage 3, Task 8 to cover the new
   baseline. An alarm that fires every month teaches you to ignore it.

---

## Task 2 — Hand over the database credentials

**Why:** the migration copies the Supabase database — including the `auth`
schema, which holds every user account — into RDS. I cannot read that database
without the password, and the password is yours.

**Time:** 10 minutes.

**Before you start:** Task 1.

### Steps

1. In the Supabase dashboard, open **Project Settings** → **Database**.
2. If you no longer have the database password from Stage 2, Task 2, click
   **Reset database password** and store the new one in your password manager
   first. Resetting it breaks anything currently using the old one, so do this
   at a quiet moment and expect to update `SUPABASE_DB_URL` in GitHub
   afterwards.
3. Put the connection string into AWS Secrets Manager, not into a message:
   open the AWS console, **Secrets Manager**, the secret named
   `legalworkflows-production/platform/migration-source` (it exists, empty,
   once the platform is applied), **Retrieve secret value**, **Set secret
   value**.
4. Enter one key, `SOURCE_DB_URL`, with the **Session pooler** URI as its
   value and the password substituted in. Session pooler, port 5432 — the
   copy needs a session, and the direct host is unreachable from AWS.
5. **Enter it as JSON**, `{"SOURCE_DB_URL": "postgres://…"}`, never as a bare
   string: the copying task reads that key by name and refuses anything
   else. The same mistake with the operator secret has stopped every task
   from starting once already; see
   [`../../../runbooks/database-unreachable.md`](../../../runbooks/database-unreachable.md).

---

## Task 3 — Move the Google sign-in redirect

**Why:** signing in with Google works because Google is told, in advance,
exactly which address it may send people back to. That address currently
belongs to Supabase. After the move it belongs to your own domain, and until
you change it Google will refuse the sign-in. Only you can change it — the
OAuth client lives in your Google account.

**Time:** 15 minutes.

**Before you start:** the new address is
`https://legalworkflows.co.uk/auth/v1/callback` — the same path Supabase used,
on your own domain (`infra/modules/gotrue`, ticket 2119). Adding it early is
safe; removing the old one early is not, so leave the Supabase address in
place until Task 6.

### Steps

1. Go to **https://console.cloud.google.com/apis/credentials** and sign in with
   the Google account that owns the OAuth client.
2. Click the OAuth 2.0 client ID used for this product.
3. Under **Authorised redirect URIs**, click **ADD URI** and paste
   `https://legalworkflows.co.uk/auth/v1/callback`.
4. **Leave the existing Supabase URI in place.** Two addresses can be
   authorised at once, and keeping both is what makes the rollback work.
5. Click **SAVE**. Google can take a few minutes to apply the change.
6. Give the client ID and secret to the platform without putting them in a
   message: in the AWS console, **Secrets Manager**, open
   `legalworkflows-production/platform/google-oauth`, **Retrieve secret
   value**, **Set secret value**, and enter the two keys as JSON:

   ```json
   {"GOOGLE_CLIENT_ID": "…", "GOOGLE_CLIENT_SECRET": "…"}
   ```

   Tell me it is written; switching the provider on is then a one-variable
   change (`gotrue_google_oauth_enabled = true`) and an apply.
7. After the soak period in Task 6, come back and remove the Supabase URI.

---

## Task 4 — Confirm email can still be sent

**Why:** password resets, email confirmations and invitations are sent by the
authentication server. Supabase sends them today. Afterwards they go through
Amazon SES, using the identity set up in Stage 3.

**Time:** 5 minutes, or 24 hours if SES is still in its sandbox.

**Before you start:** Stage 3, Task 10.

### Steps

1. Open the AWS console, **Amazon SES**, **Account dashboard**.
2. Look for **Sending limits**. If it says your account is **in the sandbox**,
   SES will only deliver to addresses you have verified — which means password
   resets silently fail for every real user. Request production access now and
   wait for the approval before the cutover.
3. If it already says production access is granted, there is nothing to do.

---

## Task 5 — Choose the cutover window

**Why:** the move needs a few minutes during which the database is not being
written to, so that the copy is complete. Everything else is rehearsed
beforehand against a copy — this is the only part that touches live data.

**Time:** 5 minutes to decide; about an hour on the day, most of it watching.

**Before you start:** Tasks 1 to 4, and I will have completed the rehearsal
(ticket 2125) and shown you its result.

### Steps

1. Pick a window when nobody is using the product. Early morning at a weekend
   is the usual answer.
2. Tell me the window. I will put the service into a read-only state, take the
   final copy, point the configuration at AWS, and verify.
3. Stay reachable during it. If anything looks wrong the decision to roll back
   is yours, and it is a decision that has to be made in minutes rather than
   hours.
4. **The rollback is to Supabase, which stays running and unchanged until Task
   6.** That is the whole reason Task 6 is last.

---

## Task 6 — Retire the Supabase project

**Why:** this is what Stage 5 was for. It is also the one step that cannot be
undone, so it waits until the new platform has carried real traffic for long
enough to trust.

**Time:** 10 minutes.

**Before you start:** at least two weeks of normal use after Task 5, with no
incident that needed a rollback. Confirm with me first that nothing still
points at Supabase.

### Steps

1. Take a final backup and keep it somewhere outside both AWS and Supabase.
   This is your last chance to have one.
2. Remove the Supabase redirect URI from the Google OAuth client (Task 3,
   step 6).
3. Delete the unused Supabase keys from AWS Secrets Manager — the same
   **Edit the JSON as JSON** warning applies.
4. In the Supabase dashboard, **Project Settings** → **General**, scroll to the
   bottom and click **Delete project**.
5. Cancel the Supabase subscription so it stops billing.
6. Tell me it is done. Ticket 2126 removes the last references to Supabase
   from the documentation and the runbooks, which cannot honestly be done
   before this point.
