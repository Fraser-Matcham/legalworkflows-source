variable "name_prefix" {
  description = "Prefix for every resource name in this module (the role keeps its hand-made name; see role_name)."
  type        = string
}

variable "region" {
  type = string
}

variable "account_id" {
  type = string
}

# --- who may assume the role ---------------------------------------------------------

variable "github_repository" {
  description = "owner/repo whose workflows may assume the role. Nothing else on GitHub can."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository must use the owner/repository form."
  }
}

variable "deploy_branches" {
  description = "Branches whose workflow runs may assume the role. A pull-request run has a different subject and is refused — CI never deploys from a branch under review."
  type        = list(string)
  default     = ["main"]
}

variable "deploy_environments" {
  description = "GitHub Actions environments whose jobs may assume the role, in addition to the branches. A job that declares `environment: production` gets that subject, and the environment's own protection rules (required reviewers, wait timer) then gate the deploy."
  type        = list(string)
  default     = ["production"]
}

variable "role_name" {
  description = "Name of the role. Matches the one Stage 3, Task 5 creates by hand so Terraform imports it rather than making a second."
  type        = string
  default     = "github-actions-deploy"
}

# --- what the role may touch -----------------------------------------------------------

variable "ecr_repository_arns" {
  description = "Repositories the deploy may push to and read scan findings from."
  type        = list(string)
}

variable "cluster_name" {
  type = string
}

variable "cluster_arn" {
  type = string
}

variable "service_names" {
  description = "ECS services the deploy may update."
  type        = list(string)
}

variable "task_definition_families" {
  description = "Task definition families the deploy may register revisions of and run one-off tasks from (the release job that syncs the workflow catalogue)."
  type        = list(string)
}

variable "passable_role_arns" {
  description = "The task and execution roles a registered task definition names; RegisterTaskDefinition needs iam:PassRole on each."
  type        = list(string)
}

variable "log_group_names" {
  description = "Log groups the deploy may read, to show why a task failed to start."
  type        = list(string)
}

variable "cloudfront_distribution_arn" {
  description = "For cache invalidation after a frontend deploy."
  type        = string
}

variable "initial_last_migration" {
  description = "Filename of the newest migration already applied when the footprint is first created — the database was installed from schema.sql, which includes every migration up to this one. Written once to the SSM parameter the deploy workflow reads; afterwards the workflow owns the value and Terraform ignores it."
  type        = string
}
