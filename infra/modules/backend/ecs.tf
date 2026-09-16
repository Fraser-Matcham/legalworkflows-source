resource "aws_ecs_cluster" "this" {
  name = var.name_prefix

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = { Name = var.name_prefix }
}

resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name       = aws_ecs_cluster.this.name
  capacity_providers = ["FARGATE"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

# Service Connect gives the frontend a private name for the backend
# (http://backend:<port>) without going out through CloudFront and back in
# through the load balancer. Production traffic does not use it — CloudFront
# routes /api to the ALB directly — but the frontend's server-side proxy
# (frontend/src/app/api/[...path]/route.ts) needs a working API_BASE_URL to
# start at all, and this makes that a real address rather than a decoy.
resource "aws_service_discovery_http_namespace" "this" {
  name        = "${var.name_prefix}.local"
  description = "Service Connect namespace for ${var.name_prefix}"

  tags = { Name = "${var.name_prefix}.local" }
}

# The frontend tasks reach the backend directly on that path, so the backend
# group must admit them. The network module owns the groups; this is the
# one extra rule the design there anticipated a later module adding.
resource "aws_vpc_security_group_ingress_rule" "backend_from_frontend" {
  security_group_id            = var.backend_security_group_id
  description                  = "From frontend tasks over Service Connect"
  ip_protocol                  = "tcp"
  from_port                    = var.container_port
  to_port                      = var.container_port
  referenced_security_group_id = var.frontend_security_group_id
}

# Created here rather than in the observability module so it exists before
# the first task tries to write to it: the awslogs driver does not create
# groups, and a task whose log group is missing fails to start. The
# observability module attaches its alarms to this group by name.
resource "aws_cloudwatch_log_group" "backend" {
  name              = "/ecs/${var.name_prefix}-backend"
  retention_in_days = var.log_retention_days

  tags = { Name = "${var.name_prefix}-backend" }
}

locals {
  secret_keys = distinct(concat(var.secret_keys, var.extra_secret_keys))

  # Non-secret configuration. Production values are the ones docs/deployment.md
  # records; anything absent falls back to the backend's own defaults.
  environment = merge(
    {
      NODE_ENV = "production"
      PORT     = tostring(var.container_port)
      # CloudFront then the ALB each append to X-Forwarded-For. Two hops back is
      # the client, which is what the per-IP rate limiters must key on.
      TRUST_PROXY_HOPS = "2"

      FRONTEND_URL   = "https://${var.domain_name}"
      API_PUBLIC_URL = "https://${var.domain_name}/api"

      SUPABASE_URL             = var.supabase_url
      SUPABASE_PUBLISHABLE_KEY = var.supabase_publishable_key

      R2_ENDPOINT_URL = var.storage_endpoint_url
      R2_BUCKET_NAME  = var.storage_bucket_name
      # Real S3 rejects R2's "auto" at signature verification
      # (backend/src/lib/storageRegion.ts).
      R2_REGION = var.region

      MIKE_WORKFLOWS_REPOSITORY = var.workflows_repository
      MIKE_WORKFLOWS_REF        = var.workflows_ref

      ERROR_TRACKING_ENVIRONMENT = "production"
      ERROR_TRACKING_RELEASE     = var.image_tag
      ERROR_TRACKING_SERVER_NAME = "${var.name_prefix}-backend"
    },
    { for k, v in var.rate_limits : k => tostring(v) },
    var.extra_environment,
  )

  container_definition = {
    name      = "backend"
    image     = "${aws_ecr_repository.backend.repository_url}:${var.image_tag}"
    essential = true

    portMappings = [{
      # The name is what Service Connect publishes.
      name          = "http"
      containerPort = var.container_port
      protocol      = "tcp"
      appProtocol   = "http"
    }]

    environment = [for k, v in local.environment : { name = k, value = v }]
    secrets     = [for k in local.secret_keys : { name = k, valueFrom = var.ecs_secrets[k] }]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.backend.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "backend"
      }
    }

    # LibreOffice writes temp files; nothing else needs a writable root.
    readonlyRootFilesystem = false
    linuxParameters = {
      initProcessEnabled = true
    }
  }
}

resource "aws_ecs_task_definition" "backend" {
  family                   = "${var.name_prefix}-backend"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.cpu)
  memory                   = tostring(var.memory)
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([local.container_definition])

  lifecycle {
    # A key the secrets module does not map would otherwise fail at plan time
    # with an opaque index error; say which key, and where it has to be added.
    precondition {
      condition     = alltrue([for k in local.secret_keys : contains(keys(var.ecs_secrets), k)])
      error_message = "Every secret key must be mapped by the secrets module's backend_ecs_secrets output. Unmapped: ${join(", ", [for k in local.secret_keys : k if !contains(keys(var.ecs_secrets), k)])}."
    }
  }

  tags = { Name = "${var.name_prefix}-backend" }
}

resource "aws_ecs_service" "backend" {
  name            = "${var.name_prefix}-backend"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.backend.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  # ECS Exec (the secrets module grants the task role what it needs).
  # Off by default — see the root `enable_ecs_exec` variable.
  enable_execute_command = var.enable_ecs_exec

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.backend_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.backend.arn
    container_name   = "backend"
    container_port   = var.container_port
  }

  # The image carries LibreOffice and is slow to pull and start; give a new
  # task time before the ALB's health check can count against it.
  health_check_grace_period_seconds = 120

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  # A deploy whose tasks keep failing health checks rolls itself back to the
  # last good task definition rather than flapping indefinitely.
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  service_connect_configuration {
    enabled   = true
    namespace = aws_service_discovery_http_namespace.this.arn

    service {
      port_name      = "http"
      discovery_name = "backend"

      client_alias {
        port     = var.container_port
        dns_name = "backend"
      }
    }
  }

  # Deploys (Stage 4) register new task definition revisions and update the
  # service outside Terraform; autoscaling adjusts desired_count. Neither is
  # drift Terraform should undo on the next apply. Changing cpu/memory/env
  # here still produces a new revision and rolls it out — Terraform simply
  # stops insisting on its own revision being the live one.
  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }

  depends_on = [aws_lb_listener.https]

  tags = { Name = "${var.name_prefix}-backend" }
}

# --- autoscaling ----------------------------------------------------------------

resource "aws_appautoscaling_target" "backend" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.backend.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.desired_count
  max_capacity       = var.max_count
}

resource "aws_appautoscaling_policy" "backend_cpu" {
  name               = "${var.name_prefix}-backend-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.backend.service_namespace
  resource_id        = aws_appautoscaling_target.backend.resource_id
  scalable_dimension = aws_appautoscaling_target.backend.scalable_dimension

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 70
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
