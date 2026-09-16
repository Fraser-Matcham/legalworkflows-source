# Image scanning for the whole private registry.
#
# This is an ACCOUNT-WIDE, PER-REGION SINGLETON, like the GitHub OIDC provider.
# It is declared at the root rather than inside a module for that reason: it is
# not this project's to own exclusively, and the account is shared with another
# project whose repositories live in the same registry.
#
# Why enhanced. Basic scanning reports a CVE but never says whether a fix
# exists, so the release gate could only ever be "zero high or critical" — and
# a Debian base image ships with unfixable CVEs, which made that gate
# unpassable rather than strict. Enhanced scanning is Amazon Inspector, and its
# findings carry `fixAvailable`, so the gate can refuse what is actionable and
# let through what nobody can currently act on. It also covers language
# packages, not just OS packages, so it sees more than basic did.
#
# Why the second rule matters. Under ENHANCED, a repository matching no filter
# has scanning DISABLED — not downgraded to basic, off. Filtering to this
# project's repositories alone would therefore silently stop scanning the other
# project's images. The wildcard rule keeps every repository in the registry
# covered; ECR applies the continuous filter in preference where both match, so
# this project's images are scanned continuously and everything else on push.
#
# Cost: Inspector charges per image scanned, and continuous scanning re-scans
# when a relevant CVE is published. Enabling this bills the whole registry, not
# only this project's repositories.
resource "aws_ecr_registry_scanning_configuration" "this" {
  scan_type = "ENHANCED"

  # This project's images: re-scanned whenever a relevant CVE is published, not
  # only at push, so a running release is judged against today's CVE list.
  # A filter without a wildcard matches any repository name containing it.
  rule {
    scan_frequency = "CONTINUOUS_SCAN"
    repository_filter {
      filter      = local.name_prefix
      filter_type = "WILDCARD"
    }
  }

  # Everything else in the shared registry, so nothing loses coverage.
  rule {
    scan_frequency = "SCAN_ON_PUSH"
    repository_filter {
      filter      = "*"
      filter_type = "WILDCARD"
    }
  }
}
