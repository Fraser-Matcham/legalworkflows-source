# Runbooks

One page per failure mode, written for somebody who has been paged and has
no other context. Every alarm the `observability` Terraform module creates
names its runbook in its description; this index is the same mapping the
other way round.

Ticket 2096 asked for six: queue backlog, model provider outage, storage
failure, failed migration, certificate expiry, and the restore procedure.
The rest exist because an alarm exists for them.

| Alarm or event (`legalworkflows-production-…`) | Topic | Runbook |
| --- | --- | --- |
| `backend-unhealthy-targets`, `frontend-unhealthy-targets` | urgent | [site-down.md](site-down.md) |
| `backend-no-running-tasks`, `frontend-no-running-tasks` | urgent | [site-down.md](site-down.md) |
| `alb-5xx` | urgent | [site-down.md](site-down.md) |
| `backend-readiness` — log line says `"check":"database"` | urgent | [database-unreachable.md](database-unreachable.md) |
| `backend-readiness` — log line says `"check":"storage"` | urgent | [storage-failure.md](storage-failure.md) |
| *event* `ecs-deployment-failed` | urgent | [deploy-rolled-back.md](deploy-rolled-back.md) |
| `backend-5xx`, `backend-latency` | informational | [backend-errors.md](backend-errors.md) |
| `backend-cpu-high`, `backend-memory-high`, `frontend-cpu-high`, `frontend-memory-high` | informational | [high-resource-usage.md](high-resource-usage.md) |
| SES bounce / complaint / reject notification | informational | [email-delivery.md](email-delivery.md) |
| *(no alarm yet — found on the dashboard or by a user)* | — | [queue-backlog.md](queue-backlog.md), [model-provider-outage.md](model-provider-outage.md), [failed-migration.md](failed-migration.md), [certificate-expiry.md](certificate-expiry.md) |
| *(procedure, not an alarm)* | — | [restore.md](restore.md) |

## Before any of them

**Where things are.** Everything is in one AWS account, region `eu-west-2`,
named with the prefix `legalworkflows-production`. The ECS cluster is the
prefix; the services are `<prefix>-backend` and `<prefix>-frontend`; their
logs are `/ecs/<prefix>-backend` and `/ecs/<prefix>-frontend`; the dashboard
is the prefix. `terraform output` in `infra/` prints every name and URL these
pages refer to — run it first if you are not sure of one.

**What you need.** AWS credentials for the account (the administrator user
from Stage 3, Task 3), the AWS CLI, and for a shell into a task the
[Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html).
Supabase access is through the dashboard for the `legalworkflows-production`
project.

**Three commands that answer most questions.**

```sh
# What ECS thinks is happening, newest event first
aws ecs describe-services --cluster legalworkflows-production \
  --services legalworkflows-production-backend \
  --query 'services[0].[status,runningCount,desiredCount,deployments,events[0:5]]'

# The backend's last half hour, live
aws logs tail /ecs/legalworkflows-production-backend --since 30m --follow

# Why the load balancer thinks a target is unhealthy
aws elbv2 describe-target-health \
  --target-group-arn "$(aws elbv2 describe-target-groups \
    --names legalworkflows-production-backend --query 'TargetGroups[0].TargetGroupArn' --output text)"
```

**Two rules.**

1. Look before you restart. A task that is failing is telling you why in its
   log; a restart destroys the evidence and, if the cause is outside the
   task, changes nothing.
2. Every alarm sends an OK when it clears. If you got a page and then an OK,
   still read the log: something happened, and the next time it may not
   clear itself.

## Reading a log line

The backend writes one JSON object per line (`docs/observability.md`). The
useful fields are `kind` (`request`, `readiness`, and the error tracker's
own), `status`, `route`, `durationMs`, and for a readiness failure `check`
and a redacted `error`. Filter in CloudWatch with the same syntax the
alarms use, for example:

```sh
aws logs filter-log-events --log-group-name /ecs/legalworkflows-production-backend \
  --start-time "$(($(date +%s) - 1800))000" \
  --filter-pattern '{ $.kind = "readiness" && $.ok is false }'
```
