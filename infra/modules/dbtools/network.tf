# Nothing reaches the task. The task reaches the database, the Supabase
# session pooler (PostgreSQL over the internet, for the copy and the
# verification), and HTTPS for the image, the log and the AWS APIs.
resource "aws_security_group" "dbtools" {
  name        = "${var.name_prefix}-dbtools"
  description = "Database-tools tasks: no ingress; PostgreSQL and HTTPS out."
  vpc_id      = var.vpc_id

  tags = { Name = "${var.name_prefix}-dbtools" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_egress_rule" "to_database" {
  security_group_id            = aws_security_group.dbtools.id
  description                  = "PostgreSQL: the RDS instance"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = var.database_security_group_id
}

# The Supabase session pooler listens on 5432 (session mode) and 6543
# (transaction mode); pg_dump needs session mode. Until Stage 5, Task 6
# deletes the project this is the copy's source; afterwards the rule is
# harmless and can be removed.
resource "aws_vpc_security_group_egress_rule" "to_source" {
  security_group_id = aws_security_group.dbtools.id
  description       = "PostgreSQL: the Supabase session pooler, for the copy"
  ip_protocol       = "tcp"
  from_port         = 5432
  to_port           = 5432
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "https" {
  security_group_id = aws_security_group.dbtools.id
  description       = "HTTPS: image pull, CloudWatch, Secrets Manager, SSM"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "database_from_dbtools" {
  security_group_id            = var.database_security_group_id
  description                  = "PostgreSQL from database-tools tasks"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.dbtools.id
}
