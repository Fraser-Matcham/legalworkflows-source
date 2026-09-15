variable "name_prefix" {
  description = "Prefix for every resource name in this module."
  type        = string
}

variable "account_id" {
  description = "AWS account id, appended to the bucket name because bucket names are global."
  type        = string
}

variable "allowed_origins" {
  description = "Browser origins allowed to PUT directly to signed upload URLs. Exact origins only — never a wildcard in production (docs/deployment.md, \"Object-storage CORS\")."
  type        = list(string)

  validation {
    condition     = length(var.allowed_origins) > 0 && alltrue([for o in var.allowed_origins : startswith(o, "https://") && !strcontains(o, "*")])
    error_message = "allowed_origins must be one or more exact https:// origins with no wildcard."
  }
}

variable "upload_session_backstop_days" {
  description = <<-EOT
    Days after which anything still under upload-sessions/ is expired. The
    backend deletes these staging and sealed objects itself as each upload
    completes, fails or expires; this is a backstop for objects orphaned by a
    crash mid-cleanup. Sessions live at most four hours and their metadata is
    kept seven days, so eight is the shortest value that cannot race the code.
  EOT
  type        = number
  default     = 8

  validation {
    condition     = var.upload_session_backstop_days >= 8
    error_message = "upload_session_backstop_days must be at least 8: a session can live 4 hours and its metadata is retained 7 days."
  }
}

variable "kms_deletion_window_in_days" {
  description = "Waiting period before a scheduled key deletion takes effect. Deleting the key makes every object unreadable; the maximum window is the point."
  type        = number
  default     = 30
}
