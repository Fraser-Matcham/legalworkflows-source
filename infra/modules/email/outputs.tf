output "identity_arn" {
  value = aws_sesv2_email_identity.domain.arn
}

output "configuration_set_name" {
  value = aws_sesv2_configuration_set.transactional.configuration_set_name
}

output "sender_address" {
  description = "The From address to give Supabase."
  value       = local.sender_address
}

output "smtp_host" {
  value = local.smtp_host
}

output "smtp_port" {
  value = 587
}

output "smtp_secret_name" {
  description = "Secrets Manager secret holding the full set of SMTP settings for Supabase."
  value       = aws_secretsmanager_secret.smtp.name
}

output "mail_from_domain" {
  value = local.mail_from_domain
}
