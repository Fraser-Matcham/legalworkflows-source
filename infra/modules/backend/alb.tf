# The load balancer sits in the public subnets with a public address, and is
# reachable only from CloudFront: the network module's security group admits
# CloudFront's prefix list alone, and the listener below refuses anything
# without this distribution's secret origin header. Two gates, because the
# prefix list admits every CloudFront distribution in the world and the header
# is what says "ours".
resource "random_password" "origin_verify" {
  length  = 40
  special = false
}

resource "aws_lb" "this" {
  name               = "${var.short_name_prefix}-alb"
  load_balancer_type = "application"
  internal           = false
  subnets            = var.public_subnet_ids
  security_groups    = [var.alb_security_group_id]

  idle_timeout               = var.alb_idle_timeout_seconds
  drop_invalid_header_fields = true
  # Every request arrives via CloudFront, which already imposes its own limits;
  # desync mitigation stays at the default ("defensive").

  tags = { Name = "${var.name_prefix}-alb" }
}

resource "aws_lb_target_group" "backend" {
  # Short prefix: the ELB API caps this at 32 characters (infra/locals.tf).
  name        = "${var.short_name_prefix}-backend"
  port        = var.container_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  # /health is "process alive" and /ready is "dependencies reachable"
  # (docs/deployment.md). The load balancer checks the first: a Supabase blip
  # must not make the ALB cycle every task, which would turn a dependency
  # outage into a full outage. Readiness gates deploys, in Stage 4.
  health_check {
    path                = "/health"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  # Draining connections at deploy: long enough for an in-flight SSE turn to
  # finish, short enough that a deploy does not sit for the default five
  # minutes.
  deregistration_delay = 60

  tags = { Name = "${var.name_prefix}-backend" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  # Anything that did not come through our CloudFront distribution — and so
  # lacks the header the rules below require — gets a bare 403.
  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "text/plain"
      message_body = "Forbidden"
      status_code  = "403"
    }
  }

  tags = { Name = "${var.name_prefix}-https" }
}

# CloudFront adds two headers per origin: X-Origin-Verify proves the request
# came through this distribution; X-Origin-Target says which service the
# behaviour was for, because the /api prefix is stripped at the edge and the
# path alone no longer says. The frontend module adds the matching rule for
# its own target group.
resource "aws_lb_listener_rule" "backend" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend.arn
  }

  condition {
    http_header {
      http_header_name = "X-Origin-Verify"
      values           = [random_password.origin_verify.result]
    }
  }

  condition {
    http_header {
      http_header_name = "X-Origin-Target"
      values           = ["backend"]
    }
  }

  tags = { Name = "${var.name_prefix}-backend" }
}

# origin.<domain> -> the load balancer. This is the hostname CloudFront is
# configured to connect to, and the one the certificate covers.
resource "aws_route53_record" "origin" {
  zone_id = var.zone_id
  name    = var.origin_fqdn
  type    = "A"

  alias {
    name                   = aws_lb.this.dns_name
    zone_id                = aws_lb.this.zone_id
    evaluate_target_health = false
  }
}
