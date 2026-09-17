variable "name_prefix" {
  description = "Prefix for every resource name in this module."
  type        = string
}

variable "short_name_prefix" {
  description = "Shortened prefix for the target group (32-character ELB limit, infra/locals.tf)."
  type        = string

  validation {
    condition     = length("${var.short_name_prefix}-postgrest") <= 32
    error_message = "short_name_prefix is too long: \"<short_name_prefix>-postgrest\" must fit the ELB API's 32-character limit."
  }
}

variable "region" {
  type = string
}

variable "account_id" {
  type = string
}

# --- network -----------------------------------------------------------------

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "alb_security_group_id" {
  description = "The load balancer's group: admitted to the API and admin ports, and given an egress rule to reach them."
  type        = string
}

variable "backend_security_group_id" {
  description = "The backend's group: admitted to the API port over Service Connect, for an internal path that bypasses the edge if one is ever wanted."
  type        = string
}

variable "database_security_group_id" {
  description = "The database module's group; this module adds its own ingress rule to it."
  type        = string
}

# --- cluster and load balancer -----------------------------------------------

variable "cluster_arn" {
  type = string
}

variable "cluster_name" {
  type = string
}

variable "service_connect_namespace_arn" {
  type = string
}

variable "https_listener_arn" {
  description = "The backend module's listener; this module adds a header-gated rule to it."
  type        = string
}

variable "origin_verify_secret" {
  description = "The secret CloudFront adds as X-Origin-Verify; the rule requires it."
  type        = string
  sensitive   = true
}

variable "listener_rule_priority" {
  description = "Backend is 10, frontend 20."
  type        = number
  default     = 30
}

# --- secrets ---------------------------------------------------------------------

variable "database_uri_secret_arn" {
  description = "The database module's roles secret; PGRST_DB_URI is its AUTHENTICATOR_URI key."
  type        = string
}

variable "database_kms_key_arn" {
  description = "The key the roles secret is encrypted with; the execution role needs kms:Decrypt on it."
  type        = string
}

variable "jwt_secret_valuefrom" {
  description = "The keys module's ecs_secrets[\"PGRST_JWT_SECRET\"]: the \"<arn>:JWT_SECRET::\" reference."
  type        = string
}

variable "jwt_secret_arn" {
  description = "The keys module's JWT secret ARN, for the execution role's read permission."
  type        = string
}

# --- the container -----------------------------------------------------------------

variable "image" {
  description = "PostgREST image. The public ECR mirror of the same release docker-compose.yml pins, so Fargate pulls it without Docker Hub's anonymous rate limit. Bump here and in docker-compose.yml together, and re-run the stack tests."
  type        = string
  default     = "public.ecr.aws/supabase/postgrest:v14.12"
}

variable "container_port" {
  type    = number
  default = 3000
}

variable "admin_port" {
  description = "PostgREST's admin server, which answers /live and /ready. The load balancer's health check uses it, so a task whose database connection has failed is taken out of rotation."
  type        = number
  default     = 3001
}

variable "db_pool" {
  description = "Connections PostgREST keeps open to the database, per task. Ten per task, two tasks at most, leaves the t4g.small's default max_connections untouched by a wide margin."
  type        = number
  default     = 10
}

variable "cpu" {
  description = "Fargate task CPU units. PostgREST is a small Haskell binary; 256 (0.25 vCPU) is plenty."
  type        = number
  default     = 256
}

variable "memory" {
  type    = number
  default = 512
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

variable "enable_ecs_exec" {
  type    = bool
  default = false
}

variable "extra_environment" {
  description = "Further PGRST_* settings, for the exceptions."
  type        = map(string)
  default     = {}
}
