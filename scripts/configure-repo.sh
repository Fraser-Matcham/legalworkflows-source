#!/usr/bin/env bash
# Apply the branch protection and merge rules this repository depends on.
#
# WHY THIS IS A SCRIPT AND NOT A CLICK-PATH: these settings are what make CI
# gate anything. Solo development benefits as much as a team does — a required
# check you can bypass is a check you will bypass at 6pm on a Friday. Keeping
# them in a script means the configuration is reviewable, repeatable, and
# recoverable if the repository is ever recreated.
#
# REQUIRES ADMIN. The GitHub App token available inside a Claude Code session
# has no admin scope on this repository, so this cannot be applied from an
# agent session. Run it yourself, once, from a machine authenticated as an
# owner of the Fraser-Matcham organisation:
#
#   gh auth login                    # needs 'repo' and 'admin:org' scopes
#   ./scripts/configure-repo.sh
#
# It is idempotent: re-running it re-asserts the same state.
#
# Delivery-plan tickets: 2004 (upstream-main mirror protection),
# 2005 (main branch protection), 2025 (required status checks).
set -euo pipefail

REPO="${REPO:-Fraser-Matcham/legalworkflows}"

command -v gh >/dev/null || { echo "error: gh CLI not found" >&2; exit 1; }

# Required status checks, given as GitHub check *contexts*: "<workflow name> /
# <job name>", taking the job's `name:` where it has one and its key where it
# does not. Verified against .github/workflows/ at the commit this was written.
#
# Every context below runs on `pull_request` into `main`, so none of them can
# strand a pull request in "Expected — waiting for status".
REQUIRED_CHECKS=(
  "CI / Backend build and tests"
  "CI / Frontend build and tests"
  "CI / Eval harness"
  "Stack tests / Supabase stack integration tests"
  "Schema drift / Fresh install vs upgraded deployment"
  "Secret scan / gitleaks (full history)"
)

# Deliberately NOT required, with reasons:
#
#   "e2e / playwright"
#       The strongest gate in the repo, and the slowest (it boots Supabase,
#       RustFS, the backend and Next.js on the runner). Add it once you have
#       lived with the feedback loop for a sprint — the line is written below,
#       commented out, so it is one edit away.
#
#   "security / dependency-audit (root|backend|frontend|word-addin)"
#       This fails the build on any high or critical advisory against a locked
#       dependency. GitHub reported 12 open advisories (2 high) on this tree at
#       seeding, so requiring it today blocks every pull request on inherited
#       debt. Clear the advisories, confirm the four jobs are green, then add
#       the four contexts here.
#
#   "CodeQL / Analyze (javascript-typescript)"
#       Cannot pass on this repository today. The analysis runs, but the upload
#       is rejected with "Code Security must be enabled for this repository to
#       use code scanning" — it is a private-repo entitlement, not a code
#       problem. Enable Code Security under Settings > Advanced Security, or
#       disable the workflow (ticket 2022). Requiring a check that can never
#       report blocks all merges.
#
#   "Mutation testing", "SSE load test", "Word add-in"
#       Not pull-request gates by design. Mutation testing is a monthly drift
#       check, the load test is manual, and the Word add-in job is
#       path-filtered to word-addin/** so it does not report on most pull
#       requests.

# ---------------------------------------------------------------------------
echo "==> Repository merge settings on ${REPO}"
# Squash-only keeps main's history linear and readable. The exception that
# matters: upstream sync branches are merged with a merge commit so upstream's
# history is preserved (AGPL section 5(a) asks you to state what changed and
# when) — hence allow_merge_commit stays true.
gh api -X PATCH "repos/${REPO}" \
  -F allow_squash_merge=true \
  -F allow_merge_commit=true \
  -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true \
  -F allow_auto_merge=true \
  -F has_issues=true \
  -F web_commit_signoff_required=false \
  >/dev/null
echo "    squash + merge commits allowed, rebase off, merged branches deleted"

# ---------------------------------------------------------------------------
echo "==> Branch protection on main"
contexts_json="$(printf '%s\n' "${REQUIRED_CHECKS[@]}" | jq -R . | jq -sc .)"

# strict:true means "branches must be up to date before merging" — without it a
# green check can be green against a stale base and merge a break into main.
#
# required_approving_review_count is 0 deliberately: this is single-maintainer
# development, and a self-approval requirement is theatre that teaches you to
# click through gates. The gate here is CI, not a second pair of eyes. Raise it
# to 1 the day a second engineer joins.
jq -nc \
  --argjson contexts "${contexts_json}" \
  '{
     required_status_checks: { strict: true, contexts: $contexts },
     enforce_admins: false,
     required_pull_request_reviews: {
       required_approving_review_count: 0,
       dismiss_stale_reviews: true,
       require_code_owner_reviews: false
     },
     restrictions: null,
     required_linear_history: false,
     allow_force_pushes: false,
     allow_deletions: false,
     block_creations: false,
     required_conversation_resolution: true,
     lock_branch: false,
     allow_fork_syncing: false
   }' \
  | gh api -X PUT "repos/${REPO}/branches/main/protection" --input - >/dev/null

echo "    pull request required; force push and deletion blocked"
echo "    required checks:"
printf '      - %s\n' "${REQUIRED_CHECKS[@]}"

# enforce_admins is false on purpose. An admin bypass you never use costs
# nothing; an admin bypass you cannot use costs you the one evening the
# migration has to land and a required runner is down. If you would rather
# remove the temptation, set it to true above — nothing else needs to change.

# ---------------------------------------------------------------------------
echo "==> Branch protection on upstream-main"
# The mirror is never committed to. It carries no required checks (nothing is
# ever proposed against it) and no review requirement (nothing is ever reviewed
# on it). What it needs is the opposite: a guarantee that it can only ever
# fast-forward to what upstream published.
#
# allow_force_pushes:false is what enforces that. A fast-forward push is not a
# force push, so scripts/upstream-sync.sh keeps working; a rewritten or
# diverged history is rejected, which is exactly the drift this branch exists
# to make impossible.
jq -nc \
  '{
     required_status_checks: null,
     enforce_admins: false,
     required_pull_request_reviews: null,
     restrictions: null,
     allow_force_pushes: false,
     allow_deletions: false,
     lock_branch: false
   }' \
  | gh api -X PUT "repos/${REPO}/branches/upstream-main/protection" --input - >/dev/null

echo "    force push and deletion blocked; fast-forward pushes still allowed"

# ---------------------------------------------------------------------------
echo "==> Dependabot"
# .github/dependabot.yml schedules version bumps; security updates (the PRs
# that fix a published CVE) are a separate repository toggle, and on a private
# repository both alerts and updates must be switched on explicitly.
gh api -X PUT "repos/${REPO}/vulnerability-alerts" >/dev/null 2>&1 \
  && echo "    alerts enabled" \
  || echo "    WARN: could not enable alerts — check them under Settings > Advanced Security"
gh api -X PUT "repos/${REPO}/automated-security-fixes" >/dev/null 2>&1 \
  && echo "    security updates enabled" \
  || echo "    WARN: could not enable security updates — enable under Settings > Advanced Security"

# ---------------------------------------------------------------------------
cat <<'MANUAL'

==> Not settable through this API — do these in the web UI

  Settings > Secrets and variables > Actions
    ANTHROPIC_API_KEY    Optional. e2e.yml is green without it: 27 of the 31
                         specs run and the 4 LLM-dependent ones self-skip. Set
                         it, spend-capped and CI-scoped, only when you want
                         those 4 enforced. See docs/e2e-ci.md.
    LOADTEST_AUTH_TOKEN  Only if you keep loadtest.yml. It is workflow_dispatch
                         only, so it never gates a merge.

  Settings > Advanced Security
    Confirm whether code scanning (CodeQL) is included on this organisation's
    plan. If it is not, disable codeql.yml and record the decision rather than
    leaving a workflow that silently never runs. Ticket 2022.

  Settings > Actions > General
    Workflow permissions: "Read repository contents and packages permissions".
    Every workflow that needs more already requests it explicitly.

Verify what landed:
  gh api "repos/${REPO}/branches/main/protection" | jq '{checks: .required_status_checks.contexts, pr: .required_pull_request_reviews, force: .allow_force_pushes.enabled}'
MANUAL
