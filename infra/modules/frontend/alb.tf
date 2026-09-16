resource "aws_lb_target_group" "frontend" {
  # Short prefix: the ELB API caps this at 32 characters (infra/locals.tf).
  name        = "${var.short_name_prefix}-frontend"
  port        = var.container_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  # Next has no dedicated health route, so the check renders the home page.
  # Anything the server answers coherently — including a redirect to the
  # sign-in page — counts as healthy; a 5xx or a hang does not. The startup
  # guard (frontend/src/instrumentation.ts) exits the process on a fatal
  # misconfiguration, so a misconfigured task never becomes healthy here and
  # the circuit breaker rolls the deploy back.
  health_check {
    path                = "/"
    matcher             = "200-399"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  deregistration_delay = 30

  tags = { Name = "${var.name_prefix}-frontend" }

  lifecycle {
    create_before_destroy = true
  }
}

# The counterpart to the backend module's rule: same secret header, a
# different target header. The default action on the listener stays a 403.
resource "aws_lb_listener_rule" "frontend" {
  listener_arn = var.https_listener_arn
  priority     = 20

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.frontend.arn
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
      values           = ["frontend"]
    }
  }

  tags = { Name = "${var.name_prefix}-frontend" }
}
