# Backend errors and slow responses

**Alarms:** `backend-5xx` (ten or more 5xx responses from the backend in
five minutes), `backend-latency` (p95 over five seconds for fifteen
minutes). Both informational: the site is up, something in it is wrong.

## `backend-5xx`

1. **What is failing.** The request log line has `route` and `status`:

   ```sh
   aws logs filter-log-events --log-group-name /ecs/legalworkflows-production-backend \
     --start-time "$(($(date +%s) - 900))000" \
     --filter-pattern '{ $.kind = "request" && $.status >= 500 }' \
     --query 'events[].message' --output text | jq -r '[.route, .status, .durationMs] | @tsv' | sort | uniq -c | sort -rn
   ```

2. **Why.** The error tracker has the redacted stack if `ERROR_TRACKING_DSN`
   is set; otherwise the log line before each 500 is the sanitised error.
   One route → a bug or a bad input; every route → a dependency
   ([database-unreachable.md](database-unreachable.md),
   [storage-failure.md](storage-failure.md)) or a provider
   ([model-provider-outage.md](model-provider-outage.md)).

3. **A 5xx from the balancer, not the backend**, is a different alarm
   (`alb-5xx`) and a different page: [site-down.md](site-down.md).

## `backend-latency`

The load balancer measures time to the *first byte* of the response. Chat
streams send their first byte immediately, so they do not move this number;
what does is a synchronous endpoint doing real work — a large document's
text extraction, an export build, a listing on a big project.

1. Which routes are slow: the same query as above with
   `$.durationMs > 5000` instead of the status.
2. If it is one route and a big input, that is a product limit rather than
   an incident; note it for the backlog. If it is every route, the task is
   starved — check [high-resource-usage.md](high-resource-usage.md) — or the
   database is slow (Supabase dashboard → Database → Query performance).
3. CloudFront gives up on the origin after 60 seconds. A request that takes
   longer returns a 504 to the user *and* counts here. The fix for that class
   of problem is to make the work asynchronous (a `db_jobs` kind), not to
   raise the timeout.
