# GitHub proves who it is to AWS with a signed OIDC token; AWS trusts the
# issuer once, here, and the role below says which tokens — which repository,
# branch or environment — may assume it. Nothing long-lived is stored in
# GitHub.
#
# No thumbprint: AWS validates GitHub's issuer against its own trusted root
# store, and the thumbprint list is Optional in the provider for that reason.
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]

  tags = { Name = "github-actions" }
}

locals {
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
      identifiers = [aws_iam_openid_connect_provider.github.arn]
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
}
