variable "project" {
  description = "Short project slug used as the prefix for every resource name."
  type        = string
  default     = "legalworkflows"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,30}$", var.project))
    error_message = "project must be 2-31 chars: lowercase letters, digits and hyphens, starting with a letter."
  }
}

variable "environment" {
  description = "Deployment environment. Production only for now (architecture.md, decision 3)."
  type        = string
  default     = "production"

  validation {
    condition     = contains(["production"], var.environment)
    error_message = "Only \"production\" exists yet. Add a value here when a second environment is created."
  }
}

variable "aws_region" {
  description = "Region for every regional resource. Decided in Stage 2, Task 7; London keeps client documents in the UK."
  type        = string
  default     = "eu-west-2"
}

variable "domain_name" {
  description = "Public origin for both the frontend and the API (architecture.md, decision 5: the bare domain, one origin)."
  type        = string
  default     = "legalworkflows.co.uk"
}

# --- dns -------------------------------------------------------------------

variable "route53_zone_id" {
  description = "Hosted zone ID of the zone for domain_name, created by hand in Stage 3 Task 7 and imported by infra/imports.tf. Starts with Z."
  type        = string

  validation {
    condition     = can(regex("^Z[A-Z0-9]{8,32}$", var.route53_zone_id))
    error_message = "route53_zone_id must be a Route 53 hosted zone ID (starts with Z), as shown on the zone's page in the console."
  }
}

variable "origin_subdomain" {
  description = "Label for the load balancer's hostname under domain_name. See modules/dns/README.md."
  type        = string
  default     = "origin"
}

# --- network ---------------------------------------------------------------

variable "vpc_cidr" {
  description = "Address range for the VPC. See modules/network."
  type        = string
  default     = "10.0.0.0/16"
}

variable "single_nat_gateway" {
  description = "One NAT gateway shared across AZs (the cost-table default) rather than one per AZ. See modules/network/README.md."
  type        = bool
  default     = true
}

# --- backend ---------------------------------------------------------------

variable "supabase_url" {
  description = "SUPABASE_URL for the backend: the project URL from Stage 2, Task 2 (https://<ref>.supabase.co)."
  type        = string

  validation {
    condition     = can(regex("^https://[a-z0-9-]+\\.supabase\\.co$", var.supabase_url))
    error_message = "supabase_url must be the project's API URL, https://<project-ref>.supabase.co, with no trailing slash."
  }
}

variable "supabase_publishable_key" {
  description = "SUPABASE_PUBLISHABLE_KEY for the backend: the anon/publishable key. Public by design (it ships in the browser bundle), so it is a plain variable; the secret key never is — it goes in the operator secret."
  type        = string

  validation {
    condition     = startswith(var.supabase_publishable_key, "sb_publishable_") || startswith(var.supabase_publishable_key, "eyJ")
    error_message = "supabase_publishable_key must be the publishable (sb_publishable_…) or legacy anon (eyJ…) key. If it starts with sb_secret_ or has role service_role, it is the secret key and must not be a Terraform variable."
  }
}

# Empty means this deployment has no workflow catalogue, and the release
# pipeline's sync step is skipped rather than failed — the job exits 78 and
# deploy.yml reads that as a skip. See
# backend/src/lib/workflowCatalogueConfig.ts and docs/deployment.md.
#
# Opting out has to be written down. Leaving this at its default is NOT opting
# out: the default is a real catalogue, just not one this deployment
# necessarily owns or can read, so a release that cannot sync it still fails.
# Skipping because somebody forgot to configure it would be exactly the quiet
# no-op this distinction exists to remove.
variable "workflows_repository" {
  description = "MIKE_WORKFLOWS_REPOSITORY: the owner/repo of the workflow catalogue. Point this at your own fork (AGENTS.md rule 2 — the variable name stays, the value is ownership). Empty means there is no catalogue and the release skips the sync."
  type        = string
  default     = "Open-Legal-Products/mike-workflows"

  validation {
    condition     = var.workflows_repository == "" || can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.workflows_repository))
    error_message = "workflows_repository must use the owner/repository form, or be empty for no catalogue."
  }
}

variable "workflows_ref" {
  description = "MIKE_WORKFLOWS_REF: the git ref of the catalogue the release job syncs. A 40-character commit SHA makes a release reproducible; a branch name does not."
  type        = string
  default     = "main"
}

variable "backend_image_tag" {
  description = "Tag in the backend's ECR repository that the Terraform-managed task definition points at. Deploys register newer revisions outside Terraform (infra/modules/backend/README.md, \"Deploys\")."
  type        = string
  default     = "bootstrap"
}

variable "backend_extra_secret_keys" {
  description = "Optional operator-secret keys to inject into the backend on top of the required set — ERROR_TRACKING_DSN, MIKE_WORKFLOWS_GITHUB_TOKEN, COURTLISTENER_API_TOKEN. Add one only after writing it to the operator secret; a referenced key that is absent stops the task from starting."
  type        = list(string)
  default     = []
}

# --- frontend --------------------------------------------------------------

variable "frontend_image_tag" {
  description = "Tag in the frontend's ECR repository that the Terraform-managed task definition points at. As backend_image_tag."
  type        = string
  default     = "bootstrap"
}

# --- observability ---------------------------------------------------------

variable "alert_email" {
  description = "Address operational alerts go to (Stage 3, Task 9). Null until the operator names one; the alarms exist regardless. SNS sends a confirmation link that must be clicked."
  type        = string
  default     = null
  nullable    = true
}

variable "urgent_sms_number" {
  description = "E.164 mobile number for the urgent alarms only (Task 9's \"wake me\"). Null for email only."
  type        = string
  default     = null
  nullable    = true
}

# --- email -----------------------------------------------------------------

variable "dmarc_policy" {
  description = "DMARC policy published for domain_name: none to start, quarantine once reports show alignment, then reject. See infra/modules/email/README.md."
  type        = string
  default     = "none"
}

variable "dmarc_report_address" {
  description = "Mailbox for DMARC aggregate reports. Null omits the tag."
  type        = string
  default     = null
  nullable    = true
}

# --- deploy ----------------------------------------------------------------

# The repository as it appears in the OIDC token's `sub` claim, which is not
# always how it appears anywhere else. This organisation has immutable subject
# claims enabled, so GitHub mints the owner and repository with their immutable
# numeric IDs appended:
#
#   repo:Fraser-Matcham@326009546/legalworkflows@1361216855:environment:production
#
# while the token's own `repository` claim, the settings pages and the URL all
# still read Fraser-Matcham/legalworkflows. IAM matches `sub` and nothing else,
# so `sub` is what this must mirror. The build job prints the live value on
# every run ("The OIDC subject this job presents"); read it there rather than
# assembling it by hand.
#
# Keeping the IDs is the stronger posture and is the point of the feature:
# renaming the organisation or the repository, or deleting and recreating
# either, then breaks the deploy instead of silently handing the role to
# whoever claims the freed name.
variable "github_repository" {
  description = "The repository component of the OIDC subject the deploy role accepts — owner/repo, carrying @<id> on each part where the organisation has immutable subject claims enabled."
  type        = string
  default     = "Fraser-Matcham@326009546/legalworkflows@1361216855"
}

variable "deploy_branches" {
  description = "Branches whose pushes may assume the deploy role without declaring a GitHub environment. Empty on purpose — see infra/modules/deploy/README.md, \"Who may assume it\"."
  type        = list(string)
  default     = []
}

variable "deploy_environments" {
  description = "GitHub Actions environments whose jobs may deploy."
  type        = list(string)
  default     = ["production"]
}

variable "deploy_role_name" {
  description = "Name of the deploy role Terraform creates. Null takes \"<project>-<environment>-github-actions\", which cannot collide with another project's role in a shared account."
  type        = string
  default     = null
  nullable    = true
}

variable "create_github_oidc_provider" {
  description = "Create GitHub's OIDC identity provider rather than using the one already in the account. It is an account-wide singleton — see infra/modules/deploy/oidc.tf. Check with `aws iam list-open-id-connect-providers` before setting this true."
  type        = bool
  default     = false
}

# --- backup ----------------------------------------------------------------

variable "backup_retention_days" {
  description = "Days a deleted or overwritten document version is kept in the backup bucket. See infra/modules/backup/README.md and docs/data-retention.md."
  type        = number
  default     = 35
}

# Security review, plan row 4.12. `aws ecs execute-command` opens an
# interactive shell in a running task. That task holds the Secrets Manager
# values decrypted into its environment — the database URL and every LLM
# provider key — and the task role's access to the document bucket. ECS
# records that a session started; without an execute_command_configuration on
# the cluster it records nothing of what was typed or displayed.
#
# Enabling the logging instead would create a second CloudWatch store holding
# whatever a shell session shows, which for this product is client documents,
# and unlike the application logs nothing would redact it.
#
# So it is off. Nothing in docs/ documents a procedure that uses it. Turn it
# on deliberately, for as long as a diagnosis needs, rather than leaving an
# unrecorded route into production standing open.
variable "enable_ecs_exec" {
  description = "Allow `aws ecs execute-command` to open a shell in a running task, and grant the task roles the SSM Messages permissions it needs. Off in production: the session is unrecorded and the task holds decrypted secrets."
  type        = bool
  default     = false
}

# --- stage 5: the self-hosted platform ----------------------------------------------

# Stage 5 (docs/delivery-plan/v2/plan.md) stands PostgreSQL, PostgREST and
# GoTrue up in this account beside the live Supabase-backed service, and
# nothing in it is a prerequisite for going live. Its first human task is to
# approve the running cost, so every stage 5 module is created only when this
# is true; the default leaves an apply exactly as it was.
variable "platform_enabled" {
  description = "Create the stage 5 platform modules (the RDS database first; PostgREST, GoTrue and their routing follow). false until Stage 5, Task 1 has approved the cost."
  type        = bool
  default     = false
}

variable "database_instance_class" {
  description = "RDS instance class — Stage 5, Task 1's first decision. See infra/modules/database/README.md."
  type        = string
  default     = "db.t4g.small"
}

variable "database_multi_az" {
  description = "Standby in a second availability zone — Stage 5, Task 1's second decision. Roughly doubles the database cost."
  type        = bool
  default     = false
}

variable "database_backup_retention_days" {
  description = "Days of automated database backups and point-in-time recovery. 35 matches the document bucket's backup retention; the RDS maximum."
  type        = number
  default     = 35
}
