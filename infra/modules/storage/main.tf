data "aws_region" "current" {}

locals {
  bucket_name = "${var.name_prefix}-documents-${var.account_id}"
}

resource "aws_s3_bucket" "documents" {
  bucket = local.bucket_name

  # Refuse to destroy a bucket that still has objects in it. Losing the
  # footprint is recoverable; losing every client document is not.
  force_destroy = false

  tags = { Name = local.bucket_name }
}

# ACLs off entirely. Every object is owned by the bucket owner and access is
# decided by IAM and the bucket policy alone, which is the only model the
# storage user's policy is written for.
resource "aws_s3_bucket_ownership_controls" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "documents" {
  bucket = aws_s3_bucket.documents.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Versioning is on for one reason: every AWS mechanism that can back an S3
# bucket up (replication, AWS Backup) requires it. docs/data-retention.md
# promises that deleting a document removes the file, so the lifecycle rule
# below expires a noncurrent version after one day, the shortest S3 allows —
# the live bucket keeps deleted bytes for at most a day, and only the backup
# bucket (modules/backup) keeps them longer, which that document states.
resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.documents.arn
    }
    # One data key per bucket rather than per object cuts KMS requests — and
    # their cost — by orders of magnitude for the many small extracted-text
    # and rendition objects the backend writes.
    bucket_key_enabled = true
  }
}

# Direct browser uploads: the backend hands the browser a signed PUT URL for
# one staging object (docs/deployment.md, "Object-storage CORS for direct
# uploads"). This is the policy that document describes, with the deployed
# origin substituted for the example.
resource "aws_s3_bucket_cors_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  cors_rule {
    allowed_origins = var.allowed_origins
    allowed_methods = ["PUT", "HEAD"]
    allowed_headers = ["Content-Type", "x-amz-*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }
}

# Lifecycle. Content never expires here — that is a documented property of the
# service (docs/data-retention.md: "Nothing expires content"), and the prefixes
# that hold content (documents/, generated/, extracted-text/, exports/) are
# deliberately absent from these rules. Only the upload-session scratch space
# is swept, and only as a backstop behind the backend's own cleanup.
resource "aws_s3_bucket_lifecycle_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  # backend/src/lib/uploadSessions.ts writes staging and sealed objects under
  # upload-sessions/<userId>/<sessionId>/<fileId>/ and deletes them as each
  # upload completes, fails or expires. Anything still here after the backstop
  # window was orphaned by a crash between the copy and the delete.
  rule {
    id     = "expire-orphaned-upload-sessions"
    status = "Enabled"

    filter {
      prefix = "upload-sessions/"
    }

    expiration {
      days = var.upload_session_backstop_days
    }
  }

  # The deletion promise, kept on a versioned bucket: a delete leaves a
  # marker and the bytes become a noncurrent version, which this expires
  # after one day (S3's minimum). Markers with no versions behind them are
  # removed by the second clause so listings do not fill with ghosts.
  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 1
    }

    expiration {
      expired_object_delete_marker = true
    }
  }

  # Uploads are single PUTs today, so this rule should never match anything.
  # It is here because an abandoned multipart upload is invisible in every
  # listing yet billed forever, and the rule costs nothing.
  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  depends_on = [
    aws_s3_bucket_ownership_controls.documents,
    aws_s3_bucket_versioning.documents,
  ]
}

# Refuse plaintext. Presigned URLs are https, the SDK client is https, and a
# request that is not is a misconfiguration worth failing loudly on.
data "aws_iam_policy_document" "bucket" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]

    resources = [
      aws_s3_bucket.documents.arn,
      "${aws_s3_bucket.documents.arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "documents" {
  bucket = aws_s3_bucket.documents.id
  policy = data.aws_iam_policy_document.bucket.json

  depends_on = [aws_s3_bucket_public_access_block.documents]
}
