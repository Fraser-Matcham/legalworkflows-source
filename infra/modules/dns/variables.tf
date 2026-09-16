variable "name_prefix" {
  description = "Prefix for every resource name in this module."
  type        = string
}

variable "domain_name" {
  description = "The apex: the public origin for both the frontend and the API (architecture.md, decision 5)."
  type        = string
}

variable "origin_subdomain" {
  description = <<-EOT
    Host label for the load balancer's own name, `<origin_subdomain>.<domain_name>`.
    CloudFront reaches the ALB over HTTPS and verifies the certificate against
    the origin hostname it was given; an ALB's default *.elb.amazonaws.com name
    has no certificate we control, so the ALB gets a name in our zone and a
    certificate for it. Users never see this name.
  EOT
  type        = string
  default     = "origin"

  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$", var.origin_subdomain))
    error_message = "origin_subdomain must be a single DNS label: lowercase letters, digits and hyphens."
  }
}
