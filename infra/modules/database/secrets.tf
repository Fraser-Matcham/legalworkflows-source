# The two login roles the platform services connect as, and their passwords.
#
#   authenticator        PostgREST's connection role. Has no rights of its own;
#                        it switches to anon, authenticated or service_role
#                        per request according to the JWT (bootstrap.sql).
#   supabase_auth_admin  GoTrue's connection role. Owns the auth schema and
#                        runs GoTrue's own migrations in it.
#
# Both passwords are minted here and never leave Secrets Manager except into
# the two task definitions, as ECS `secrets`. The full connection URIs are
# stored alongside so the services and the database-tools task read one key
# rather than assembling a string. Rotate by tainting the random_password;
# the bootstrap SQL is idempotent and re-applies the new value.
resource "random_password" "authenticator" {
  length  = 40
  special = false
}

resource "random_password" "auth_admin" {
  length  = 40
  special = false
}

locals {
  authenticator_uri = "postgres://authenticator:${random_password.authenticator.result}@${aws_db_instance.this.address}:${aws_db_instance.this.port}/${aws_db_instance.this.db_name}?sslmode=require"
  auth_admin_uri    = "postgres://supabase_auth_admin:${random_password.auth_admin.result}@${aws_db_instance.this.address}:${aws_db_instance.this.port}/${aws_db_instance.this.db_name}?sslmode=require"
}

resource "aws_secretsmanager_secret" "roles" {
  name                    = "${var.name_prefix}/database/roles"
  description             = "Passwords and connection URIs for the authenticator (PostgREST) and supabase_auth_admin (GoTrue) database roles, minted by the database module. Rotate by tainting the matching random_password."
  recovery_window_in_days = var.recovery_window_in_days
  kms_key_id              = aws_kms_key.database.arn

  tags = { Name = "${var.name_prefix}-database-roles" }
}

resource "aws_secretsmanager_secret_version" "roles" {
  secret_id = aws_secretsmanager_secret.roles.id
  secret_string = jsonencode({
    AUTHENTICATOR_PASSWORD = random_password.authenticator.result
    AUTHENTICATOR_URI      = local.authenticator_uri
    AUTH_ADMIN_PASSWORD    = random_password.auth_admin.result
    AUTH_ADMIN_URI         = local.auth_admin_uri
  })
}
