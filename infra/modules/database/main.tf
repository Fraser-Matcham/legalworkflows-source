# Row 5.1 of the Stage 5 table (tickets 2111, 2112): the PostgreSQL instance
# that replaces the Supabase project's database. Everything that talks to it
# — PostgREST, GoTrue, the migration and restore tooling — runs as a task in
# the same private subnets; the backend itself keeps speaking HTTP to
# PostgREST and never opens a database connection.

resource "aws_db_subnet_group" "this" {
  name        = "${var.name_prefix}-database"
  description = "Private subnets for the ${var.name_prefix} database"
  subnet_ids  = var.private_subnet_ids

  tags = { Name = "${var.name_prefix}-database" }
}

# Three settings, each for a reason:
#   rds.force_ssl               every client speaks TLS or is refused; the
#                               PostgREST and GoTrue URIs carry sslmode=require
#   shared_preload_libraries    pg_stat_statements, so "what is slow" has an
#                               answer without guessing (static: needs a reboot,
#                               which the maintenance window provides)
#   log_min_duration_statement  slow statements reach the exported log group
resource "aws_db_parameter_group" "this" {
  name        = "${var.name_prefix}-postgres17"
  family      = "postgres17"
  description = "${var.name_prefix}: TLS required, pg_stat_statements, slow-query logging"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  parameter {
    name         = "shared_preload_libraries"
    value        = "pg_stat_statements"
    apply_method = "pending-reboot"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = tostring(var.slow_query_ms)
  }

  tags = { Name = "${var.name_prefix}-postgres17" }

  lifecycle {
    create_before_destroy = true
  }
}

# Exported PostgreSQL logs land here. Created before the instance for the same
# reason the backend module creates its own group: a missing group is an
# error at the first write, not at plan time.
resource "aws_cloudwatch_log_group" "postgresql" {
  name              = "/aws/rds/instance/${var.name_prefix}-db/postgresql"
  retention_in_days = var.log_retention_days

  tags = { Name = "${var.name_prefix}-db-postgresql" }
}

resource "aws_db_instance" "this" {
  identifier = "${var.name_prefix}-db"

  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class

  # The same database name and master username the Supabase project uses, so
  # a dump restores into the same names and every object owned by `postgres`
  # there is owned by `postgres` here. RDS's `postgres` is not a superuser
  # (it holds rds_superuser), which the bootstrap SQL allows for.
  db_name  = "postgres"
  username = "postgres"

  # RDS generates the master password and keeps it in Secrets Manager under
  # this module's key, rotating it on the schedule RDS chooses. Terraform never
  # sees the value, and nothing in the footprint reads it routinely: the
  # services use the narrower roles the bootstrap SQL creates, and the master
  # credential is for the bootstrap itself and for a restore.
  manage_master_user_password   = true
  master_user_secret_kms_key_id = aws_kms_key.database.key_id

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.database.id]
  parameter_group_name   = aws_db_parameter_group.this.name
  publicly_accessible    = false
  multi_az               = var.multi_az
  network_type           = "IPV4"

  storage_type          = "gp3"
  allocated_storage     = var.allocated_storage_gb
  max_allocated_storage = var.max_allocated_storage_gb
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.database.arn

  backup_retention_period   = var.backup_retention_days
  backup_window             = var.backup_window
  maintenance_window        = var.maintenance_window
  copy_tags_to_snapshot     = true
  delete_automated_backups  = false
  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.name_prefix}-db-final"

  # Minor versions carry security fixes and are backwards compatible within
  # the major; let AWS apply them in the maintenance window. A major upgrade
  # is a deliberate edit to engine_version, with the ignore below removed for
  # that one apply.
  auto_minor_version_upgrade  = true
  allow_major_version_upgrade = false
  apply_immediately           = false

  performance_insights_enabled          = true
  performance_insights_kms_key_id       = aws_kms_key.database.arn
  performance_insights_retention_period = 7
  enabled_cloudwatch_logs_exports       = ["postgresql"]

  # The 2048-bit RSA CA is what the PostgreSQL client libraries in the
  # PostgREST and GoTrue images verify against without extra bundles.
  ca_cert_identifier = "rds-ca-rsa2048-g1"

  tags = { Name = "${var.name_prefix}-db" }

  lifecycle {
    # See auto_minor_version_upgrade: the live minor moves without Terraform.
    ignore_changes = [engine_version]
  }

  depends_on = [aws_cloudwatch_log_group.postgresql]
}
