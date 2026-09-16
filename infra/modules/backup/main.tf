# Every object in the documents bucket, replicated as it is written into a
# second bucket that nothing else can write to, under a different key, and
# kept there for retention_days after it is deleted or overwritten in the
# live bucket. This is the object-storage half of ticket 2095; the database
# half is Supabase's own backups (docs/runbooks/restore.md).
#
# Same region, deliberately. A region-wide S3 outage is far rarer than the
# failure this protects against — a bug or a person deleting the wrong thing —
# and cross-region replication would add data-transfer cost and a second KMS
# region for a risk the runbook can accept for now.

data "aws_region" "current" {}

locals {
  bucket_name = "${var.name_prefix}-documents-backup-${var.account_id}"
}

# Its own key: a compromised or scheduled-for-deletion documents key must not
# take the backup with it.
resource "aws_kms_key" "backup" {
  description             = "${var.name_prefix} document backup bucket"
  enable_key_rotation     = true
  deletion_window_in_days = var.kms_deletion_window_in_days

  tags = { Name = "${var.name_prefix}-documents-backup" }
}

resource "aws_kms_alias" "backup" {
  name          = "alias/${var.name_prefix}-documents-backup"
  target_key_id = aws_kms_key.backup.key_id
}

resource "aws_s3_bucket" "backup" {
  bucket        = local.bucket_name
  force_destroy = false

  tags = { Name = local.bucket_name }
}

resource "aws_s3_bucket_ownership_controls" "backup" {
  bucket = aws_s3_bucket.backup.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "backup" {
  bucket = aws_s3_bucket.backup.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Replication requires versioning on both ends; here it is also what makes
# the bucket a backup — a delete in the live bucket arrives as a marker and
# the bytes stay as a noncurrent version until the lifecycle rule ages them.
resource "aws_s3_bucket_versioning" "backup" {
  bucket = aws_s3_bucket.backup.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backup" {
  bucket = aws_s3_bucket.backup.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.backup.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "backup" {
  bucket = aws_s3_bucket.backup.id

  # The retention window. A version that is current in the live bucket is
  # current here too and never expires; one that was deleted or replaced
  # there becomes noncurrent here and leaves after retention_days.
  rule {
    id     = "retain-then-expire-noncurrent"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = var.retention_days
    }

    expiration {
      expired_object_delete_marker = true
    }
  }

  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  depends_on = [aws_s3_bucket_versioning.backup]
}

# Only S3 replication writes objects here. The storage user, the tasks and
# anyone else with account access can read for a restore but cannot put,
# delete or change versions — which is the property that makes this a backup
# rather than a copy. Bucket configuration (lifecycle, versioning, policy) is
# deliberately NOT denied: Terraform runs as an ordinary IAM user, not the
# account root, and must keep being able to manage the bucket it created.
data "aws_iam_policy_document" "backup_bucket" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.backup.arn, "${aws_s3_bucket.backup.arn}/*"]
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  statement {
    sid    = "OnlyReplicationWritesObjects"
    effect = "Deny"
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    actions = [
      "s3:PutObject",
      "s3:PutObjectAcl",
      "s3:PutObjectTagging",
      "s3:DeleteObject",
      "s3:DeleteObjectVersion",
      "s3:DeleteObjectTagging",
      "s3:DeleteObjectVersionTagging",
    ]
    resources = ["${aws_s3_bucket.backup.arn}/*"]
    condition {
      test     = "ArnNotEquals"
      variable = "aws:PrincipalArn"
      values   = [aws_iam_role.replication.arn]
    }
    # Replication writes with s3:Replicate* actions, and the lifecycle rule
    # acts as the service rather than as a principal; neither is affected.
    # The role is exempted anyway so a future change to how replication is
    # authorised cannot silently stop the backup.
  }
}

resource "aws_s3_bucket_policy" "backup" {
  bucket = aws_s3_bucket.backup.id
  policy = data.aws_iam_policy_document.backup_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.backup]
}
