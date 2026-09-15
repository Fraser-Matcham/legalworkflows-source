output "bucket_name" {
  description = "Where to restore documents from (docs/runbooks/restore.md)."
  value       = aws_s3_bucket.backup.bucket
}

output "bucket_arn" {
  value = aws_s3_bucket.backup.arn
}

output "kms_key_arn" {
  value = aws_kms_key.backup.arn
}

output "retention_days" {
  value = var.retention_days
}
