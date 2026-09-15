output "aws_account_id" {
  description = "Account the footprint lives in. Stage 4, Task 1 needs it as a GitHub variable."
  value       = data.aws_caller_identity.current.account_id
}

output "aws_region" {
  description = "Region every regional resource was created in."
  value       = data.aws_region.current.region
}

output "name_prefix" {
  description = "Prefix shared by every resource name, for cross-referencing in the console."
  value       = local.name_prefix
}

output "vpc_id" {
  value = module.network.vpc_id
}

output "nat_gateway_public_ips" {
  description = "Fixed egress addresses of the private subnets, should a third party want to allow-list them."
  value       = module.network.nat_gateway_public_ips
}

output "documents_bucket_name" {
  description = "R2_BUCKET_NAME for the backend."
  value       = module.storage.bucket_name
}

output "documents_endpoint_url" {
  description = "R2_ENDPOINT_URL for the backend."
  value       = module.storage.endpoint_url
}

output "name_servers" {
  description = "The zone's nameservers; must match what the registrar points at (Stage 3, Task 7)."
  value       = module.dns.name_servers
}

output "operator_secret_name" {
  description = "Secrets Manager secret to populate with the operator-held values (infra/modules/secrets/README.md)."
  value       = module.secrets.operator_secret_name
}

output "origin_fqdn" {
  description = "The load balancer's hostname, which CloudFront connects to."
  value       = module.dns.origin_fqdn
}

output "backend_ecr_repository_url" {
  description = "Where the Stage 4 deploy workflow pushes backend images."
  value       = module.backend.ecr_repository_url
}

output "ecs_cluster_name" {
  description = "Cluster both services run in; the deploy workflow needs it."
  value       = module.backend.cluster_name
}

output "backend_service_name" {
  description = "ECS service the deploy workflow updates."
  value       = module.backend.service_name
}

output "backend_log_group_name" {
  description = "Where the backend's logs go."
  value       = module.backend.log_group_name
}

output "alb_dns_name" {
  description = "The load balancer's own hostname, for debugging the origin directly. Requests without CloudFront's origin header get a 403 by design."
  value       = module.backend.alb_dns_name
}
