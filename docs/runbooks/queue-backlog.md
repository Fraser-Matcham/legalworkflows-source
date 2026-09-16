# Queue backlog

Background work — document conversion, text extraction, tabular extraction,
export builds, account deletion, storage cleanup, chat audit records, MCP
token refresh — runs through a Postgres-backed queue, the `db_jobs` table,
polled by a worker thread inside each backend task (`docs/deployment.md`,
"Background jobs"). There is no Redis in the production footprint.

**How it shows up.** No alarm fires yet; nothing scrapes `/metrics` in
production. You find out from a user ("my document has said *converting*
for an hour") or from the dashboard's readiness and error panels being
clean while the product is not. Ticket 2085's alert for this path is the
`job_queue_depth` gauge; until something scrapes it, this page is the
alert.

## 1. Look at the table

In the Supabase dashboard, SQL editor, project `legalworkflows-production`:

```sql
select kind, status, count(*), min(created_at), max(claimed_at)
from public.db_jobs
group by kind, status
order by kind, status;
```

| You see | Meaning |
| --- | --- |
| `pending` growing, `running` zero | nothing is claiming. The worker thread is dead or the tasks are down — go to step 2 |
| `running` rows with `claimed_at` older than 10 minutes | a worker went quiet mid-job. The runner reclaims a claim after 600 s (`STALE_SECONDS` in `backend/src/lib/dbq/runner.ts`) and retries it; if these are not clearing, step 2 |
| `pending` with `run_at` in the future | retries waiting out their backoff — 30 s, 90 s, 270 s… capped at 30 min. Normal after a transient failure; read `last_error` on the same rows |
| `failed` rows | attempts exhausted (default `max_attempts` 5) or an unknown `kind`. Kept for inspection: `last_error` says why. These are the ones users are waiting on |
| everything `done`, nothing pending, user still waiting | the job succeeded and the *result* is wrong or not shown — a product bug, not a queue one |

Job kinds you will see: `conversion.convert`, `extraction.extract`,
`document.precompute_text`, `export.build`, `account.delete`,
`storage.cleanup`, `audit.chat_turn`, `mcp.refresh_token`.

## 2. Is the worker alive

Each backend task runs one worker thread (`WORKERS_MODE=thread`). It logs
`[worker-thread]` on crash and respawns after five seconds; a thread that
dies on every start loops there.

```sh
aws logs filter-log-events --log-group-name /ecs/legalworkflows-production-backend \
  --start-time "$(($(date +%s) - 1800))000" --filter-pattern '"[worker-thread]"' \
  --query 'events[].message' --output text | tail
```

A crash loop names the cause. A worker that is simply *slow* — one task,
CPU pinned — is [high-resource-usage.md](high-resource-usage.md): a second
task doubles claim capacity, and autoscaling should already be doing that.

## 3. Failed jobs

Read `last_error`. The common ones:

| `last_error` | Cause | Then |
| --- | --- | --- |
| a storage error | [storage-failure.md](storage-failure.md) | fix storage; requeue |
| LibreOffice timeout / conversion failed | a document that cannot be converted, or `UPLOAD_CONVERT_TIMEOUT_MS` too tight for its size | requeue once after checking memory; if it fails again the document is the problem and the user needs telling |
| a model provider error (extraction) | [model-provider-outage.md](model-provider-outage.md) | requeue when the provider is back |
| `unknown job kind` | a deploy skew: a job enqueued by a newer backend, claimed by an older one | resolves itself once the deploy completes; requeue |

To requeue a failed job:

```sql
update public.db_jobs
set status = 'pending', attempts = 0, run_at = now(), last_error = null
where id = '<job id>';
```

Do not requeue `account.delete` or `storage.cleanup` without reading the
payload: they delete things, and the reason they failed may be that the
thing is already gone.

## 4. Draining a large backlog

Order matters:

1. Confirm memory headroom ([high-resource-usage.md](high-resource-usage.md)).
2. Let autoscaling add the second task, or set `desired_count = 2` on the
   backend module and apply.
3. Only then consider `UPLOAD_PROCESSING_CONCURRENCY` (via
   `extra_environment` on the backend module). Each unit is one LibreOffice
   process's worth of memory.

Old `done` and `failed` rows are swept by the runner on a schedule; a large
`done` count is not a backlog.
