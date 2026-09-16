# Two certificates, because two AWS services terminate TLS at two places:
#
#   apex   (us-east-1)  — CloudFront, for https://<domain>. CloudFront reads
#                         certificates from us-east-1 only.
#   origin (regional)   — the ALB, for https://origin.<domain>, which is the
#                         hostname CloudFront connects to and verifies.
#
# Both validate by DNS record in the zone above, which is why the zone has to
# exist and be delegated before the first apply: with the registrar still
# pointing elsewhere, validation waits until it is, and so does everything
# downstream of the certificates.

locals {
  origin_fqdn = "${var.origin_subdomain}.${var.domain_name}"
}

# --- apex, for CloudFront -----------------------------------------------------

resource "aws_acm_certificate" "apex" {
  provider = aws.us_east_1

  domain_name       = var.domain_name
  validation_method = "DNS"

  tags = { Name = "${var.name_prefix}-apex" }

  lifecycle {
    # A renewed or reissued certificate is created before the old one is
    # removed, so the distribution never points at a deleted certificate.
    create_before_destroy = true
  }
}

resource "aws_route53_record" "apex_validation" {
  for_each = {
    for dvo in aws_acm_certificate.apex.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id         = aws_route53_zone.this.zone_id
  name            = each.value.name
  type            = each.value.type
  ttl             = 60
  records         = [each.value.record]
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "apex" {
  provider = aws.us_east_1

  certificate_arn         = aws_acm_certificate.apex.arn
  validation_record_fqdns = [for record in aws_route53_record.apex_validation : record.fqdn]
}

# --- origin, for the load balancer -------------------------------------------

resource "aws_acm_certificate" "origin" {
  domain_name       = local.origin_fqdn
  validation_method = "DNS"

  tags = { Name = "${var.name_prefix}-origin" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "origin_validation" {
  for_each = {
    for dvo in aws_acm_certificate.origin.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id         = aws_route53_zone.this.zone_id
  name            = each.value.name
  type            = each.value.type
  ttl             = 60
  records         = [each.value.record]
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "origin" {
  certificate_arn         = aws_acm_certificate.origin.arn
  validation_record_fqdns = [for record in aws_route53_record.origin_validation : record.fqdn]
}
