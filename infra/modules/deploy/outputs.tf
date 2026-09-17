output "role_arn" {
  description = "AWS_ROLE_ARN for the repository's GitHub Actions variables (Stage 4, Task 1)."
  value       = aws_iam_role.github_actions.arn
}

output "role_name" {
  value = aws_iam_role.github_actions.name
}

output "oidc_provider_arn" {
  description = "The provider this role trusts, whether created here or already in the account."
  value       = local.oidc_provider_arn
}

output "allowed_subjects" {
  description = "The GitHub token subjects the trust policy accepts."
  value       = local.github_subjects
}

output "last_migration_parameter_name" {
  description = "SSM parameter the deploy workflow reads and writes."
  value       = aws_ssm_parameter.last_migration.name
}

output "last_migration_parameter_arn" {
  description = "The SSM record of the last applied migration, for the dbtools task role (stage 5)."
  value       = aws_ssm_parameter.last_migration.arn
}
