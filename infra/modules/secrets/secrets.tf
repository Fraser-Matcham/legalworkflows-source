# Three secrets rather than one per variable. Secrets Manager charges per
# secret, ECS can read a single JSON key out of a secret
# (valueFrom = "<arn>:<key>::"), and the three groups rotate on different
# schedules and by different hands:
#
#   generated  — minted here by Terraform, rotated by tainting the random
#                resource. Nobody ever needs to know these values.
#   operator   — values only the operator holds (Supabase key, model provider
#                key). Terraform creates the container and never writes the
#                value; see README for how it is set.
#   storage    — the IAM access key the storage module minted. Rotated by
#                rotating that key.
#
# Encryption uses the account's aws/secretsmanager managed key. A customer key
# would add a KMS grant to every task role for no gain until there is a
# requirement to audit or revoke at the key level.

# --- generated ---------------------------------------------------------------

# Ticket 2046's four, plus the metrics token docs/deployment.md asks for.
# 32 random bytes as 64 hex characters, matching `openssl rand -hex 32`.
locals {
  generated_secret_keys = [
    "DOWNLOAD_SIGNING_SECRET",
    "USER_API_KEYS_ENCRYPTION_SECRET",
    "AUTH_HANDOFF_ENCRYPTION_SECRET",
    "MANIFEST_SIGNING_KEY",
    "METRICS_TOKEN",
  ]
}

resource "random_bytes" "generated" {
  for_each = toset(local.generated_secret_keys)

  length = 32
}

resource "aws_secretsmanager_secret" "generated" {
  name                    = "${var.name_prefix}/backend/generated"
  description             = "Backend secrets minted by Terraform: signing, encryption and metrics tokens. Rotate by tainting the matching random_bytes resource."
  recovery_window_in_days = var.recovery_window_in_days

  tags = { Name = "${var.name_prefix}-backend-generated" }
}

resource "aws_secretsmanager_secret_version" "generated" {
  secret_id = aws_secretsmanager_secret.generated.id
  secret_string = jsonencode({
    for key in local.generated_secret_keys : key => random_bytes.generated[key].hex
  })
}

# --- operator ----------------------------------------------------------------

# Deliberately no aws_secretsmanager_secret_version: the value is written by
# the operator (or by whoever they hand the values to) with
# `aws secretsmanager put-secret-value`, and Terraform must neither know it
# nor overwrite it on the next apply.
resource "aws_secretsmanager_secret" "operator" {
  name                    = "${var.name_prefix}/backend/operator"
  description             = "Backend secrets the operator holds: ${join(", ", var.operator_secret_keys)}. Set out of band; Terraform never writes this value."
  recovery_window_in_days = var.recovery_window_in_days

  tags = { Name = "${var.name_prefix}-backend-operator" }
}

# --- storage -----------------------------------------------------------------

resource "aws_secretsmanager_secret" "storage" {
  name                    = "${var.name_prefix}/backend/storage"
  description             = "Object storage access key minted by the storage module, as the R2_* variables the backend reads."
  recovery_window_in_days = var.recovery_window_in_days

  tags = { Name = "${var.name_prefix}-backend-storage" }
}

resource "aws_secretsmanager_secret_version" "storage" {
  secret_id = aws_secretsmanager_secret.storage.id
  secret_string = jsonencode({
    R2_ACCESS_KEY_ID     = var.storage_access_key_id
    R2_SECRET_ACCESS_KEY = var.storage_secret_access_key
  })
}
