variable "project" {
  description = "Short project slug used as the prefix for every resource name."
  type        = string
  default     = "legalworkflows"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,30}$", var.project))
    error_message = "project must be 2-31 chars: lowercase letters, digits and hyphens, starting with a letter."
  }
}

variable "environment" {
  description = "Deployment environment. Production only for now (architecture.md, decision 3)."
  type        = string
  default     = "production"

  validation {
    condition     = contains(["production"], var.environment)
    error_message = "Only \"production\" exists yet. Add a value here when a second environment is created."
  }
}

variable "aws_region" {
  description = "Region for every regional resource. Decided in Stage 2, Task 7; London keeps client documents in the UK."
  type        = string
  default     = "eu-west-2"
}

variable "domain_name" {
  description = "Public origin for both the frontend and the API (architecture.md, decision 5: the bare domain, one origin)."
  type        = string
  default     = "legalworkflows.co.uk"
}

# --- network ---------------------------------------------------------------

variable "vpc_cidr" {
  description = "Address range for the VPC. See modules/network."
  type        = string
  default     = "10.0.0.0/16"
}

variable "single_nat_gateway" {
  description = "One NAT gateway shared across AZs (the cost-table default) rather than one per AZ. See modules/network/README.md."
  type        = bool
  default     = true
}
