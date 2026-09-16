# `dns`

Row 3.7 of the Stage 3 table. The hosted zone and the two certificates. The
alias records that point names at things live with the things: the ALB's
record in `backend`, CloudFront's in `frontend`. That avoids a cycle (the ALB
needs this module's certificate; a record for the ALB needs the ALB).

## The zone is imported, not created

Stage 3, Task 7 has the operator create the hosted zone in the console and
switch the registrar's nameservers to it *before* Terraform runs — because
propagation can take up to 48 hours, and because the certificates below
validate by DNS and cannot complete until the zone is authoritative. Creating
the zone in Terraform would either put that wait on the critical path of the
first apply, or create a second zone with different nameservers.

So the operator reports the **Hosted zone ID** in Task 7, it goes into
`route53_zone_id` in `terraform.tfvars`, and `infra/imports.tf` imports the
existing zone into `module.dns.aws_route53_zone.this` on the first apply.
From then on Terraform owns it: the resource describes the zone, drift is
reported, and `prevent_destroy` stops a `terraform destroy` from taking the
nameservers the registrar points at.

## Two certificates

| Certificate | Region | Covers | Used by |
| --- | --- | --- | --- |
| `apex` | `us-east-1` | `legalworkflows.co.uk` | CloudFront — which reads certificates from `us-east-1` only |
| `origin` | the footprint's region | `origin.legalworkflows.co.uk` | the ALB's HTTPS listener |

**Why the ALB gets a name of its own.** CloudFront connects to its origin over
HTTPS and verifies the certificate against the origin hostname it was
configured with. An ALB's default `*.elb.amazonaws.com` name carries no
certificate we control, so the ALB is given `origin.<domain>` in our zone and a
certificate for exactly that. Users never see the name; the `network` module's
security group means only CloudFront can connect to it anyway.

Both validate by DNS. Consumers take the ARN from the *validation* resource
so they cannot bind a certificate that has not finished validating.

## Inputs

| Name | Default | Purpose |
| --- | --- | --- |
| `name_prefix` | — | Resource names and tags |
| `domain_name` | — | The apex (root `var.domain_name`) |
| `origin_subdomain` | `origin` | Label for the ALB's hostname |

The module also requires an aliased provider: `providers = { aws = aws, aws.us_east_1 = aws.us_east_1 }`.

## Outputs

`zone_id`, `name_servers`, `domain_name`, `origin_fqdn`,
`apex_certificate_arn`, `origin_certificate_arn`.
