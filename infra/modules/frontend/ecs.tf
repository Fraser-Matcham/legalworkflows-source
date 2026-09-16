resource "aws_cloudwatch_log_group" "frontend" {
  name              = "/ecs/${var.name_prefix}-frontend"
  retention_in_days = var.log_retention_days

  tags = { Name = "${var.name_prefix}-frontend" }
}

locals {
  # The frontend's whole contract is three variables (frontend/.env.example);
  # nothing here is secret and the execution role could not fetch one anyway.
  environment = merge(
    {
      NODE_ENV = "production"
      PORT     = tostring(var.container_port)
      HOSTNAME = "0.0.0.0"

      # Server-side calls only. Browsers use the relative /api path, which
      # CloudFront routes to the backend on the same origin (cloudfront.tf).
      API_BASE_URL = var.api_base_url

      # Next inlines NEXT_PUBLIC_* at build time, so the value that reaches
      # the browser bundle is the one the Stage 4 build passes as a build
      # argument. Setting it here as well keeps the runtime and the bundle in
      # agreement and satisfies the start-up guard's check.
      NEXT_PUBLIC_APP_URL = "https://${var.domain_name}"
    },
    var.extra_environment,
  )

  container_definition = {
    name      = "frontend"
    image     = "${aws_ecr_repository.frontend.repository_url}:${var.image_tag}"
    essential = true

    portMappings = [{
      name          = "http"
      containerPort = var.container_port
      protocol      = "tcp"
      appProtocol   = "http"
    }]

    environment = [for k, v in local.environment : { name = k, value = v }]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.frontend.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "frontend"
      }
    }

    # The standalone Next server needs to write nothing; the image already
    # runs as the unprivileged node user.
    readonlyRootFilesystem = false
    linuxParameters = {
      initProcessEnabled = true
    }
  }
}

resource "aws_ecs_task_definition" "frontend" {
  family                   = "${var.name_prefix}-frontend"
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

  tags = { Name = "${var.name_prefix}-frontend" }
}

resource "aws_ecs_service" "frontend" {
  name            = "${var.name_prefix}-frontend"
  cluster         = var.cluster_arn
  task_definition = aws_ecs_task_definition.frontend.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  enable_execute_command = true

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.frontend_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.frontend.arn
    container_name   = "frontend"
    container_port   = var.container_port
  }

  health_check_grace_period_seconds = 60

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # Client-side membership only — no `service` block — so the task can resolve
  # http://backend:<port> without publishing a name of its own. Nothing needs
  # to find the frontend except the load balancer.
  service_connect_configuration {
    enabled   = true
    namespace = var.service_connect_namespace_arn
  }

  # As for the backend: deploys and autoscaling own these two.
  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }

  depends_on = [aws_lb_listener_rule.frontend]

  tags = { Name = "${var.name_prefix}-frontend" }
}

# --- autoscaling ----------------------------------------------------------------

resource "aws_appautoscaling_target" "frontend" {
  service_namespace  = "ecs"
  resource_id        = "service/${var.cluster_name}/${aws_ecs_service.frontend.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.desired_count
  max_capacity       = var.max_count
}

resource "aws_appautoscaling_policy" "frontend_cpu" {
  name               = "${var.name_prefix}-frontend-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.frontend.service_namespace
  resource_id        = aws_appautoscaling_target.frontend.resource_id
  scalable_dimension = aws_appautoscaling_target.frontend.scalable_dimension

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 70
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
