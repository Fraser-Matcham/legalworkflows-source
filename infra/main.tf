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
}

module "backend" {
  source = "./modules/backend"

  name_prefix = local.name_prefix
  region      = data.aws_region.current.region

  vpc_id                     = module.network.vpc_id
  public_subnet_ids          = module.network.public_subnet_ids
  private_subnet_ids         = module.network.private_subnet_ids
  alb_security_group_id      = module.network.alb_security_group_id
  backend_security_group_id  = module.network.backend_security_group_id
  frontend_security_group_id = module.network.frontend_security_group_id

  execution_role_arn = module.secrets.backend_execution_role_arn
  task_role_arn      = module.secrets.backend_task_role_arn
  ecs_secrets        = module.secrets.backend_ecs_secrets
  extra_secret_keys  = var.backend_extra_secret_keys

  certificate_arn = module.dns.origin_certificate_arn
  zone_id         = module.dns.zone_id
  origin_fqdn     = module.dns.origin_fqdn
  domain_name     = var.domain_name

  supabase_url             = var.supabase_url
  supabase_publishable_key = var.supabase_publishable_key
  storage_endpoint_url     = module.storage.endpoint_url
  storage_bucket_name      = module.storage.bucket_name
  workflows_repository     = var.workflows_repository
  workflows_ref            = var.workflows_ref
  image_tag                = var.backend_image_tag
}

module "frontend" {
  source = "./modules/frontend"

  name_prefix = local.name_prefix
  region      = data.aws_region.current.region

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

  github_repository   = var.github_repository
  deploy_branches     = var.deploy_branches
  deploy_environments = var.deploy_environments
  role_name           = var.deploy_role_name

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
