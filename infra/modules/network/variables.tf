variable "name_prefix" {
  description = "Prefix for every resource name in this module."
  type        = string
}

variable "vpc_cidr" {
  description = "Address range for the VPC. /16 leaves room for the four /20 subnets below and anything added later."
  type        = string
  default     = "10.0.0.0/16"

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0)) && tonumber(split("/", var.vpc_cidr)[1]) <= 20
    error_message = "vpc_cidr must be a valid IPv4 CIDR no smaller than /20, so four /20 subnets fit."
  }
}

variable "availability_zone_count" {
  description = "How many availability zones to spread the subnets across. Two is the minimum an ALB accepts."
  type        = number
  default     = 2

  validation {
    condition     = var.availability_zone_count >= 2 && var.availability_zone_count <= 3
    error_message = "availability_zone_count must be 2 or 3."
  }
}

variable "single_nat_gateway" {
  description = <<-EOT
    true: one NAT gateway in the first public subnet, shared by every private
    subnet. Loses outbound internet for the private subnets if that one AZ
    fails, but costs one gateway rather than one per AZ — the trade
    architecture.md's cost table makes. Set false for one NAT per AZ once the
    service is worth the extra ~£30/month per gateway.
  EOT
  type        = bool
  default     = true
}

variable "backend_port" {
  description = "Port the backend container listens on (backend/Dockerfile EXPOSE)."
  type        = number
  default     = 3001
}

variable "frontend_port" {
  description = "Port the frontend container listens on (frontend/Dockerfile EXPOSE)."
  type        = number
  default     = 3000
}
