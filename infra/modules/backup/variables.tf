variable "name_prefix" {
  description = "Prefix for every resource name in this module."
  type        = string
}

variable "account_id" {
  type = string
}

variable "source_bucket_name" {
  description = "The documents bucket. Passed as the storage module's versioned_bucket_id so replication cannot be configured before versioning is on."
  type        = string
}

variable "source_bucket_arn" {
  type = string
}

variable "source_kms_key_arn" {
  description = "Key the source objects are encrypted with; the replication role must decrypt with it."
  type        = string
}

variable "retention_days" {
  description = "How long a version that has been overwritten or deleted in the live bucket stays in the backup bucket. Matches the window an erasure request has to be answered against (docs/data-retention.md). Thirty-five days is what point-in-time recovery products offer and long enough to notice a bad deploy over a holiday."
  type        = number
  default     = 35

  validation {
    condition     = var.retention_days >= 7
    error_message = "retention_days must be at least 7: a backup shorter than a week is not one anyone will reach in time."
  }
}

variable "kms_deletion_window_in_days" {
  type    = number
  default = 30
}
