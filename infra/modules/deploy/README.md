# `deploy`

Row 3.9 of the Stage 3 table: the role GitHub Actions assumes to deploy,
through GitHub's OIDC provider, so no AWS access key is ever stored in a
GitHub secret.

## Adopting the hand-made role

Stage 3, Task 5 has the operator create the identity provider and a role
named `github-actions-deploy` in the console, with `AdministratorAccess`
"for now" and no branch restriction. `infra/imports.tf` imports both into
this module, and the first apply then:

- rewrites the trust policy to accept only tokens whose subject is a job in
  a listed environment (`production`) of `github_repository` — see "Who may
  assume it" below;
- attaches the least-privilege inline policy below;
- **removes `AdministratorAccess`**, through
  `aws_iam_role_policy_attachments_exclusive` with an empty list, which also
  removes anything attached by hand later.

Read the plan for that apply: it should show the provider and role as
imported and updated, never created or replaced. If Task 5 was skipped,
delete the two `import` blocks and Terraform creates both.

## What the deploy may do

| Action | On |
| --- | --- |
| log in to ECR; push, pull, list images; read scan findings | the two repositories |
| register task definition revisions; describe and list them | any (the API has no resource scope) |
| tag on create | task definitions and tasks it creates |
| describe and update the service | the two services |
| run a one-off task (the catalogue sync release job) | the two task definition families, in this cluster |
| describe, list, stop tasks | this cluster |
| pass roles to ECS | the four task and execution roles, to `ecs-tasks.amazonaws.com` only |
| invalidate the CDN | the one distribution |
| read logs | the two service log groups |
| read target health | any |
| read and write the last-applied-migration parameter | `/<prefix>/deploy/last-migration` |

Not granted, on purpose: anything to do with Terraform state, secrets, IAM
beyond `PassRole`, S3, or creating infrastructure. `infra/` is applied by a
person (`infra/README.md`); the deploy workflow ships containers.

## The migration record

`docs/deployment.md` says to keep the last applied migration filename with
the deployment records. Here it is an SSM parameter,
`/<prefix>/deploy/last-migration`, created with the newest file in
`backend/migrations` at the time of the first apply — the database was
installed from `schema.sql`, which already contains every migration up to
that one — and owned by the deploy workflow from then on: it applies every
file that sorts after the value, then writes the newest back. Terraform
ignores later changes to the value.

## Who may assume it

Only a job that declares `environment: production` in
`Fraser-Matcham/legalworkflows`. GitHub gives a workflow job the subject
`repo:<owner>/<repo>:environment:<name>` when it declares an environment,
and `repo:<owner>/<repo>:ref:refs/heads/<branch>` when it does not. The
trust policy lists the first form only.

That is deliberate, and it is what makes the environment's protection rules
(required reviewers, a wait timer) a real gate rather than an advisory one.
If the policy also accepted the branch subject, any job running on `main`
with `id-token: write` could assume this role by simply *omitting* the
environment — no approval prompt, and the role can pass the backend
execution role, which reads every Secrets Manager secret. `deploy_branches`
exists for an operator who knowingly wants that trade; it is empty by
default, and adding to it means this paragraph is no longer true.

A pull-request run gets a third subject form (`pull_request`) and is refused
either way: CI never deploys from a branch under review.

## Using it from a workflow

```yaml
permissions:
  id-token: write   # ask GitHub for the OIDC token
  contents: read

jobs:
  deploy:
    environment: production     # gives the token the environment subject
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ vars.AWS_ROLE_ARN }}
          aws-region: eu-west-2
```

`AWS_ROLE_ARN` is this module's `role_arn` output, set as a repository
variable in Stage 4, Task 1. **The `environment: production` line is not
decoration** — without it the job's token carries a subject the trust policy
does not list, and `configure-aws-credentials` fails. That is the mechanism
by which the environment's protection rules gate every use of this role.
