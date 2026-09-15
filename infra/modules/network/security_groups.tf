# The reachability contract, in three groups:
#
#   CloudFront --443--> alb --backend_port--> backend
#                           --frontend_port--> frontend
#
# Nothing else reaches the load balancer, and nothing reaches a task except
# the load balancer. Rules are separate resources rather than inline blocks so
# a later module can add one without rewriting the group.

# CloudFront publishes the address ranges its origin-facing servers use as a
# managed prefix list. Admitting only that list is what makes the load
# balancer effectively internal even though it sits in a public subnet with a
# public address — the address is reachable, but every packet not from
# CloudFront is dropped at the security group. The `frontend` module adds a
# secret origin header on top, so a request must also come through *this*
# distribution, not any CloudFront distribution.
data "aws_ec2_managed_prefix_list" "cloudfront_origin_facing" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "alb" {
  name        = "${var.name_prefix}-alb"
  description = "Load balancer: HTTPS from CloudFront only."
  vpc_id      = aws_vpc.this.id

  tags = { Name = "${var.name_prefix}-alb" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "alb_https_from_cloudfront" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTPS from CloudFront origin-facing ranges"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront_origin_facing.id
}

resource "aws_vpc_security_group_egress_rule" "alb_to_backend" {
  security_group_id            = aws_security_group.alb.id
  description                  = "To backend tasks"
  ip_protocol                  = "tcp"
  from_port                    = var.backend_port
  to_port                      = var.backend_port
  referenced_security_group_id = aws_security_group.backend.id
}

resource "aws_vpc_security_group_egress_rule" "alb_to_frontend" {
  security_group_id            = aws_security_group.alb.id
  description                  = "To frontend tasks"
  ip_protocol                  = "tcp"
  from_port                    = var.frontend_port
  to_port                      = var.frontend_port
  referenced_security_group_id = aws_security_group.frontend.id
}

resource "aws_security_group" "backend" {
  name        = "${var.name_prefix}-backend"
  description = "Backend tasks: traffic from the load balancer only."
  vpc_id      = aws_vpc.this.id

  tags = { Name = "${var.name_prefix}-backend" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "backend_from_alb" {
  security_group_id            = aws_security_group.backend.id
  description                  = "From the load balancer"
  ip_protocol                  = "tcp"
  from_port                    = var.backend_port
  to_port                      = var.backend_port
  referenced_security_group_id = aws_security_group.alb.id
}

# Outbound is open: Supabase, the model providers, ECR image pulls and
# CloudWatch are all reached over HTTPS to addresses that change, and S3 goes
# via the gateway endpoint. Narrowing this to 443 would be reasonable later;
# Postgres is not spoken directly (the backend uses Supabase's HTTP API), so
# 5432 is not needed.
resource "aws_vpc_security_group_egress_rule" "backend_all" {
  security_group_id = aws_security_group.backend.id
  description       = "All outbound"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_security_group" "frontend" {
  name        = "${var.name_prefix}-frontend"
  description = "Frontend tasks: traffic from the load balancer only."
  vpc_id      = aws_vpc.this.id

  tags = { Name = "${var.name_prefix}-frontend" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "frontend_from_alb" {
  security_group_id            = aws_security_group.frontend.id
  description                  = "From the load balancer"
  ip_protocol                  = "tcp"
  from_port                    = var.frontend_port
  to_port                      = var.frontend_port
  referenced_security_group_id = aws_security_group.alb.id
}

# The frontend's server side calls the backend through the load balancer
# (API_BASE_URL) and pulls its image from ECR; both are outbound HTTPS/HTTP to
# changing addresses, so the same open-egress reasoning as the backend applies.
resource "aws_vpc_security_group_egress_rule" "frontend_all" {
  security_group_id = aws_security_group.frontend.id
  description       = "All outbound"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}
