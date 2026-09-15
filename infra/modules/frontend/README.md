# `frontend`

Row 3.6 of the Stage 3 table. The web application's image repository, its
Fargate service, and the CloudFront distribution that is the public face of
the whole system — the one place `https://legalworkflows.co.uk` is made to
mean "the frontend, and `/api` is the backend".

```
                     https://<domain>
                            │
                       CloudFront ── /_next/static/*  (cached a year)
                            │
          ┌─────────────────┴──────────────────┐
     /  (default)                          /api/*  ── function strips "/api"
   X-Origin-Target: frontend             X-Origin-Target: backend
          │                                    │
          └──────── origin.<domain> (ALB :443) ─┘
                 rule 20 → frontend TG      rule 10 → backend TG
                       Next.js :3000            API :3001
```

## Choices worth knowing about

**Two origins, one hostname.** Both CloudFront origins connect to the
`backend` module's load balancer at `origin.<domain>`. Each adds the secret
`X-Origin-Verify` header — without it the listener answers 403 — and an
`X-Origin-Target` header naming the service the behaviour was for. The ALB
rules match on that pair. The path alone cannot say, because the `/api`
prefix has been removed by the time the request reaches the ALB.

**The prefix is stripped at the edge.** A CloudFront function on the
`/api/*` behaviour turns `/api/projects` into `/projects`, which is what the
backend mounts. Doing it here rather than in the frontend's Node proxy means
API traffic never touches the frontend task at all; the proxy in
`frontend/src/app/api/[...path]/route.ts` is for local development.

**Every viewer header is forwarded, including `Host`.** The `AllViewer`
origin request policy sends the browser's `Host`, `Origin`, cookies and query
string through unchanged. The backend checks `Origin` against `FRONTEND_URL`
and sets `__Host-` cookies, both of which need the public hostname, not the
origin's. CloudFront still connects to `origin.<domain>` and validates that
certificate; only the header changes.

**Caching is off except for `/_next/static/*`.** Pages are rendered per
request and depend on who is asking. Build output under `/_next/static/` is
content-hashed and marked immutable by Next, so `CachingOptimized` keeps it
for up to a year and ignores cookies for the key. A deploy changes the hashes,
so nothing needs invalidating; `distribution_id` is exported in case it ever
does.

**No WAF, no response-headers policy — yet.** Both are worth adding once
there is traffic to tune them against. A response-headers policy that sets
`X-Frame-Options` could interfere with the Word add-in's Office dialog flow,
which has not been exercised against this footprint; that is a decision for
the hardening pass, not a default.

**Health check is the home page.** Next has no dedicated health route. `/`
with a `200-399` matcher accepts a redirect to sign-in as healthy and a 5xx
as not. The start-up guard in `frontend/src/instrumentation.ts` exits the
process on a fatal misconfiguration, so such a task never registers healthy
and the circuit breaker rolls the deploy back.

**Service Connect, as a client.** The service joins the backend module's
namespace without publishing a name, so `API_BASE_URL=http://backend:3001`
resolves. Production requests never use it (see above), but the frontend
refuses to start without a valid value, and this is the honest one.

**Timeouts.** CloudFront waits `origin_read_timeout_seconds` (default and
maximum 60) for the origin's first byte and between bytes. SSE streams send a
heartbeat every 15 seconds, so they are fine; a synchronous request that
takes longer than a minute gets a 504 from the edge. The backend's long work
(conversion, extraction) is asynchronous for that reason among others.

**`NEXT_PUBLIC_APP_URL` is a build-time value.** Next inlines `NEXT_PUBLIC_*`
into the browser bundle when the image is built, so the Stage 4 build must
pass `https://<domain>` as a build argument. The task definition sets it too,
so the runtime and the bundle agree and the start-up guard is satisfied.

## Inputs and outputs

See `variables.tf` and `outputs.tf`. The module takes the shared cluster,
listener, namespace and origin secret from the `backend` module rather than
creating its own, which is what keeps the two services on one load balancer
and one hostname.
