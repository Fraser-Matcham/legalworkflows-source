locals {
  name_prefix = "${var.project}-${var.environment}"

  # Load balancers and target groups are capped at 32 characters by the ELB
  # API, far shorter than every other name in this footprint, and
  # "<project>-production-frontend" already exceeds it. These few resources
  # therefore use a shortened environment: the first four characters, which
  # are unambiguous for every environment name anyone would choose, rather
  # than a blind truncation that could cut a word in half or collide.
  short_name_prefix = "${var.project}-${substr(var.environment, 0, 4)}"

  common_tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
    Repository  = "Fraser-Matcham/legalworkflows"
  }
}
