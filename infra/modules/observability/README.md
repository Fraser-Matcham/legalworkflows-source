# `observability`

Row 3.8 of the Stage 3 table (ticket 2085), and the charting half of 2086.
Two SNS topics, thirteen alarms, one EventBridge rule and one dashboard. The
log groups themselves are created by the `backend` and `frontend` modules,
because a task whose log group does not exist fails to start; this module
attaches to them by name.

## Two lists

Task 9 in the Stage 3 runbook asks the operator two things: where should
alerts go, and do you want to be woken. The answer maps onto two topics.

| Topic | Means | Subscribers |
| --- | --- | --- |
| `<prefix>-alerts-urgent` | users cannot use the site right now | `alert_email`, and `urgent_sms_number` if given |
| `<prefix>-alerts` | look at this when next at a desk | `alert_email` |

Both topics and every alarm exist from the first apply whether or not the
operator has answered; the subscriptions are the only thing that waits on
the variables. An email subscription is *pending* until the link in SNS's
confirmation message is clicked — Terraform cannot do that. An SMS
subscription in a new account is subject to SNS's own SMS sandbox, which
requires the destination number to be verified in the SNS console first.

## What fires, and why

Every alarm's description ends with the runbook that answers it; the index
is [`docs/runbooks/README.md`](../../../docs/runbooks/README.md).

**Urgent.**

| Alarm | Condition | Reading |
| --- | --- | --- |
| `<svc>-unhealthy-targets` | any target failing its health check for 2 min | a task is up but not answering |
| `<svc>-no-running-tasks` | fewer than one running task for 3 min | the service is down; Container Insights metric |
| `alb-5xx` | the ALB itself answered 5xx five times in 5 min | no target answered at all |
| `backend-readiness` | ≥ 3 readiness-check failures logged in 5 min | Supabase or S3 unreachable; the check is named in the log |
| *(event)* `ecs-deployment-failed` | the circuit breaker rolled a deploy back | the site is up on the old code; the release did not land |

**Informational.**

| Alarm | Condition |
| --- | --- |
| `backend-5xx` | ≥ `backend_5xx_per_5m` (10) target 5xx in 5 min |
| `backend-latency` | p95 > `backend_p95_latency_seconds` (5 s) for 15 min |
| `<svc>-cpu-high`, `<svc>-memory-high` | average > 85% for 15 min |

Every alarm sends an OK notification too, so a page that resolves itself
says so. Missing data is *not breaching* everywhere except `no-running-tasks`,
where no data is exactly the condition: if Container Insights has nothing
to report, nothing is running.

**Why readiness is a log filter.** The load balancer checks `/health`
(process alive) and must not check `/ready` (dependencies reachable), or a
Supabase blip would cycle every task — see the `backend` module. The backend
logs each failed readiness check as `{"kind":"readiness",…,"ok":false}`
(`docs/observability.md`), so a metric filter on that line turns "a
dependency is down" into an alarm without the balancer being involved.

**Why no CloudFront alarm.** CloudFront's metrics are in `us-east-1`, and an
alarm must publish to a topic in its own region, which would mean a second
pair of topics and subscriptions for one metric. Every origin failure the
edge would report is already caught at the load balancer, so the
distribution appears on the dashboard and not in the alarm list.

**Not encrypted.** CloudWatch cannot publish to a topic encrypted with the
AWS-managed SNS key, and a customer key to protect "UnHealthyHostCount ≥ 1"
is cost without benefit.

## The dashboard

One page, named after the prefix: requests per target, errors (ALB, target
and readiness), backend latency percentiles, running tasks against healthy
targets, CPU and memory, and the edge's request count and error rates. Its
URL is an output.

## What is not here

- **Billing.** Task 8 creates the budget by hand as root, because budget
  alerts are a root-account setting.
- **Metrics from `/metrics`.** The backend's Prometheus endpoint is not
  scraped by anything yet; an agent sidecar or a CloudWatch agent
  configuration is the follow-up when one of its metrics (queue depth, LLM
  spend) needs an alarm. Nothing above depends on it.
- **The alert drill.** Ticket 2087's "fire a rule and hold a drill" needs the
  footprint applied; it is a Stage 3 "done when" item, not code.
