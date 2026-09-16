# Model provider outage

Chat, workflow runs and tabular extraction call a model provider over
HTTPS. When the provider is down, rate-limiting, or has revoked the key,
those features fail and everything else — documents, projects, sign-in —
keeps working.

**How it shows up.** Users: "the assistant says something went wrong",
extractions stuck. Metrics: `llm_calls_total{outcome="error"}` climbing on
`/metrics`. Log: `[llm]`-labelled error lines and a `logged_errors_total`
increase. The error tracker groups them by provider. No alarm fires for
this alone; `backend-5xx` may, if the failure surfaces as a 500.

## 1. Them or us

1. The provider's status page: Anthropic
   [status.anthropic.com](https://status.anthropic.com); others as
   configured. An incident there is the answer — nothing to fix, tell users
   if it is prolonged.
2. The error shape in the log:

   | Error | Meaning |
   | --- | --- |
   | `401` / `authentication` | the key in `legalworkflows-production/backend/operator` (`ANTHROPIC_API_KEY`) is wrong or revoked |
   | `429` | rate limited or **the spending limit on the key has been reached** (Stage 2 asked for one to be set). Check the provider console's usage page |
   | `overloaded` / `529` / `503` | the provider is saturated; retries are already happening in the SDK |
   | timeouts on every call | egress: NAT gateway or route tables — [database-unreachable.md](database-unreachable.md) step 2, "The network" |

## 2. If it is the key

Rotate it in the provider's console, write it to the operator secret, and
restart the tasks:

```sh
 aws secretsmanager put-secret-value \
  --secret-id legalworkflows-production/backend/operator \
  --secret-string "$(aws secretsmanager get-secret-value \
    --secret-id legalworkflows-production/backend/operator --query SecretString --output text \
    | jq --arg k "<new key>" '.ANTHROPIC_API_KEY = $k')"
aws ecs update-service --cluster legalworkflows-production \
  --service legalworkflows-production-backend --force-new-deployment
```

(Leading space: keeps it out of shell history.)

## 3. If it is the spending limit

Raising it is a business decision, not an operational one. Until it is
raised, users with their own provider keys (Settings → API Keys) are
unaffected — per-user keys are used in preference to the operator's — and
that is the honest interim answer.

## 4. A second provider

The backend supports several providers (`backend/.env.example`:
`OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, …). Adding one is
a configuration change, not an incident response: add the key name to
`operator_secret_keys` in the `secrets` module, write the value to the
operator secret, add the name to `backend_extra_secret_keys`, apply, and
force a new deployment. Do it on a quiet day, not during an outage.

## Afterwards

If the cause was the spending limit, the useful follow-up is an alarm on the
provider console's budget, which lives with the provider, not here.
