variable "name_prefix" {
  description = "Prefix for every resource name in this module."
  type        = string
}

variable "region" {
  type = string
}

variable "account_id" {
  type = string
}

# --- where alerts go -------------------------------------------------------------

variable "alert_email" {
  description = "Address subscribed to both topics (Stage 3, Task 9). Null until the operator names one: the topics and alarms exist either way, so wiring the address later is a one-variable change. The subscription must be confirmed from the email SNS sends."
  type        = string
  default     = null
  nullable    = true
}

variable "urgent_sms_number" {
  description = "E.164 mobile number subscribed to the urgent topic only (Task 9's \"wake me\"). Null for \"email only\" or \"morning is fine\"."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.urgent_sms_number == null || can(regex("^\\+[1-9][0-9]{6,14}$", var.urgent_sms_number))
    error_message = "urgent_sms_number must be in E.164 form, for example +447700900123."
  }
}

# --- what is watched, from the other modules ----------------------------------------

variable "alb_arn_suffix" {
  type = string
}

variable "backend_target_group_arn_suffix" {
  type = string
}

variable "frontend_target_group_arn_suffix" {
  type = string
}

variable "cluster_name" {
  type = string
}

variable "cluster_arn" {
  type = string
}

variable "backend_service_name" {
  type = string
}

variable "frontend_service_name" {
  type = string
}

variable "backend_log_group_name" {
  type = string
}

variable "cloudfront_distribution_id" {
  description = "For the dashboard only. CloudFront's metrics live in us-east-1 and an alarm there would need its own topic in that region; the load balancer alarms already cover every origin failure the edge would report."
  type        = string
}

# --- thresholds --------------------------------------------------------------------

variable "backend_5xx_per_5m" {
  description = "Target 5xx responses from the backend in five minutes before the informational alarm fires. A handful is a bug; a sustained stream is an incident, and the ELB-level alarm catches the latter."
  type        = number
  default     = 10
}

variable "backend_p95_latency_seconds" {
  description = "p95 backend response time over five minutes before the informational alarm fires. Chat streams are excluded by construction — the ALB measures to the first byte for streamed responses."
  type        = number
  default     = 5
}

variable "readiness_failures_per_5m" {
  description = "Readiness-check failures logged in five minutes before the urgent alarm fires. /ready is polled by nothing in production yet, so this counts the backend's own start-up and Stage 4 deploy-gate probes; a low threshold is right."
  type        = number
  default     = 3
}
