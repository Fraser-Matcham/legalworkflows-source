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
