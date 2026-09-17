output "service_name" {
  value = aws_ecs_service.postgrest.name
}

output "task_definition_family" {
  value = aws_ecs_task_definition.postgrest.family
}

output "security_group_id" {
  value = aws_security_group.postgrest.id
}

output "target_group_arn_suffix" {
  description = "For the observability module's metric dimensions."
  value       = aws_lb_target_group.postgrest.arn_suffix
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.postgrest.name
}

output "service_connect_url" {
  description = "Where the backend would reach PostgREST without leaving the VPC: http://postgrest:<port>."
  value       = "http://postgrest:${var.container_port}"
}

output "execution_role_arn" {
  value = aws_iam_role.execution.arn
}

output "task_role_arn" {
  value = aws_iam_role.task.arn
}
