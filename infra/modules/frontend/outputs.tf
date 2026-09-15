output "ecr_repository_url" {
  description = "Where the deploy workflow pushes frontend images."
  value       = aws_ecr_repository.frontend.repository_url
}

output "service_name" {
  value = aws_ecs_service.frontend.name
}

output "task_definition_family" {
  value = aws_ecs_task_definition.frontend.family
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.frontend.name
}

output "target_group_arn_suffix" {
  description = "For CloudWatch metric dimensions in the observability module."
  value       = aws_lb_target_group.frontend.arn_suffix
}

output "distribution_id" {
  description = "For cache invalidations after a deploy, and for the observability module's metrics."
  value       = aws_cloudfront_distribution.this.id
}

output "distribution_arn" {
  value = aws_cloudfront_distribution.this.arn
}

output "distribution_domain_name" {
  description = "The d123.cloudfront.net name the apex records alias to."
  value       = aws_cloudfront_distribution.this.domain_name
}

output "app_url" {
  description = "The public origin, as served."
  value       = "https://${var.domain_name}"
}
