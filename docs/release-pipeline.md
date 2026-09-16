# Release pipeline

How a merge to `main` becomes the running production service, and how it is
undone. The workflow is [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml);
this page is why it is shaped the way it is. Stage 4 of
[the delivery plan](delivery-plan/v2/plan.md), tickets 2050–2052 and
2073–2076.

```
merge to main
   │
   ▼
 gate      every other check on this commit is green — or we wait, or we stop
   │
   ▼
 mirror    tag the release; push the tree and its history to the public mirror
   │       ── fails → nothing deploys (AGPL §13: no running version without published source)
   ▼
 build     backend and frontend images → ECR, tagged with the commit sha
   │       ── ECR scan has a HIGH or CRITICAL finding → stop
   ▼
 migrate   backend/migrations newer than the recorded one, in order, once
   │
   ▼
 backend   new task definition revision → catalogue-sync release job → roll the service
   │       ── /api/ready through CloudFront must answer 200
   ▼
 frontend  new revision → roll the service ── / must answer
   │
   ▼
 summary   the revisions this release registered, and where its source is
```

One deploy runs at a time (`concurrency: production-deploy`); a second merge
waits for the first rather than cancelling it.

Until the `AWS_ROLE_ARN` variable exists (Stage 4, Task 1), every job is
skipped and a single notice says so — a merge to `main` before the
footprint is applied must not produce a red run and an email. From the
moment it exists, every step below is strict.

## Each step, and the reason for its position

**Gate.** `push` to `main` fires this workflow and every CI workflow at the
same moment. The gate polls the commit's check runs until all of them —
CI, stack tests, schema drift, security, gitleaks, Terraform validate — have
completed, and stops on any failure. That is ticket 2052's "gate the deploy
on CI being green for that commit", done inside the deploy so that a merge
still deploys "with no manual step" (the Stage 4 done-when) without a red
commit ever reaching production. Branch protection (Stage 4, Task 2) is the
other half: it stops a red commit reaching `main` at all.

**Mirror, before anything else.** AGPL-3.0 section 13 obliges the operator
to offer the Corresponding Source of the version users are interacting with.
Tickets 2074 and 2075 put that in the pipeline in this order — tag, mirror,
*then* deploy — so a version can never be running without its source already
public. The push is the full history to `main` of the mirror plus the
release tag, fast-forward only; a mirror that has been written to by hand
diverges and stops the deploy for a person to look at. The mirror's name and
a token that can write to it (and nothing else) are the two settings Stage 4,
Tasks 1 and 3 ask for; until both exist, **every deploy stops at this step**,
by design.

**Build and scan.** Both images, `linux/amd64`, pushed as `<sha>` and `main`.
The frontend gets two build arguments: `NEXT_PUBLIC_APP_URL` (the public
origin; Next inlines it into the browser bundle, so it cannot be set later)
and `NEXT_PUBLIC_SOURCE_URL`, the mirror at exactly this commit — which is
what `/legal` links to (ticket 2076). ECR scans on push; the job waits for
the result and refuses the image on any HIGH or CRITICAL finding, the same
posture the npm advisory gate takes with dependencies (ticket 2050).

**Migrate.** `docs/deployment.md`'s rule, automated: apply, in filename
order, only the files newer than the last one applied, and keep that filename
with the deployment records. The record is the SSM parameter
`/legalworkflows-production/deploy/last-migration`, created by the `deploy`
Terraform module with the newest migration `schema.sql` already contained
when the database was installed, and owned by this step from then on. All
pending files run in one `psql` session behind a session-level advisory lock
(so two migrators cannot interleave even if the concurrency group were
bypassed), each with its own transaction semantics — several manage their
own `BEGIN`/`COMMIT` — and `ON_ERROR_STOP` halts at the first failing
statement with the record advanced only to the last file that completed.
Ticket 2051. What to do when it fails: [`runbooks/failed-migration.md`](runbooks/failed-migration.md).

The connection is Supabase's **session pooler** URI (`SUPABASE_DB_URL`), not
the direct host: GitHub's runners have no IPv6, and the direct host is
IPv6-only without the IPv4 add-on.

**Backend.** A new task definition revision is the current one with the
image swapped and `ERROR_TRACKING_RELEASE` set to the sha — cpu, memory,
environment and secrets stay whatever Terraform last set, so a Terraform
change and a deploy never overwrite each other. Before the service moves,
the catalogue sync (`npm run sync:workflows`) runs as a one-off task from
that revision, in the service's own subnets and security group, and its exit
code decides whether to continue: `docs/deployment.md` says to run it as a
release job before directing traffic to the new backend. Then the rolling
update (100% minimum healthy, 200% maximum), `wait services-stable`, a check
that the primary deployment is the new revision — if the circuit breaker
rolled back, it is not — and finally `/api/ready` through CloudFront, the
dependency check the load balancer deliberately does not run
([`runbooks/site-down.md`](runbooks/site-down.md) says why).

**Frontend.** The same shape; the gate is the home page answering.

**Summary.** The run's summary records the commit, the tag, both task
definition revisions and the source URL. That is the deployment record —
and the input to a rollback.

## Rolling back

[`.github/workflows/rollback.yml`](../.github/workflows/rollback.yml), run by
hand with the revision numbers from the summary of the release *before* the
bad one. It points each service at that revision and waits for it to settle;
ECS does the rolling replacement with the same health checks. The circuit
breaker also does this on its own when a release's tasks never become
healthy ([`runbooks/deploy-rolled-back.md`](runbooks/deploy-rolled-back.md)).

Migrations are not rolled back. They are written forward-only, so the
previous release runs against the newer schema; a migration that damaged
data is the one case for a database restore ([`runbooks/restore.md`](runbooks/restore.md)).

Ticket 2052's proof — "a deliberately broken deploy is caught by the health
check and rolled back without manual intervention" — and 4.4's "a rollback
that has been tested by rolling back" both need the footprint applied. They
are the first two things to do once it is.

## What the pipeline needs

| Kind | Name | Value |
| --- | --- | --- |
| variable | `AWS_REGION` | `eu-west-2` |
| variable | `AWS_ROLE_ARN` | `deploy_role_arn` from `terraform output` |
| variable | `AWS_ACCOUNT_ID` | the 12-digit account id |
| variable | `APP_URL` | `https://legalworkflows.co.uk` |
| variable | `SOURCE_MIRROR_REPOSITORY` | `owner/repo` of the public mirror (Stage 4, Task 3) |
| secret | `SUPABASE_DB_URL` | the project's **session pooler** connection string |
| secret | `SOURCE_MIRROR_TOKEN` | a fine-grained token with *Contents: read and write* on the mirror repository only |

Runtime secrets — the Supabase service key, the model provider key — are
**not** GitHub secrets. They live in Secrets Manager and reach the tasks
from there (`infra/modules/secrets/README.md`); the pipeline never sees
them.

Jobs that touch AWS run in the `production` GitHub environment, and the
deploy role's trust policy accepts **only** that environment's token
subject — not a bare push to `main`. A job that omitted the `environment:`
line would get a subject the policy does not list and would fail to assume
the role. That is what makes protection rules on the environment (a required
reviewer, a wait timer) an actual gate on production access rather than a
convention; `infra/modules/deploy/README.md` has the reasoning.

## What it deliberately does not do

- **Run Terraform.** Infrastructure changes are applied by a person who has
  read the plan (`infra/README.md`). The deploy role cannot touch state.
- **Deploy from a branch.** Only `main`, only after every check. Preview
  environments would need a second footprint; architecture decision 3 says
  not yet.
- **Invalidate CloudFront.** Build output under `/_next/static/` is
  content-hashed and everything else is uncached, so nothing needs it.
- **Retry.** A failed step is a failed release; the summary and the
  runbooks say what to look at.
