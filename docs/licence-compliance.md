# Licence compliance sign-off

Ticket 2103, plan row 4.11. The ten items the licence position rests on, each
with the command that checks it and what that command returned.

This is a checklist you re-run, not a certificate. Seven of the ten are
enforced by CI and cannot regress silently. Three are not, and are marked
**manual** — those are the ones worth a person's attention before a release.

The obligations come from two places. The service is a modified AGPL-3.0 work
and is used over a network, so sections 5 and 13 apply to it. Its dependencies
carry their own attribution clauses — Apache-2.0 section 4, the BSD and MIT
notice requirements, the LGPL relinking notices — which are discharged
together in `THIRD-PARTY-NOTICES.md`.

Last run: 16 September 2026, against `6dabc5e`.

---

## 1. `LICENSE` retained — AGPL-3.0 section 4

```sh
git rev-parse HEAD:LICENSE upstream-main:LICENSE   # must match
git log --oneline --follow -- LICENSE              # must show only the import
```

Both resolve to blob `be3f7b28e564e7dd05eaf59d64adba1a4065ac0e`, and the only
commit that has ever touched the file is the initial import `d969096`. So the
licence text is byte-identical to the one received from upstream, not merely
*a* copy of the AGPL.

That distinction is the point. Section 8 terminates the rights granted under
the licence if its terms are altered, and a hand-edited copy is indistinguishable
from an intact one at a glance. Comparing blob hashes is what makes it checkable.

**Enforced:** no. Fork rule 4 in `AGENTS.md` states it; nothing fails a build.

## 2. Modification notice, with a date — section 5(a)

`NOTICE` carries "Modified by Fraser Matcham, beginning 8 September 2026", and
the same date is `MODIFICATION_DATE` in `frontend/src/app/lib/legalNotice.ts`,
rendered at `/legal`.

The date is the first commit in this repository not present upstream. Section
5(a) asks for "a relevant date", not the date of the latest change, so it does
not move as work continues.

**Enforced:** partly — item 4 below covers the rendered half.

## 3. AGPL notice — section 5(b)

The "Licence" section of `NOTICE` states the terms; `/legal` renders the same
through `LICENCE_NAME` and `LICENCE_URL`.

## 4. Appropriate Legal Notices in the UI — section 5(d)

`frontend/src/app/legal/page.tsx`, with a test at `page.test.tsx`.

Every fact on that page is imported from `legalNotice.ts` rather than written
into the markup, so the page and `NOTICE` cannot drift apart on the holder, the
year, the modification date or the upstream name. Editing the copy cannot
change what the service asserts; only editing the constants can, and those
carry a comment saying so.

## 5. Source offer matching the deployed commit — section 13

```
config ──▶ gate ──▶ mirror ──▶ build ──▶ migrate ──▶ backend ──▶ frontend
```

`.github/workflows/deploy.yml` builds the frontend with

```
NEXT_PUBLIC_SOURCE_URL=https://github.com/<mirror>/tree/<sha>
```

where `<sha>` is the exact commit being deployed — so the offer points at the
source of the version a user is actually interacting with, which is what
section 13 requires and what a link to `main` would not give.

Two things make it hold rather than merely intend to:

- `build` declares `needs: [config, gate, mirror]`, so no image is built until
  the Corresponding Source is published. A release cannot exist whose source
  offer 404s.
- The `mirror` job hard-fails when `SOURCE_MIRROR_REPOSITORY` or
  `SOURCE_MIRROR_TOKEN` is unset, rather than proceeding with an empty value.
  Without that guard the URL would build as `https://github.com//tree/<sha>`
  and ship a broken offer silently.

For builds with no mirror configured — local, e2e — `correspondingSourceUrl()`
falls back to the upstream repository. That is honest for an unmodified tree
and better than rendering a dead link.

**Manual:** that the deployed `/legal` link resolves, and that the mirror at
that commit is complete, can only be confirmed against the running service.
Do it at cutover (row 4.13).

## 6. Apache-2.0 licence copy — section 4(a)

The full licence text ships in `THIRD-PARTY-NOTICES.md` (the
`TERMS AND CONDITIONS` block), alongside the packages it covers.

## 7. Apache notices retained, changed files marked — sections 4(b), 4(c)

```sh
grep -rl "Licensed under the Apache License" backend/src frontend/src word-addin/src e2e scripts
```

Returns nothing: no first-party file carries an Apache header, so there is none
to strip and none to mark as changed. The Apache-licensed code here is all
third-party dependencies, which keep their own headers inside `node_modules`
and are attributed in `THIRD-PARTY-NOTICES.md`.

This is a consequence of fork rule 1. Juralio is the Apache-2.0 work, and the
boundary to it is HTTP only — no vendored source, so no Apache-headered files
to preserve in this tree. `npm run boundary` fails the build if that stops
being true.

## 8. Third-party attributions reproduced — Apache 4(c), BSD, MIT, LGPL

```sh
npm ci && npm ci --prefix backend && npm ci --prefix frontend && npm ci --prefix word-addin
npm run notices:check
```

**This item was failing when the checklist was first run, and the failure is
the reason the checklist exists.**

`THIRD-PARTY-NOTICES.md` was generated on 9 September. Four Dependabot
production bumps on 14 September moved the dependency trees under it — Apache-2.0
from 145 packages to 135, LGPL-3.0-or-later from 20 to 10, ISC from 51 to 52 —
and nothing regenerated it. `NOTICE` names that file as where the attributions
live, so for five days the product asserted attributions that no longer matched
what it shipped.

Fixed by regenerating, and guarded by the `notices` job in `ci.yml` so it cannot
drift unobserved again. The installs in that job are load-bearing: package names
and licence ids come from the lockfiles, but the licence *text* is read from each
installed package's own `LICENSE` file, so without `node_modules` the generator
emits a file with every text missing.

**Open:** `buffers@0.1.1` (frontend, via `exceljs → unzipper → binary`) declares
no licence at all and appears under `UNKNOWN`. A package with no grant is not
permissively licensed by default. It predates this sign-off and is listed rather
than hidden; resolving it means replacing the `exceljs` XLSX read path or
accepting it in writing.

## 9. No upstream trademarks on visible surfaces — AGPL 7(e), Apache 6

```sh
npm run trademarks
```

Passes: 5 allowlisted, no unexplained surfaces.

Neither licence grants the upstream marks, and neither requires giving them up
either — so this is an allowlist, not a ban. Three entries are *required*
attribution: `legalNotice.ts` must name Mike and Open Legal Products for
sections 5(a), 5(b) and 13, and deleting them to "finish the debranding" would
breach the licence rather than complete a rename. The two `word-addin/manifest.xml`
control ids are never rendered by Office.

**Open — 2 deferred:** `frontend/src/app/components/workflows/OpenSourceWorkflowModal.tsx`
still shows `mikeoss.com` and `Open Legal Products` ×3. This is consent text
telling a contributor where their workflow will be published, and
`MIKE_WORKFLOWS_REPOSITORY` still resolves there, so rewording it before the
catalogue is forked would make it false. Blocked on tickets 2015 and 2016 —
fix the destination, then the copy. They print as `[DEFERRED]` on every run,
which is how they stay visible instead of quietly becoming permanent.

## 10. Release ordering verified

Covered by item 5: the mirror publishes before any image is built, and the
release tag is pushed to `origin` only after the mirror push succeeds, so a
failed publish leaves no tag naming a release that never happened.

---

## What is enforced, and what is not

| # | Item | Enforced by |
| --- | --- | --- |
| 1 | `LICENSE` intact | `ci.yml` → `frontend-boundary` (`npm run licence`) |
| 2 | Modification notice and date | partly (item 4) |
| 3 | AGPL notice | partly (item 4) |
| 4 | Notices in the UI | `frontend/src/app/legal/page.test.tsx` |
| 5 | Source offer at the deployed commit | `deploy.yml` job ordering + mirror guard |
| 6 | Apache licence copy | `ci.yml` → `notices` |
| 7 | Apache headers, changed files | `ci.yml` → `boundary`, indirectly |
| 8 | Third-party attributions | `ci.yml` → `notices` |
| 9 | No upstream trademarks | `ci.yml` → `trademarks` |
| 10 | Release ordering | `deploy.yml` job graph |

Item 1 used to be the one with no gate and the worst failure mode. It has one
now: `scripts/check-licence.mjs` (`npm run licence`) fails the build if
`LICENSE` is missing, altered by so much as a character, or joined at the root
by a second file claiming different terms. `NOTICE` is not such a file —
Apache-2.0 section 4(d) requires it, and it attributes rather than licences.

One limit worth knowing. The check pins the SHA-256 of the file as it stands
here, reviewed by eye against the AGPL-3.0 text. It proves the file has not
changed since; it does not prove byte-identity with the FSF's own copy,
because the environment it was written in could not reach gnu.org. Alongside
the hash it asserts the title, the version line, section 13 and the closing
terms, so a wholesale replacement fails with something a person can act on
rather than a bare hash mismatch. If you verify the file against gnu.org
directly, record it in the script's header.

## Before signing off a release

1. Re-run items 8 and 9 — the two that can still move without anyone deciding
   they should. Item 1 now fails CI on its own, so a release that got this far
   has already passed it.
2. Confirm the two deferred trademark references are still deliberate, and
   whether 2015/2016 have unblocked them.
3. Confirm `buffers@0.1.1` is still accepted, or gone.
4. After cutover, open `/legal` on the deployed site and follow the source
   link. It should land on the mirror at the commit that is running.
