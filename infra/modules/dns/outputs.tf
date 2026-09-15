output "zone_id" {
  description = "For the alias records the backend (ALB) and frontend (CloudFront) modules create."
  value       = aws_route53_zone.this.zone_id
}

output "name_servers" {
  description = "Must match what the registrar points at (Stage 3, Task 7)."
  value       = aws_route53_zone.this.name_servers
}

output "domain_name" {
  value = var.domain_name
}

output "origin_fqdn" {
  description = "The load balancer's hostname, and CloudFront's origin domain name."
  value       = local.origin_fqdn
}

# Both ARNs come from the *validation* resource, not the certificate: a
# consumer that references the certificate directly can be created before
# validation completes and then fail to bind. Depending on the validation
# resource sequences it correctly.
output "apex_certificate_arn" {
  description = "us-east-1 certificate for https://<domain>, for CloudFront."
  value       = aws_acm_certificate_validation.apex.certificate_arn
}

output "origin_certificate_arn" {
  description = "Regional certificate for https://origin.<domain>, for the ALB's HTTPS listener."
  value       = aws_acm_certificate_validation.origin.certificate_arn
}
