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

# The deploy role and GitHub's OIDC provider are NOT imported. Terraform
# creates the role itself, under a prefixed name that cannot collide in a
# shared account, and looks the account-wide OIDC provider up rather than
# adopting it (see modules/deploy/oidc.tf). Stage 3, Task 5's hand-made pair
# is therefore no longer needed; if an earlier run of this stage created a
# role called `github-actions-deploy`, it is unused and can be deleted.
