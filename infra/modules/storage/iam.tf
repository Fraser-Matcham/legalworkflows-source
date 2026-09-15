# The backend's S3 client (backend/src/lib/storage.ts) reads a static access
# key from R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY and refuses to start without
# one, so the footprint has to mint one. It belongs to a user that can do
# exactly what the code does — put, get, copy, list and delete objects in this
# one bucket, and use this one key — and nothing else in the account.
#
# A long-lived key is the weaker of the two options; the stronger one is the
# ECS task role, which needs the code to stop passing explicit credentials so
# the SDK's default chain picks the role up. That is a small change scheduled
# for after the row 3.10 round trip proves the bucket works at all. When it
# lands, this user and key are deleted and the policy below moves to the task
# role unchanged.
resource "aws_iam_user" "storage" {
  name = "${var.name_prefix}-storage"
  path = "/service/"

  tags = { Name = "${var.name_prefix}-storage" }
}

data "aws_iam_policy_document" "storage_access" {
  statement {
    sid       = "ListBucket"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.documents.arn]
  }

  # CopyObject (staging -> sealed -> documents/) is GetObject on the source
  # plus PutObject on the target; HeadObject is GetObject. Nothing here
  # touches ACLs, versioning, policy or lifecycle.
  statement {
    sid    = "ObjectReadWriteDelete"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = ["${aws_s3_bucket.documents.arn}/*"]
  }

  # SSE-KMS: writing (including a browser's presigned PUT, which is signed as
  # this user) needs GenerateDataKey; reading needs Decrypt; the SDK calls
  # DescribeKey when resolving the alias.
  statement {
    sid    = "UseDocumentsKey"
    effect = "Allow"
    actions = [
      "kms:GenerateDataKey",
      "kms:Decrypt",
      "kms:DescribeKey",
    ]
    resources = [aws_kms_key.documents.arn]
  }
}

resource "aws_iam_policy" "storage_access" {
  name        = "${var.name_prefix}-storage-access"
  path        = "/service/"
  description = "Object read/write/delete on the ${var.name_prefix} document bucket and use of its KMS key."
  policy      = data.aws_iam_policy_document.storage_access.json
}

resource "aws_iam_user_policy_attachment" "storage_access" {
  user       = aws_iam_user.storage.name
  policy_arn = aws_iam_policy.storage_access.arn
}

# The secret lands in Terraform state, which is why the state bucket is
# private, versioned and encrypted (backend.tf). The `secrets` module copies
# it into Secrets Manager for the task; nothing reads it from state at runtime.
resource "aws_iam_access_key" "storage" {
  user = aws_iam_user.storage.name
}
