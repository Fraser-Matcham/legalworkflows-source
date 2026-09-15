# Two topics, because Task 9 asks the operator a two-part question — how do
# alerts reach you, and are you willing to be woken — and the answer is
# "email for everything, and a text for the things that mean the site is
# down". `urgent` is the second list.
#
# Not encrypted: CloudWatch alarms cannot publish to a topic encrypted with
# the AWS-managed SNS key, and a customer key for alarm text ("UnHealthyHostCount
# >= 1") protects nothing worth the key's cost.
resource "aws_sns_topic" "urgent" {
  name         = "${var.name_prefix}-alerts-urgent"
  display_name = "legalworkflows URGENT"

  tags = { Name = "${var.name_prefix}-alerts-urgent" }
}

resource "aws_sns_topic" "informational" {
  name         = "${var.name_prefix}-alerts"
  display_name = "legalworkflows alerts"

  tags = { Name = "${var.name_prefix}-alerts" }
}

locals {
  topics = {
    urgent        = aws_sns_topic.urgent
    informational = aws_sns_topic.informational
  }

  # The EventBridge rule below targets the urgent topic and the topic policy
  # must name the rule; building the ARN from the name avoids a cycle between
  # the two resources.
  deployment_failed_rule_name = "${var.name_prefix}-ecs-deployment-failed"
  deployment_failed_rule_arn  = "arn:aws:events:${var.region}:${var.account_id}:rule/${local.deployment_failed_rule_name}"
}

# Who may publish: this account (CloudWatch alarms publish as the account),
# EventBridge for the one rule below, and SES for bounce and complaint events
# from the email module — each service pinned to this account.
data "aws_iam_policy_document" "topic" {
  for_each = local.topics

  statement {
    sid    = "AccountOwner"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${var.account_id}:root"]
    }
    actions   = ["sns:Publish", "sns:Subscribe", "sns:GetTopicAttributes", "sns:SetTopicAttributes", "sns:ListSubscriptionsByTopic", "sns:DeleteTopic", "sns:RemovePermission", "sns:AddPermission"]
    resources = [each.value.arn]
  }

  statement {
    sid    = "CloudWatchAlarms"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com"]
    }
    actions   = ["sns:Publish"]
    resources = [each.value.arn]
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [var.account_id]
    }
  }

  statement {
    sid    = "SesEvents"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["ses.amazonaws.com"]
    }
    actions   = ["sns:Publish"]
    resources = [each.value.arn]
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [var.account_id]
    }
  }

  dynamic "statement" {
    for_each = each.key == "urgent" ? [1] : []
    content {
      sid    = "EventBridgeDeploymentFailed"
      effect = "Allow"
      principals {
        type        = "Service"
        identifiers = ["events.amazonaws.com"]
      }
      actions   = ["sns:Publish"]
      resources = [each.value.arn]
      condition {
        test     = "ArnEquals"
        variable = "aws:SourceArn"
        values   = [local.deployment_failed_rule_arn]
      }
    }
  }
}

resource "aws_sns_topic_policy" "this" {
  for_each = local.topics

  arn    = each.value.arn
  policy = data.aws_iam_policy_document.topic[each.key].json
}

# Subscriptions appear only once the operator has answered Task 9. An email
# subscription stays "pending confirmation" until the link in SNS's message is
# clicked; Terraform cannot do that step.
resource "aws_sns_topic_subscription" "email" {
  for_each = var.alert_email == null ? {} : local.topics

  topic_arn = each.value.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_sns_topic_subscription" "sms" {
  count = var.urgent_sms_number == null ? 0 : 1

  topic_arn = aws_sns_topic.urgent.arn
  protocol  = "sms"
  endpoint  = var.urgent_sms_number
}
