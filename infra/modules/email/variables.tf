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

variable "domain_name" {
  description = "The sending domain. Mail comes from <sender_local_part>@<domain_name>."
  type        = string
}

variable "zone_id" {
  description = "The Route 53 zone for domain_name, from the dns module. DKIM, MAIL FROM and DMARC records are written here."
  type        = string
}

variable "sender_local_part" {
  description = "Local part of the From address Supabase is given. Nobody reads replies to it, which is the point of the name."
  type        = string
  default     = "no-reply"
}

variable "sender_name" {
  description = "Display name on outgoing auth email."
  type        = string
  default     = "legalworkflows"
}

variable "mail_from_subdomain" {
  description = "Custom MAIL FROM domain label under domain_name. A custom MAIL FROM makes SPF align with the From domain, which DMARC wants; SES's default bounces from amazonses.com and fails that alignment."
  type        = string
  default     = "mail"
}

variable "dmarc_policy" {
  description = "DMARC policy for the domain. Start at none (monitor only), move to quarantine once the reports show every legitimate sender is aligned, then reject."
  type        = string
  default     = "none"

  validation {
    condition     = contains(["none", "quarantine", "reject"], var.dmarc_policy)
    error_message = "dmarc_policy must be none, quarantine or reject."
  }
}

variable "dmarc_report_address" {
  description = "Mailbox for DMARC aggregate reports (the rua tag). Null omits the tag; reports then go nowhere, which is acceptable while the policy is none."
  type        = string
  default     = null
  nullable    = true
}

variable "event_topic_arn" {
  description = "SNS topic that receives bounce, complaint and reject events — the observability module's informational topic, whose policy already admits SES."
  type        = string
}

variable "recovery_window_in_days" {
  description = "Days the SMTP credential secret stays recoverable after deletion."
  type        = number
  default     = 7
}
