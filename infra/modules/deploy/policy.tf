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
