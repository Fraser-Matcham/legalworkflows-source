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
  name               = "${var.name_prefix}-gotrue-execution"
  path               = "/service/"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json

  tags = { Name = "${var.name_prefix}-gotrue-execution" }
}

data "aws_iam_policy_document" "execution" {
  statement {
    sid    = "Logs"
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.gotrue.arn}:*"]
  }

  # The database URI, the JWT secret, the SMTP credential and the Google
  # client: everything GoTrue reads at start. The task role gets none of it.
  statement {
    sid     = "ReadSecrets"
    effect  = "Allow"
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      var.database_uri_secret_arn,
      var.jwt_secret_arn,
      var.smtp_secret_arn,
      aws_secretsmanager_secret.google_oauth.arn,
    ]
  }

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
  name               = "${var.name_prefix}-gotrue-task"
  path               = "/service/"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json

  tags = { Name = "${var.name_prefix}-gotrue-task" }
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

# --- the Google OAuth client (ticket 2119) --------------------------------------
# Operator-held, like the backend's operator secret: Terraform creates the
# container and never writes the value. Written once with
#   aws secretsmanager put-secret-value --secret-id <name> \
#     --secret-string '{"GOOGLE_CLIENT_ID":"…","GOOGLE_CLIENT_SECRET":"…"}'
# and then google_oauth_enabled can be set.
resource "aws_secretsmanager_secret" "google_oauth" {
  name                    = "${var.name_prefix}/platform/google-oauth"
  description             = "The Google OAuth client GoTrue signs users in with: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET. Set out of band; Terraform never writes this value. The client's authorised redirect URI must include https://${var.domain_name}/auth/v1/callback."
  recovery_window_in_days = var.recovery_window_in_days

  tags = { Name = "${var.name_prefix}-platform-google-oauth" }
}
