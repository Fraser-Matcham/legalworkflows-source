variable "name_prefix" {
  description = "Prefix for every resource name in this module."
  type        = string
}

variable "recovery_window_in_days" {
  description = "Days a deleted secret stays recoverable. The maximum: losing the JWT secret invalidates every session and every API key at once."
  type        = number
  default     = 30
}
