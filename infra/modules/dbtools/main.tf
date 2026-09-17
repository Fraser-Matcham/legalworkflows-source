# Row 5.2 of the Stage 5 table (ticket 2113): the database-tools task. psql,
# pg_dump and pg_restore at the platform's PostgreSQL version, with this
# repository's schema, migrations and bootstrap baked in, run as a one-off
# Fargate task in the private subnets — the only place the RDS instance is
# reachable from. It bootstraps the roles, copies the Supabase database
# across, verifies the copy, and after the cutover applies migrations for
# the release pipeline. Nothing here runs on a schedule; every run is a
# person or the pipeline starting a task (infra/dbtools/run.sh).

resource "aws_ecr_repository" "dbtools" {
  name                 = "${var.name_prefix}-dbtools"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = { Name = "${var.name_prefix}-dbtools" }
}

resource "aws_ecr_lifecycle_policy" "dbtools" {
  repository = aws_ecr_repository.dbtools.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the ten most recent images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_cloudwatch_log_group" "dbtools" {
  name              = "/ecs/${var.name_prefix}-dbtools"
  retention_in_days = var.log_retention_days

  tags = { Name = "${var.name_prefix}-dbtools" }
}

# Where the Supabase database is copied from: the project's session-pooler
# connection string, which Stage 5, Task 2 writes here. Operator-held —
# Terraform creates the container and never writes the value. The direct
# database host is IPv6-only and unreachable through the NAT gateway; the
# pooler answers on IPv4.
resource "aws_secretsmanager_secret" "migration_source" {
  name                    = "${var.name_prefix}/platform/migration-source"
  description             = "SOURCE_DB_URL: the Supabase project's session-pooler connection string, read by the dbtools task's dump-restore and verify subcommands. Set out of band (Stage 5, Task 2); Terraform never writes this value."
  recovery_window_in_days = var.recovery_window_in_days

  tags = { Name = "${var.name_prefix}-platform-migration-source" }
}

locals {
  container_definition = {
    name      = "dbtools"
    image     = "${aws_ecr_repository.dbtools.repository_url}:${var.image_tag}"
    essential = true

    # No ports: nothing connects to this task.
    environment = [
      { name = "DATABASE_HOST", value = var.database_address },
      { name = "DATABASE_PORT", value = tostring(var.database_port) },
      { name = "DATABASE_NAME", value = var.database_name },
      { name = "DATABASE_MASTER_SECRET_ARN", value = var.database_master_secret_arn },
      { name = "DATABASE_ROLES_SECRET_ARN", value = var.database_roles_secret_arn },
      { name = "SOURCE_DB_SECRET_ARN", value = aws_secretsmanager_secret.migration_source.arn },
      { name = "LAST_MIGRATION_PARAM", value = var.last_migration_parameter_name },
      { name = "AWS_DEFAULT_REGION", value = var.region },
    ]

    # The secrets are read by the task itself (task role), not injected by
    # ECS: the master password is rotated by RDS and must be read at run
    # time, and the source URL should never sit in a task definition.
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.dbtools.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "dbtools"
      }
    }

    readonlyRootFilesystem = false
    linuxParameters = {
      initProcessEnabled = true
    }
  }
}

resource "aws_ecs_task_definition" "dbtools" {
  family                   = "${var.name_prefix}-dbtools"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.cpu)
  memory                   = tostring(var.memory)
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([local.container_definition])

  tags = { Name = "${var.name_prefix}-dbtools" }
}
