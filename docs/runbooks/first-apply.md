# The first apply

Creating the production footprint from `infra/`, from your own terminal.

This is the one procedure in this repository that creates real, billable
resources against a real account. It is written to be read once in full
before anything is typed, because two of its steps are hard to undo and one
of them waits on DNS that may not be ready.

Applying is deliberately a human step (`infra/README.md`): Terraform is not
run by CI, and nothing here happens automatically.

## Before you start

Two things must already exist, created by hand. Terraform adopts or
depends on both and will fail without them.

| Thing | From | Check it |
| --- | --- | --- |
| The state bucket | Stage 3, Task 4 | `aws s3 ls \| grep terraform-state` |
| The Route 53 hosted zone, with the registrar pointing at it | Stage 3, Task 7 | `dig +short NS <your domain>` returns four `awsdns` names |

And one thing to look up rather than create:

```sh
aws iam list-open-id-connect-providers
```

GitHub's OIDC provider is an account-wide singleton. If one is listed,
leave `create_github_oidc_provider` false and Terraform uses it. If the
list is empty, set it true in `terraform.tfvars`. The deploy role itself is
always created by Terraform, so there is nothing to make by hand.

**The nameserver check is not a formality.** Two certificates validate by
DNS during this apply, and `aws_acm_certificate_validation` blocks until
they do. If the registrar still points at the old nameservers, the apply
hangs for the resource's timeout and then fails, leaving half a footprint
behind. Confirm propagation at whatsmydns.net before starting.

You also need, on your machine:

- Terraform `~> 1.16` (CI validates with 1.16.2)
- The AWS CLI, with administrator credentials for the account — an IAM
  Identity Center (SSO) session is fine, and is what Stage 3, Task 3's
  separate admin user is an alternative to
- This repository, on `main`

## 1. Configure

```sh
git checkout main && git pull
cd infra
cp backend.hcl.example backend.hcl
cp terraform.tfvars.example terraform.tfvars
```

Both files are gitignored. Edit them:

- **`backend.hcl`** — the state bucket's exact name, its own region (which
  need not be the region the footprint is built in), and a **project-scoped
  key**. If the bucket is shared with another project, two projects writing
  the same key overwrite each other's state, which is the one failure here
  with no clean recovery. Check what is already there first:

  ```sh
  aws s3 ls s3://<bucket> --recursive
  aws s3api get-bucket-location --bucket <bucket>
  ```

- **`terraform.tfvars`** — three values have no default and the apply
  refuses to start without them: `route53_zone_id` (the hosted zone ID, not
  the domain), `supabase_url` and `supabase_publishable_key`. The last two
  are public by design; they ship in the browser bundle. Everything else in
  that file is already the production value.

**No secret goes in either file.** The Supabase secret key, the model
provider key and the rest reach the service through Secrets Manager, after
the apply — see below, and `infra/modules/secrets/README.md`.

## 2. Initialise

```sh
terraform init -backend-config=backend.hcl
```

This writes nothing to AWS beyond reading the state bucket. If it fails on
the backend, the bucket name or region in `backend.hcl` is wrong.

## 3. Plan, and read it

```sh
terraform plan -out=tfplan
```

Read the whole thing. It is long — roughly 120 resources — but you are
looking for four specific things:

1. **One resource marked "will be imported"**: the hosted zone. Imports are
   listed separately from creations, near the top. If the zone shows as
   *created* rather than imported, `route53_zone_id` is wrong and you are
   about to make a second zone that the registrar does not point at. Stop.
2. **Nothing destroyed.** On a first apply the destroy count must be zero.
3. **Nothing named `legalworkflows-production` that you do not recognise.**
   Every resource carries that prefix; skim the names.
4. **No `(known after apply)` in a place that surprises you** — secret
   values are expected to be hidden, but a hostname or a bucket name should
   be concrete.

If anything looks wrong, nothing has happened yet. The plan is the rehearsal
that `architecture.md` decision 3 relies on, given there is no staging
environment.

## 4. Apply

```sh
terraform apply tfplan
```

Twenty to thirty minutes, most of it in three places: the NAT gateway, the
two certificate validations, and the CloudFront distribution. Leave it
running; interrupting an apply is how state and reality diverge.

### What will look broken, and is not

- **The ECS tasks cannot start.** The task definitions point at an image tag
  (`bootstrap`) that does not exist in ECR until the first deploy pushes
  one. The services are created, the tasks fail to pull, the circuit breaker
  stops the retry loop. Expected, and harmless: nothing is reachable through
  CloudFront yet anyway.
- **The alarms fire.** `no-running-tasks` is true, because there are none.
  They clear after the first deploy. If you have already answered Stage 3,
  Task 9 and set `alert_email`, expect an SNS confirmation email first —
  the subscription stays pending until you click it.
- **The site does not answer.** DNS for the apex now points at CloudFront,
  which points at an origin with no healthy targets. The first deploy fixes
  it.

## 5. After the apply

**Write the operator secret.** Terraform created the container and
deliberately never writes its value. Until this is done, no backend task can
start even with an image:

```sh
 aws secretsmanager put-secret-value \
  --secret-id "$(terraform output -raw operator_secret_name)" \
  --secret-string '{"SUPABASE_SECRET_KEY":"…","ANTHROPIC_API_KEY":"…"}'
```

Note the leading space: with bash's default `HISTCONTROL=ignorespace` it
keeps the command out of your shell history.

**Check the key before you rely on it.** Supabase rejecting
`SUPABASE_SECRET_KEY` does not show up until something uses it, and the first
thing that does is a release — deploy runs 12 and 13 on `main` both got as far
as building and pushing both images, applying migrations, and launching the
catalogue sync task before dying on it, about seventeen minutes each. Thirty
seconds here saves that:

```sh
 KEY='…the same service_role key you just wrote…'
curl -s -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  "<your supabase_url from terraform.tfvars>/rest/v1/" | head -c 200
```

If the response mentions **`Invalid API key`**, the key is wrong — that is the
exact message the release fails with, and
[database-unreachable.md](database-unreachable.md) section 2 has the patch
command. Anything else, and Supabase accepted the credential.

Deliberately phrased around the failure rather than the success: the failing
response is the one we have actually seen, out of a release log. What a
healthy project returns from that path was not exercised when this was
written, so do not read a particular status code into it. Add `ERROR_TRACKING_DSN`,
`MIKE_WORKFLOWS_GITHUB_TOKEN` or `COURTLISTENER_API_TOKEN` to that JSON if
you have them, and add their names to `backend_extra_secret_keys` in
`terraform.tfvars` on the next apply so the task reads them.

> **Decide about the workflow catalogue before your first release.** The
> release pipeline runs the catalogue sync from the new image and treats its
> exit code as the verdict, so this is not a setting you can leave for later
> and discover at the worst moment.
>
> Pick one:
>
> - **A catalogue.** Point `workflows_repository` at a repository this
>   deployment can read — AGENTS.md rule 2 asks for your own fork, since the
>   variable name is configuration and the value is ownership — and, if it is
>   private, write `MIKE_WORKFLOWS_GITHUB_TOKEN` into the operator secret above
>   and list it in `backend_extra_secret_keys`. Add the name only after writing
>   the value: a referenced key that is absent stops the task from starting.
> - **No catalogue.** Set `workflows_repository = ""`. The sync job exits 78,
>   the pipeline reads that as a skip rather than a failure, and the release
>   summary records `skipped (no catalogue configured)` so nobody later mistakes
>   it for a sync that ran.
>
> **Leaving the default is neither.** It resolves to the upstream
> `Open-Legal-Products/mike-workflows`, which is a real catalogue your
> deployment may not be able to read — and a release that cannot sync it stops.
> That is deliberate: skipping on an unset value would hide a misconfiguration
> behind a green release.
>
> If a sync does fail, the step now prints the task's own last hundred lines
> into the workflow log, so the reason is in the run rather than a log stream
> you have to go and find.

**Check the signed-URL round trip against real S3** (plan row 3.10). The
storage client was written for Cloudflare R2, which signs with the region
`auto`. Real S3 rejects a presigned URL signed for the wrong region, and the
failure looks like a permissions problem rather than a signing one, so it is
worth ten minutes now instead of during a launch.

The code half is done: `backend/src/lib/storageRegion.ts` resolves the signing
region from `R2_REGION`, defaulting to `auto` for R2, and it is covered by
`backend/src/lib/__tests__/storageRegion.test.ts`. What that cannot prove is
how a real S3 endpoint treats the signature.

Confirm `R2_REGION` is the bucket's own region and not `auto`:

```sh
terraform output -raw documents_bucket_name
aws s3api get-bucket-location --bucket "$(terraform output -raw documents_bucket_name)"
```

Then exercise the round trip through the running application rather than by
hand — it is the same code path the product uses, and a hand-rolled `aws s3
presign` proves something slightly different. Stage 4, Task 5 already walks it:
step 4 uploads a document and step 7 downloads one. If both work against the
deployed stack, this row is satisfied. If the upload fails with a 403 whose
body mentions the signature or the region, `R2_REGION` is wrong — correct it in
`terraform.tfvars`, apply, and let the service roll.

**Collect the outputs.** These are the GitHub settings from Stage 4, Task 1:

```sh
terraform output
```

`deploy_role_arn` is `AWS_ROLE_ARN`, `aws_account_id` is `AWS_ACCOUNT_ID`,
`app_url` is `APP_URL`. `smtp_secret_name` holds the six values for
Supabase's SMTP page; read it with `aws secretsmanager get-secret-value`
once the SES identity shows as verified.

**Then the first deploy.** With the GitHub variables and secrets set, a
merge to `main` builds both images and rolls them out
(`docs/release-pipeline.md`). That is what turns the footprint into a
running service.

## 6. Stage 5: the platform, later

None of the above creates the self-hosted platform. It arrives in its own
apply, once Stage 5, Task 1 has approved the running cost, and it is
additive: the live service is untouched until the cutover.

1. `platform_enabled = true` in `terraform.tfvars`; `terraform plan` shows
   the database, keys, postgrest, gotrue and dbtools modules, two CloudFront
   origins and behaviours, and the alarms — and no change to the backend or
   frontend services. Apply. The RDS instance takes ten to fifteen minutes.
2. Set `PLATFORM_ENABLED=true` on the repository's `production` environment
   so the next release builds and pushes the dbtools image.
3. `infra/dbtools/run.sh bootstrap` — the role shape, the `auth` and
   `extensions` schemas, the extensions (`infra/modules/database/README.md`).
4. Mint, verify and write the API keys: `docs/runbooks/api-keys.md`.
5. Stage 5, Task 2 writes the migration-source secret; Task 3 adds the
   Google redirect URI and writes the client, after which
   `gotrue_google_oauth_enabled = true` and an apply.
6. `npm run smoke -- --app-url https://legalworkflows.co.uk --platform …`
   proves GoTrue and PostgREST answer through the edge.
7. The rehearsal, then the cutover: `docs/runbooks/platform-cutover.md`.

Nothing in steps 1 to 6 changes what users see. `platform_serves_backend`
stays `false` until the rehearsal has passed.

## If it fails partway

Terraform records what it created. Fix the cause and run
`terraform plan` again: it will show only the remainder. Do not delete
resources by hand to "start clean" — that is how state and reality diverge,
and the recovery is worse than the original failure.

The failures worth naming:

- **Certificate validation timed out.** The nameservers are not propagated,
  or the registrar points elsewhere. Fix the delegation, wait, re-plan. The
  certificate resource is replaced on the next apply; nothing is lost.
- **The import failed with "cannot import non-existent remote object".** The
  hosted zone ID is wrong, or the zone is in another account.
- **An IAM resource already exists.** Another project in the same account
  has one with that name. The deploy role is prefixed to avoid this; if it
  still collides, set `deploy_role_name`.

## Destroying it

`terraform destroy` works, with two deliberate exceptions: the hosted zone
carries `prevent_destroy`, and neither S3 bucket will delete while it holds
objects. Both are on purpose. Losing the footprint is recoverable; losing
the zone or the documents is not.
