# Remote state. The bucket is the one resource created by hand (Stage 3, Task 4
# in docs/delivery-plan/v2/human-tasks/stage-3-infrastructure.md) because state
# has to live somewhere before Terraform can manage anything.
#
# The bucket name embeds the AWS account id, which is not known until that
# account exists, so the values live in backend.hcl (gitignored) rather than
# here. Copy backend.hcl.example and run:
#
#   terraform init -backend-config=backend.hcl
#
# Locking uses Terraform's native S3 lock file (use_lockfile), so no DynamoDB
# table is needed. Versioning on the bucket is what makes a corrupted state
# recoverable.
terraform {
  backend "s3" {
    use_lockfile = true
    encrypt      = true
  }
}
