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

output "app_url" {
  description = "The public origin, as served by CloudFront."
  value       = module.frontend.app_url
}

output "cloudfront_distribution_id" {
  description = "For cache invalidations and the observability module."
  value       = module.frontend.distribution_id
}

output "cloudfront_domain_name" {
  description = "The distribution's own hostname, which the apex records alias to."
  value       = module.frontend.distribution_domain_name
}

output "frontend_ecr_repository_url" {
  description = "Where the Stage 4 deploy workflow pushes frontend images."
  value       = module.frontend.ecr_repository_url
}

output "frontend_service_name" {
  description = "ECS service the deploy workflow updates."
  value       = module.frontend.service_name
}

output "frontend_log_group_name" {
  value = module.frontend.log_group_name
}

output "alerts_urgent_topic_arn" {
  description = "SNS topic for the alarms that mean the site is down."
  value       = module.observability.urgent_topic_arn
}

output "alerts_topic_arn" {
  description = "SNS topic for everything else."
  value       = module.observability.informational_topic_arn
}

output "dashboard_url" {
  description = "The CloudWatch dashboard."
  value       = module.observability.dashboard_url
}

output "smtp_secret_name" {
  description = "Secrets Manager secret with the SMTP settings to paste into Supabase once SES production access is approved (infra/modules/email/README.md)."
  value       = module.email.smtp_secret_name
}

output "email_sender_address" {
  description = "The From address Supabase Auth sends as."
  value       = module.email.sender_address
}

output "deploy_role_arn" {
  description = "AWS_ROLE_ARN for the repository's Actions variables (Stage 4, Task 1)."
  value       = module.deploy.role_arn
}

# What a failed "Not authorized to perform sts:AssumeRoleWithWebIdentity" is
# asking you to compare against: print this, then read the subject GitHub
# actually sent from the run's OIDC token. They are matched case-sensitively.
output "deploy_allowed_subjects" {
  description = "The GitHub token subjects the deploy role's trust policy accepts."
  value       = module.deploy.allowed_subjects
}

output "deploy_oidc_provider_arn" {
  description = "The OIDC provider the deploy role trusts — account-wide, and possibly shared with another project."
  value       = module.deploy.oidc_provider_arn
}

output "documents_backup_bucket_name" {
  description = "Where to restore documents from (docs/runbooks/restore.md)."
  value       = module.backup.bucket_name
}

# --- stage 5 ----------------------------------------------------------------------
# Null until platform_enabled is true.

output "database_address" {
  description = "Hostname of the RDS instance, reachable from the private subnets only."
  value       = one(module.database[*].address)
}

output "database_master_user_secret_arn" {
  description = "The RDS-managed master credential, for the role bootstrap and a restore (infra/modules/database/README.md)."
  value       = one(module.database[*].master_user_secret_arn)
}

output "database_roles_secret_name" {
  description = "Secret holding the authenticator and supabase_auth_admin passwords and URIs."
  value       = one(module.database[*].roles_secret_name)
}

output "database_security_group_id" {
  description = "For adding an ingress rule from a new client task."
  value       = one(module.database[*].security_group_id)
}

output "platform_jwt_secret_name" {
  description = "Secret holding the JWT secret PostgREST and GoTrue sign with; the input to minting API keys (docs/runbooks/api-keys.md)."
  value       = one(module.keys[*].jwt_secret_name)
}

output "platform_api_keys_secret_name" {
  description = "Secret the minted anon and service_role keys are written to."
  value       = one(module.keys[*].api_keys_secret_name)
}
