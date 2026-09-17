# Cutting over to the platform, and back

Moving the running service from the Supabase project to the self-hosted
platform — RDS, PostgREST and GoTrue in this account — and the way back.
Ticket 2125 is the rehearsal, which is this whole page done against a copy
first; ticket 2122 is the cutover itself. Stage 5, Task 5 is the operator's
side: choosing the window and being reachable.

**The rule the whole page rests on:** the Supabase project is never
touched. It keeps running, unchanged, through the rehearsal, the cutover
and the soak period, and is deleted only in Stage 5, Task 6. That is what
makes the rollback a configuration change rather than a restore.

## What "cut over" means in this footprint

Three settings, one variable:

| | Before | After (`platform_serves_backend = true`) |
| --- | --- | --- |
| `SUPABASE_URL` | `https://<ref>.supabase.co` | `https://legalworkflows.co.uk` — the edge routes `/rest/v1` and `/auth/v1` to PostgREST and GoTrue |
| `SUPABASE_SECRET_KEY` | the operator secret | `<prefix>/platform/api-keys`, `SERVICE_ROLE_KEY` |
| `SUPABASE_PUBLISHABLE_KEY` | the root variable | `<prefix>/platform/api-keys`, `ANON_KEY` |

Nothing in the application changes. The frontend and the Word add-in never
talk to Supabase, so they need nothing. The GitHub variable
`PLATFORM_SERVES_BACKEND` tells the release pipeline to run migrations as a
task inside the VPC from then on.

## Prerequisites, all of them

Every one of these is a separate, earlier step. Do not start the cutover
with any of them open.

- [ ] `platform_enabled = true` applied; `PLATFORM_ENABLED` set on the
      repository; `Build and scan (dbtools)` green on the latest release.
- [ ] `infra/dbtools/run.sh bootstrap` has been run and its role table read.
- [ ] The API keys minted, verified and written
      ([`api-keys.md`](api-keys.md)); `verify --against
      https://legalworkflows.co.uk` will only pass after the restore, so for
      now the offline verify.
- [ ] Stage 5, Task 2 (the source connection string) and Task 3 (the Google
      redirect URI added, the client written, `gotrue_google_oauth_enabled =
      true` applied). Task 4 (SES out of the sandbox) was satisfied on 16
      September 2026.
- [ ] `npm run smoke -- --app-url https://legalworkflows.co.uk --platform
      --alb-host … --bucket …` shows GoTrue answering `/auth/v1/health` and
      PostgREST refusing an anonymous `/rest/v1` request. Both services are
      up and routed; the database behind them is still empty.
- [ ] **The rehearsal below has been done at least once, and its record
      written down.**

## The rehearsal (ticket 2125)

The same steps as the cutover, against a copy, with the live service
untouched throughout. The point is to find out how long the copy takes,
what the verify says, and that the way back works — not to move anything.

1. **Copy.** [`platform-migration.md`](platform-migration.md), steps 1 to 3:
   bootstrap, `dump-restore`, `verify`. The source is live, so `verify`'s
   row counts may differ by whatever changed during the copy; note the
   difference and that it is explained. Time the whole thing.
2. **Point a copy of the backend at it, not the service.** Run the backend
   locally against the platform with the values the cutover would set:
   `SUPABASE_URL=https://legalworkflows.co.uk`, the two minted keys, and the
   real storage settings read-only (`docs/safe-local-testing.md` for what
   "read-only" needs). Sign in as an account that existed in the copy
   (with its MFA code — the factors came across with `auth.mfa_factors`).
   Open a project, a document, a chat, a tabular review. This is the
   ticket's "every user can still sign in": proven on the copy.
3. **Prove the switch from the outside.** `verify --against
   https://legalworkflows.co.uk` for both keys now passes, because PostgREST
   has tables to answer about.
4. **Prove the way back.** Nothing was switched, so the rollback here is
   the *rehearsal of the mechanism*: with `platform_serves_backend` still
   false, `terraform plan` must show no change to the backend service. Then
   set it true, `terraform plan` — read what it would change: the backend
   task definition's `SUPABASE_URL` and two secrets, nothing else — and set
   it back to false without applying. That plan is the cutover; its
   inverse is the rollback.
5. **Reset for the real thing.** The copy is now stale. Before the cutover,
   the instance must be empty again: the neat way is a snapshot taken after
   the bootstrap and before the restore, restored over the instance; the
   blunt way is `terraform taint 'module.database[0].aws_db_instance.this'`
   and an apply, then bootstrap again. `dump-restore` refuses a target with
   tables, so this cannot be skipped by accident.
6. **Record.** Date, duration of the copy, verify output, what did not
   work. Stage 5, Task 5 is signed off against this.

## The cutover (ticket 2122)

In the window the operator chose. Roughly an hour; most of it watching.

1. **Announce and freeze.** Nobody using the product. Take the backend to
   zero so nothing writes to Supabase during the copy:

   ```sh
   aws ecs update-service --cluster legalworkflows-production \
     --service legalworkflows-production-backend --desired-count 0
   ```

   The frontend stays up and shows errors for the duration; that is the
   window. Note the time.

2. **Copy.** `run.sh dump-restore`, then `run.sh verify`. With the source
   frozen, every row count must match and the fingerprints must be
   identical. A `verify: FAIL` here is a stop: bring the backend back
   (step 6's first command) and investigate before trying again.

3. **Switch.** In `infra/terraform.tfvars`, `platform_serves_backend = true`.
   `terraform plan`: the backend task definition changes `SUPABASE_URL` and
   the two secret references, and the service rolls. Nothing else.
   `terraform apply`.

4. **Bring the backend back.**

   ```sh
   aws ecs update-service --cluster legalworkflows-production \
     --service legalworkflows-production-backend --desired-count 1
   ```

   Watch `/api/ready` through the edge until it answers 200: it includes
   the database probe, which now reaches PostgREST on the platform.

5. **Set the pipeline variable.** `PLATFORM_SERVES_BACKEND=true` on the
   `production` environment, so the next release applies migrations as a
   task. (The record of the last applied migration is the same SSM
   parameter either way.)

6. **Smoke.** The automated test, then the human one:

   ```sh
   npm run smoke -- --app-url https://legalworkflows.co.uk --platform \
     --alb-host <alb_dns_name> --bucket <documents_bucket_name>
   ```

   then Stage 4, Task 5's walk: sign in (with MFA), upload, ask, review,
   download, and — new — sign **up** with a fresh address and confirm the
   email arrives from `no-reply@legalworkflows.co.uk`, and sign in with
   Google. Those two are the paths that moved to SES and to the new
   redirect URI.

7. **Announce.** The window is over. Note the time.

## The rollback

At any point in the soak period, for any reason that would not be fixed
faster forward. It is the cutover's step 3 inverted, and it is the reason
the Supabase project is still there.

1. Backend to zero (cutover step 1).
2. `platform_serves_backend = false`, `terraform apply`. The backend goes
   back to the Supabase URL and the operator secret's key.
3. Backend back to one; `/api/ready` 200.
4. `PLATFORM_SERVES_BACKEND` removed or `false` on the environment.
5. Smoke without `--platform`.

**What is lost:** everything written to the platform since the cutover —
sign-ups, chats, reviews, document rows. The objects those rows point at
are still in S3, as [`restore.md`](restore.md) describes for the same
situation. That is why the soak period starts short and why the cutover
is announced: the first days on the platform are the days a rollback
would cost least.

**What is not lost:** any user who existed at the cutover, their MFA
factors, and everything before it. The Supabase database is exactly as
the freeze left it.

**What the rollback cannot do:** carry platform-side writes back to
Supabase. There is deliberately no reverse copy; a reverse copy over a
live Supabase database is [`restore.md`](restore.md)'s "last resort" with
a different source, and would need the same care.

## After the soak

Stage 5, Task 6: two weeks of normal use with no rollback, then the
Supabase project is deleted and ticket 2126 removes the last references
to it from the documentation. Until then, the rollback above stays
available and `SUPABASE_DB_URL`, the operator secret's `SUPABASE_SECRET_KEY`
and the Google client's Supabase redirect URI all stay where they are.
