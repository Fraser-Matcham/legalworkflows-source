# The same two-role split the secrets module uses for the backend: an
# execution role for the ECS agent to start the task with, a task role for the
# code — which for PostgREST is empty, because a Haskell binary that talks to
# one database needs nothing from AWS.

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

resource "aws_iam_role" "execution" {
  name               = "${var.name_prefix}-postgrest-execution"
  path               = "/service/"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json

  tags = { Name = "${var.name_prefix}-postgrest-execution" }
}

data "aws_iam_policy_document" "execution" {
  # The image is on the public ECR gallery, which needs no registry login.
  statement {
    sid    = "Logs"
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.postgrest.arn}:*"]
  }

  statement {
    sid     = "ReadSecrets"
    effect  = "Allow"
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      var.database_uri_secret_arn,
      var.jwt_secret_arn,
    ]
  }

  # The roles secret is under the database module's customer-managed key.
  statement {
    sid       = "DecryptDatabaseSecret"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = [var.database_kms_key_arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${var.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "execution" {
  name   = "execution"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution.json
}

resource "aws_iam_role" "task" {
  name               = "${var.name_prefix}-postgrest-task"
  path               = "/service/"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json

  tags = { Name = "${var.name_prefix}-postgrest-task" }
}

data "aws_iam_policy_document" "ecs_exec" {
  statement {
    sid    = "SsmMessagesForEcsExec"
    effect = "Allow"
    actions = [
      "ssmmessages:CreateControlChannel",
      "ssmmessages:CreateDataChannel",
      "ssmmessages:OpenControlChannel",
      "ssmmessages:OpenDataChannel",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "task_ecs_exec" {
  count = var.enable_ecs_exec ? 1 : 0

  name   = "ecs-exec"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.ecs_exec.json
}
