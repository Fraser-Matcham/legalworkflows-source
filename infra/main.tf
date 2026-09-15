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
