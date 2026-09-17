#!/usr/bin/env bash
# Run a database-tools subcommand as a one-off Fargate task and follow its
# log. Ticket 2113; docs/runbooks/platform-migration.md.
#
#   infra/dbtools/run.sh bootstrap
#   infra/dbtools/run.sh dump-restore
#   infra/dbtools/run.sh verify
#   infra/dbtools/run.sh migrate
#
# Needs the AWS CLI with credentials for the account, and the dbtools image
# pushed by the release pipeline (deploy.yml, "Build and scan (dbtools)").
# NAME_PREFIX defaults to the production prefix; AWS_REGION to eu-west-2.
set -euo pipefail

NAME_PREFIX=${NAME_PREFIX:-legalworkflows-production}
export AWS_DEFAULT_REGION=${AWS_REGION:-${AWS_DEFAULT_REGION:-eu-west-2}}
SUBCOMMAND=${1:?usage: run.sh <bootstrap|dump-restore|verify|migrate|fingerprint>}

# The task runs where the platform's other tasks run — the backend service's
# subnets — but in the dbtools security group, which is the one the database
# admits and which can reach the Supabase pooler.
SUBNETS=$(aws ecs describe-services --cluster "$NAME_PREFIX" --services "$NAME_PREFIX-backend" \
  --query 'services[0].networkConfiguration.awsvpcConfiguration.subnets' --output json)
SG=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=$NAME_PREFIX-dbtools" \
  --query 'SecurityGroups[0].GroupId' --output text)
[ "$SG" != "None" ] || { echo "no $NAME_PREFIX-dbtools security group: is platform_enabled applied?" >&2; exit 1; }

TASK=$(aws ecs run-task --cluster "$NAME_PREFIX" --launch-type FARGATE \
  --task-definition "$NAME_PREFIX-dbtools" \
  --network-configuration "{\"awsvpcConfiguration\":{\"subnets\":$SUBNETS,\"securityGroups\":[\"$SG\"],\"assignPublicIp\":\"DISABLED\"}}" \
  --overrides "{\"containerOverrides\":[{\"name\":\"dbtools\",\"command\":[\"$SUBCOMMAND\"]}]}" \
  --started-by "dbtools-$SUBCOMMAND" \
  --query 'tasks[0].taskArn' --output text)
echo "task: $TASK"
echo "log:  /ecs/$NAME_PREFIX-dbtools  dbtools/dbtools/${TASK##*/}"

aws ecs wait tasks-stopped --cluster "$NAME_PREFIX" --tasks "$TASK"
EXIT=$(aws ecs describe-tasks --cluster "$NAME_PREFIX" --tasks "$TASK" --query 'tasks[0].containers[0].exitCode' --output text)
REASON=$(aws ecs describe-tasks --cluster "$NAME_PREFIX" --tasks "$TASK" --query 'tasks[0].stoppedReason' --output text)

echo "--- task output ---"
for attempt in 1 2 3 4 5; do
  LINES=$(aws logs get-log-events --log-group-name "/ecs/$NAME_PREFIX-dbtools" \
    --log-stream-name "dbtools/dbtools/${TASK##*/}" --start-from-head \
    --query 'events[].message' --output text 2>/dev/null || true)
  [ -n "$LINES" ] && break
  sleep 3
done
printf '%s\n' "${LINES:-(no log events)}"
echo "--- exit code: $EXIT ($REASON) ---"
[ "$EXIT" = "0" ]
