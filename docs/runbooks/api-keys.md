# The platform's API keys

Minting, verifying and rotating the `anon` and `service_role` keys for the
self-hosted platform, and rotating the JWT secret they are signed with.
Ticket 2121; the Terraform half is `infra/modules/keys`.

**Read this first.** Three releases in a row (deploy runs 12 to 14) failed on
a Supabase key that was wrong in a way nobody could see: the value looked
plausible, the task's log said only `Invalid API key`, and there was no way
to check a key short of deploying it. Every step below that writes a key is
preceded by a step that verifies it, and the verifier is the same code that
minted it. Do not skip the verify step to save thirty seconds; it exists
because thirty seconds is what the missing check cost, three times over.

## What the keys are

Each key is a JSON Web Token: `{"iss":"supabase","role":"anon"|"service_role",
"iat":…,"exp":…}`, signed HS256 with the platform's JWT secret. PostgREST
checks the signature and switches to the named database role; GoTrue accepts
`service_role` for its admin endpoints. The backend presents the
`service_role` key as `SUPABASE_SECRET_KEY` and the `anon` key as
`SUPABASE_PUBLISHABLE_KEY`, exactly as it did with Supabase's keys.

Two secrets hold everything (`terraform output` prints both names):

| | Secret | Written by |
| --- | --- | --- |
| the JWT secret | `platform_jwt_secret_name` → `<prefix>/platform/jwt`, key `JWT_SECRET` | Terraform |
| the two keys | `platform_api_keys_secret_name` → `<prefix>/platform/api-keys` | you, below |

The tool is `scripts/platform-keys.mjs` (`npm run platform-keys -- …`). It
reads no AWS credential; the AWS CLI does the reading and writing and the
script only ever sees the secret through a pipe.

## Mint the keys (first time, or to rotate the keys)

From a checkout, with AWS credentials for the account and `jq`:

```sh
cd infra
JWT_SECRET_ID=$(terraform output -raw platform_jwt_secret_name)
API_KEYS_ID=$(terraform output -raw platform_api_keys_secret_name)
cd ..

# 1. Mint. The secret goes straight from Secrets Manager into the script's
#    stdin; it never lands in a variable, a file, or your shell history.
aws secretsmanager get-secret-value --secret-id "$JWT_SECRET_ID" \
    --query SecretString --output text | jq -r .JWT_SECRET \
  | npm run --silent platform-keys -- mint --secret-stdin > /tmp/api-keys.json

# 2. Verify each key against the secret BEFORE writing it. This is the
#    check that was missing. It refuses a malformed, expired, wrong-role or
#    wrong-secret key and prints why.
for role in anon service_role; do
  key=$(jq -r ".$(echo $role | tr a-z A-Z)_KEY" /tmp/api-keys.json)
  aws secretsmanager get-secret-value --secret-id "$JWT_SECRET_ID" \
      --query SecretString --output text | jq -r .JWT_SECRET \
    | npm run --silent platform-keys -- verify --key "$key" --role "$role" --secret-stdin
done

# 3. Write. The whole object, as JSON — never a bare string; see
#    docs/runbooks/database-unreachable.md for what a bare string did.
aws secretsmanager put-secret-value --secret-id "$API_KEYS_ID" \
    --secret-string "file:///tmp/api-keys.json"

# 4. Read it back and verify what was actually stored, not what you meant to.
stored=$(aws secretsmanager get-secret-value --secret-id "$API_KEYS_ID" \
    --query SecretString --output text | jq -r .SERVICE_ROLE_KEY)
aws secretsmanager get-secret-value --secret-id "$JWT_SECRET_ID" \
    --query SecretString --output text | jq -r .JWT_SECRET \
  | npm run --silent platform-keys -- verify --key "$stored" --role service_role --secret-stdin

rm -f /tmp/api-keys.json
```

Step 2 prints `VERIFIED role=… issued=… expires=…` and `signature: matches
the secret` for each key, and exits non-zero otherwise. A `REFUSED` here is
the tool doing its job: read the reason, fix it, and do not write.

**Then**: any task that reads the keys picks them up on its next start. Before
the cutover (ticket 2122) that is nothing; after it, the backend — force a new
deployment or push a release.

## Verify a key against the running platform

Once PostgREST and GoTrue are up, the offline check can be extended to ask
them:

```sh
npm run --silent platform-keys -- verify --key "$key" --role anon \
    --against https://legalworkflows.co.uk
```

It requests `/rest/v1/` and `/auth/v1/settings` with the key and reports
which service refused it. A `503` is reported as "the service is not
healthy, so the key was not tested" rather than as a pass — a key is only
verified when something actually checked it.

The same command is the first thing to run when the backend logs
`Invalid API key` after the cutover: it says in one line whether the stored
key is the problem or the services are.

## Rotate the keys

The keys are only ever checked, never stored, by PostgREST and GoTrue, so
rotating them touches only the backend:

1. Run "Mint the keys" above. The new keys are signed with the same secret,
   so the old ones stay valid until step 3.
2. Force a new deployment of the backend so it reads the new values:
   `aws ecs update-service --cluster legalworkflows-production --service
   legalworkflows-production-backend --force-new-deployment`.
3. The old keys are now unused. They remain *valid* — a JWT cannot be
   revoked short of changing the secret — so if the reason for rotating was a
   suspected leak, rotate the secret instead.

## Rotate the JWT secret

This signs every user out (their access and refresh tokens were signed with
the old secret) and invalidates both keys. Do it in a quiet window and say so
beforehand.

```sh
cd infra
terraform taint 'module.keys[0].random_password.jwt_secret'
terraform apply            # writes the new JWT_SECRET
cd ..
```

Then, in this order:

1. "Mint the keys" above — the old keys now fail the verify step, which is
   the proof the taint took effect.
2. New deployments of **PostgREST and GoTrue** (they read the secret at
   start): `aws ecs update-service … --force-new-deployment` for each.
   Between this step and the next, the backend's old keys are refused and
   `/api/ready` reports the database check failing; that is expected and
   brief.
3. A new deployment of the **backend**.
4. `verify --against` for both keys.

A ten-year expiry means the keys never rotate on a schedule; they rotate when
a person decides to. `verify` warns from ninety days before expiry, and
`EXPIRES_AT` in the secret is the date to put in a calendar.

## If a task will not start

`ResourceInitializationError … did not contain json key SERVICE_ROLE_KEY`
means the api-keys secret has never been written, or was replaced by
something that is not the JSON object above. `get-secret-value` and look;
`--version-stage AWSPREVIOUS` shows the value before the last write. Restore
the object, never a bare string.
