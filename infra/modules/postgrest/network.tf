# Reachability: the load balancer reaches the API port (requests) and the
# admin port (health checks); the backend reaches the API port over Service
# Connect; the task reaches the database on 5432 and the public ECR gallery
# and CloudWatch over HTTPS. Nothing else, in either direction.
resource "aws_security_group" "postgrest" {
  name        = "${var.name_prefix}-postgrest"
  description = "PostgREST tasks: from the load balancer and the backend only."
  vpc_id      = var.vpc_id

  tags = { Name = "${var.name_prefix}-postgrest" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "api_from_alb" {
  security_group_id            = aws_security_group.postgrest.id
  description                  = "API from the load balancer"
  ip_protocol                  = "tcp"
  from_port                    = var.container_port
  to_port                      = var.container_port
  referenced_security_group_id = var.alb_security_group_id
}

resource "aws_vpc_security_group_ingress_rule" "admin_from_alb" {
  security_group_id            = aws_security_group.postgrest.id
  description                  = "Health checks from the load balancer"
  ip_protocol                  = "tcp"
  from_port                    = var.admin_port
  to_port                      = var.admin_port
  referenced_security_group_id = var.alb_security_group_id
}

resource "aws_vpc_security_group_ingress_rule" "api_from_backend" {
  security_group_id            = aws_security_group.postgrest.id
  description                  = "API from backend tasks over Service Connect"
  ip_protocol                  = "tcp"
  from_port                    = var.container_port
  to_port                      = var.container_port
  referenced_security_group_id = var.backend_security_group_id
}

resource "aws_vpc_security_group_egress_rule" "to_database" {
  security_group_id            = aws_security_group.postgrest.id
  description                  = "PostgreSQL"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = var.database_security_group_id
}

# Image pull from the public gallery and log delivery, both over HTTPS to
# addresses that change. Narrower than the backend's all-outbound because
# PostgREST calls no third party.
resource "aws_vpc_security_group_egress_rule" "https" {
  security_group_id = aws_security_group.postgrest.id
  description       = "HTTPS: image pull and CloudWatch"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

# The other side of each ingress rule above, on the groups other modules own.
resource "aws_vpc_security_group_egress_rule" "alb_to_postgrest_api" {
  security_group_id            = var.alb_security_group_id
  description                  = "To PostgREST tasks"
  ip_protocol                  = "tcp"
  from_port                    = var.container_port
  to_port                      = var.container_port
  referenced_security_group_id = aws_security_group.postgrest.id
}

resource "aws_vpc_security_group_egress_rule" "alb_to_postgrest_admin" {
  security_group_id            = var.alb_security_group_id
  description                  = "To PostgREST health checks"
  ip_protocol                  = "tcp"
  from_port                    = var.admin_port
  to_port                      = var.admin_port
  referenced_security_group_id = aws_security_group.postgrest.id
}

resource "aws_vpc_security_group_ingress_rule" "database_from_postgrest" {
  security_group_id            = var.database_security_group_id
  description                  = "PostgreSQL from PostgREST tasks"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.postgrest.id
}

# --- load balancer ------------------------------------------------------------------

resource "aws_lb_target_group" "postgrest" {
  name        = "${var.short_name_prefix}-postgrest"
  port        = var.container_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  # /ready on the admin port answers 200 only while PostgREST holds a working
  # connection to the database and has loaded the schema cache; /live would
  # keep a task with a dead pool in rotation. Unlike the backend, whose check
  # deliberately excludes its dependency, PostgREST *is* the dependency: a
  # task that cannot reach the database has nothing to serve.
  health_check {
    path                = "/ready"
    port                = tostring(var.admin_port)
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  deregistration_delay = 30

  tags = { Name = "${var.name_prefix}-postgrest" }

  lifecycle {
    create_before_destroy = true
  }
}

# Same two gates as the backend and frontend rules: the distribution's secret
# and the target header CloudFront sets for the /rest/v1 behaviour (frontend
# module, ticket 2123). The /rest/v1 prefix is stripped at the edge, so
# PostgREST sees the paths it expects.
resource "aws_lb_listener_rule" "postgrest" {
  listener_arn = var.https_listener_arn
  priority     = var.listener_rule_priority

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.postgrest.arn
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
      values           = ["postgrest"]
    }
  }

  tags = { Name = "${var.name_prefix}-postgrest" }
}
