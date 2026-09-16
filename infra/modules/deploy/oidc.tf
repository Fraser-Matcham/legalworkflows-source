# GitHub proves who it is to AWS with a signed OIDC token; AWS trusts the
# issuer once, here, and the role below says which tokens — which repository,
# branch or environment — may assume it. Nothing long-lived is stored in
# GitHub.
#
# The provider is an ACCOUNT-WIDE singleton: one per account, shared by every
# project that deploys from GitHub. So this module only creates it when the
# account does not have one yet, and otherwise looks the existing one up.
# Adopting it into this state instead would make `terraform destroy` here
# delete a provider other projects in the account depend on.
#
# No thumbprint: AWS validates GitHub's issuer against its own trusted root
# store, and the thumbprint list is Optional in the provider for that reason.
resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_oidc_provider ? 1 : 0

  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]

  tags = { Name = "github-actions" }
}

data "aws_iam_openid_connect_provider" "github" {
  count = var.create_oidc_provider ? 0 : 1

  url = "https://token.actions.githubusercontent.com"
}

# The token subjects the role accepts. GitHub gives a job the environment
# subject when it declares `environment:`, and the branch subject otherwise.
# `github_repository` is the repository *as the subject spells it*, which
# carries immutable numeric IDs under an organisation that has enabled them.
# Accepting both would mean the environment's protection rules (required
# reviewers, wait timer) could be skipped by a job that simply omits the
# environment, so deploy_branches is empty by default and the environment
# subject is the only way in.
locals {
  oidc_provider_arn = var.create_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : data.aws_iam_openid_connect_provider.github[0].arn

  github_subjects = concat(
    [for b in var.deploy_branches : "repo:${var.github_repository}:ref:refs/heads/${b}"],
    [for e in var.deploy_environments : "repo:${var.github_repository}:environment:${e}"],
  )
}

data "aws_iam_policy_document" "trust" {
  statement {
    sid     = "GitHubActionsFromThisRepository"
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = local.github_subjects
    }
  }
}

resource "aws_iam_role" "github_actions" {
  name                 = var.role_name
  description          = "Assumed by ${var.github_repository}'s deploy workflows through GitHub's OIDC provider. Permissions are the deploy's and nothing more."
  assume_role_policy   = data.aws_iam_policy_document.trust.json
  max_session_duration = 3600

  tags = { Name = var.role_name }

  lifecycle {
    # Both lists empty would produce a StringLike over no values, which
    # matches nothing: a role nothing can assume, discovered at the first
    # deploy rather than here.
    precondition {
      condition     = length(local.github_subjects) > 0
      error_message = "deploy_branches and deploy_environments cannot both be empty: the role would accept no token at all."
    }
  }
}
