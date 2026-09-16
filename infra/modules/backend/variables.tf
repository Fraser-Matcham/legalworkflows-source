variable "name_prefix" {
  description = "Prefix for every resource name in this module."
  type        = string
}

variable "region" {
  type = string
}

variable "short_name_prefix" {
  description = "Prefix for the load balancer and its target groups, which the ELB API caps at 32 characters. See infra/locals.tf."
  type        = string

  validation {
    condition     = length(var.short_name_prefix) <= 23
    error_message = "short_name_prefix must be 23 characters or fewer: the ELB API caps a target group name at 32, and this module appends \"-frontend\" (9) in the frontend module."
  }
}

# --- placement -----------------------------------------------------------

variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  description = "For the load balancer."
  type        = list(string)
}

variable "private_subnet_ids" {
  description = "For the tasks."
  type        = list(string)
}

variable "alb_security_group_id" {
  type = string
}

variable "backend_security_group_id" {
  type = string
}

variable "frontend_security_group_id" {
  description = "Allowed to reach the backend directly on its port over Service Connect, for the frontend's server-side proxy fallback."
  type        = string
}

# --- identity and secrets ------------------------------------------------

variable "execution_role_arn" {
  type = string
}

variable "task_role_arn" {
  type = string
}

variable "ecs_secrets" {
  description = "Backend variable name => ECS valueFrom, from the secrets module."
  type        = map(string)
}

variable "secret_keys" {
  description = <<-EOT
    Which of ecs_secrets to inject. Every key here must exist in its secret or
    the task fails to start, so optional operator values (ERROR_TRACKING_DSN,
    MIKE_WORKFLOWS_GITHUB_TOKEN, COURTLISTENER_API_TOKEN) are added through
    extra_secret_keys only once they have been written to the operator secret.
    AUTH_HANDOFF_ENCRYPTION_SECRET is generated, so it is always present; the
    backend only requires it once WORD_ADDIN_URL is set, and injecting it now
    means enabling the add-in later is a variable change, not a secrets change.
  EOT
  type        = list(string)
  default = [
    "SUPABASE_SECRET_KEY",
    "ANTHROPIC_API_KEY",
    "DOWNLOAD_SIGNING_SECRET",
    "USER_API_KEYS_ENCRYPTION_SECRET",
    "AUTH_HANDOFF_ENCRYPTION_SECRET",
    "MANIFEST_SIGNING_KEY",
    "METRICS_TOKEN",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
  ]
}

variable "extra_secret_keys" {
  description = "Further ecs_secrets keys to inject, appended to secret_keys. This is how the optional operator values are switched on once written."
  type        = list(string)
  default     = []
}

# --- edge ---------------------------------------------------------------------

variable "certificate_arn" {
  description = "Validated regional certificate for origin_fqdn, from the dns module."
  type        = string
}

variable "zone_id" {
  type = string
}

variable "origin_fqdn" {
  description = "The load balancer's hostname; CloudFront's origin domain name."
  type        = string
}

variable "domain_name" {
  description = "The public origin, for FRONTEND_URL and API_PUBLIC_URL."
  type        = string
}

variable "alb_idle_timeout_seconds" {
  description = "Idle timeout on the load balancer. The backend's SSE streams send a heartbeat comment well inside 30s (lib/sseHeartbeat.ts), so this need only exceed that with margin; CloudFront's own 60s origin read timeout is the tighter bound."
  type        = number
  default     = 120
}

# --- configuration --------------------------------------------------------------

variable "supabase_url" {
  type = string
}

variable "supabase_publishable_key" {
  description = "The anon/publishable key. Public by design; it ships in the browser bundle elsewhere, so it is environment rather than a secret."
  type        = string
}

variable "storage_endpoint_url" {
  type = string
}

variable "storage_bucket_name" {
  type = string
}

variable "workflows_repository" {
  description = "MIKE_WORKFLOWS_REPOSITORY. Point at your own catalogue fork (AGENTS.md, rule 2: the variable name stays, the value is ownership)."
  type        = string
}

variable "workflows_ref" {
  description = "MIKE_WORKFLOWS_REF. Pin a 40-character commit SHA for a reproducible production release."
  type        = string
}

variable "rate_limits" {
  description = "Production starting values from docs/deployment.md, \"Rate limits\". Reasoned, not measured; revisit after a week of traffic."
  type        = map(number)
  default = {
    RATE_LIMIT_AUTH_LOGIN_MAX   = 20
    RATE_LIMIT_AUTH_ACCOUNT_MAX = 10
    RATE_LIMIT_AUTH_EMAIL_MAX   = 5
    RATE_LIMIT_AUTH_MFA_MAX     = 10
    RATE_LIMIT_AUTH_FLOW_MAX    = 30
    RATE_LIMIT_GENERAL_MAX      = 600
    RATE_LIMIT_CHAT_MAX         = 30
    RATE_LIMIT_CHAT_CREATE_MAX  = 60
    RATE_LIMIT_TOOL_RESULT_MAX  = 2000
    RATE_LIMIT_UPLOAD_MAX       = 200
    RATE_LIMIT_EXPORT_MAX       = 10
    RATE_LIMIT_DATA_DELETE_MAX  = 20
  }
}

variable "extra_environment" {
  description = "Further non-secret variables to set on the container, for anything not modelled above. Never put a secret here."
  type        = map(string)
  default     = {}
}

# --- sizing --------------------------------------------------------------------

variable "image_tag" {
  description = "Tag of the image in this module's ECR repository that the Terraform-managed task definition points at. Deploys register newer revisions outside Terraform (see README, \"Deploys\")."
  type        = string
  default     = "bootstrap"
}

variable "container_port" {
  type    = number
  default = 3001
}

variable "cpu" {
  description = "Fargate task CPU units. 1024 = 1 vCPU, the cost table's figure."
  type        = number
  default     = 1024
}

variable "memory" {
  description = "Fargate task memory in MiB. LibreOffice conversions are the reason this is not smaller."
  type        = number
  default     = 2048
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "max_count" {
  description = "Autoscaling ceiling. Two rather than more: the queue and the conversion pool are per-task and per-user capped, so a second task is the cheap step; beyond that, look at what is actually slow."
  type        = number
  default     = 2
}

variable "log_retention_days" {
  type    = number
  default = 30
}
