# Observability

## The request log line

Every HTTP request writes exactly one JSON line to stdout when the response
completes. `backend/src/middleware/requestLog.ts` emits it; it is mounted in
`app.ts` immediately after the middleware that mints the request id.

```json
{
  "kind": "http",
  "requestId": "0f0f5f6e-3a2e-4b7c-9f11-9b1c2d3e4f50",
  "userId": "11111111-2222-3333-4444-555555555555",
  "method": "POST",
  "route": "/single-documents/:documentId/notes",
  "status": 201,
  "durationMs": 42.18
}
```

| Field | Meaning |
| --- | --- |
| `kind` | Always `"http"`. Filter on it to separate request lines from everything else on stdout. |
| `requestId` | The same value returned to the caller in the `X-Request-ID` header and in the `request_id` field of an error response. |
| `userId` | The authenticated user's uuid, or `null` when the request was not authenticated. |
| `method` | HTTP method. |
| `route` | The matched Express route pattern. When nothing matched — a 404, a scanner — this is the raw path instead, with its query string stripped and opaque segments masked. |
| `status` | Response status code. |
| `durationMs` | Milliseconds from the logging middleware to response completion, to two decimal places. |
| `aborted` | Present and `true` only when the client disconnected before the response finished. Without it, such a request would be indistinguishable from a success. |

### Answering the two questions that matter

**"This request failed, here is the id from the error message."** The user is
quoting `request_id` from the error response, which is `requestId` here.

```
requestId = "0f0f5f6e-3a2e-4b7c-9f11-9b1c2d3e4f50"
```

That id also appears on the `[http/internal-error]` and
`[http/sanitized-internal-error]` lines, so one filter returns the request and
the failure that produced it.

**"What has this client been doing?"** Filter on `userId`. The log store never
holds an email address, so start from the uuid: look it up in `auth.users`, or
use the audit events, which do record the subject's email deliberately.

## What the line deliberately does not contain

Logs sit outside every access control the API enforces. A document that only
one user may read through the API is readable by everyone with access to the
log platform once it is written to stdout. The exclusions are therefore
deliberate, and `backend/src/__tests__/integration/requestLog.probe.test.ts`
plants a canary value in each of these positions and fails if it reappears:

- **Request and response bodies.** Never read.
- **Headers and cookies.** Never read, so no `Authorization` and no session
  cookie.
- **Query strings.** Stripped. Filenames and search terms live there.
- **Concrete path segments.** The route *pattern* is logged, not the path. A
  path segment can be the credential itself: `/download/:token` carries a
  signed token whose payload is base64url, not encrypted, and decodes to the
  storage path and the client's filename.
- **The caller's email.** `res.locals.userEmail` is in scope at the point the
  line is written and is not read. Same reasoning as the remote IP below.
- **The remote IP.** Not recorded, consistent with the auth audit events in
  `backend/src/middleware/auditAuthEvents.ts` and UK GDPR data minimisation.

What the service stores beyond logs — and what deletion does to it — is in
[docs/data-retention.md](data-retention.md).

## Redaction

`backend/src/lib/safeError.ts` holds the helpers. Anything on its way to a log
should go through one of them.

| Helper | Use it for |
| --- | --- |
| `safeErrorForLog(error)` | Any caught value before logging it. Returns `{name, message, stack?, status?, code?, cause?}` and **does not copy the thrown object's own properties** — a provider SDK routinely hangs the request body, and therefore the prompt, off `error.request`. |
| `describeForLog(value)` | A value you must characterise but must **not** print, because it is client content by hypothesis. Reports type, size and key names only. |
| `safeLogValue(value)` | A value that is not an error and whose content is expected to be safe, such as a job record. Bounded in depth and width; keys that name a secret are dropped whatever they hold. |
| `safePathForLog(url)` | A request path. Strips the query string and masks opaque segments. |
| `safeLogString(text)` | Free text. Redacts, then truncates. |
| `redactSecrets(text)` | Redaction alone, without truncation. |

Three defences, because none is sufficient alone:

1. **By value.** Every environment variable whose name ends in `KEY`, `TOKEN`,
   `SECRET`, `PASSWORD`, `PASSPHRASE`, `CREDENTIAL(S)` or `DSN` has its value
   searched for verbatim and replaced with `[redacted:VAR_NAME]`. This catches
   a key of any shape, including one the code has never heard of.
2. **By shape.** JWTs, `Authorization` headers, the common provider key
   prefixes, AWS-style access key ids and this service's own signed download
   tokens are matched by form. This catches the secrets the process
   environment does *not* hold — a caller's own stored API key, a user's
   session token.
3. **By context.** A secret with no recognisable shape, held by no environment
   variable, betrayed only by the label beside it — OpenAI's `Incorrect API
   key provided: …` echoes the rejected key back verbatim. These patterns are
   restored from the `safeError.ts` upstream used to have and deleted as
   collateral in commit `1d92cba`; the instruction to use them outlived the
   module by four months.
4. **By volume.** A prompt or an extracted page matches no pattern; it is
   simply long. Every string is truncated at `MAX_LOGGED_STRING`, and objects
   are never spread into a log line field by field.

Volume is a defence, not a guarantee: a short prompt containing no secret
pattern survives all four. Where a value is client content *by hypothesis* —
the sanitised-5xx guard fires precisely because a handler put something
unexpected in a response body — use `describeForLog` and print nothing at
all. The probe caught this exact case: the guard was logging the offending
`detail` string verbatim.

### Adding a log line

Do not pass a caught error, a request body, or a path straight to `console`.
Pick the helper from the table above. If you are adding a field that could
carry client content, add a canary for it to
`backend/src/lib/safeError.test.ts` — the probe is only as good as the
positions it plants values in.

## Volume

One line per request, including `/health`, which uptime checks poll
continuously. There is no sampling and no off switch: a request log with holes
in it answers the two questions above unreliably, and the failure mode of a
switch is that someone turns it off and nobody notices. If the volume becomes
a cost, drop `/health` at the log platform rather than at the source, so the
service keeps emitting a complete record.

## Health and readiness

Two endpoints, answering two different questions. Confusing them is how a load
balancer ends up routing traffic to an instance that cannot reach its database.

| Endpoint | Question | Cost | Auth |
| --- | --- | --- | --- |
| `GET /health` | Is the process running? | None — a constant | None |
| `GET /ready` | Are its dependencies reachable? | One no-row query, one HEAD | None |

**`/health` must stay unconditional.** Four things gate on it: the e2e
workflow's `wait-on`, `playwright.config.ts`'s `webServer` block,
`word-addin/scripts/dev.sh`, and its own integration test. If it ever starts
depending on something that can be down, those all become flaky. It returns
`{"ok": true}` and nothing else.

**`/ready` is what a load balancer should poll.** `200` with the report when
every dependency answered; `503` with **no body** when one did not.

The checks live in `backend/src/lib/readiness.ts`:

- `database` — a `head: true` select, so PostgREST returns headers and no rows.
  It proves the connection and the credentials, and reads nobody's data.
- `storage` — a HEAD for a key that will not exist. `headFile` returns null on
  a 404 and throws on anything else, so "not found" is the answer we want: the
  bucket was reachable and the credentials were accepted. Reported as
  `skipped` rather than failing when no bucket is configured, which is the
  legitimate case locally and in e2e.

Every check races a 2-second timeout, because a probe that hangs tells the
balancer less than one that fails. Checks run concurrently and none
short-circuits: an operator needs to know whether one dependency is down or
all of them.

**Why the failure path sends no body.** `protectInternalErrorResponses`
rewrites any `res.json` body at status ≥ 500 into the generic internal error
and logs a sanitised-error line — right for an escaped exception, wrong here,
where the 503 is deliberate. That middleware is inherited from upstream and
fork rule 3 says not to edit inherited files when there is another way. There
is: the balancer acts on the status code, and the failing check is named in the
log. An empty body also cannot leak, whatever that middleware does or does not
intercept.

The reason for a failure never reaches the caller — the endpoint is
unauthenticated by necessity — and goes to the log instead, through
`safeErrorForLog`:

```json
{"kind":"readiness","check":"database","ok":false,"error":{…redacted…}}
```

## Error tracking

Off by default. Set `ERROR_TRACKING_DSN` to a Sentry DSN to turn it on; every
other `ERROR_TRACKING_*` variable is optional and documented in
`backend/.env.example`.

### Why there is no SDK

`@sentry/node` is deliberately not a dependency. Its value is automatic
capture: it patches the HTTP layer, the global rejection handlers and the
Express error middleware, and it serialises the thrown object's own
properties. That last behaviour is the problem. A provider SDK error carries
the outgoing request on `error.request`, and that request body is the prompt,
which is a client's document. An integration that captures it defeats
`safeError.ts` entirely, and does so invisibly, because no line of our code
says the capture is happening.

So `backend/src/lib/errorTracking/sentryEnvelope.ts` speaks the ingest
protocol directly instead — parse the DSN, build the event, POST the envelope.
Its event builder takes a `SafeError`, not an `unknown`, so the type system
refuses a raw thrown value. That is what makes ticket 2084's acceptance
criterion checkable rather than a matter of trusting a third party's defaults,
and it adds nothing to a dependency tree the build already audits.

### How ~200 call sites were captured without editing them

`backend/src` has roughly 200 `console.error` calls, nearly all in inherited
files. `installErrorTracking()` bridges `console.error` once, so every
existing site reports, and a site an upstream merge adds reports the day it
lands. The bridge calls the original first and **does not change what is
printed**; it only redacts what it sends onward. It cannot throw, and it
cannot recurse — a delivery failure is logged through the saved original.

It is installed by the three entrypoints, because each owns a separate
handler registry: `src/index.ts`, `src/worker.ts`, `src/workerThread.ts`.

### The raw dump it closes

`process.on("unhandledRejection")` was registered nowhere in this service.
Node's default printer inspects the thrown object's own enumerable
properties, so for an error shaped like a provider's, both lines below reach
stdout unredacted, whatever `safeError.ts` says, because none of our code is
on that path. Measured on Node 22:

```
Error: Incorrect API key provided: sk-ant-CANARY…
  …
  request: { body: { prompt: 'PRIVILEGED CLIENT DOCUMENT TEXT' } }
```

The handlers now put the redaction helpers in front of it. They install
**whether or not a DSN is configured**, because the dump happens either way.

They also keep the process's existing life-cycle, which is easy to break here
by accident. Node's default has been `--unhandled-rejections=throw` since
v15: a rejection escalates to an uncaught exception and the process exits 1.
Registering a handler suppresses that escalation entirely, so a handler that
only logged would quietly convert "this service crashes and restarts" into
"this service carries on in an unknown state". Both handlers therefore exit 1,
exactly as the process did before — after a 100 ms delay, so the redacted line
and the in-flight POST are not lost to an immediate teardown. Whether an
unhandled rejection *should* be fatal is a resilience decision for the
operator; it is not one that redacting a log line gets to make.

### Event volume

`ERROR_TRACKING_MAX_EVENTS_PER_MINUTE` (default 60) caps sending, so a hot
failure loop cannot flood the ingest or the egress budget. Suppression is
reported once per window, so "quiet" is distinguishable from "throttled".

## Known gap

The two error paths (`sendInternalError` and the sanitised-response guard) and
the request line are redacted, and so is everything the error tracker sends.
What the roughly 200 other `console` calls **print to stdout** is still
whatever the call site passed: the bridge above redacts the event it forwards,
not the line it prints. Redacting the printed line too is now a one-place
change rather than a 200-file one, but it would alter what every operator sees
in the log store, so it is a deliberate decision rather than a side effect of
ticket 2084.

Until then: route new logging through the helpers, and convert an inherited
call site when you are editing it for another reason.
