# What is actually left

The backlog register is [`../backlog.csv`](../backlog.csv), 124 tickets; the
current status of each is in [`delivery-status.xlsx`](delivery-status.xlsx). Most
are done and the plan records them. This lists only what is **not** done, with
the evidence for each, so nobody has to re-derive it.

Compiled 17 September 2026, against `main` at `0f8e99c`.

---

## Blocked on the operator, and blocking everything downstream

### The deployment is broken on an invalid Supabase credential

Deploy runs 12 and 13 both died at the catalogue sync with:

```
Mike workflow sync failed { message: 'Invalid API key',
  hint: 'Double check your Supabase `anon` or `service_role` API key.' }
```

`SUPABASE_SECRET_KEY` in `<prefix>/backend/operator` is wrong or stale. The
remedy is section 2 of
[`../../runbooks/database-unreachable.md`](../../runbooks/database-unreachable.md).

It would not have stopped at the sync: the service reads the same secret from
the same task definition, and `/ready` includes a database probe, so the
readiness gate a step later would have failed too.

**Everything in Stage 4 from row 4.8 onward waits on this.** Rows 4.8/4.9 (load
test), 4.10, 4.13 (the smoke test exists but has never met a deployment) and
4.14 all need a stack that serves.

### `terraform apply` has not been run since three changes landed

- ECS Exec disabled on both services and both task roles (security review
  finding 2) — until applied, the running services still accept an exec session.
- ECR enhanced scanning.
- `workflows_repository`, if it is to be set to `""` (see 2014 below).

---

## Genuinely open tickets

### 2014 — Take ownership of the workflow catalogue *(Story, High)*

> *"Product content is therefore controlled by a third party."*
> AC: *"The catalogue syncs from a repository you control; upstream renaming or
> privatising theirs has no effect."*

`workflows_repository` still points at `Open-Legal-Products/mike-workflows`.
AGENTS.md fork rule 2 asks for a fork you own — the variable name is
configuration, the value is ownership.

This is **not** an availability problem today: the e2e workflow's "Sync Mike
workflow catalog" step passes on every pull request, which means that
repository is publicly readable without a token. It is a supply-chain problem —
the ticket's own framing — and it stays open until the catalogue is yours.

Needs a fork created under an account you control, which is outside what this
repository's tooling can do.

**The licence question the ticket raises is answered.** Checked on
17 September 2026 against `Open-Legal-Products/mike-workflows` at `ce62e6a`
(17 August 2026): the repository is **MIT** (`LICENSE`, and the README's
"License" section), with a `PROVENANCE.md` that requires each workflow to
carry its own `license` field and asks contributors to keep third-party
notices where a pack was adapted. MIT permits the fork, the copy and the
modification outright; the one obligation is to keep the MIT notice in the
fork, which forking does by construction. It is a separate repository from
the AGPL application, so the AGPL does not reach it and it does not reach
the AGPL.

Once the fork exists, the remaining steps are configuration: set
`workflows_repository` in `infra/terraform.tfvars` to the fork (and
`workflows_ref` to a commit SHA for a reproducible release), apply, and the
next release's catalogue sync reads from it (ticket 2016 is that release
passing its sync step against an empty catalogue and the five defaults
resolving in the product). The catalogue carries 23 assistant workflows and
the tabular-review packs; pinning the SHA is what stops an upstream edit
changing product content between releases.

### 2009 — Run a first upstream merge as a dry run *(Sub-task, Medium)*

> AC: *"Merge completes; full backend and frontend suites green afterwards."*

`upstream-main` exists and [`../../upstream-sync.md`](../../upstream-sync.md)
documents the routine (2004 and 2008 are done), but no merge from it appears in
this fork's history. The merge commits that mention "upstream" are inherited
from upstream's own history, not performed here.

The point of the ticket is to prove the mechanics while a conflict is still
impossible, so its value decays as the fork diverges. It has diverged
considerably.

---

## Done literally, not meaningfully

### 2020 — Configure Actions secrets and verify the e2e run *(Sub-task, High)*

> AC: *"e2e workflow completes green on a pull request."*

Met on the face of it: e2e runs on every pull request and passes.

**`ANTHROPIC_API_KEY` is not set, so four specs have never run in CI** — chat
rename, chat delete, chat submit, and the critical-path "ask a question". They
self-skip without the key and the run still reports green, which is deliberate
and documented in `e2e.yml`, `e2e/llm.ts` and
[`../../e2e-ci.md`](../../e2e-ci.md). The design is not the problem; the empty
secret is.

The evidence is in any e2e job log, in the env block of a step that exposes it:

```
ANTHROPIC_API_KEY:
```

GitHub renders a configured secret as `***` and an unset one as empty. It is
empty on run 35152758070, job 104984842558 — the e2e run for `89348ed`.

So the specs covering the product's central flow — send a message, get a
streamed answer — are green because they did not run. Setup is in
`docs/e2e-ci.md`, "Enable the LLM specs"; it wants a spend-capped, CI-scoped
key. Until then, treat e2e's green as covering the other 27 specs only.

---

## Not in this repository

Seven backlog rows target `juralio-frontend`, the other side of the HTTP
boundary, and one epic with them. They cannot be done from here, and fork rule 1
means they must not be done by reaching across.

Row 4.12's security review is also only half done for the same reason: it
covers this repository and the seam from this side. See
[`../../security-review.md`](../../security-review.md).

---

## Verified done during this sweep

Checked against the tree rather than assumed, because the plan does not cite
them by number and they read as open:

| Ticket | Evidence |
| --- | --- |
| 2003 clone with history | the repository exists with history |
| 2004 `upstream-main` branch | exists on the remote |
| 2005 branch protection | plan row 4.5, set in GitHub settings |
| 2006 fork rules in AGENTS.md | the four fork rules are there |
| 2008 upstream sync documented | `docs/upstream-sync.md` |
| 2011 SheetJS CDN removed | no `cdn.sheetjs`/`sheetjs.com` reference in any source tree |
| 2019 scorecard.yml deleted | absent from `.github/workflows/` |
| 2021 Dependabot | `.github/dependabot.yml` |
| 2022 CodeQL | `.github/workflows/codeql.yml` |
| 2035 do-not-rename register | the table in AGENTS.md fork rule 2 |
| 2062 production security baseline | trusted origins, 24 rate-limit settings in `app.ts`, `docs/data-retention.md`, `docs/security-review.md` |
