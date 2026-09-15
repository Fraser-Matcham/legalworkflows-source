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

output "operator_secret_name" {
  description = "Secrets Manager secret to populate with the operator-held values (infra/modules/secrets/README.md)."
  value       = module.secrets.operator_secret_name
}
