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
  description = <<-EOT
    Branches whose workflow runs may assume the role *without declaring a
    GitHub environment*. Empty by default, and that is the security property:
    a branch subject would let any job on that branch assume the role while
    skipping the environment's protection rules, so the environment approval
    would be advisory rather than a gate. Every job in deploy.yml and
    rollback.yml that touches AWS declares `environment: production`, so
    nothing needs a branch subject. Add one only if you accept that the
    approval can be bypassed, and correct the README if you do.
  EOT
  type        = list(string)
  default     = []
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
