output "generated_secret_arn" {
  value = aws_secretsmanager_secret.generated.arn
}

output "operator_secret_arn" {
  value = aws_secretsmanager_secret.operator.arn
}

output "operator_secret_name" {
  description = "Pass to `aws secretsmanager put-secret-value --secret-id` when setting the operator-held values."
  value       = aws_secretsmanager_secret.operator.name
}

output "storage_secret_arn" {
  value = aws_secretsmanager_secret.storage.arn
}

# The backend task definition's `secrets` block, ready to use: each backend
# variable name mapped to the "<secret arn>:<json key>::" form ECS reads a
# single key with. Keeping the mapping here means the backend module never
# has to know which secret a variable lives in.
output "backend_ecs_secrets" {
  description = "Map of backend environment variable name to ECS valueFrom, covering every generated, storage and operator key."
  value = merge(
    { for key in local.generated_secret_keys : key => "${aws_secretsmanager_secret.generated.arn}:${key}::" },
    {
      R2_ACCESS_KEY_ID     = "${aws_secretsmanager_secret.storage.arn}:R2_ACCESS_KEY_ID::"
      R2_SECRET_ACCESS_KEY = "${aws_secretsmanager_secret.storage.arn}:R2_SECRET_ACCESS_KEY::"
    },
    { for key in var.operator_secret_keys : key => "${aws_secretsmanager_secret.operator.arn}:${key}::" },
  )
}

output "backend_execution_role_arn" {
  value = aws_iam_role.backend_execution.arn
}

output "backend_task_role_arn" {
  value = aws_iam_role.backend_task.arn
}

output "backend_task_role_name" {
  description = "For attaching further policies (the storage move to the task role, later)."
  value       = aws_iam_role.backend_task.name
}

output "frontend_execution_role_arn" {
  value = aws_iam_role.frontend_execution.arn
}

output "frontend_task_role_arn" {
  value = aws_iam_role.frontend_task.arn
}
