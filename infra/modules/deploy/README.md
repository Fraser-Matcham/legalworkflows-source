# `deploy`

Row 3.9 of the Stage 3 table: the role GitHub Actions assumes to deploy,
through GitHub's OIDC provider, so no AWS access key is ever stored in a
GitHub secret.

## Adopting the hand-made role

Stage 3, Task 5 has the operator create the identity provider and a role
named `github-actions-deploy` in the console, with `AdministratorAccess`
"for now" and no branch restriction. `infra/imports.tf` imports both into
this module, and the first apply then:

- rewrites the trust policy to accept only tokens whose subject is a push
  to a listed branch (`main`) or a job in a listed environment
  (`production`) of `github_repository` — a pull-request run has a
  different subject and is refused;
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

Not granted, on purpose: anything to do with Terraform state, secrets, IAM
beyond `PassRole`, S3, or creating infrastructure. `infra/` is applied by a
person (`infra/README.md`); the deploy workflow ships containers.

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
variable in Stage 4, Task 1. Protection rules on the `production`
environment (required reviewers, a wait timer) gate the deploy at GitHub's
side; the trust policy makes them the only door.
