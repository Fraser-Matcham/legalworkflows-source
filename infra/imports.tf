# Resources that exist before Terraform does, adopted rather than recreated.
#
# The hosted zone: created by hand in Stage 3, Task 7 so that nameserver
# propagation and certificate validation are not on the first apply's critical
# path. See modules/dns/README.md. Once imported, this block is a no-op on
# every later plan.
import {
  to = module.dns.aws_route53_zone.this
  id = var.route53_zone_id
}
