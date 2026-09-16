variable "name_prefix" {
  description = "Prefix for every resource name in this module."
  type        = string
}

variable "region" {
  type = string
}

# --- placement -----------------------------------------------------------

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  description = "For the tasks."
  type        = list(string)
}

variable "frontend_security_group_id" {
  type = string
}

# --- identity --------------------------------------------------------------

variable "execution_role_arn" {
  description = "The frontend execution role: pulls the image and writes logs, and deliberately cannot read secrets (the frontend has none)."
  type        = string
}

variable "task_role_arn" {
  type = string
}

# --- the shared cluster, load balancer and namespace, from the backend module

variable "cluster_arn" {
  type = string
}

variable "cluster_name" {
  type = string
}

variable "service_connect_namespace_arn" {
  description = "Joined as a client only, so the task can resolve the backend's private name."
  type        = string
}

variable "api_base_url" {
  description = "API_BASE_URL for the server-side proxy: the backend's Service Connect address."
  type        = string
}

variable "https_listener_arn" {
  description = "The backend module's HTTPS listener; this module adds the frontend rule to it."
  type        = string
}

variable "origin_verify_secret" {
  description = "Value CloudFront sends in X-Origin-Verify; the listener rules require it."
  type        = string
  sensitive   = true
}

variable "origin_fqdn" {
  description = "The load balancer's hostname, which CloudFront connects to for both origins."
  type        = string
}

# --- edge ---------------------------------------------------------------------

variable "domain_name" {
  description = "The public origin. CloudFront's alias, the apex records, and NEXT_PUBLIC_APP_URL."
  type        = string
}

variable "zone_id" {
  type = string
}

variable "apex_certificate_arn" {
  description = "Validated certificate for domain_name in us-east-1, from the dns module. CloudFront accepts nothing from any other region."
  type        = string
}

variable "price_class" {
  description = "CloudFront edge footprint. PriceClass_100 is North America and Europe, where the users are; the others add edges (and cost) on continents that would only ever see the odd crawler."
  type        = string
  default     = "PriceClass_100"

  validation {
    condition     = contains(["PriceClass_100", "PriceClass_200", "PriceClass_All"], var.price_class)
    error_message = "price_class must be PriceClass_100, PriceClass_200 or PriceClass_All."
  }
}

variable "origin_read_timeout_seconds" {
  description = "How long CloudFront waits for the origin to send a byte. 60 is the maximum without a quota increase. SSE streams heartbeat every 15s (backend/src/lib/sseHeartbeat.ts) so they never trip it; a synchronous request that takes longer than this gets a 504 from the edge, which is why long work in the backend is asynchronous."
  type        = number
  default     = 60

  validation {
    condition     = var.origin_read_timeout_seconds >= 1 && var.origin_read_timeout_seconds <= 60
    error_message = "origin_read_timeout_seconds must be between 1 and 60 (the default CloudFront quota)."
  }
}

# --- configuration --------------------------------------------------------------

variable "extra_environment" {
  description = "Further variables to set on the container. The frontend reads three (frontend/.env.example) and this module sets all of them; this exists for the unforeseen. Never a secret: the frontend has none, and its execution role cannot read any."
  type        = map(string)
  default     = {}
}

# --- sizing --------------------------------------------------------------------

variable "image_tag" {
  description = "Tag in this module's ECR repository the Terraform-managed task definition points at. Deploys register newer revisions outside Terraform, as for the backend."
  type        = string
  default     = "bootstrap"
}

variable "container_port" {
  type    = number
  default = 3000
}

variable "cpu" {
  description = "Fargate task CPU units. 512 = 0.5 vCPU, the cost table's figure: the frontend renders pages and proxies nothing in production."
  type        = number
  default     = 512
}

variable "memory" {
  description = "Fargate task memory in MiB."
  type        = number
  default     = 1024
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "max_count" {
  type    = number
  default = 2
}

variable "log_retention_days" {
  type    = number
  default = 30
}
