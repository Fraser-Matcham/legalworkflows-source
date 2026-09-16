# Site down

**Alarms:** `backend-unhealthy-targets`, `frontend-unhealthy-targets`,
`backend-no-running-tasks`, `frontend-no-running-tasks`, `alb-5xx`. All
urgent. They overlap on purpose: any one of them can fire alone, and which
ones fire together is the first clue.

| Firing | Most likely |
| --- | --- |
| `no-running-tasks` only | tasks cannot start: bad image tag, missing secret key, pull failure, out of capacity |
| `unhealthy-targets` only, tasks running | the process is up but not answering `/health` (backend) or `/` (frontend): crash loop, port, or a dependency the start-up guard checks |
| `alb-5xx` with either of the above | the load balancer has nobody to send to — same cause, seen from the user's side |
| `alb-5xx` alone | targets healthy but requests failing at the balancer: timeouts on a slow endpoint, or a deploy mid-rollover |
| `unhealthy-targets` on the backend and `backend-readiness` | not this page — the process is up and cannot reach a dependency: [database-unreachable.md](database-unreachable.md) or [storage-failure.md](storage-failure.md) |

## 1. Confirm from outside

```sh
curl -sS -o /dev/null -w '%{http_code}\n' https://legalworkflows.co.uk/
curl -sS -o /dev/null -w '%{http_code}\n' https://legalworkflows.co.uk/api/health
```

`200` on both means users are fine and the alarm is about redundancy or a
partial failure; keep going, less urgently. A `502`/`503`/`504` is the
outage. A `403` from `/api/health` means the request reached the load
balancer without CloudFront's secret header — see "Origin header" below.

## 2. What is ECS doing

```sh
aws ecs describe-services --cluster legalworkflows-production \
  --services legalworkflows-production-backend legalworkflows-production-frontend \
  --query 'services[].[serviceName,runningCount,desiredCount,deployments[].[status,rolloutState,rolloutStateReason],events[0:5].message]'
```

- **`runningCount` 0 and events say tasks keep stopping:** find the stopped
  task's reason.

  ```sh
  aws ecs list-tasks --cluster legalworkflows-production \
    --service-name legalworkflows-production-backend --desired-status STOPPED --query 'taskArns[0]' --output text \
  | xargs -I{} aws ecs describe-tasks --cluster legalworkflows-production --tasks {} \
    --query 'tasks[0].[stoppedReason,containers[0].reason,containers[0].exitCode]'
  ```

  | Reason says | Do |
  | --- | --- |
  | `CannotPullContainerError` | the image tag does not exist in ECR. If this follows a deploy, [deploy-rolled-back.md](deploy-rolled-back.md). If it is the first apply, expected until Stage 4 pushes an image. |
  | `ResourceInitializationError: unable to pull secrets` | a key the task definition references is missing from its Secrets Manager secret, or the execution role cannot read it. Compare `infra/modules/backend/variables.tf` `secret_keys` with the JSON in `legalworkflows-production/backend/operator`. Add the missing key or remove it from `backend_extra_secret_keys`. |
  | exit code 1 within seconds, log shows configuration error | the start-up guard refused to start. The log names the variable. Backend: `validateRuntimeConfiguration` in `backend/src/lib/runtimeConfig.ts`. Frontend: `frontend/src/app/lib/env.ts`. Fix the value (environment in Terraform, or the secret) and force a new deployment. |
  | `OutOfMemoryError` / exit 137 | the task hit its memory limit — LibreOffice on a large document is the usual cause. Raise `memory` in `infra/main.tf` for the backend module, apply, and read [high-resource-usage.md](high-resource-usage.md). |
  | nothing useful, `rolloutState` `FAILED` | the circuit breaker rolled back: [deploy-rolled-back.md](deploy-rolled-back.md). |

- **`runningCount` ≥ 1 but targets unhealthy:** the process is alive and the
  health check fails. Backend checks `GET /health` on 3001; frontend checks
  `GET /` on 3000. Read the log (`aws logs tail … --follow`) for a crash loop
  or a port mismatch, then check target health for the exact failing code:

  ```sh
  aws elbv2 describe-target-health --target-group-arn "$(aws elbv2 describe-target-groups \
    --names legalworkflows-prod-backend --query 'TargetGroups[0].TargetGroupArn' --output text)"
  ```

  `Target.Timeout` with a healthy-looking log usually means the security
  group rule between the ALB and the task is gone — `terraform plan` will
  show it. `Target.ResponseCodeMismatch` with a 5xx means the process is
  answering but broken; the log has the stack (redacted).

## 3. Restart, once you know why

A force-new-deployment starts fresh tasks from the *same* task definition —
right for "the secret was fixed", "the dependency is back", or a wedged
process; wrong for a bad image (roll back instead, see
[deploy-rolled-back.md](deploy-rolled-back.md)).

```sh
aws ecs update-service --cluster legalworkflows-production \
  --service legalworkflows-production-backend --force-new-deployment
```

## Origin header

Every request must arrive through CloudFront carrying `X-Origin-Verify`;
the load balancer answers a bare `403 Forbidden` to anything else. If real
users see 403 on every page, the secret CloudFront sends and the one the
listener rules expect have diverged — which only Terraform can cause. Run
`terraform plan` in `infra/`: it will want to update either the
distribution's origin headers or the listener rules. Apply it.

## Afterwards

Write two lines in the incident log: what fired, what the cause was. If the
cause was a missing alarm or an unclear one, change
`infra/modules/observability/alarms.tf`.
