# Row 5.3 of the Stage 5 table (tickets 2114, 2115): PostgREST as a Fargate
# service on the existing cluster. The backend's 556 `.from(...)` call sites
# speak PostgREST's protocol; running it ourselves keeps every one of them
# working against the RDS database with no application change.

resource "aws_cloudwatch_log_group" "postgrest" {
  name              = "/ecs/${var.name_prefix}-postgrest"
  retention_in_days = var.log_retention_days

  tags = { Name = "${var.name_prefix}-postgrest" }
}

locals {
  environment = merge(
    {
      # The same settings docker-compose.yml runs locally, plus the admin
      # server for health checks and a pool size for a shared t4g.small.
      PGRST_DB_SCHEMAS                  = "public"
      PGRST_DB_ANON_ROLE                = "anon"
      PGRST_DB_POOL                     = tostring(var.db_pool)
      PGRST_DB_POOL_ACQUISITION_TIMEOUT = "10"
      PGRST_SERVER_HOST                 = "!4"
      PGRST_SERVER_PORT                 = tostring(var.container_port)
      PGRST_ADMIN_SERVER_PORT           = tostring(var.admin_port)
      PGRST_LOG_LEVEL                   = "warn"
      PGRST_OPENAPI_MODE                = "disabled"
      PGRST_DB_PREPARED_STATEMENTS      = "true"
    },
    var.extra_environment,
  )

  container_definition = {
    name      = "postgrest"
    image     = var.image
    essential = true

    portMappings = [
      {
        name          = "http"
        containerPort = var.container_port
        protocol      = "tcp"
        appProtocol   = "http"
      },
      {
        name          = "admin"
        containerPort = var.admin_port
        protocol      = "tcp"
      },
    ]

    environment = [for k, v in local.environment : { name = k, value = v }]
    secrets = [
      { name = "PGRST_DB_URI", valueFrom = "${var.database_uri_secret_arn}:AUTHENTICATOR_URI::" },
      { name = "PGRST_JWT_SECRET", valueFrom = var.jwt_secret_valuefrom },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.postgrest.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "postgrest"
      }
    }

    # The image is built from scratch: one static binary, no shell, nothing
    # to write. Read-only is free here.
    readonlyRootFilesystem = true
    linuxParameters = {
      initProcessEnabled = false
    }
  }
}

resource "aws_ecs_task_definition" "postgrest" {
  family                   = "${var.name_prefix}-postgrest"
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

  tags = { Name = "${var.name_prefix}-postgrest" }
}

resource "aws_ecs_service" "postgrest" {
  name            = "${var.name_prefix}-postgrest"
  cluster         = var.cluster_arn
  task_definition = aws_ecs_task_definition.postgrest.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  enable_execute_command = var.enable_ecs_exec

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.postgrest.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.postgrest.arn
    container_name   = "postgrest"
    container_port   = var.container_port
  }

  # Schema cache load on a 50-table database is seconds, not minutes.
  health_check_grace_period_seconds = 30

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # Published as http://postgrest:<port> in the cluster's namespace so the
  # backend could reach it without leaving the VPC. Production traffic goes
  # through the edge today (README, "Why through the edge"); the name is the
  # honest value for an internal path rather than a decoy.
  service_connect_configuration {
    enabled   = true
    namespace = var.service_connect_namespace_arn

    service {
      port_name      = "http"
      discovery_name = "postgrest"

      client_alias {
        port     = var.container_port
        dns_name = "postgrest"
      }
    }
  }

  # Unlike the backend and frontend, nothing deploys PostgREST outside
  # Terraform: the image is a pinned upstream release, so a new revision is
  # an edit here. Autoscaling still owns desired_count.
  lifecycle {
    ignore_changes = [desired_count]
  }

  depends_on = [aws_lb_listener_rule.postgrest]

  tags = { Name = "${var.name_prefix}-postgrest" }
}

# --- autoscaling ----------------------------------------------------------------

resource "aws_appautoscaling_target" "postgrest" {
  service_namespace  = "ecs"
  resource_id        = "service/${var.cluster_name}/${aws_ecs_service.postgrest.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.desired_count
  max_capacity       = var.max_count
}

resource "aws_appautoscaling_policy" "postgrest_cpu" {
  name               = "${var.name_prefix}-postgrest-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.postgrest.service_namespace
  resource_id        = aws_appautoscaling_target.postgrest.resource_id
  scalable_dimension = aws_appautoscaling_target.postgrest.scalable_dimension

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 70
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
