variable "name_prefix" {
  description = "Prefix for every resource name in this module."
  type        = string
}

variable "short_name_prefix" {
  description = "Shortened prefix for the target group (32-character ELB limit, infra/locals.tf)."
  type        = string

  validation {
    condition     = length("${var.short_name_prefix}-gotrue") <= 32
    error_message = "short_name_prefix is too long: \"<short_name_prefix>-gotrue\" must fit the ELB API's 32-character limit."
  }
}

variable "region" {
  type = string
}

variable "account_id" {
  type = string
}

variable "domain_name" {
  description = "The public origin. GoTrue's site URL, the base every email link and the Google callback are built on, and the origin its redirect allow-list admits."
  type        = string
}

# --- network -----------------------------------------------------------------

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "alb_security_group_id" {
  type = string
}

variable "backend_security_group_id" {
  description = "Admitted over Service Connect, for an internal path if one is ever wanted."
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
  type = string
}

variable "origin_verify_secret" {
  type      = string
  sensitive = true
}

variable "listener_rule_priority" {
  description = "Backend is 10, frontend 20, PostgREST 30."
  type        = number
  default     = 40
}

# --- secrets ---------------------------------------------------------------------

variable "database_uri_secret_arn" {
  description = "The database module's roles secret; GOTRUE_DB_DATABASE_URL is its AUTH_ADMIN_URI key."
  type        = string
}

variable "database_kms_key_arn" {
  type = string
}

variable "jwt_secret_arn" {
  type = string
}

variable "jwt_secret_valuefrom" {
  description = "The keys module's ecs_secrets[\"GOTRUE_JWT_SECRET\"]."
  type        = string
}

variable "smtp_secret_arn" {
  description = "The email module's SMTP secret: SMTP_USERNAME and SMTP_PASSWORD are read from it (ticket 2118)."
  type        = string
}

variable "smtp_host" {
  type = string
}

variable "smtp_port" {
  type = number
}

variable "sender_address" {
  description = "The From address, from the email module."
  type        = string
}

variable "sender_name" {
  type = string
}

# --- Google sign-in (ticket 2119) --------------------------------------------------

variable "google_oauth_enabled" {
  description = "Turn on the Google provider. Requires the <prefix>/platform/google-oauth secret to have been written first (README) — a task that references a missing key does not start."
  type        = bool
  default     = false
}

# --- behaviour -------------------------------------------------------------------------

variable "disable_signup" {
  description = "Refuse new sign-ups (existing users still sign in). Off for launch; the docker-compose file describes the same switch."
  type        = bool
  default     = false
}

variable "extra_redirect_urls" {
  description = "Redirect targets beyond https://<domain>/** — the Word add-in's origin, if it is hosted elsewhere. GoTrue's glob syntax."
  type        = list(string)
  default     = []
}

variable "jwt_expiry_seconds" {
  description = "Access token lifetime. An hour, as the local stack and Supabase's default."
  type        = number
  default     = 3600
}

variable "password_min_length" {
  description = "docs/deployment.md asks for 10."
  type        = number
  default     = 10
}

# --- the container -----------------------------------------------------------------

variable "image" {
  description = "GoTrue image: the public ECR mirror of the release docker-compose.yml pins. Bump both together and re-run the stack tests."
  type        = string
  default     = "public.ecr.aws/supabase/gotrue:v2.189.0"
}

variable "container_port" {
  type    = number
  default = 9999
}

variable "cpu" {
  description = "Fargate task CPU units. GoTrue is a small Go service; 256 is plenty."
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

variable "recovery_window_in_days" {
  type    = number
  default = 30
}

variable "enable_ecs_exec" {
  type    = bool
  default = false
}

variable "extra_environment" {
  description = "Further GOTRUE_* settings, for the exceptions."
  type        = map(string)
  default     = {}
}
