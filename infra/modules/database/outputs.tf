output "instance_identifier" {
  description = "For the observability module's RDS alarms and the console."
  value       = aws_db_instance.this.identifier
}

output "instance_arn" {
  value = aws_db_instance.this.arn
}

output "address" {
  description = "Hostname of the instance, private to the VPC."
  value       = aws_db_instance.this.address
}

output "port" {
  value = aws_db_instance.this.port
}

output "db_name" {
  value = aws_db_instance.this.db_name
}

output "security_group_id" {
  description = "The PostgREST, GoTrue and database-tools modules add their own ingress rules against this group."
  value       = aws_security_group.database.id
}

output "kms_key_arn" {
  description = "Encrypts the volume, the backups and both credential secrets. A role that reads either secret needs kms:Decrypt on this key."
  value       = aws_kms_key.database.arn
}

output "master_user_secret_arn" {
  description = "The RDS-managed master credential (JSON with username and password). For the bootstrap and for a restore; no service reads it."
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
}

output "roles_secret_arn" {
  description = "Secret holding AUTHENTICATOR_URI and AUTH_ADMIN_URI, for the PostgREST and GoTrue task definitions."
  value       = aws_secretsmanager_secret.roles.arn
}

output "roles_secret_name" {
  value = aws_secretsmanager_secret.roles.name
}

output "bootstrap_sql_path" {
  description = "The role bootstrap to run once, as the master user, before anything is restored or any service starts. See README."
  value       = "${path.module}/bootstrap.sql"
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.postgresql.name
}
