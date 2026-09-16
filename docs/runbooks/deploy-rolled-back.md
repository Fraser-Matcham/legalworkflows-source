# A deploy rolled back

**Event:** `ecs-deployment-failed` (urgent). ECS's deployment circuit
breaker watched the new tasks fail their health checks, gave up, and put
the previous task definition back. **The site is up, on the old code.**
Nothing is on fire; the release did not land.

## 1. Which service, which revision

The notification names the service. Find the revision it tried and the one
it is running:

```sh
aws ecs describe-services --cluster legalworkflows-production \
  --services legalworkflows-production-backend \
  --query 'services[0].[taskDefinition,deployments[].[status,taskDefinition,rolloutState,rolloutStateReason,failedTasks]]'
```

## 2. Why the new tasks failed

Stopped tasks keep their reason for about an hour:

```sh
aws ecs list-tasks --cluster legalworkflows-production \
  --service-name legalworkflows-production-backend --desired-status STOPPED --query 'taskArns' --output text \
| tr '\t' '\n' | head -3 | xargs -I{} aws ecs describe-tasks --cluster legalworkflows-production --tasks {} \
  --query 'tasks[0].[taskDefinitionArn,stoppedReason,containers[0].reason,containers[0].exitCode]'
```

And the log of one of them — the stream name contains the task id:

```sh
aws logs tail /ecs/legalworkflows-production-backend --since 1h \
  --log-stream-name-prefix "backend/backend/<task-id>"
```

| What you see | Cause | Fix |
| --- | --- | --- |
| `CannotPullContainerError` | the image was not pushed, or the tag in the task definition is wrong | re-run the build; check the deploy workflow's push step |
| start-up guard error naming a variable | the new revision added a variable the configuration does not have, or a secret key that is not in its secret | add it (Terraform for environment, `put-secret-value` for a secret), then redeploy |
| a stack trace on start | a bug in the release | fix forward or leave the rollback in place; either way the site is on the old code |
| health checks failing with no log output | the process is not listening on the expected port, or takes longer than the 120 s grace period to start | check `PORT`; if the image legitimately starts slower, raise `health_check_grace_period_seconds` in `infra/modules/backend/ecs.tf` |
| a migration error in the deploy workflow, before ECS was touched | not this page: [failed-migration.md](failed-migration.md) |

## 3. Redeploy when fixed

The Stage 4 deploy workflow redeploys on the next merge to `main`. To retry
the same commit, re-run the workflow. To roll *forward* by hand to a
revision you know is good:

```sh
aws ecs list-task-definitions --family-prefix legalworkflows-production-backend --sort DESC --max-items 5
aws ecs update-service --cluster legalworkflows-production \
  --service legalworkflows-production-backend --task-definition legalworkflows-production-backend:<revision>
```

Terraform ignores `task_definition` on the service, so neither the
rollback nor a manual roll-forward creates drift.

## Note for the record

Ticket 2052's acceptance criterion is exactly this event: "a deliberately
broken deploy is caught by the health check and rolled back without manual
intervention." The first time it fires for real, note it as the proof.
