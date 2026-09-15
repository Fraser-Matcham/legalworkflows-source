provider "aws" {
  region = var.aws_region

  # Every resource carries these, so cost and ownership are attributable
  # without relying on anyone remembering to tag by hand.
  default_tags {
    tags = local.common_tags
  }
}

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}
