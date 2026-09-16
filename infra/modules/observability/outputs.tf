output "urgent_topic_arn" {
  description = "Alarms that mean users cannot use the site. Email and, if configured, SMS."
  value       = aws_sns_topic.urgent.arn
}

output "informational_topic_arn" {
  description = "Everything else, email only. The email module sends bounce and complaint events here."
  value       = aws_sns_topic.informational.arn
}

output "dashboard_name" {
  value = aws_cloudwatch_dashboard.this.dashboard_name
}

output "dashboard_url" {
  value = "https://${var.region}.console.aws.amazon.com/cloudwatch/home?region=${var.region}#dashboards:name=${aws_cloudwatch_dashboard.this.dashboard_name}"
}

output "alarm_names" {
  description = "Every alarm this module created, for the runbooks."
  value = sort(concat(
    [for a in aws_cloudwatch_metric_alarm.unhealthy_targets : a.alarm_name],
    [for a in aws_cloudwatch_metric_alarm.no_running_tasks : a.alarm_name],
    [for a in aws_cloudwatch_metric_alarm.service_cpu : a.alarm_name],
    [for a in aws_cloudwatch_metric_alarm.service_memory : a.alarm_name],
    [
      aws_cloudwatch_metric_alarm.elb_5xx.alarm_name,
      aws_cloudwatch_metric_alarm.readiness_failures.alarm_name,
      aws_cloudwatch_metric_alarm.backend_5xx.alarm_name,
      aws_cloudwatch_metric_alarm.backend_latency.alarm_name,
    ],
  ))
}
