# Row 5.7 of the Stage 5 table (tickets 2120, 2121): the JWT secret the
# platform signs with, and the container for the two API keys minted from it.
#
# On Supabase the anon and service_role keys are JWTs signed with a secret
# only Supabase held, which is why three releases died on a key nobody in
# this account could verify. Here the secret is minted by Terraform into
# Secrets Manager, PostgREST and GoTrue read it from there, and the keys are
# minted from it by scripts/platform-keys.mjs — which can also verify one
# before it is written. docs/runbooks/api-keys.md is the procedure.
#
#   <prefix>/platform/jwt        JWT_SECRET            written by Terraform
#   <prefix>/platform/api-keys   ANON_KEY,             written by the runbook,
#                                SERVICE_ROLE_KEY,     never by Terraform
#                                ISSUED_AT, EXPIRES_AT
#
# Terraform cannot sign a JWT — it has no HMAC function — so the keys are a
# script's output rather than a resource. That is also why the api-keys secret
# has no version here: like the operator secret, Terraform creates the
# container and never writes or overwrites the value.

# 64 characters from [A-Za-z0-9]: comfortably past PostgREST's 32-character
# minimum, and free of anything a shell or a URI would need quoting.
resource "random_password" "jwt_secret" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "jwt" {
  name                    = "${var.name_prefix}/platform/jwt"
  description             = "JWT secret PostgREST and GoTrue verify and sign with. Rotate by tainting random_password.jwt_secret in the keys module, then re-mint the API keys (docs/runbooks/api-keys.md). Rotation signs every user out."
  recovery_window_in_days = var.recovery_window_in_days

  tags = { Name = "${var.name_prefix}-platform-jwt" }
}

resource "aws_secretsmanager_secret_version" "jwt" {
  secret_id = aws_secretsmanager_secret.jwt.id
  secret_string = jsonencode({
    JWT_SECRET = random_password.jwt_secret.result
  })
}

resource "aws_secretsmanager_secret" "api_keys" {
  name                    = "${var.name_prefix}/platform/api-keys"
  description             = "The anon and service_role API keys minted from the platform JWT secret by scripts/platform-keys.mjs. Written by the runbook, never by Terraform. Keys: ANON_KEY, SERVICE_ROLE_KEY, ISSUED_AT, EXPIRES_AT."
  recovery_window_in_days = var.recovery_window_in_days

  tags = { Name = "${var.name_prefix}-platform-api-keys" }
}
