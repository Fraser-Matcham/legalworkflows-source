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
intervention."

**Drilled on 18 September 2026, and it did not happen.** The backend was
deliberately rolled onto a revision whose image tag does not exist in ECR. The
result, over seventeen minutes:

| Time (UTC) | What happened |
| --- | --- |
| 10:36 | Service updated to the broken revision; it becomes `PRIMARY`, `IN_PROGRESS` |
| 10:38, 10:40, 10:42 | Three tasks each fail with `CannotPullContainerError` |
| 10:42 onwards | No further attempt, no rollback. `rolloutState` stays `IN_PROGRESS`, `failedTasks` stalls at 2 |
| 10:53 | Restored to the good revision by hand |

The circuit breaker is configured correctly — `enable` and `rollback` both
true — and it still did not fire. The reason appears to be that an unpullable
image produces a *placement* failure ("was unable to place a task"), not a
task that starts and then fails, and the deployment simply stalls instead of
being failed.

Two things follow, and the second is the one that matters:

- **Availability was never at risk.** `deploymentConfiguration.minimumHealthyPercent`
  is 100, so the running task is not drained until a replacement is healthy.
  The site answered 200 on every one of 33 probes across the drill. This is the
  property worth having, and it held.
- **What catches a broken deploy is the pipeline, not the breaker.** The "Roll
  the service" step in `deploy.yml` runs `aws ecs wait services-stable`, which
  is bounded at ten minutes, and then asserts that the `PRIMARY` deployment is
  the revision it just registered. A stalled deployment fails that step and the
  release goes red. Do not rely on the breaker to undo it for you.

So if you are reading this page because a deploy went wrong, check whether the
deployment actually rolled back or merely stalled. `describe-services` telling
you `IN_PROGRESS` long after the fact means stalled, and you restore the
previous revision yourself:

```sh
aws ecs update-service --cluster legalworkflows-production \
  --service legalworkflows-production-backend \
  --task-definition legalworkflows-production-backend:<last good revision>
```

### The runtime case, drilled the same day, and it works

The obvious question the drill above leaves open is whether the breaker fires
at all. It does. Drilled again at 11:51 on 18 September 2026, this time with a
*runtime* failure: the real image, which pulls and starts normally, with the
entry point replaced by `sleep 3600` so the container runs but never listens on
port 3001.

| Time (UTC) | What happened |
| --- | --- |
| 11:51 | Service updated to the broken revision; `PRIMARY`, `IN_PROGRESS` |
| 11:52 | Task starts and is **registered as a target** |
| 11:54:50 | `(port 3001) is unhealthy in (target-group ...)`; task stopped. Failure 1 |
| 12:00:28 | Second task, same outcome. Failure 2 |
| 12:05:57 | Third task, same outcome. Failure 3 |
| 12:06:34 | `deployment failed: tasks failed to start`, then `rolling back to deployment ...` |
| 12:06 onwards | Service back on the good revision, unaided |

`rolloutStateReason` on the failed deployment reads *"ECS deployment circuit
breaker: tasks failed to start"*, and on the new primary *"ECS deployment
circuit breaker: rolling back to deploymentId ..."*. Nobody touched it. That is
ticket 2052's acceptance criterion, met.

The site answered 200 on all 60 probes across the fifteen minutes, because
`minimumHealthyPercent` is 100 and the good task was never drained.

**So the distinction that matters is where the failure happens**, and it is not
the one you would guess from the configuration:

| Failure | Task registers as a target? | Breaker fires? | What catches it |
| --- | --- | --- | --- |
| Image cannot be pulled | No, never placed | **No** — deployment stalls | `wait services-stable` in `deploy.yml` |
| Container runs but fails its health check | Yes | **Yes**, after 3 failures, about 15 minutes | The breaker, unaided |

A release that fails the way most releases fail — bad code, a missing
variable, a process that dies or never listens — is the second row, and it
rolls itself back. A release that cannot pull its image at all is the first
row, and it needs the pipeline. Both are covered; only one is covered by the
breaker.
