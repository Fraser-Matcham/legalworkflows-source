data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [var.account_id]
    }
  }
}

# Execution role: pull the image, write the log. No secrets — the task reads
# its own, at run time, with the task role.
resource "aws_iam_role" "execution" {
  name               = "${var.name_prefix}-dbtools-execution"
  path               = "/service/"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json

  tags = { Name = "${var.name_prefix}-dbtools-execution" }
}

data "aws_iam_policy_document" "execution" {
  statement {
    sid       = "EcrAuth"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid    = "EcrPull"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
    ]
    resources = [aws_ecr_repository.dbtools.arn]
  }

  statement {
    sid    = "Logs"
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.dbtools.arn}:*"]
  }
}

resource "aws_iam_role_policy" "execution" {
  name   = "execution"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution.json
}

# Task role: the three secrets the subcommands read, the key the database
# secrets are under, and the migration record. This is the most capable
# role in the footprint — it can read the master credential — which is why
# the task has no ports, no service, and runs only when started by hand or
# by the pipeline.
resource "aws_iam_role" "task" {
  name               = "${var.name_prefix}-dbtools-task"
  path               = "/service/"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json

  tags = { Name = "${var.name_prefix}-dbtools-task" }
}

data "aws_iam_policy_document" "task" {
  statement {
    sid     = "ReadDatabaseSecrets"
    effect  = "Allow"
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      var.database_master_secret_arn,
      var.database_roles_secret_arn,
      aws_secretsmanager_secret.migration_source.arn,
    ]
  }

  statement {
    sid       = "DecryptDatabaseSecrets"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = [var.database_kms_key_arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${var.region}.amazonaws.com"]
    }
  }

  statement {
    sid    = "MigrationRecord"
    effect = "Allow"
    actions = [
      "ssm:GetParameter",
      "ssm:PutParameter",
    ]
    resources = [var.last_migration_parameter_arn]
  }
}

resource "aws_iam_role_policy" "task" {
  name   = "task"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}
