# Supabase Auth sends its email over SMTP with a username and password. SES
# derives the SMTP password from an IAM secret access key, so the credential
# is an IAM user whose only permission is to send from this domain.
resource "aws_iam_user" "smtp" {
  name = "${var.name_prefix}-smtp"
  path = "/service/"

  tags = { Name = "${var.name_prefix}-smtp" }
}

data "aws_iam_policy_document" "smtp" {
  statement {
    sid    = "SendFromThisDomainOnly"
    effect = "Allow"
    actions = [
      "ses:SendEmail",
      "ses:SendRawEmail",
    ]
    resources = [
      aws_sesv2_email_identity.domain.arn,
      aws_sesv2_configuration_set.transactional.arn,
    ]
    condition {
      test     = "StringLike"
      variable = "ses:FromAddress"
      values   = ["*@${var.domain_name}"]
    }
  }
}

resource "aws_iam_user_policy" "smtp" {
  name   = "send-email"
  user   = aws_iam_user.smtp.name
  policy = data.aws_iam_policy_document.smtp.json
}

resource "aws_iam_access_key" "smtp" {
  user = aws_iam_user.smtp.name
}

# The settings Supabase's Authentication → SMTP page asks for, in one place
# the operator can read back with `aws secretsmanager get-secret-value`.
# ses_smtp_password_v4 is the SigV4 derivation SES requires, computed by the
# provider from the secret key for this region.
resource "aws_secretsmanager_secret" "smtp" {
  name                    = "${var.name_prefix}/email/smtp"
  description             = "SMTP settings for Supabase Auth: host, port, username, password, sender. Rotate by tainting aws_iam_access_key.smtp in the email module."
  recovery_window_in_days = var.recovery_window_in_days

  tags = { Name = "${var.name_prefix}-email-smtp" }
}

resource "aws_secretsmanager_secret_version" "smtp" {
  secret_id = aws_secretsmanager_secret.smtp.id
  secret_string = jsonencode({
    SMTP_HOST         = local.smtp_host
    SMTP_PORT         = "587"
    SMTP_USERNAME     = aws_iam_access_key.smtp.id
    SMTP_PASSWORD     = aws_iam_access_key.smtp.ses_smtp_password_v4
    SMTP_SENDER_EMAIL = local.sender_address
    SMTP_SENDER_NAME  = var.sender_name
  })
}

locals {
  smtp_host = "email-smtp.${var.region}.amazonaws.com"
}
