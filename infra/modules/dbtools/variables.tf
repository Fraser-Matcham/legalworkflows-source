variable "name_prefix" {
  type = string
}

variable "region" {
  type = string
}

variable "account_id" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "database_security_group_id" {
  description = "The database module's group; this module adds its own ingress rule to it."
  type        = string
}

variable "database_address" {
  type = string
}

variable "database_port" {
  type = number
}

variable "database_name" {
  type = string
}

variable "database_master_secret_arn" {
  description = "The RDS-managed master credential."
  type        = string
}

variable "database_roles_secret_arn" {
  type = string
}

variable "database_kms_key_arn" {
  type = string
}

variable "last_migration_parameter_arn" {
  description = "The deploy module's SSM record of the last applied migration; the migrate subcommand reads and writes it."
  type        = string
}

variable "last_migration_parameter_name" {
  type = string
}

variable "image_tag" {
  description = "Tag in this module's ECR repository the task definition points at. The release pipeline pushes <sha> and main; main is the newest release."
  type        = string
  default     = "main"
}

variable "cpu" {
  description = "A dump and restore of a few hundred megabytes is I/O-bound; half a vCPU and a gigabyte are plenty, and the task's 20 GB of ephemeral storage holds the dump."
  type        = number
  default     = 512
}

variable "memory" {
  type    = number
  default = 1024
}

variable "log_retention_days" {
  description = "Longer than the services': a migration's output is the record of what was applied."
  type        = number
  default     = 90
}

variable "recovery_window_in_days" {
  type    = number
  default = 30
}
