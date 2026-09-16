# Infrastructure

The production footprint, as Terraform. Decision 1 in
[`docs/delivery-plan/v2/architecture.md`](../docs/delivery-plan/v2/architecture.md):
everything that exists is described here and reviewed in a pull request, and
the whole thing can be destroyed and rebuilt from this directory.

Nothing in this directory is applied by CI. Applying is a deliberate, human
step against a real account — see "Applying" below.

## Layout

```
infra/
  versions.tf      Terraform and provider version pins
  backend.tf       remote state (S3, native lock file) — values from backend.hcl
  providers.tf     AWS provider, default tags, account/region data sources
  variables.tf     root inputs, all with production defaults
  locals.tf        name prefix and the tag set every resource carries
  outputs.tf       values later stages need (account id, region, names, URLs)
  imports.tf       the hand-created resources Terraform adopts (zone, OIDC provider, deploy role)
  modules/         one module per row of the Stage 3 table in plan.md:
                   network, storage, backup, secrets, dns, backend, frontend,
                   observability, email, deploy — each with its own README
```

Each module in `modules/` maps to one row of the Stage 3 engineering table in
[`docs/delivery-plan/v2/plan.md`](../docs/delivery-plan/v2/plan.md) and to one
row of the "What Terraform will own" table in `architecture.md`. A module is
added in its own pull request, wired into the root here, and described in its
own `README.md`.

## Prerequisites

- Terraform `~> 1.16` (the exact version CI validates with is pinned in
  [`.github/workflows/infra.yml`](../.github/workflows/infra.yml)).
- An AWS account with the state bucket created by hand — Stage 3, Task 4 in
  [`docs/delivery-plan/v2/human-tasks/stage-3-infrastructure.md`](../docs/delivery-plan/v2/human-tasks/stage-3-infrastructure.md).
  That bucket is the only resource not managed here, because state has to live
  somewhere before Terraform can manage anything.
- Credentials with rights to create the footprint. During the build that is
  the `terraform-build` user from Stage 3, Task 6; it is deleted in Stage 4,
  Task 4 once deploys run through the GitHub OIDC role instead.

## Initialising

```sh
cd infra
cp backend.hcl.example backend.hcl        # fill in the real bucket name
cp terraform.tfvars.example terraform.tfvars   # optional; defaults are production
terraform init -backend-config=backend.hcl
```

`backend.hcl` and `terraform.tfvars` are gitignored. The bucket name embeds the
account id, which is why it cannot be committed in `backend.tf` directly.

## Validating without an account

`terraform fmt -check -recursive` and `terraform validate` need no AWS
credentials and no state bucket:

```sh
cd infra
terraform fmt -check -recursive
terraform init -backend=false
terraform validate
```

CI runs exactly these on every pull request that touches `infra/`. A module
that does not validate does not merge.

## Applying

```sh
terraform plan -out=tfplan     # read it. All of it.
terraform apply tfplan
```

`terraform plan` is the rehearsal architecture.md's decision 3 relies on, given
there is no staging environment: read the plan before applying, every time,
and treat anything it wants to destroy or replace as a question rather than a
step.

## Conventions

- **Names** start with `local.name_prefix` (`legalworkflows-production`), so a
  console search on the prefix finds everything.
- **Tags** come from `local.common_tags` via the provider's `default_tags`; do
  not tag by hand.
- **Secrets** never pass through Terraform variables or `tfvars`. Secret
  values are written to Secrets Manager entries that the `secrets` module
  creates, and read by the tasks at start-up.
- **Regions**: everything regional is in `var.aws_region`; the only exception
  is the ACM certificate CloudFront requires in `us-east-1`, which the `dns`
  module handles with an aliased provider and says so.
- **Storage credentials**: the backend's S3 client (`backend/src/lib/storage.ts`)
  currently reads static `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` values, so
  the `storage` and `secrets` modules provision an IAM access key for the
  bucket. Its signing region comes from `R2_REGION`
  (`backend/src/lib/storageRegion.ts`), which the `backend` module sets to the
  footprint's region because real S3 rejects R2's `auto`. Moving to the task
  role afterwards removes the long-lived key; that is a follow-up, not part
  of the first footprint.
