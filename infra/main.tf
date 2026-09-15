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
