# Reachability, in one sentence: nothing reaches port 5432 except a task in a
# security group listed here or added by a later module, and the instance
# initiates nothing. There is no public address, no bastion and no allow-list
# of laptops: every administrative session goes through a task in the private
# subnets (the database-tools task, ticket 2113), which is what makes the
# session both recorded and impossible from a coffee shop.
resource "aws_security_group" "database" {
  name        = "${var.name_prefix}-database"
  description = "PostgreSQL: from the listed task security groups only."
  vpc_id      = var.vpc_id

  tags = { Name = "${var.name_prefix}-database" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "from_clients" {
  for_each = var.client_security_group_ids

  security_group_id            = aws_security_group.database.id
  description                  = "PostgreSQL from ${each.key} tasks"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = each.value
}

# No egress rule at all. An RDS instance makes no outbound connections of its
# own, and the default "allow all egress" a security group carries when it is
# created through the console is exactly what this module's explicit rules
# are meant to replace.
