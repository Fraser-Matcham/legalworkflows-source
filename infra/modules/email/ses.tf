# The domain identity. SES proves ownership through the DKIM CNAMEs below —
# no separate verification TXT record is needed once those resolve.
resource "aws_sesv2_email_identity" "domain" {
  email_identity         = var.domain_name
  configuration_set_name = aws_sesv2_configuration_set.transactional.configuration_set_name

  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }

  tags = { Name = "${var.name_prefix}-${var.domain_name}" }
}

# Easy DKIM: three CNAMEs SES rotates the keys behind on its own.
resource "aws_route53_record" "dkim" {
  count = 3

  zone_id = var.zone_id
  name    = "${aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens[count.index]}._domainkey.${var.domain_name}"
  type    = "CNAME"
  ttl     = 600
  records = ["${aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"]
}

# A custom MAIL FROM so the envelope sender is under our domain. SPF then
# aligns with the From header, which is one of the two ways a message passes
# DMARC (DKIM alignment is the other; with both, one can fail).
resource "aws_sesv2_email_identity_mail_from_attributes" "domain" {
  email_identity         = aws_sesv2_email_identity.domain.email_identity
  mail_from_domain       = local.mail_from_domain
  behavior_on_mx_failure = "USE_DEFAULT_VALUE"
}

resource "aws_route53_record" "mail_from_mx" {
  zone_id = var.zone_id
  name    = local.mail_from_domain
  type    = "MX"
  ttl     = 600
  records = ["10 feedback-smtp.${var.region}.amazonses.com"]
}

resource "aws_route53_record" "mail_from_spf" {
  zone_id = var.zone_id
  name    = local.mail_from_domain
  type    = "TXT"
  ttl     = 600
  records = ["v=spf1 include:amazonses.com -all"]
}

# DMARC on the apex. The policy starts at "none" so misalignment is reported
# rather than enforced; the README says when to tighten it.
resource "aws_route53_record" "dmarc" {
  zone_id = var.zone_id
  name    = "_dmarc.${var.domain_name}"
  type    = "TXT"
  ttl     = 600
  records = [local.dmarc_record]
}

# One configuration set for all transactional mail: TLS to the recipient's
# server or nothing, reputation metrics on, and SES's account-level
# suppression list applied so an address that bounced or complained is not
# mailed again — the "process for handling bounces and complaints" the
# production-access request describes.
resource "aws_sesv2_configuration_set" "transactional" {
  configuration_set_name = "${var.name_prefix}-transactional"

  delivery_options {
    tls_policy = "REQUIRE"
  }

  reputation_options {
    reputation_metrics_enabled = true
  }

  sending_options {
    sending_enabled = true
  }

  suppression_options {
    suppressed_reasons = ["BOUNCE", "COMPLAINT"]
  }

  tags = { Name = "${var.name_prefix}-transactional" }
}

# Bounces, complaints and rejects go to the alerts topic so a person sees
# them. Deliveries do not; at this volume every successful send would be
# noise.
resource "aws_sesv2_configuration_set_event_destination" "alerts" {
  configuration_set_name = aws_sesv2_configuration_set.transactional.configuration_set_name
  event_destination_name = "bounces-and-complaints"

  event_destination {
    enabled              = true
    matching_event_types = ["BOUNCE", "COMPLAINT", "REJECT"]

    sns_destination {
      topic_arn = var.event_topic_arn
    }
  }
}

locals {
  mail_from_domain = "${var.mail_from_subdomain}.${var.domain_name}"
  sender_address   = "${var.sender_local_part}@${var.domain_name}"

  dmarc_record = join("; ", compact([
    "v=DMARC1",
    "p=${var.dmarc_policy}",
    var.dmarc_report_address == null ? "" : "rua=mailto:${var.dmarc_report_address}",
    "adkim=s",
    "aspf=s",
  ]))
}
