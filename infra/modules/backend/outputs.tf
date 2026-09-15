output "ecr_repository_url" {
  description = "Where the deploy workflow pushes backend images."
  value       = aws_ecr_repository.backend.repository_url
}

output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "cluster_arn" {
  value = aws_ecs_cluster.this.arn
}

output "service_name" {
  value = aws_ecs_service.backend.name
}

output "task_definition_family" {
  value = aws_ecs_task_definition.backend.family
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.backend.name
}

output "service_connect_namespace_arn" {
  description = "For the frontend service to join the same namespace."
  value       = aws_service_discovery_http_namespace.this.arn
}

output "service_connect_backend_url" {
  description = "API_BASE_URL for the frontend: the backend's private Service Connect address."
  value       = "http://backend:${var.container_port}"
}

output "alb_arn" {
  value = aws_lb.this.arn
}

output "alb_arn_suffix" {
  description = "For CloudWatch metric dimensions in the observability module."
  value       = aws_lb.this.arn_suffix
}

output "alb_dns_name" {
  value = aws_lb.this.dns_name
}

output "alb_zone_id" {
  value = aws_lb.this.zone_id
}

output "https_listener_arn" {
  description = "The frontend module adds its own rule here."
  value       = aws_lb_listener.https.arn
}

output "backend_target_group_arn_suffix" {
  description = "For CloudWatch metric dimensions in the observability module."
  value       = aws_lb_target_group.backend.arn_suffix
}

output "origin_verify_secret" {
  description = "Value CloudFront must send in X-Origin-Verify. Consumed by the frontend module."
  value       = random_password.origin_verify.result
  sensitive   = true
}
