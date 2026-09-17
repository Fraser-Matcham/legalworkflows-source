output "ecr_repository_url" {
  description = "Where the release pipeline pushes the dbtools image."
  value       = aws_ecr_repository.dbtools.repository_url
}

output "ecr_repository_arn" {
  value = aws_ecr_repository.dbtools.arn
}

output "task_definition_family" {
  value = aws_ecs_task_definition.dbtools.family
}

output "security_group_id" {
  description = "The group a dbtools task must run in (infra/dbtools/run.sh looks it up by name)."
  value       = aws_security_group.dbtools.id
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.dbtools.name
}

output "execution_role_arn" {
  value = aws_iam_role.execution.arn
}

output "task_role_arn" {
  value = aws_iam_role.task.arn
}

output "migration_source_secret_name" {
  description = "Where Stage 5, Task 2 writes SOURCE_DB_URL."
  value       = aws_secretsmanager_secret.migration_source.name
}
