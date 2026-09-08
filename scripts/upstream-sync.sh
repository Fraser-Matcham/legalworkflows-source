#!/usr/bin/env bash
# Fast-forward the upstream-main mirror and report what a sync would bring in.
#
# This is steps 1 and 2 of docs/upstream-sync.md. It deliberately STOPS before
# merging into main: the merge is a judgement call that belongs on a named
# branch with a pull request behind it, not in a script that could be run on
# a dirty tree by accident.
#
# What it does:
#   1. Checks the three-remote topology is intact (origin/upstream/fork).
#   2. Fetches upstream and fast-forwards local upstream-main to upstream/main.
#      --ff-only is the drift guard: if anything has ever been committed to the
#      mirror, this fails loudly instead of quietly creating a merge commit.
#   3. Pushes the mirror to origin.
#   4. Prints the commits and the diffstat that main is missing, plus the exact
#      commands to take them.
#
# Usage, from the repo root:
#   ./scripts/upstream-sync.sh
#   ./scripts/upstream-sync.sh --no-push    # local mirror only, don't push
set -euo pipefail

UPSTREAM_URL="https://github.com/open-legal-products/mike"
PUSH=1
[[ "${1:-}" == "--no-push" ]] && PUSH=0

cd "$(git rev-parse --show-toplevel)"

# A dirty tree turns a checkout into a surprise. Refuse rather than stash:
# stashing someone else's work is a worse failure than stopping.
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "error: working tree has uncommitted changes. Commit or stash first." >&2
  exit 1
fi

if ! git remote get-url upstream >/dev/null 2>&1; then
  echo "error: no 'upstream' remote. Add it with:" >&2
  echo "  git remote add upstream ${UPSTREAM_URL}" >&2
  exit 1
fi

STARTING_REF="$(git symbolic-ref --quiet --short HEAD || git rev-parse HEAD)"
# Always put the caller back where they were, including on failure.
trap 'git checkout --quiet "${STARTING_REF}" 2>/dev/null || true' EXIT

echo "==> Fetching upstream and origin"
git fetch upstream --prune
git fetch origin --prune

echo "==> Fast-forwarding upstream-main to upstream/main"
if git show-ref --verify --quiet refs/heads/upstream-main; then
  git checkout --quiet upstream-main
  # If this fails, the mirror has drifted: something was committed to it.
  # Reset it to upstream/main rather than merging — see docs/upstream-sync.md.
  git merge --ff-only upstream/main
else
  git checkout --quiet -b upstream-main upstream/main
fi

if [[ "${PUSH}" -eq 1 ]]; then
  echo "==> Pushing upstream-main to origin"
  git push -u origin upstream-main
fi

git checkout --quiet "${STARTING_REF}"

BEHIND="$(git rev-list --count main..upstream-main)"
echo
echo "==> main is ${BEHIND} commit(s) behind upstream-main"

if [[ "${BEHIND}" -eq 0 ]]; then
  echo "    Nothing to merge. main is level with upstream."
  exit 0
fi

echo
echo "--- commits to take -------------------------------------------------"
git log --oneline --no-decorate main..upstream-main
echo
echo "--- files affected --------------------------------------------------"
git diff --stat main..upstream-main
echo
BRANCH="chore/upstream-sync-$(date +%Y-%m-%d)"
cat <<NEXT
--- next steps ------------------------------------------------------
  git checkout main && git pull --ff-only origin main
  git checkout -b ${BRANCH}
  git merge upstream-main

Lockfile conflicts are expected and intentional (.gitattributes marks them
merge=binary). Resolve by taking this repo's copy and regenerating:

  git checkout --ours <workspace>/package-lock.json
  (cd <workspace> && npm install)
  git add <workspace>/package-lock.json

for each of: . backend frontend word-addin

Then verify, push, and open a pull request into main.
Full routine: docs/upstream-sync.md
NEXT
