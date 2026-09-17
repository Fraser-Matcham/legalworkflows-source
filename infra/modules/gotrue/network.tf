# Reachability: the load balancer reaches the API port; the backend reaches it
# over Service Connect; the task reaches the database on 5432, SES on 587,
# and HTTPS for the image pull, CloudWatch and Google's token endpoint.
resource "aws_security_group" "gotrue" {
  name        = "${var.name_prefix}-gotrue"
  description = "GoTrue tasks: from the load balancer and the backend only."
  vpc_id      = var.vpc_id

  tags = { Name = "${var.name_prefix}-gotrue" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "api_from_alb" {
  security_group_id            = aws_security_group.gotrue.id
  description                  = "API and health checks from the load balancer"
  ip_protocol                  = "tcp"
  from_port                    = var.container_port
  to_port                      = var.container_port
  referenced_security_group_id = var.alb_security_group_id
}

resource "aws_vpc_security_group_ingress_rule" "api_from_backend" {
  security_group_id            = aws_security_group.gotrue.id
  description                  = "API from backend tasks over Service Connect"
  ip_protocol                  = "tcp"
  from_port                    = var.container_port
  to_port                      = var.container_port
  referenced_security_group_id = var.backend_security_group_id
}

resource "aws_vpc_security_group_egress_rule" "to_database" {
  security_group_id            = aws_security_group.gotrue.id
  description                  = "PostgreSQL"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = var.database_security_group_id
}

resource "aws_vpc_security_group_egress_rule" "smtp" {
  security_group_id = aws_security_group.gotrue.id
  description       = "SMTP submission to SES"
  ip_protocol       = "tcp"
  from_port         = var.smtp_port
  to_port           = var.smtp_port
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "https" {
  security_group_id = aws_security_group.gotrue.id
  description       = "HTTPS: image pull, CloudWatch, Google OAuth"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_gotrue" {
  security_group_id            = var.alb_security_group_id
  description                  = "To GoTrue tasks"
  ip_protocol                  = "tcp"
  from_port                    = var.container_port
  to_port                      = var.container_port
  referenced_security_group_id = aws_security_group.gotrue.id
}

resource "aws_vpc_security_group_ingress_rule" "database_from_gotrue" {
  security_group_id            = var.database_security_group_id
  description                  = "PostgreSQL from GoTrue tasks"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.gotrue.id
}

# --- load balancer ------------------------------------------------------------------

resource "aws_lb_target_group" "gotrue" {
  name        = "${var.short_name_prefix}-gotrue"
  port        = var.container_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  # GoTrue's /health is process liveness — it does not touch the database.
  # A database outage should page through the readiness alarm, not cycle the
  # auth tasks; the backend module makes the same choice for the same reason.
  health_check {
    path                = "/health"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  deregistration_delay = 30

  tags = { Name = "${var.name_prefix}-gotrue" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_lb_listener_rule" "gotrue" {
  listener_arn = var.https_listener_arn
  priority     = var.listener_rule_priority

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.gotrue.arn
  }

  condition {
    http_header {
      http_header_name = "X-Origin-Verify"
      values           = [var.origin_verify_secret]
    }
  }

  condition {
    http_header {
      http_header_name = "X-Origin-Target"
      values           = ["gotrue"]
    }
  }

  tags = { Name = "${var.name_prefix}-gotrue" }
}
