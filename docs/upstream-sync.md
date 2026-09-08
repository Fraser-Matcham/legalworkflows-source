# Upstream sync

This repository is a private extraction of `open-legal-products/mike`. Upstream
is active — 631 commits in its first four months — and it ships security fixes.
This is the routine for taking them.

Run it on a cadence (fortnightly is a reasonable default) rather than on demand.
The cost of a sync grows faster than linearly with the size of the diff: a
fortnight of upstream commits is an afternoon, six months of them is a project.

## Remote topology

Three remotes, each with exactly one job:

| Remote | URL | Job |
| --- | --- | --- |
| `origin` | `https://github.com/Fraser-Matcham/legalworkflows` | The private service repository. Everything you build lives here. |
| `upstream` | `https://github.com/open-legal-products/mike` | The AGPL-3.0 project this was extracted from. Read-only; you never push to it. |
| `fork` | `https://github.com/matchamfraser/legalworkflows` | The public GitHub fork the extraction came from. Kept for provenance and for opening upstream pull requests if that is ever wanted. Not part of the sync routine. |

Set them up on a fresh clone with:

```sh
git clone https://github.com/Fraser-Matcham/legalworkflows
cd legalworkflows
git remote add upstream https://github.com/open-legal-products/mike
git remote add fork https://github.com/matchamfraser/legalworkflows
git fetch upstream
```

`git remote -v` should then list all three.

## Two branches, two rules

- **`main`** is the service. Protected: pull requests only, required checks
  must pass.
- **`upstream-main`** is a mirror of `upstream/main`. **Nothing is ever
  committed to it.** It exists so that a merge into `main` has a clean base
  and so a diff against upstream is always one command away. It is protected
  to reject anything that is not a fast-forward, which is what stops it
  drifting.

If `upstream-main` ever refuses a fast-forward, something has been committed to
it by mistake. Reset it to `upstream/main` rather than merging.

## The routine

`scripts/upstream-sync.sh` does steps 1 and 2 and stops before the merge, so
the merge is always a deliberate act on a branch you named. To do it by hand:

```sh
# 1. Fetch upstream and fast-forward the mirror. Fails loudly if the mirror
#    has drifted, which is the point of --ff-only.
git fetch upstream
git checkout upstream-main
git merge --ff-only upstream/main
git push origin upstream-main

# 2. See what you are about to take.
git log --oneline main..upstream-main
git diff --stat main..upstream-main

# 3. Merge into a branch, never straight into main.
git checkout main
git pull --ff-only origin main
git checkout -b chore/upstream-sync-$(date +%Y-%m-%d)
git merge upstream-main

# 4. Resolve conflicts (see below), then verify before pushing.
npm ci --prefix backend && npm run build --prefix backend && npm test --prefix backend
npm ci --prefix frontend && npm run build --prefix frontend && npm test --prefix frontend

# 5. Open a pull request into main and let CI gate it.
git push -u origin chore/upstream-sync-$(date +%Y-%m-%d)
```

Step 3 uses a merge, not a rebase. A merge records that upstream's history is
part of this one, which is the cleanest evidence of "what changed and when"
that AGPL section 5(a) asks you to state. A rebase throws that away.

## Resolving conflicts

### Lockfiles

`.gitattributes` marks `package-lock.json` and `bun.lock` as `merge=binary`
deliberately. Git's line-level merge can combine both sides' insertions into
syntactically invalid JSON *without raising a conflict* — that silently broke
`backend/package.json` in upstream PR #233. Marking them binary forces every
concurrent change to surface as an explicit conflict.

Resolve by taking this repository's copy and regenerating:

```sh
git checkout --ours backend/package-lock.json
cd backend && npm install && cd ..
git add backend/package-lock.json
```

Repeat per workspace with its own lockfile: the repository root, `backend/`,
`frontend/`, and `word-addin/`. `security.yml` audits exactly those four, so a
missed one shows up as a red check rather than a surprise in production.

### Everything else

Most conflicts will be in files you have edited — the debranded frontend
surfaces, and anything a fork rule told you to change. This is the cost the
"additive changes in new files" rule in `AGENTS.md` exists to keep small.
When you resolve, prefer taking upstream's logic and re-applying your change on
top of it, rather than keeping your side wholesale: your side is usually a
string or a small edit, and upstream's side is usually the bug fix you came for.

Do not resolve a conflict in `LICENSE`. There should never be one — if there
is, take upstream's copy unchanged.

## Verifying a sync

A sync is done when all of these hold:

- `git log --oneline main..upstream-main` is empty.
- The backend and frontend builds and suites are green locally.
- The pull request into `main` is green on CI, including `Stack tests`,
  `Schema drift`, and `Secret scan`.
- No user-visible upstream branding has come back in. Check the surfaces listed
  under the debranding epic in `docs/delivery-plan/README.md` before merging.

## Establishing the baseline

The first sync should be run while `main` and `upstream/main` are identical, so
the mechanics are proven at a moment when a conflict is impossible. At the time
this repository was seeded both were at `8b3466fc04bf8cad623238a71fca1fda3fc89fde`,
with `git rev-list --left-right --count upstream/main...main` returning `0 0`.
