output "jwt_secret_arn" {
  value = aws_secretsmanager_secret.jwt.arn
}

output "jwt_secret_name" {
  description = "Pass to `aws secretsmanager get-secret-value --secret-id` when minting keys."
  value       = aws_secretsmanager_secret.jwt.name
}

output "api_keys_secret_arn" {
  value = aws_secretsmanager_secret.api_keys.arn
}

output "api_keys_secret_name" {
  description = "Pass to `aws secretsmanager put-secret-value --secret-id` after minting."
  value       = aws_secretsmanager_secret.api_keys.name
}

# ECS `secrets` entries, in the "<arn>:<json key>::" form, for whichever task
# definition needs them: PostgREST and GoTrue take the secret, the backend
# takes the two keys once the cutover (ticket 2122) points it here.
output "ecs_secrets" {
  description = "Map of environment variable name to ECS valueFrom for the JWT secret and the two API keys."
  value = {
    PGRST_JWT_SECRET         = "${aws_secretsmanager_secret.jwt.arn}:JWT_SECRET::"
    GOTRUE_JWT_SECRET        = "${aws_secretsmanager_secret.jwt.arn}:JWT_SECRET::"
    SUPABASE_PUBLISHABLE_KEY = "${aws_secretsmanager_secret.api_keys.arn}:ANON_KEY::"
    SUPABASE_SECRET_KEY      = "${aws_secretsmanager_secret.api_keys.arn}:SERVICE_ROLE_KEY::"
  }
}
