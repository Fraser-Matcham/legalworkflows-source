output "role_arn" {
  description = "AWS_ROLE_ARN for the repository's GitHub Actions variables (Stage 4, Task 1)."
  value       = aws_iam_role.github_actions.arn
}

output "role_name" {
  value = aws_iam_role.github_actions.name
}

output "oidc_provider_arn" {
  value = aws_iam_openid_connect_provider.github.arn
}

output "allowed_subjects" {
  description = "The GitHub token subjects the trust policy accepts."
  value       = local.github_subjects
}
