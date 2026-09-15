output "bucket_name" {
  description = "Value for R2_BUCKET_NAME."
  value       = aws_s3_bucket.documents.bucket
}

output "bucket_arn" {
  value = aws_s3_bucket.documents.arn
}

output "endpoint_url" {
  description = "Value for R2_ENDPOINT_URL: the regional S3 endpoint. The client uses path-style addressing, which this endpoint accepts."
  value       = "https://s3.${data.aws_region.current.region}.amazonaws.com"
}

output "kms_key_arn" {
  value = aws_kms_key.documents.arn
}

output "iam_user_name" {
  value = aws_iam_user.storage.name
}

output "access_key_id" {
  description = "Value for R2_ACCESS_KEY_ID. Consumed by the secrets module; not a root output."
  value       = aws_iam_access_key.storage.id
  sensitive   = true
}

output "secret_access_key" {
  description = "Value for R2_SECRET_ACCESS_KEY. Consumed by the secrets module; not a root output."
  value       = aws_iam_access_key.storage.secret
  sensitive   = true
}

output "versioned_bucket_id" {
  description = "The bucket name, but known only once versioning is enabled — the backup module's replication configuration uses this so it cannot be applied first."
  value       = aws_s3_bucket_versioning.documents.id
}
