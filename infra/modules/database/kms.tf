# The storage module's reasoning applies unchanged: a customer-managed key can
# be rotated, every use is logged, and access to the bytes can be revoked at
# the key. It encrypts the volume, every automated backup and snapshot, the
# exported logs' Performance Insights data, and the master credential RDS
# keeps in Secrets Manager. A snapshot copied to another account or region
# needs a grant on this key, which is the control that makes an accidental
# share fail rather than succeed.
resource "aws_kms_key" "database" {
  description             = "${var.name_prefix} database volume, backups and master credential"
  enable_key_rotation     = true
  deletion_window_in_days = var.kms_deletion_window_in_days

  tags = { Name = "${var.name_prefix}-database" }
}

resource "aws_kms_alias" "database" {
  name          = "alias/${var.name_prefix}-database"
  target_key_id = aws_kms_key.database.key_id
}
