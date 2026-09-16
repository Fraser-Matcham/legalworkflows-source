# Database unreachable

**Alarm:** `backend-readiness` (urgent) when the failing log lines say
`"check":"database"`. The backend is running — the load balancer's
`/health` check passes, which is why the site may still answer — but its
readiness probe could not complete a trivial query against Supabase within
two seconds. Every request that touches data is failing or about to.

## 1. Which check, how often

```sh
aws logs filter-log-events --log-group-name /ecs/legalworkflows-production-backend \
  --start-time "$(($(date +%s) - 900))000" \
  --filter-pattern '{ $.kind = "readiness" && $.ok is false }' \
  --query 'events[].message' --output text | tail -20
```

If the lines say `storage`, stop: [storage-failure.md](storage-failure.md).

The `error` field is redacted but its shape tells you which of the three
causes this is.

## 2. Is it Supabase, the network, or the credentials

**Supabase itself.** Open the project in the dashboard:
`legalworkflows-production`, region `eu-west-2`. A paused, restarting or
"unhealthy" project is the whole answer; so is a banner. Check
[status.supabase.com](https://status.supabase.com). Nothing in this
repository can fix a Supabase-side outage; the service will recover on its
own when Supabase does, and the alarm sends an OK.

**The credentials.** A `401`/`403`-shaped error, or one mentioning `JWT` or
`apikey`, means the key the backend holds is no longer accepted. That
happens if the service-role key was rotated in the Supabase dashboard
(Project Settings → API keys) without the operator secret being updated.
Put the current key in the secret and restart the tasks so they read it:

```sh
aws secretsmanager put-secret-value \
  --secret-id legalworkflows-production/backend/operator \
  --secret-string "$(aws secretsmanager get-secret-value \
    --secret-id legalworkflows-production/backend/operator --query SecretString --output text \
    | jq --arg k "<new service_role key>" '.SUPABASE_SECRET_KEY = $k')"
aws ecs update-service --cluster legalworkflows-production \
  --service legalworkflows-production-backend --force-new-deployment
```

(Prefix the first command with a space so the shell history does not keep
it, as `infra/modules/secrets/README.md` says.)

**The network.** A timeout with Supabase healthy means the tasks cannot
reach the internet: the NAT gateway, its route, or the private subnets'
route tables. `terraform plan` shows drift; `aws ec2 describe-nat-gateways`
shows state. A NAT gateway in `failed` state is replaced by
`terraform apply` after `terraform taint`.

## 3. Verify

```sh
curl -sS -o /dev/null -w '%{http_code}\n' https://legalworkflows.co.uk/api/ready
```

`200` and the alarm's OK notification. Sign in and open a project.

## Do not

Do not point the load balancer's health check at `/ready` to "make it
fail over": there is nothing to fail over to, and cycling every task on a
dependency blip turns a database outage into a full one. That is why the
alarm exists instead.
