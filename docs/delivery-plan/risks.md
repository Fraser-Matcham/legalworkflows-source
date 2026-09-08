# Risks and assumptions

Carried over from the delivery plan, with two rows added during the repository
review (17 and 18). See [`plan-review.md`](plan-review.md) for the reasoning
behind the additions.

## Risks

| # | Item | Impact | Likelihood | Mitigation | Owner |
| --- | --- | --- | --- | --- | --- |
| 1 | xlsx is pinned to a SheetJS CDN tarball, not a registry package | npm ci fails on any filtered network; no CI runner can build the backend | Certain | Verified in review with a 403. First ticket of Sprint 1 - replace with exceljs, already a frontend dependency. | You |
| 2 | AGPL section 13 obliges publication of Corresponding Source to network users | Your combined platform source becomes available to every customer, who may then redistribute it | Certain, absent a licence | Send the commercial licence enquiry to Open Legal Products before Sprint 1. If it lands, the Sprint 5 compliance epic disappears entirely. | You |
| 3 | Authorisation has no database backstop - RLS is deny-all with zero policies and the backend runs as service role | A route missing an access check leaks across tenants; it is a data breach, not a permission error | High | Keep stack-tests and mutation testing as required checks. Cross-tenant denial test per route in Sprint 4. Never relax the RLS posture. | Team |
| 4 | Accidental combination - an import, submodule or copied file across the service boundary | Irreversible under AGPL section 5(c); Juralio's whole tree becomes AGPL | Medium | CI check failing the build on cross-repo imports (Sprint 4). Re-declare types rather than importing them. | Team |
| 5 | Default workflow catalogue is fetched from a third-party GitHub repository | Product content controlled externally; breaks if the repo is renamed or made private | Medium | Fork and repoint MIKE_WORKFLOWS_REPOSITORY in Sprint 1. | You |
| 6 | Audit trail records no share-grant, share-revoke or authentication events | Cannot answer who could see a matter and since when - a procurement and discovery exposure | High | Close in Sprint 4, before any client data exists in any environment. | Team |
| 7 | Upstream merges conflict with debranding and local edits | Every sync costs rework; security fixes get expensive to take | Medium | User-visible strings only; additive changes in new files; keep upstream-main pristine and merge on a cadence. | Team |
| 8 | Backend coverage floor is 52 percent and the four largest files sit inside the gap | Regressions in the tabular, tool-dispatch and user surfaces ship undetected | Medium | Sprint 5 characterisation tests. Do not refactor those files before the tests land. | Team |
| 9 | Integration epic depends on Juralio's API being deployed and reachable | Sprint 4 stalls with half the sprint unstartable | Medium | Sequence after Sprint 4 of the Juralio plan, or build against a mocked seam and integrate later. | You |
| 10 | CodeQL and Dependabot behaviour differs on private repositories | Silent loss of two security gates that appear to be configured | Medium | Confirm plan entitlements in Sprint 2; if unavailable, record the gap and decide explicitly. | You |
| 17 | The fork and the private repository have different owners — user `matchamfraser` vs organisation `Fraser-Matcham` | Two permission models and two billing surfaces; the CodeQL entitlement in ticket 2022 depends on the organisation's plan, and Actions minutes for the e2e and stack-test suites bill to the organisation | Certain | Confirm both plan entitlements and the Actions minute budget before Sprint 2 ends, not during Sprint 2. | You |
| 18 | `security.yml` fails the build on any high or critical advisory, and 12 are already open on the seeded tree (2 high) | Making it a required check stops every pull request on inherited debt | High, if the check is required before the advisories are cleared | Ticket 2025 deliberately leaves it out of the required set. Clear the advisories, confirm all four `dependency-audit` jobs are green, then add the contexts. | Team |

## Assumptions

| # | Item | Impact if wrong | Mitigation | Owner |
| --- | --- | --- | --- | --- |
| 11 | One engineer pairing with Claude Code, ~41 points per 4-week sprint | All sprint boundaries shift if wrong | Re-baseline after Sprint 1 on actual throughput and reflow the Sprint column. | You |
| 12 | This plan runs sequentially with the Juralio delivery plan, not in parallel | One engineer cannot run both; together they are roughly 48 weeks | Decide the order deliberately. Juralio first is the safer sequence, because this plan's Sprint 4 needs Juralio's API live. | You |
| 13 | No commercial licence is obtained - the plan assumes AGPL compliance | If a licence lands mid-plan, roughly 19 points of Sprint 5 fall away | Ask before Sprint 1 so the answer is known early either way. | You |
| 14 | Supabase projects, S3-compatible storage and domains are available from Sprint 3 | Delays the entire infrastructure phase | Confirm before Sprint 2 ends. | You |
| 15 | The Word add-in and Mike's own frontend are not shipped to customers in these 24 weeks | Timeline extends if either becomes a deliverable | Both stay in the repository and are rebranded; deployment is a follow-on decision. | You |
| 16 | No new product features are built during these 24 weeks | Timeline extends proportionally | Agree a feature freeze, or explicitly extend the plan. | You |

