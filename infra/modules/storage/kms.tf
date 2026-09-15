# A customer-managed key rather than the S3-managed default (SSE-S3): it can
# be rotated, its use is logged per call in CloudTrail, and access to the
# bytes can be revoked at the key without touching the bucket. The default key
# policy gives the account root full control, which is what lets the IAM
# policy in iam.tf grant the storage user its narrow set of key actions.
resource "aws_kms_key" "documents" {
  description             = "${var.name_prefix} document bucket"
  enable_key_rotation     = true
  deletion_window_in_days = var.kms_deletion_window_in_days

  tags = { Name = "${var.name_prefix}-documents" }
}

resource "aws_kms_alias" "documents" {
  name          = "alias/${var.name_prefix}-documents"
  target_key_id = aws_kms_key.documents.key_id
}
