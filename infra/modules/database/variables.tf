variable "name_prefix" {
  description = "Prefix for every resource name in this module."
  type        = string
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  description = "The network module's private subnets. The instance lives in the same subnets as the tasks that talk to it and has no route from the internet."
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_ids) >= 2
    error_message = "An RDS subnet group needs subnets in at least two availability zones."
  }
}

variable "client_security_group_ids" {
  description = "Security groups admitted to port 5432, keyed by a short label used in the rule description. The backend's group at first; the PostgREST, GoTrue and database-tools modules add their own rules against database_security_group_id rather than passing themselves here, so each module owns its own reachability."
  type        = map(string)
  default     = {}
}

# --- engine and size ---------------------------------------------------------

variable "engine_version" {
  description = "PostgreSQL major.minor. Matched to the Supabase project in use (17.6, ticket 2111) so a dump from it restores without a version skew; a restore into an OLDER minor is what pg_restore refuses. Minor upgrades within 17 are applied by AWS in the maintenance window and ignored by Terraform (see main.tf); a new major is a deliberate edit here."
  type        = string
  default     = "17.6"

  validation {
    condition     = can(regex("^17\\.[0-9]+$", var.engine_version))
    error_message = "engine_version must be a PostgreSQL 17 release, major.minor (for example 17.6): the schema and the Supabase dump are 17."
  }
}

variable "instance_class" {
  description = "Stage 5, Task 1's decision. db.t4g.small (2 vCPU burstable, 2 GB) is the starting recommendation: the workload is a handful of users, PostgREST and GoTrue, and the queue's short polls. Change it here and apply; RDS resizes in the maintenance window unless apply_immediately is set."
  type        = string
  default     = "db.t4g.small"
}

variable "allocated_storage_gb" {
  description = "Initial gp3 volume size. Storage autoscaling grows it up to max_allocated_storage_gb; RDS never shrinks."
  type        = number
  default     = 20

  validation {
    condition     = var.allocated_storage_gb >= 20
    error_message = "allocated_storage_gb must be at least 20, the gp3 minimum."
  }
}

variable "max_allocated_storage_gb" {
  description = "Ceiling for storage autoscaling. Zero disables it, which is not recommended: a full volume takes the database read-only."
  type        = number
  default     = 100
}

variable "multi_az" {
  description = "Stage 5, Task 1's second decision. false (single AZ) is the honest starting answer while the rollback target during the move is the Supabase project rather than a standby; switching to true later is an apply with no downtime beyond the failover itself."
  type        = bool
  default     = false
}

# --- backups -------------------------------------------------------------------

variable "backup_retention_days" {
  description = "Days of automated backups (daily snapshot plus continuous transaction logs, so point-in-time restore reaches any second in the window). 35 is the RDS maximum and matches the document bucket's backup retention (infra/modules/backup, retention_days), so a restore of one half of the data can always be paired with the other. Storage up to the database's own size is free; beyond it is a few pence per GB."
  type        = number
  default     = 35

  validation {
    condition     = var.backup_retention_days >= 7 && var.backup_retention_days <= 35
    error_message = "backup_retention_days must be between 7 (a backup shorter than a week is not one anyone will reach in time) and 35 (the RDS maximum)."
  }
}

variable "backup_window" {
  description = "UTC window for the daily snapshot. Must not overlap maintenance_window."
  type        = string
  default     = "02:00-03:00"
}

variable "maintenance_window" {
  description = "UTC window for minor version upgrades and instance changes that were not applied immediately. Sunday small hours, UK time, is when nobody is using the product."
  type        = string
  default     = "Sun:03:30-Sun:04:30"
}

variable "deletion_protection" {
  description = "Refuse to delete the instance while true. On in production; a destroy needs this flipped and applied first, which is the deliberate step it should be."
  type        = bool
  default     = true
}

# --- housekeeping --------------------------------------------------------------

variable "kms_deletion_window_in_days" {
  description = "Waiting period before a scheduled key deletion takes effect. Deleting the key makes the volume and every snapshot unreadable; the maximum window is the point."
  type        = number
  default     = 30
}

variable "recovery_window_in_days" {
  description = "Days a deleted role-credentials secret stays recoverable."
  type        = number
  default     = 30
}

variable "log_retention_days" {
  description = "Retention for the exported PostgreSQL log group."
  type        = number
  default     = 30
}

variable "slow_query_ms" {
  description = "Statements slower than this are logged (log_min_duration_statement). One second catches a missing index without logging the queue's polls."
  type        = number
  default     = 1000
}
