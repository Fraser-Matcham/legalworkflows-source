output "service_name" {
  value = aws_ecs_service.gotrue.name
}

output "task_definition_family" {
  value = aws_ecs_task_definition.gotrue.family
}

output "security_group_id" {
  value = aws_security_group.gotrue.id
}

output "target_group_arn_suffix" {
  value = aws_lb_target_group.gotrue.arn_suffix
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.gotrue.name
}

output "google_oauth_secret_name" {
  description = "Where the operator writes GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (Stage 5, Task 3)."
  value       = aws_secretsmanager_secret.google_oauth.name
}

output "google_redirect_uri" {
  description = "The authorised redirect URI to add to the Google OAuth client."
  value       = "https://${var.domain_name}/auth/v1/callback"
}

output "service_connect_url" {
  value = "http://gotrue:${var.container_port}"
}
