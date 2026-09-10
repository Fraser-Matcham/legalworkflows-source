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
3. **By volume.** A prompt or an extracted page matches no pattern; it is
   simply long. Every string is truncated at `MAX_LOGGED_STRING`, and objects
   are never spread into a log line field by field.

Volume is a defence, not a guarantee: a short prompt containing no secret
pattern survives all three. Where a value is client content *by hypothesis* —
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

## Known gap

The two error paths (`sendInternalError` and the sanitised-response guard) and
the request line are redacted. The roughly 200 other `console` calls across
`backend/src` are not yet routed through these helpers; they were left alone
because rewriting them all would touch inherited files across the whole tree
for no gain in the paths that actually carry client content. Route new logging
through the helpers, and convert an inherited call site when you are editing
it for another reason.
