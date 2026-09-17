# Row 5.4 of the Stage 5 table (tickets 2116, 2117), with 5.5 (SES email,
# 2118) and 5.6 (Google sign-in, 2119): GoTrue as a Fargate service. Auth is
# the part that would have been expensive to replace — sessions, JWT
# issuance, MFA, password reset and the Google provider are all what the
# application already expects — so it runs the same release the local stack
# does, configured for the public origin.

resource "aws_cloudwatch_log_group" "gotrue" {
  name              = "/ecs/${var.name_prefix}-gotrue"
  retention_in_days = var.log_retention_days

  tags = { Name = "${var.name_prefix}-gotrue" }
}

locals {
  origin = "https://${var.domain_name}"

  environment = merge(
    {
      GOTRUE_API_HOST = "0.0.0.0"
      GOTRUE_API_PORT = tostring(var.container_port)

      # Every link GoTrue puts in an email is API_EXTERNAL_URL + the mailer
      # path, so the two together must be the address the edge routes to
      # GoTrue: https://<domain>/auth/v1/verify (ticket 2123 strips the
      # prefix). The same shape hosted Supabase uses.
      API_EXTERNAL_URL                    = local.origin
      GOTRUE_MAILER_URLPATHS_CONFIRMATION = "/auth/v1/verify"
      GOTRUE_MAILER_URLPATHS_RECOVERY     = "/auth/v1/verify"
      GOTRUE_MAILER_URLPATHS_INVITE       = "/auth/v1/verify"
      GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE = "/auth/v1/verify"

      GOTRUE_DB_DRIVER = "postgres"

      # Where users land after a link, and the only places a redirectTo may
      # name. The backend builds its callbacks on the request origin
      # (backend/src/routes/auth.ts, callbackUrl), so one glob on the domain
      # covers /auth/callback, /reset-password and the add-in's
      # /oauth-dialog.html when the add-in is served from the same origin.
      GOTRUE_SITE_URL       = local.origin
      GOTRUE_URI_ALLOW_LIST = join(",", concat(["${local.origin}/**"], var.extra_redirect_urls))

      GOTRUE_JWT_EXP                = tostring(var.jwt_expiry_seconds)
      GOTRUE_JWT_AUD                = "authenticated"
      GOTRUE_JWT_DEFAULT_GROUP_NAME = "authenticated"
      GOTRUE_JWT_ADMIN_ROLES        = "service_role"

      GOTRUE_DISABLE_SIGNUP                   = var.disable_signup ? "true" : "false"
      GOTRUE_PASSWORD_MIN_LENGTH              = tostring(var.password_min_length)
      GOTRUE_EXTERNAL_EMAIL_ENABLED           = "true"
      GOTRUE_EXTERNAL_PHONE_ENABLED           = "false"
      GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED = "false"

      # Production email: confirmation required (docs/deployment.md, "Enable
      # email confirmation for production signups"), and an email change
      # confirmed from both addresses.
      GOTRUE_MAILER_AUTOCONFIRM                 = "false"
      GOTRUE_MAILER_SECURE_EMAIL_CHANGE_ENABLED = "true"

      # Ticket 2118: SES, on the credential the email module minted. Port 587
      # is STARTTLS, which GoTrue's mailer negotiates; SES refuses plaintext.
      GOTRUE_SMTP_HOST        = var.smtp_host
      GOTRUE_SMTP_PORT        = tostring(var.smtp_port)
      GOTRUE_SMTP_ADMIN_EMAIL = var.sender_address
      GOTRUE_SMTP_SENDER_NAME = var.sender_name

      # MFA (TOTP) as the application uses it: enrol, verify, unenrol.
      GOTRUE_MFA_TOTP_ENROLL_ENABLED  = "true"
      GOTRUE_MFA_TOTP_VERIFY_ENABLED  = "true"
      GOTRUE_MFA_MAX_ENROLLED_FACTORS = "10"

      # Refresh-token rotation with a short reuse window, as hosted Supabase.
      GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED = "true"
      GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL   = "10"

      # Ticket 2119: the Google provider. Its client id and secret are
      # injected as secrets below when enabled.
      GOTRUE_EXTERNAL_GOOGLE_ENABLED      = var.google_oauth_enabled ? "true" : "false"
      GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI = "${local.origin}/auth/v1/callback"

      GOTRUE_LOG_LEVEL = "info"
    },
    var.extra_environment,
  )

  secrets = concat(
    [
      { name = "GOTRUE_DB_DATABASE_URL", valueFrom = "${var.database_uri_secret_arn}:AUTH_ADMIN_URI::" },
      { name = "GOTRUE_JWT_SECRET", valueFrom = var.jwt_secret_valuefrom },
      { name = "GOTRUE_SMTP_USER", valueFrom = "${var.smtp_secret_arn}:SMTP_USERNAME::" },
      { name = "GOTRUE_SMTP_PASS", valueFrom = "${var.smtp_secret_arn}:SMTP_PASSWORD::" },
    ],
    var.google_oauth_enabled ? [
      { name = "GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID", valueFrom = "${aws_secretsmanager_secret.google_oauth.arn}:GOOGLE_CLIENT_ID::" },
      { name = "GOTRUE_EXTERNAL_GOOGLE_SECRET", valueFrom = "${aws_secretsmanager_secret.google_oauth.arn}:GOOGLE_CLIENT_SECRET::" },
    ] : [],
  )

  container_definition = {
    name      = "gotrue"
    image     = var.image
    essential = true

    portMappings = [{
      name          = "http"
      containerPort = var.container_port
      protocol      = "tcp"
      appProtocol   = "http"
    }]

    environment = [for k, v in local.environment : { name = k, value = v }]
    secrets     = local.secrets

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.gotrue.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "gotrue"
      }
    }

    readonlyRootFilesystem = true
    linuxParameters = {
      initProcessEnabled = true
    }
  }
}

resource "aws_ecs_task_definition" "gotrue" {
  family                   = "${var.name_prefix}-gotrue"
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

  tags = { Name = "${var.name_prefix}-gotrue" }
}

resource "aws_ecs_service" "gotrue" {
  name            = "${var.name_prefix}-gotrue"
  cluster         = var.cluster_arn
  task_definition = aws_ecs_task_definition.gotrue.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  enable_execute_command = var.enable_ecs_exec

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.gotrue.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.gotrue.arn
    container_name   = "gotrue"
    container_port   = var.container_port
  }

  # GoTrue runs its own schema migrations at start; on an empty auth schema
  # that is a few seconds, on a restored one it is a no-op.
  health_check_grace_period_seconds = 60

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  service_connect_configuration {
    enabled   = true
    namespace = var.service_connect_namespace_arn

    service {
      port_name      = "http"
      discovery_name = "gotrue"

      client_alias {
        port     = var.container_port
        dns_name = "gotrue"
      }
    }
  }

  # As PostgREST: the image is a pinned release and deploys are an edit here.
  lifecycle {
    ignore_changes = [desired_count]
  }

  depends_on = [aws_lb_listener_rule.gotrue]

  tags = { Name = "${var.name_prefix}-gotrue" }
}

# --- autoscaling ----------------------------------------------------------------

resource "aws_appautoscaling_target" "gotrue" {
  service_namespace  = "ecs"
  resource_id        = "service/${var.cluster_name}/${aws_ecs_service.gotrue.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.desired_count
  max_capacity       = var.max_count
}

resource "aws_appautoscaling_policy" "gotrue_cpu" {
  name               = "${var.name_prefix}-gotrue-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.gotrue.service_namespace
  resource_id        = aws_appautoscaling_target.gotrue.resource_id
  scalable_dimension = aws_appautoscaling_target.gotrue.scalable_dimension

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 70
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
