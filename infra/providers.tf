provider "aws" {
  region = var.aws_region

  # Every resource carries these, so cost and ownership are attributable
  # without relying on anyone remembering to tag by hand.
  default_tags {
    tags = local.common_tags
  }
}

# CloudFront reads its TLS certificate from us-east-1 regardless of where the
# footprint runs. Only the dns module uses this alias, for that one
# certificate; everything else stays in var.aws_region.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = local.common_tags
  }
}

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}
