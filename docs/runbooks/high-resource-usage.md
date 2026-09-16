# High CPU or memory

**Alarms:** `backend-cpu-high`, `backend-memory-high`, `frontend-cpu-high`,
`frontend-memory-high`. Informational: an average over 85% of the task's
allocation for fifteen minutes.

## What it means for each

| Service | CPU | Memory |
| --- | --- | --- |
| backend | conversions (LibreOffice), text extraction, or a hot loop. The service autoscales on CPU up to `max_count` (2), so a sustained high average means it is at its ceiling or the load is on one task | LibreOffice on a large document; many concurrent uploads (`UPLOAD_PROCESSING_CONCURRENCY`). Memory does not autoscale; the task is killed at the limit and restarts (exit 137) |
| frontend | server-side rendering under load — rare at this scale; a crawler is the usual cause | a leak, over days |

## 1. Confirm on the dashboard

The `legalworkflows-production` dashboard's "CPU and memory" and "Running
tasks" panels show whether it is one task, all of them, and whether
autoscaling has already added a second.

## 2. Is it real work

```sh
aws logs filter-log-events --log-group-name /ecs/legalworkflows-production-backend \
  --start-time "$(($(date +%s) - 900))000" \
  --filter-pattern '{ $.kind = "request" }' \
  --query 'events[].message' --output text | jq -r '.route' | sort | uniq -c | sort -rn | head
```

Many conversion or upload requests means a user is loading a matter; that
is the service doing its job and the alarm clears when they finish. A flood
of requests from one route with no user behind it is a scanner or a crawler:
the per-IP rate limiters (`RATE_LIMIT_GENERAL_MAX`) should be answering
429s — check the log for them.

## 3. Give it room

Sizes are variables on the module blocks in `infra/main.tf` (defaults in
`infra/modules/backend/variables.tf`): `cpu` (1024 = 1 vCPU), `memory`
(MiB), `max_count`. Changing any of them registers a new task definition
and rolls it out on `terraform apply`. Fargate constrains the pairs — 1 vCPU
allows 2–8 GB; 2 vCPU allows 4–16 GB.

Memory first for the backend: LibreOffice is the reason it is 2 GB and a
larger document is the reason it would need more. Go to 3 GB before adding
CPU.

## 4. Do not

Do not raise `UPLOAD_PROCESSING_CONCURRENCY` to clear a backlog on a task
that is already at its memory ceiling; that is how a slow queue becomes a
crash loop. [queue-backlog.md](queue-backlog.md) has the order to do things
in.
