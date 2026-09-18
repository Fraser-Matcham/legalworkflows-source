locals {
  service_arns = [
    for s in var.service_names : "arn:aws:ecs:${var.region}:${var.account_id}:service/${var.cluster_name}/${s}"
  ]
  task_definition_arns = [
    for f in var.task_definition_families : "arn:aws:ecs:${var.region}:${var.account_id}:task-definition/${f}:*"
  ]
  log_group_arns = flatten([
    for g in var.log_group_names : [
      "arn:aws:logs:${var.region}:${var.account_id}:log-group:${g}",
      "arn:aws:logs:${var.region}:${var.account_id}:log-group:${g}:*",
    ]
  ])
}

# What a deploy does, and only that: push an image, read its scan, register
# a task definition revision, roll the service, run the release job, watch
# it land, invalidate the CDN, and read the logs if it did not. No Terraform
# — infra/ is applied by a person (infra/README.md) — so no state bucket,
# no IAM beyond PassRole, no secrets.
data "aws_iam_policy_document" "deploy" {
  statement {
    sid       = "EcrLogin"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid    = "EcrPushAndRead"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeImageScanFindings",
      "ecr:DescribeImages",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:ListImages",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = var.ecr_repository_arns
  }

  # Enhanced scanning is Amazon Inspector wearing an ECR badge.
  # `ecr:DescribeImageScanFindings` is allowed above and simulates as allowed,
  # and the call is still refused: under ENHANCED the ECR API reads the findings
  # out of Inspector, and that read is authorised against inspector2, not ecr.
  #
  # This was not obvious, because it was invisible. The release's scan step hid
  # the failure behind `2>/dev/null || echo PENDING` and waited out its timeout
  # instead, three releases in a row, while CloudTrail recorded twenty of twenty
  # DescribeImageScanFindings calls as AccessDenied. The workflow no longer
  # swallows the error; this is the permission it was failing on.
  #
  # Which actions, exactly, was a guess the first time: ListFindings alone,
  # inferred from the shape of the call. Deploy run 33 refused it and named the
  # real one — inspector2:ListCoverage, on /coverage/list — which is ECR asking
  # Inspector whether the image is covered before it reads anything from it.
  # ListFindings stays: the coverage check is the first gate, not the only one.
  #
  # That correction took five seconds, because the same change that added this
  # statement also stopped the workflow swallowing the error. The three failures
  # before it each spent fifteen minutes saying nothing.
  #
  # Neither action takes a resource, so this cannot be scoped to the project's
  # repositories the way the ECR statement is. Both are read-only.
  statement {
    sid    = "InspectorReadFindings"
    effect = "Allow"
    actions = [
      "inspector2:ListCoverage",
      "inspector2:ListFindings",
    ]
    resources = ["*"]
  }

  # Task definition APIs do not support resource-level permissions.
  statement {
    sid    = "EcsTaskDefinitions"
    effect = "Allow"
    actions = [
      "ecs:DescribeTaskDefinition",
      "ecs:ListTaskDefinitions",
      "ecs:RegisterTaskDefinition",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "EcsTagOnCreate"
    effect = "Allow"
    actions = [
      "ecs:TagResource",
    ]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "ecs:CreateAction"
      values   = ["RegisterTaskDefinition", "RunTask"]
    }
  }

  statement {
    sid    = "EcsServices"
    effect = "Allow"
    actions = [
      "ecs:DescribeServices",
      "ecs:UpdateService",
    ]
    resources = local.service_arns
  }

  statement {
    sid       = "EcsCluster"
    effect    = "Allow"
    actions   = ["ecs:DescribeClusters"]
    resources = [var.cluster_arn]
  }

  # The release job (npm run sync:workflows) runs as a one-off task of the
  # backend definition before the service is rolled.
  statement {
    sid       = "EcsRunReleaseJob"
    effect    = "Allow"
    actions   = ["ecs:RunTask"]
    resources = local.task_definition_arns
    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [var.cluster_arn]
    }
  }

  statement {
    sid    = "EcsWatchTasks"
    effect = "Allow"
    actions = [
      "ecs:DescribeTasks",
      "ecs:ListTasks",
      "ecs:StopTask",
    ]
    resources = ["*"]
    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [var.cluster_arn]
    }
  }

  statement {
    sid       = "PassTaskRolesToEcs"
    effect    = "Allow"
    actions   = ["iam:PassRole"]
    resources = var.passable_role_arns
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }

  statement {
    sid    = "CloudFrontInvalidate"
    effect = "Allow"
    actions = [
      "cloudfront:CreateInvalidation",
      "cloudfront:GetInvalidation",
    ]
    resources = [var.cloudfront_distribution_arn]
  }

  statement {
    sid    = "ReadServiceLogs"
    effect = "Allow"
    actions = [
      "logs:DescribeLogStreams",
      "logs:FilterLogEvents",
      "logs:GetLogEvents",
    ]
    resources = local.log_group_arns
  }

  statement {
    sid       = "ReadTargetHealth"
    effect    = "Allow"
    actions   = ["elasticloadbalancing:DescribeTargetHealth"]
    resources = ["*"]
  }

  # The deploy's own record of which migration it applied last.
  statement {
    sid    = "MigrationRecord"
    effect = "Allow"
    actions = [
      "ssm:GetParameter",
      "ssm:PutParameter",
    ]
    resources = [aws_ssm_parameter.last_migration.arn]
  }
}

# docs/deployment.md: "Keep the last applied migration filename with your
# deployment records." This is that record. The deploy workflow applies every
# file in backend/migrations that sorts after this value, then writes the
# newest one back. Terraform sets the value once, on creation, to the newest
# migration schema.sql already contained when the database was installed,
# and never touches it again.
resource "aws_ssm_parameter" "last_migration" {
  name        = "/${var.name_prefix}/deploy/last-migration"
  description = "Filename of the last backend/migrations file applied to production. Owned by the deploy workflow."
  type        = "String"
  value       = var.initial_last_migration

  lifecycle {
    ignore_changes = [value]
  }

  tags = { Name = "${var.name_prefix}-last-migration" }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "deploy"
  role   = aws_iam_role.github_actions.name
  policy = data.aws_iam_policy_document.deploy.json
}

# Task 5 attaches AdministratorAccess to the hand-made role "for now". These
# two resources make the role's policies exactly what is declared here and
# nothing else, so the first apply after import removes it — and anything
# attached by hand later is removed on the next.
resource "aws_iam_role_policy_attachments_exclusive" "github_actions" {
  role_name   = aws_iam_role.github_actions.name
  policy_arns = []
}

resource "aws_iam_role_policies_exclusive" "github_actions" {
  role_name    = aws_iam_role.github_actions.name
  policy_names = [aws_iam_role_policy.deploy.name]
}
