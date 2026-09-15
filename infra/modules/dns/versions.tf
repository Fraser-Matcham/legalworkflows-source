terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
      # CloudFront only accepts certificates from us-east-1, whatever region the
      # rest of the footprint is in. The root passes an aliased provider for it.
      configuration_aliases = [aws.us_east_1]
    }
  }
}
