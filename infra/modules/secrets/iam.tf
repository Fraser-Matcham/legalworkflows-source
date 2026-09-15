# Two kinds of role per service, because ECS uses them for different things:
#
#   execution role — what the ECS agent uses to START the task: pull the image
#                    from ECR, create the log stream, fetch the secrets the
#                    task definition injects. The container never holds it.
#   task role      — what the CODE inside the container gets from the SDK's
#                    default credential chain. The backend needs none of AWS
#                    today (storage is a static key, email is Supabase's), so
#                    this is nearly empty; it exists so moving storage to the
#                    role later is a policy attachment, not a new role.
#
# Separate roles for backend and frontend: only the backend's execution role
# may read secrets, because only the backend has any.

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }

    # Only tasks from this account may assume these roles, which closes the
    # confused-deputy gap ECS documents for cross-account task definitions.
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [var.account_id]
    }
  }
}

# --- shared execution permissions -------------------------------------------

# ECR repositories are created by the backend and frontend modules with this
# prefix; log groups by the observability module. Naming is the contract.
locals {
  ecr_repository_arn_pattern = "arn:aws:ecr:${var.region}:${var.account_id}:repository/${var.name_prefix}-*"
  log_group_arn_pattern      = "arn:aws:logs:${var.region}:${var.account_id}:log-group:/ecs/${var.name_prefix}*"
}

data "aws_iam_policy_document" "execution_common" {
  # GetAuthorizationToken does not support resource-level permissions.
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
    resources = [local.ecr_repository_arn_pattern]
  }

  statement {
    sid    = "Logs"
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${local.log_group_arn_pattern}:*"]
  }
}

# --- backend -----------------------------------------------------------------

resource "aws_iam_role" "backend_execution" {
  name               = "${var.name_prefix}-backend-execution"
  path               = "/service/"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json

  tags = { Name = "${var.name_prefix}-backend-execution" }
}

data "aws_iam_policy_document" "backend_execution" {
  source_policy_documents = [data.aws_iam_policy_document.execution_common.json]

  statement {
    sid     = "ReadBackendSecrets"
    effect  = "Allow"
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      aws_secretsmanager_secret.generated.arn,
      aws_secretsmanager_secret.operator.arn,
      aws_secretsmanager_secret.storage.arn,
    ]
  }
}

resource "aws_iam_role_policy" "backend_execution" {
  name   = "execution"
  role   = aws_iam_role.backend_execution.id
  policy = data.aws_iam_policy_document.backend_execution.json
}

resource "aws_iam_role" "backend_task" {
  name               = "${var.name_prefix}-backend-task"
  path               = "/service/"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json

  tags = { Name = "${var.name_prefix}-backend-task" }
}

# --- frontend ----------------------------------------------------------------

resource "aws_iam_role" "frontend_execution" {
  name               = "${var.name_prefix}-frontend-execution"
  path               = "/service/"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json

  tags = { Name = "${var.name_prefix}-frontend-execution" }
}

resource "aws_iam_role_policy" "frontend_execution" {
  name   = "execution"
  role   = aws_iam_role.frontend_execution.id
  policy = data.aws_iam_policy_document.execution_common.json
}

resource "aws_iam_role" "frontend_task" {
  name               = "${var.name_prefix}-frontend-task"
  path               = "/service/"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json

  tags = { Name = "${var.name_prefix}-frontend-task" }
}

# --- ECS Exec ----------------------------------------------------------------

# `aws ecs execute-command` opens a shell in a running task through SSM. The
# task role needs these four actions; the caller separately needs
# ecs:ExecuteCommand, so this alone grants nobody anything.
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

resource "aws_iam_role_policy" "backend_task_ecs_exec" {
  count = var.enable_ecs_exec ? 1 : 0

  name   = "ecs-exec"
  role   = aws_iam_role.backend_task.id
  policy = data.aws_iam_policy_document.ecs_exec.json
}

resource "aws_iam_role_policy" "frontend_task_ecs_exec" {
  count = var.enable_ecs_exec ? 1 : 0

  name   = "ecs-exec"
  role   = aws_iam_role.frontend_task.id
  policy = data.aws_iam_policy_document.ecs_exec.json
}
