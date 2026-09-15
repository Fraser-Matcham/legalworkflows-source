# The hosted zone is created by hand in Stage 3, Task 7 — before Terraform
# runs — so that the registrar's nameserver change has the 48 hours it can take
# to propagate while everything else is being built, and so that certificate
# validation below can complete on the first apply. Terraform then IMPORTS it
# (infra/imports.tf) and owns it from that point on: this resource describes
# the zone Task 7 made, and a later apply that found it drifting would say so.
resource "aws_route53_zone" "this" {
  name    = var.domain_name
  comment = "${var.name_prefix}: public zone for ${var.domain_name}. Created by hand in Stage 3 Task 7, then imported; managed by Terraform since."

  tags = { Name = var.domain_name }

  lifecycle {
    # The zone is the one thing a `terraform destroy` must never take with it:
    # its nameservers are what the registrar points at, and a new zone gets
    # new ones.
    prevent_destroy = true
  }
}
