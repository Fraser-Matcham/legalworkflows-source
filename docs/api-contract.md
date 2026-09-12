# The HTTP API contract

What this service promises to the things that call it, and what it does not.

There are two consumers today and a third planned. The **web frontend** in this
repository calls it, and since the two became separate deployables that call
crosses a network rather than a function boundary. The **Word add-in** calls the
same API from a different origin. **Juralio** will call it later, over HTTP and
by no other means (AGENTS.md fork rule 1), which is why this document exists in
a form somebody outside this repository can read.

`scripts/check-api-contract.mjs` fails the build when the mount table below
stops matching what `backend/src/app.ts` actually mounts. Run it locally with
`npm run api-contract`. A contract nobody checks is a comment.

## What is stable, and what is not

| | |
| --- | --- |
| **Stable** | The mount prefixes below; the authentication model; the error envelope; the SSE event names. Breaking any of these is a deliberate, announced change. |
| **Not stable** | Response field additions — a consumer must tolerate unknown fields. Internal representations. Anything under a route not listed here. |

There is no version prefix on the URL and no plan for one. With a single
operator and three known consumers, coordinating a change is cheaper than
carrying two versions. That reasoning stops holding the moment there is a
consumer you cannot deploy, and the right answer then is `/v2`, not a
compatibility shim.

## Origin

The browser calls `/api/*` as a **relative path**. The CDN routes that prefix
to the backend, so the frontend and the API share one origin — see
`docs/delivery-plan/v2/architecture.md`, decision 5. `frontend/src/app/api/[...path]/route.ts`
is the server-side proxy that strips `/api` and forwards to `API_BASE_URL`.

The Word add-in calls the backend origin directly and is subject to the CORS
allowlist.

## Authentication

Two mechanisms, in this order (`backend/src/middleware/auth.ts`):

1. **`Authorization: Bearer <token>`** — API clients, and older add-in builds.
2. **HttpOnly cookie session** — what current browser clients use. The add-in
   establishes one through the handoff flow rather than holding a token.

Every route requires one except: `/auth/*` (it is how you get a session),
`/health`, `/ready`, and `/manifest-signing-key` (deliberately open — whoever
verifies an export manifest is usually outside the workspace and needs the key
from the server rather than from the file they were handed).

`GET /metrics` is the one endpoint with an authentication scheme of its own: a
bearer token from `METRICS_TOKEN`, not a session. A scraper is not a user and
should not hold a user's session. With no token configured the endpoint answers
**404**, the same as any unrouted path, so the default posture is that it does
not exist.

Authorisation is **per handler**. The backend holds the service-role key and
bypasses RLS entirely, so a route that forgets its access check is a
cross-tenant leak rather than a permission error. `npm run tenancy` guards
that, and `docs/testing-coverage.md` records which routers have denial tests.

## Errors

Two envelopes, and the difference matters to a caller.

**Intentional 4xx** — validation and permission failures say what is wrong:

```json
{ "detail": "The filename is required." }
```

**5xx** — never say what is wrong, because the reason is internal:

```json
{ "code": "internal_error",
  "detail": "Something went wrong. Please try again.",
  "request_id": "0f4c…" }
```

`protectInternalErrorResponses` enforces the second: any JSON body at status
≥ 500 is replaced with exactly that shape. The `request_id` matches the
`x-request-id` response header and the `requestId` in the request log, which is
how an operator ties a user's report to a log line
(`docs/observability.md`).

One deliberate exception: `GET /ready` answers **503 with no body at all** when
a dependency is unreachable. A load balancer acts on the status code, and an
empty body cannot leak.

## Streaming

`POST /chat`, `/word-chat`, `/projects/:projectId/chat` and
`/tabular-review/:reviewId/chat` respond with **Server-Sent Events**, not JSON.
Each frame is `data: <json>\n\n`. This is the most fragile part of the surface
and the part a consumer is most likely to get wrong.

Event objects carry a `type`. The vocabulary in use:

| Group | `type` values |
| --- | --- |
| Content | `content`, `content_delta`, `lead` |
| Reasoning | `reasoning`, `reasoning_delta`, `reasoning_block_end` |
| Identity | `chat_id`, `chat_title` |
| Citations | `citations`, `citation_data` |
| Documents | `doc_created`, `doc_read`, `doc_find`, `doc_edited`, `doc_download`, `doc_replicated` |
| Word edits | `word_edit_block`, `word_edit_ref`, `edit_data` |
| Tools | `tool_call_start`, `workflow_applied` |
| Input requests | `ask_inputs`, `ask_inputs_response` |
| Failure | `error` |

Three rules for a consumer:

1. **Ignore unknown `type` values.** New ones are added without notice; that is
   the one place additions are routine.
2. **An `error` event can arrive before the stream ends**, and is the failure
   channel — a 200 status says the stream opened, not that it succeeded.
3. **Deltas accumulate.** `content_delta` fragments concatenate; they are not
   replacements.

The frontend's re-declared copies of the shapes it depends on live in
`frontend/src/app/components/shared/apiTypes.ts`. That duplication is
deliberate: fork rule 1 forbids importing types across the boundary, and
`npm run frontend-boundary` enforces it.

## Mounts

Every router mounted by `backend/src/app.ts`. The checker compares this table
against the source, so a new router that is not listed here fails the build.

| Prefix | What it serves |
| --- | --- |
| `/auth` | Sign-in, sign-up, sign-out, password and email changes, MFA, OAuth handoff |
| `/chat` | The assistant, over SSE, plus chat listing and history |
| `/word-chat` | The Word add-in's chat surface |
| `/models` | Provider catalogues, behind a server-side key |
| `/projects` | Projects, their documents, folders, chats, and access grants |
| `/projects/:projectId/chat` | Project-scoped assistant |
| `/orgs` | Organisations, membership, invitations |
| `/single-documents` | Documents outside any project, and their versions |
| `/library` | The shared template and precedent library |
| `/tabular-review` | Tabular reviews, their columns, cells and generation |
| `/workflows` | Workflow definitions and runs |
| `/quick-actions` | Saved prompts |
| `/workflow-addons` | The global add-on catalogue, and importing from it |
| `/user` | Account, settings, API keys, model choices, exports, deletion |
| `/users` | Alias of `/user`, retained for older clients |
| `/download` | Token-authorised file downloads |
| `/documents` | Source-document hydration (public case law) |
| `/audit` | The audit trail and its export |
| `/upload-sessions` | Direct-to-storage upload reservations and completion |

Standalone endpoints, outside any router:

| Endpoint | Purpose | Auth |
| --- | --- | --- |
| `GET /health` | Liveness. Unconditionally `{"ok":true}` | none |
| `GET /ready` | Readiness — dependencies reachable. 200 with a report, or 503 with no body | none |
| `GET /manifest-signing-key` | The Ed25519 public key for export manifests, or `null` | none |
| `GET /metrics` | Prometheus text exposition. 404 when `METRICS_TOKEN` is unset, 401 without it | `Authorization: Bearer $METRICS_TOKEN` |

## Rate limits

Twelve limiters, all tunable by environment variable, attached in `app.ts`
before the routers. A caller that exceeds one gets **429**. The auth limiters
are the strictest: per-IP on login, per-address on sign-up and password reset,
and a body-aware account limiter whose key is a one-way digest, so email
addresses never enter the limiter store.

Production values are set per environment rather than in code; see ticket 2063.

---

Copyright 2026 Fraser Matcham. Licensed under the GNU Affero General Public
License v3.0.
