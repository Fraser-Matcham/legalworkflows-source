# `deploy`

Row 3.9 of the Stage 3 table: the role GitHub Actions assumes to deploy,
through GitHub's OIDC provider, so no AWS access key is ever stored in a
GitHub secret.

## Where the role and the provider come from

**The role is created here**, named `<project>-<environment>-github-actions`
by default. It is not adopted from anything: a role called
`github-actions-deploy` created by hand earlier is unused and can be
deleted. The prefix matters in an account shared with another project,
where a bare name would collide.

**The provider is not.** GitHub's OIDC identity provider is an account-wide
singleton — one `token.actions.githubusercontent.com` per account, shared by
every project that deploys from GitHub. So this module looks the existing one
up with a data source, and creates it only when `create_oidc_provider` is
true. Two reasons: creating a second one fails outright, and adopting
another project's into this state would make `terraform destroy` here delete
the provider their deploys depend on.

Check which case you are in before the first apply:

```sh
aws iam list-open-id-connect-providers
```

Anything listed means leave `create_github_oidc_provider` at its default of
false. An empty list means set it true.

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

### When the role will not assume

`Could not assume role with OIDC: Not authorized to perform
sts:AssumeRoleWithWebIdentity` means the token reached AWS and was refused.
Print what this side expects and compare it with what GitHub sent:

```sh
terraform output deploy_allowed_subjects
```

Every comparison below is **case-sensitive** — IAM condition operators do not
fold case, and two of the three traps are nothing but capitalisation:

- **The environment's name.** GitHub puts the environment in the subject
  exactly as the repository records it, so an environment created as
  `Production` yields `:environment:Production` and will not match
  `deploy_environments = ["production"]`. This one hides well: a workflow's
  `environment: production` still matches the environment, so the job's
  variables and secrets resolve normally and only the role assumption fails.
- **The owner and repository.** `github_repository` must be the canonical
  spelling GitHub stores, not a lowercased or differently-cased form of it.
- **The provider's audience.** When the account already had a GitHub OIDC
  provider, this module looks it up rather than creating one, so its
  `ClientIDList` is whatever the project that created it chose. If it does
  not contain `sts.amazonaws.com`, AWS rejects the token before the trust
  policy is consulted at all, and the error is identical:

  ```sh
  aws iam get-open-id-connect-provider \
    --open-id-connect-provider-arn "$(terraform output -raw deploy_oidc_provider_arn)" \
    --query '{url:Url,audiences:ClientIDList}'
  ```

  Adding an audience to a shared provider affects every project using it, so
  read who else depends on it before changing it.

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
