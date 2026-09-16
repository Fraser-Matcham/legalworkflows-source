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
