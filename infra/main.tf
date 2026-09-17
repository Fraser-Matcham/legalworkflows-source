# Root wiring. One module per row of the Stage 3 table in
# docs/delivery-plan/v2/plan.md, in dependency order.

module "network" {
  source = "./modules/network"

  name_prefix        = local.name_prefix
  vpc_cidr           = var.vpc_cidr
  single_nat_gateway = var.single_nat_gateway
}

module "storage" {
  source = "./modules/storage"

  name_prefix     = local.name_prefix
  account_id      = data.aws_caller_identity.current.account_id
  allowed_origins = ["https://${var.domain_name}"]
}

module "dns" {
  source = "./modules/dns"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  name_prefix      = local.name_prefix
  domain_name      = var.domain_name
  origin_subdomain = var.origin_subdomain
}

module "secrets" {
  source = "./modules/secrets"

  name_prefix               = local.name_prefix
  account_id                = data.aws_caller_identity.current.account_id
  region                    = data.aws_region.current.region
  storage_access_key_id     = module.storage.access_key_id
  storage_secret_access_key = module.storage.secret_access_key
  enable_ecs_exec           = var.enable_ecs_exec

  # Stage 5: the backend reads its Supabase keys from the platform's api-keys
  # secret once it is served by the platform.
  extra_readable_secret_arns = var.platform_enabled ? [module.keys[0].api_keys_secret_arn] : []
}

module "backend" {
  source = "./modules/backend"

  enable_ecs_exec = var.enable_ecs_exec

  name_prefix       = local.name_prefix
  short_name_prefix = local.short_name_prefix
  region            = data.aws_region.current.region

  vpc_id                     = module.network.vpc_id
  public_subnet_ids          = module.network.public_subnet_ids
  private_subnet_ids         = module.network.private_subnet_ids
  alb_security_group_id      = module.network.alb_security_group_id
  backend_security_group_id  = module.network.backend_security_group_id
  frontend_security_group_id = module.network.frontend_security_group_id

  execution_role_arn = module.secrets.backend_execution_role_arn
  task_role_arn      = module.secrets.backend_task_role_arn

  # Stage 5, ticket 2122: with platform_serves_backend, the two Supabase keys
  # map to the platform's api-keys secret (the merge overrides the operator
  # secret's SUPABASE_SECRET_KEY) and the publishable key is injected as a
  # secret rather than set as environment.
  ecs_secrets = merge(
    module.secrets.backend_ecs_secrets,
    var.platform_serves_backend ? {
      SUPABASE_SECRET_KEY      = module.keys[0].ecs_secrets["SUPABASE_SECRET_KEY"]
      SUPABASE_PUBLISHABLE_KEY = module.keys[0].ecs_secrets["SUPABASE_PUBLISHABLE_KEY"]
    } : {},
  )
  extra_secret_keys = concat(
    var.backend_extra_secret_keys,
    var.platform_serves_backend ? ["SUPABASE_PUBLISHABLE_KEY"] : [],
  )

  certificate_arn = module.dns.origin_certificate_arn
  zone_id         = module.dns.zone_id
  origin_fqdn     = module.dns.origin_fqdn
  domain_name     = var.domain_name

  supabase_url             = var.platform_serves_backend ? "https://${var.domain_name}" : var.supabase_url
  supabase_publishable_key = var.platform_serves_backend ? null : var.supabase_publishable_key
  storage_endpoint_url     = module.storage.endpoint_url
  storage_bucket_name      = module.storage.bucket_name
  workflows_repository     = var.workflows_repository
  workflows_ref            = var.workflows_ref
  image_tag                = var.backend_image_tag
}

module "frontend" {
  source = "./modules/frontend"

  enable_ecs_exec = var.enable_ecs_exec

  name_prefix       = local.name_prefix
  short_name_prefix = local.short_name_prefix
  region            = data.aws_region.current.region

  vpc_id                     = module.network.vpc_id
  private_subnet_ids         = module.network.private_subnet_ids
  frontend_security_group_id = module.network.frontend_security_group_id

  execution_role_arn = module.secrets.frontend_execution_role_arn
  task_role_arn      = module.secrets.frontend_task_role_arn

  cluster_arn                   = module.backend.cluster_arn
  cluster_name                  = module.backend.cluster_name
  service_connect_namespace_arn = module.backend.service_connect_namespace_arn
  api_base_url                  = module.backend.service_connect_backend_url
  https_listener_arn            = module.backend.https_listener_arn
  origin_verify_secret          = module.backend.origin_verify_secret
  origin_fqdn                   = module.dns.origin_fqdn

  domain_name          = var.domain_name
  zone_id              = module.dns.zone_id
  apex_certificate_arn = module.dns.apex_certificate_arn

  image_tag = var.frontend_image_tag

  # Stage 5: /rest/v1 and /auth/v1 to the platform services (ticket 2123).
  platform_routes_enabled = var.platform_enabled
}

module "observability" {
  source = "./modules/observability"

  name_prefix = local.name_prefix
  region      = data.aws_region.current.region
  account_id  = data.aws_caller_identity.current.account_id

  alert_email       = var.alert_email
  urgent_sms_number = var.urgent_sms_number

  alb_arn_suffix                   = module.backend.alb_arn_suffix
  backend_target_group_arn_suffix  = module.backend.backend_target_group_arn_suffix
  frontend_target_group_arn_suffix = module.frontend.target_group_arn_suffix
  cluster_name                     = module.backend.cluster_name
  cluster_arn                      = module.backend.cluster_arn
  backend_service_name             = module.backend.service_name
  frontend_service_name            = module.frontend.service_name
  backend_log_group_name           = module.backend.log_group_name
  cloudfront_distribution_id       = module.frontend.distribution_id

  # Stage 5: null and empty until the platform exists, and then its alarms
  # appear alongside the backend's and frontend's.
  database_instance_identifier = one(module.database[*].instance_identifier)
  extra_services = var.platform_enabled ? {
    postgrest = module.postgrest[0].service_name
    gotrue    = module.gotrue[0].service_name
  } : {}
  extra_target_groups = var.platform_enabled ? {
    postgrest = module.postgrest[0].target_group_arn_suffix
    gotrue    = module.gotrue[0].target_group_arn_suffix
  } : {}
}

module "email" {
  source = "./modules/email"

  name_prefix = local.name_prefix
  region      = data.aws_region.current.region
  account_id  = data.aws_caller_identity.current.account_id

  domain_name          = var.domain_name
  zone_id              = module.dns.zone_id
  dmarc_policy         = var.dmarc_policy
  dmarc_report_address = var.dmarc_report_address
  event_topic_arn      = module.observability.informational_topic_arn
}

module "deploy" {
  source = "./modules/deploy"

  name_prefix = local.name_prefix
  region      = data.aws_region.current.region
  account_id  = data.aws_caller_identity.current.account_id

  github_repository    = var.github_repository
  deploy_branches      = var.deploy_branches
  deploy_environments  = var.deploy_environments
  role_name            = coalesce(var.deploy_role_name, "${local.name_prefix}-github-actions")
  create_oidc_provider = var.create_github_oidc_provider

  ecr_repository_arns = [
    module.backend.ecr_repository_arn,
    module.frontend.ecr_repository_arn,
  ]
  cluster_name             = module.backend.cluster_name
  cluster_arn              = module.backend.cluster_arn
  service_names            = [module.backend.service_name, module.frontend.service_name]
  task_definition_families = [module.backend.task_definition_family, module.frontend.task_definition_family]
  passable_role_arns = [
    module.secrets.backend_execution_role_arn,
    module.secrets.backend_task_role_arn,
    module.secrets.frontend_execution_role_arn,
    module.secrets.frontend_task_role_arn,
  ]
  log_group_names             = [module.backend.log_group_name, module.frontend.log_group_name]
  cloudfront_distribution_arn = module.frontend.distribution_arn

  # The newest migration file in the repository at the time of the first
  # apply: schema.sql, which the database was installed from, already
  # contains everything up to it (the schema-drift CI check proves that).
  initial_last_migration = reverse(sort(tolist(fileset("${path.root}/../backend/migrations", "*.sql"))))[0]
}

module "backup" {
  source = "./modules/backup"

  name_prefix = local.name_prefix
  account_id  = data.aws_caller_identity.current.account_id

  source_bucket_name = module.storage.versioned_bucket_id
  source_bucket_arn  = module.storage.bucket_arn
  source_kms_key_arn = module.storage.kms_key_arn
  retention_days     = var.backup_retention_days
}

# --- stage 5: the self-hosted platform ----------------------------------------------
# One module per row of the Stage 5 table, all gated on platform_enabled.

module "database" {
  count  = var.platform_enabled ? 1 : 0
  source = "./modules/database"

  name_prefix        = local.name_prefix
  vpc_id             = module.network.vpc_id
  private_subnet_ids = module.network.private_subnet_ids

  # The backend is admitted because ticket 2112 says so and because the
  # migration job may one day run from its image; it opens no connection
  # today. PostgREST, GoTrue and the database-tools task add their own rules.
  client_security_group_ids = {
    backend = module.network.backend_security_group_id
  }

  instance_class        = var.database_instance_class
  multi_az              = var.database_multi_az
  backup_retention_days = var.database_backup_retention_days
}

module "keys" {
  count  = var.platform_enabled ? 1 : 0
  source = "./modules/keys"

  name_prefix = local.name_prefix
}

module "postgrest" {
  count  = var.platform_enabled ? 1 : 0
  source = "./modules/postgrest"

  name_prefix       = local.name_prefix
  short_name_prefix = local.short_name_prefix
  region            = data.aws_region.current.region
  account_id        = data.aws_caller_identity.current.account_id
  enable_ecs_exec   = var.enable_ecs_exec

  vpc_id                     = module.network.vpc_id
  private_subnet_ids         = module.network.private_subnet_ids
  alb_security_group_id      = module.network.alb_security_group_id
  backend_security_group_id  = module.network.backend_security_group_id
  database_security_group_id = module.database[0].security_group_id

  cluster_arn                   = module.backend.cluster_arn
  cluster_name                  = module.backend.cluster_name
  service_connect_namespace_arn = module.backend.service_connect_namespace_arn
  https_listener_arn            = module.backend.https_listener_arn
  origin_verify_secret          = module.backend.origin_verify_secret

  database_uri_secret_arn = module.database[0].roles_secret_arn
  database_kms_key_arn    = module.database[0].kms_key_arn
  jwt_secret_arn          = module.keys[0].jwt_secret_arn
  jwt_secret_valuefrom    = module.keys[0].ecs_secrets["PGRST_JWT_SECRET"]
}

module "gotrue" {
  count  = var.platform_enabled ? 1 : 0
  source = "./modules/gotrue"

  name_prefix       = local.name_prefix
  short_name_prefix = local.short_name_prefix
  region            = data.aws_region.current.region
  account_id        = data.aws_caller_identity.current.account_id
  domain_name       = var.domain_name
  enable_ecs_exec   = var.enable_ecs_exec

  vpc_id                     = module.network.vpc_id
  private_subnet_ids         = module.network.private_subnet_ids
  alb_security_group_id      = module.network.alb_security_group_id
  backend_security_group_id  = module.network.backend_security_group_id
  database_security_group_id = module.database[0].security_group_id

  cluster_arn                   = module.backend.cluster_arn
  cluster_name                  = module.backend.cluster_name
  service_connect_namespace_arn = module.backend.service_connect_namespace_arn
  https_listener_arn            = module.backend.https_listener_arn
  origin_verify_secret          = module.backend.origin_verify_secret

  database_uri_secret_arn = module.database[0].roles_secret_arn
  database_kms_key_arn    = module.database[0].kms_key_arn
  jwt_secret_arn          = module.keys[0].jwt_secret_arn
  jwt_secret_valuefrom    = module.keys[0].ecs_secrets["GOTRUE_JWT_SECRET"]

  smtp_secret_arn = module.email.smtp_secret_arn
  smtp_host       = module.email.smtp_host
  smtp_port       = module.email.smtp_port
  sender_address  = module.email.sender_address
  sender_name     = module.email.sender_name

  google_oauth_enabled = var.gotrue_google_oauth_enabled
  extra_redirect_urls  = var.gotrue_extra_redirect_urls
}
