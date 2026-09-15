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

variable "workflows_repository" {
  description = "MIKE_WORKFLOWS_REPOSITORY: the owner/repo of the workflow catalogue. Point this at your own fork (AGENTS.md rule 2 — the variable name stays, the value is ownership)."
  type        = string
  default     = "Open-Legal-Products/mike-workflows"

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.workflows_repository))
    error_message = "workflows_repository must use the owner/repository form."
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

variable "github_repository" {
  description = "owner/repo whose GitHub Actions workflows may assume the deploy role."
  type        = string
  default     = "Fraser-Matcham/legalworkflows"
}

variable "deploy_branches" {
  description = "Branches whose pushes may deploy. See infra/modules/deploy/README.md."
  type        = list(string)
  default     = ["main"]
}

variable "deploy_environments" {
  description = "GitHub Actions environments whose jobs may deploy."
  type        = list(string)
  default     = ["production"]
}

variable "deploy_role_name" {
  description = "Name of the deploy role created by hand in Stage 3, Task 5 and imported by infra/imports.tf."
  type        = string
  default     = "github-actions-deploy"
}

# --- backup ----------------------------------------------------------------

variable "backup_retention_days" {
  description = "Days a deleted or overwritten document version is kept in the backup bucket. See infra/modules/backup/README.md and docs/data-retention.md."
  type        = number
  default     = 35
}
