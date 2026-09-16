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

# Stage 3, Task 5 creates GitHub's identity provider and the deploy role by
# hand with broad permissions; the deploy module narrows both. Adopting them
# rather than creating a second pair keeps the ARN the operator was told to
# copy into GitHub valid. Delete these two blocks if Task 5 was skipped.
import {
  to = module.deploy.aws_iam_openid_connect_provider.github
  id = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/token.actions.githubusercontent.com"
}

import {
  to = module.deploy.aws_iam_role.github_actions
  id = var.deploy_role_name
}
