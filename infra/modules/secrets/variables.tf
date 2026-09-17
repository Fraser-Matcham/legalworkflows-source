variable "name_prefix" {
  description = "Prefix for every resource name in this module."
  type        = string
}

variable "account_id" {
  description = "AWS account id, for ARN patterns in the role policies."
  type        = string
}

variable "region" {
  description = "Region, for ARN patterns in the role policies."
  type        = string
}

variable "storage_access_key_id" {
  description = "From the storage module. Becomes R2_ACCESS_KEY_ID."
  type        = string
  sensitive   = true
}

variable "storage_secret_access_key" {
  description = "From the storage module. Becomes R2_SECRET_ACCESS_KEY."
  type        = string
  sensitive   = true
}

variable "operator_secret_keys" {
  description = <<-EOT
    Backend variables whose values only the operator holds and which are set
    out of band (see README) — never through Terraform. Listed here so the
    task definition can reference each by JSON key and so the README can print
    the exact command. Optional ones may be left absent from the JSON; ECS
    fails a task start only for keys it is told to read, so the backend module
    maps only the keys it has been told exist.
  EOT
  type        = list(string)
  default = [
    "SUPABASE_SECRET_KEY",
    "ANTHROPIC_API_KEY",
    "ERROR_TRACKING_DSN",
    "MIKE_WORKFLOWS_GITHUB_TOKEN",
    "COURTLISTENER_API_TOKEN",
  ]
}

variable "recovery_window_in_days" {
  description = "Days a deleted secret stays recoverable. The maximum, deliberately: a destroyed footprint should not take the Supabase key with it."
  type        = number
  default     = 30
}

variable "enable_ecs_exec" {
  description = "Grant the task roles the SSM Messages permissions `aws ecs execute-command` needs to open a shell in a running task. Off in production — see the root variable of the same name."
  type        = bool
  default     = false
}

variable "extra_readable_secret_arns" {
  description = "Further secrets the backend execution role may read: the stage 5 platform's api-keys secret, once the backend is served by it (ticket 2122). The backend module still has to be told which keys to inject."
  type        = list(string)
  default     = []
}
