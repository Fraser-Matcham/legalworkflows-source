data "aws_iam_policy_document" "replication_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["s3.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [var.account_id]
    }
  }
}

resource "aws_iam_role" "replication" {
  name               = "${var.name_prefix}-s3-replication"
  path               = "/service/"
  description        = "Assumed by S3 to replicate the documents bucket into its backup bucket."
  assume_role_policy = data.aws_iam_policy_document.replication_trust.json

  tags = { Name = "${var.name_prefix}-s3-replication" }
}

data "aws_iam_policy_document" "replication" {
  statement {
    sid    = "ReadSourceBucket"
    effect = "Allow"
    actions = [
      "s3:GetReplicationConfiguration",
      "s3:ListBucket",
    ]
    resources = [var.source_bucket_arn]
  }

  statement {
    sid    = "ReadSourceVersions"
    effect = "Allow"
    actions = [
      "s3:GetObjectVersionForReplication",
      "s3:GetObjectVersionAcl",
      "s3:GetObjectVersionTagging",
    ]
    resources = ["${var.source_bucket_arn}/*"]
  }

  statement {
    sid    = "WriteReplicas"
    effect = "Allow"
    actions = [
      "s3:ReplicateObject",
      "s3:ReplicateDelete",
      "s3:ReplicateTags",
    ]
    resources = ["${aws_s3_bucket.backup.arn}/*"]
  }

  statement {
    sid       = "DecryptSource"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = [var.source_kms_key_arn]
    condition {
      test     = "StringLike"
      variable = "kms:ViaService"
      values   = ["s3.${data.aws_region.current.region}.amazonaws.com"]
    }
  }

  statement {
    sid       = "EncryptReplicas"
    effect    = "Allow"
    actions   = ["kms:Encrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.backup.arn]
    condition {
      test     = "StringLike"
      variable = "kms:ViaService"
      values   = ["s3.${data.aws_region.current.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "replication" {
  name   = "replicate-documents"
  role   = aws_iam_role.replication.name
  policy = data.aws_iam_policy_document.replication.json
}

# Configured on the SOURCE bucket. source_bucket_name is the storage module's
# versioned_bucket_id, so this cannot be created before versioning is on.
resource "aws_s3_bucket_replication_configuration" "documents" {
  bucket = var.source_bucket_name
  role   = aws_iam_role.replication.arn

  rule {
    id       = "everything-to-backup"
    status   = "Enabled"
    priority = 1

    filter {}

    # A delete in the live bucket becomes a delete marker here too, so the
    # backup's current view tracks the live bucket while its noncurrent
    # versions hold what was deleted, for retention_days.
    delete_marker_replication {
      status = "Enabled"
    }

    source_selection_criteria {
      sse_kms_encrypted_objects {
        status = "Enabled"
      }
    }

    destination {
      bucket        = aws_s3_bucket.backup.arn
      storage_class = "STANDARD"

      encryption_configuration {
        replica_kms_key_id = aws_kms_key.backup.arn
      }
    }
  }

  depends_on = [
    aws_s3_bucket_versioning.backup,
    aws_iam_role_policy.replication,
  ]
}
