output "vpc_id" {
  value = aws_vpc.this.id
}

output "vpc_cidr" {
  value = aws_vpc.this.cidr_block
}

output "availability_zones" {
  description = "Zones the subnets were created in, in subnet index order."
  value       = local.azs
}

output "public_subnet_ids" {
  description = "For the load balancer."
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "For the ECS services."
  value       = aws_subnet.private[*].id
}

output "nat_gateway_public_ips" {
  description = "Source addresses of all outbound traffic from the private subnets. Useful if a third party (Supabase network restrictions, a provider allow-list) wants a fixed egress address."
  value       = aws_eip.nat[*].public_ip
}

output "alb_security_group_id" {
  value = aws_security_group.alb.id
}

output "backend_security_group_id" {
  value = aws_security_group.backend.id
}

output "frontend_security_group_id" {
  value = aws_security_group.frontend.id
}
