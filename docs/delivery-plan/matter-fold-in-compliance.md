# Compliance requirements on the unified product

The control baseline, Statement of Applicability (SoA) mapping, and
launch checklists for the [fold-in plan](matter-fold-in.md). This is an
engineering constraint document, not a certificate and not legal advice.

It exists because a unified case-and-workflow service holds **client matter
files, privileged communications, and commercially sensitive costs** in the
same system that sends document text to language-model providers. That is a
different risk profile from "chat with a PDF". The fold-in does not start
from zero — this service already has tenancy CI, deny-all RLS, redacted
logs, SSE-KMS document storage, MFA, and an audit table — but several
controls that ISO and a firm's COLP will treat as mandatory are still
gaps, and the matter model creates new ones.

**Maximum certification compatibility** here means: design the product so
that Cyber Essentials Plus and ISO 27001 / 27701 are an evidence-collection
exercise, not a retrofit. Secure defaults, the control plane, and firm
identity land before paying firms store live files. Feature work that
cannot show a control is not "done".

Compiled 19 September 2026 (certification-first revision the same day),
against the code and docs in this repository
and against ISO/IEC 27001:2022 Annex A, UK GDPR, and the SRA Standards
and Regulations as they apply to a **processor of law-firm client data**.

---

## What this service is, legally

For a firm's **client files, matters, chats, and costs**: this service is a
**processor** (UK GDPR Art. 28). The firm is the controller. Their SRA
confidentiality duty (paragraph 6.3 of both the Code of Conduct for
Solicitors and the Code of Conduct for Firms, backed by the firm's
systems-and-controls duty in Firms 2.1 and 2.5) does not move; they need
to be able to show they chose
a processor with appropriate technical and organisational measures
(Art. 32) and a written contract (Art. 28).

For **account records** (email, MFA, org membership, billing contact): this
service is a **controller**.

Language-model vendors (Anthropic, Google, OpenAI, OpenRouter, and any
user-configured MCP server) are **sub-processors** of the firm, reached
through this service. `docs/data-retention.md` already says so. The fold-in
does not change that fact; it changes the *sensitivity* of what is sent,
because a matter-linked prompt can carry privileged work product, not only
an isolated document.

Legal professional privilege is not a GDPR category. A leak across matters,
or an LLM prompt that leaves the UK/EEA without the firm's informed choice,
is a **privilege and SRA problem** even when it is also a personal-data
problem.

---

## The standards that actually apply

A UK law firm (or an insurer completing a proposal form) will not ask for
every ISO control by number. They will ask a short list that maps onto
them. This is that list, in the order it usually appears.

| What they ask | What it really is | Why the unified product is in scope |
| --- | --- | --- |
| ISO 27001 | ISMS + Statement of Applicability against Annex A:2022 | The expected badge for a legal-tech processor. Alignment starts in Phase 0; certification is an organisational programme (scope, internal audit, Stage 1/2). |
| ISO 27701:2025 | Privacy information management system (PIMS). Standalone-certifiable since the 2025 edition; integrable with 27001 | Processor + controller roles, records of processing (Art. 30), DPIAs. Sequenced after 27001 (decision D9). |
| UK GDPR / DPA 2018 | Law, not a standard | Lawful basis, Art. 28 contract, Art. 32 security, Art. 33/34 incidents, Art. 5(1)(e) storage limitation, Art. 35 DPIA for novel AI processing of client files. |
| SRA Codes | Confidentiality (6.3 in both Codes); firm systems and controls (Firms 2.1, 2.5); information barriers where 6.5 applies | Matter membership *is* the confidentiality boundary. A cross-matter read is not a UX bug. Private workstreams are the product's information-barrier primitive. |
| Legal professional privilege | Common law | Matter documents, posts, and assistant transcripts can be LPP. Sub-processors and logs must not waive it by accident. |
| Cyber Essentials / Plus | NCSC scheme; Plus adds an assessor-run external and internal vulnerability scan and a configuration audit | Often a procurement gate. Plus is the one PI insurers recognise. Phase 1 is shaped so a Plus assessor is not the first person to find root containers and optional MFA. |
| NCSC Cloud Security Principles | 14 principles for cloud | Region, identity, audit, supply chain. eu-west-2 plus SSE-KMS already speaks to several. Stage 5 (operator-controlled RDS/GoTrue) speaks to more. |
| Law Society cloud computing practice note | How a solicitor may use cloud | Due diligence on the supplier, data location, exit, encryption, subcontractors. The trust centre is the due-diligence pack. |
| Lexcel | Law Society practice-management standard | File supervision, risk, complaints, retention of client files. The product should *support* a Lexcel firm (audit, matter status, retention hooks, legal hold), not claim to *be* Lexcel. |
| SOC 2 Type II | US-shaped cousin of 27001 | Useful later for international firms; not the first badge. Same evidence pack as 27001 with different mapping. |

Out of scope until the product does that work: SRA Accounts Rules (no client
money), MLR 2017 CDD (no intake/KYC in the fold-in), CQS (conveyancing
scheme). Do not build them as part of unification. On the SoA they are
**excluded — not applicable**, with that reason.

ISO 27001 certification of the **operator** (Fraser Matcham / the company
that runs `legalworkflows.co.uk`) is a decision for the operator. This
document says what the **software and operations** must be able to show
when that programme starts, and what a firm will already demand in a
security questionnaire before they put live matters on it.

---

## Unification helps the ISMS — if we do not dual-run

ISO 27001:2022 5.9 (inventory), 5.19–5.21 (suppliers), 8.9 (configuration)
and 5.24 (incidents) all get worse with two production stacks, two identity
providers, two audit stores, and an HTTP seam whose identity mapping was
never designed (backlog 2069).

The fold-in recommendation — **one origin, one GoTrue, one audit table, one
deploy pipeline** — is the compliance-friendly option, not only the
engineering-friendly one. Applying Matter Management production Terraform
would create a second ISMS scope for no user benefit.

That is the first control decision: **do not produce a second live
processor**. `lmm-dev` as a spec environment is acceptable and **out of
production ISMS scope**; a second customer-facing production is not.

Stage 5 (RDS + in-VPC GoTrue, then delete the Supabase project) is the
same decision applied to the remaining SaaS database: fewer suppliers,
operator-controlled backups, encryption at rest in the operator's
account. It is how the backup and supplier controls become audit-stable.

---

## What is already true in this service

Grounded in `docs/security-review.md`, `docs/data-retention.md`,
`docs/observability.md`, and the production footprint. These are credits
the fold-in must **preserve**, not re-litigate. On the SoA they are
**implemented**.

| Control theme | ISO 27001:2022 | Already in this repo |
| --- | --- | --- |
| Access restriction, need-to-know | 5.15, 8.3, 8.2 | Handler-level auth; `npm run tenancy`; RLS enabled with no browser policies; `anon`/`authenticated` revoked (`npm run schema-privileges`); cross-tenant denial tests. |
| Authentication | 5.17, 8.5 | GoTrue, Google OAuth, TOTP MFA, optional MFA-on-login; HttpOnly session. Org-enforced MFA for matter-holding orgs is Phase 3. |
| Cryptography | 8.24 | TLS at CloudFront/ALB; S3 SSE-KMS with a customer key; secrets in Secrets Manager; download tokens; tamper-evident export manifests. RDS encryption at rest is Stage 5. |
| Logging without leaking client files | 8.15, 8.11, 5.34 | One JSON request line; bodies/headers/query/IP/email excluded; `safeErrorForLog`; CloudWatch leak of prompts **fixed** (security review finding 1). |
| Vulnerability management | 8.8 | Image-scan gate, `npm audit` gate, gitleaks, ECR enhanced scanning. |
| Network | 8.20–8.22 | Private subnets, no public task IPs, CloudFront prefix list + origin-verify header. |
| Supplier / cloud | 5.19, 5.23 | AWS eu-west-2; documented sub-processors for models; no training pipeline in-repo. Supabase remains until Stage 5 cutover. |
| Secure development | 8.25–8.29, 8.32 | CI tenancy, API contract, schema-drift, boundary/trademark checks; one PR per slice. |
| Privileged operator access | 8.2, 8.15, 8.18 | ECS Exec **disabled** in production (finding 2); deploy role cannot open a shell. No customer-matter god-mode UI. |
| Backup of objects | 8.13 (partial) | Document bucket versioning + 35-day replica, drilled. **Database backups are still a gap** (ticket 2095) — Phase 1. |
| Test information | 8.33 | `docs/safe-local-testing.md`: synthetic documents, disposable resources. |
| Change / release | 8.32, 8.19 | Release pipeline, image scan, rolling deploy, documented rollback. |
| Clock | 8.17 | NTP via AWS. |

Preserve these invariants in every new matter handler: identity on every
query, revoke new tables from browser roles, redaction on every log site,
no prompt or post body on stdout.

---

## Statement of Applicability — working map

This is the software/operations half of an SoA, grouped so a certification
body can see include / exclude / inherit. People controls (6.x: screening,
awareness) and physical controls (7.x: AWS data centres) are
**organisational / inherited from AWS**; they are in the operator ISMS,
not in this repository. They are not "N/A because we skipped them".

| Annex A theme | Disposition | Where it lands |
| --- | --- | --- |
| 5.1–5.2 Policies, roles | Operator ISMS; processor vs controller recorded in Phase 0 | Phase 0 |
| 5.9 Inventory of information and assets | One production origin; `lmm-dev` out of scope; decommission LMM when the spec is spent | Phase 0; later runbook |
| 5.12–5.13 Classification and labelling | Matter default Confidential, LPP-capable | Phase 2 schema |
| 5.14 Information transfer | Exports, Excel, LLM prompts, template import; all audited; BYOK/MCP default off; provider residency default UK/EU (D10) | Phases 1, 2, 6, 8, 9 |
| 5.15–5.18 Access control, identity, rights | Matter membership; org-admin create; no email grants; MFA enforced; freeze; session revoke; Microsoft SSO | Phases 2 and 3 |
| 5.19–5.21, 5.23 Suppliers and cloud | Sub-processor list; no second production; Stage 5 shrinks SaaS | Phases 0, 1; Stage 5 |
| 5.24–5.28 Incidents | One runbook; notify the firm as controller; no ECS Exec to debug files | Phase 1 |
| 5.29–5.30 Business continuity | 2095 restore drill; Stage 5 RDS 35-day backups | Phase 1 / Stage 5 |
| 5.31 Legal, 5.32 IP | UK GDPR, SRA; AGPL source-offer already in `/legal` | Existing + Phase 0 |
| 5.33 Records | Audit append-only; cost snapshots immutable; retention category; legal hold | Phases 2, 7, 9 |
| 5.34 Privacy | DPIA; org model policy; log minimisation | Phases 1, 8 |
| 8.2, 8.18 Privileged access | ECS Exec off; no instance UI over customer matters | Existing + Phase 0 |
| 8.3, 8.5 Access restriction, secure auth | `matterAccess`; MFA; SSO | Phases 2, 3 |
| 8.8 Vulnerabilities | Scan gates, empty audit allowlist | Existing; keep |
| 8.9 Secure configuration | Non-root backend image | Phase 1 |
| 8.10 Deletion | Matter destroy removes rows and objects; refuses on legal hold | Phase 2 |
| 8.11–8.12 Masking / DLP | Request-log contract; no prompts in CloudWatch | Existing + Phase 1 tests |
| 8.13 Backup | Objects done; database is 2095 | Phase 1 |
| 8.15–8.16 Logging and monitoring | Existing JSON line + alarms; matter_id in *audit* only | Existing + Phase 2 |
| 8.20–8.22, 8.24 Network and crypto | Existing; RDS encryption at Stage 5 | Existing / Stage 5 |
| 8.25–8.29 Secure development | Existing CI; `*.crossMatter.test.ts`; authenticated live probe | Phases 1, 2 |
| 8.31 Separation of environments | Staging = synthetic only | Phase 1 |
| 8.32 Change management | One PR per slice; no schema-only PR | Fold-in rule |
| 8.33 Test information | Synthetic; no production dumps in CI | Existing |
| 6.x People | Operator ISMS (exclude from software SoA) | Operator |
| 7.x Physical | Inherited from AWS (SoA: supplier) | AWS |
| 8.23 Web filtering | Operator endpoints, not the product | Operator ISMS |
| Art. 28(3)(e) assistance with data-subject requests | Matter export covers part; per-person search inside a matter does not exist | Residual, or Phase 7 |
| Art. 30 records of processing | Both roles, drafted with the SoA | Phase 0 |
| SRA Accounts / MLR / CQS | N/A — product does not do that work | Exclude |

A control marked "Phase 1" that is still a ticket is **not implemented**
on the SoA. Do not mark it inherited or N/A.

---

## Known gaps that Phase 1 exists to close

These are already documented as design gaps. They were tolerable for a
document-AI beta. They are not tolerable for a processor of live client
matters, and they are **not** deferred to a feature phase.

| Gap | GDPR / ISO / SRA | Fold-in consequence |
| --- | --- | --- |
| **No accessible database backups** (ticket 2095) | ISO 8.13, 5.29, 5.30; Art. 32 | Phase 1.1. Stage 5 RDS is the only accepted close (decision D5: no interim bridge). No gate opens before it. |
| **Backend container runs as root** | ISO 8.9, Cyber Essentials | Phase 1.2. Conversion-tested `USER`; blocks Plus if left open. |
| **No Art. 28 DPA or public sub-processor list as product artefacts** | Art. 28, 5.19, Law Society cloud note | Phase 1.4 trust centre. Engineering emits facts; operator signs. |
| **No DPIA for AI-on-client-files** | Art. 35; ICO AI guidance | Draft in Phase 1.5; **accepted** before Gate C. |
| **Anonymous-only live smoke** | ISO 8.25, 8.16 | Phase 1.2 authenticated tenancy probe. Fold-in also cancels the Juralio-side half of 2104 by cancelling the seam. |
| **BYOK and MCP connectors** | 5.19, 5.14, 8.12; Ch. V | Flag in Phase 1.5, default **no** on matter-linked work; enforced in Phases 2 and 8. Provider default is UK/EU residency + zero retention, per org (decision D10). |
| **No content retention or expiry** (`data-retention.md`) | Art. 5(1)(e); ISO 8.10, 5.33; Lexcel | Phase 2 ships retention category, legal hold, and a destroy path. Auto-TTL can still wait; "delete" cannot be undefined. |
| **Soft-deleted metadata kept forever** | Art. 5(1)(e), 17; ISO 8.10 | Phase 2 destroy path; backup tail stated. |
| **MFA optional per user** | ISO 8.5; Cyber Essentials | Capability in Phase 1.3; **enforced** on matter-holding orgs in Phase 3. |
| **No Microsoft / SAML SSO** | ISO 5.16 | Phase 3. Not a hard Gate B blocker (decision D6): MFA-enforced email login is acceptable if the named firm accepts it in writing; SSO when a firm needs it. |

---

## New controls the matter model introduces

These do not exist in today's Legal Workflows because there is no matter.

### 1. Classification and need-to-know — ISO 5.12, 5.13, 5.15, 8.3

Treat every matter row, workstream, task, post, linked document, chat, and
cost snapshot as **Confidential, LPP-capable**. Org-public or "shared with
the whole firm" is an explicit grant, not a default.

Matter membership (`admin` / `team` / `viewer` / `costs`) is the access
control list. Private workstreams are a second, narrower list. Linked
`projects` inherit; they must not grow their own email grants to people
outside the matter (that would be an SRA confidentiality failure dressed
as a sharing feature). Only org admins create matters unless
`matter_creator` is granted.

**Engineering gate:** a test named for the rule, not for the route —
"a team member of matter A cannot read a task, post, document, chat,
tabular cell, or cost snapshot of matter B" — must fail the build. Assistant
tools use the same `matterAccess` function as HTTP. Search, export, and
audit export are in that test, not only CRUD.

### 2. Identity and joiner-mover-leaver — ISO 5.16, 5.18, 8.2

Placeholder people (pre-account assignees) are not `auth.users`. They must
not be able to authenticate. Conversion on invite-accept must be audited.
Removing a member must revoke derived project grants **and sessions** in
the same transaction, and the audit event must say who did it.

Org freeze / disable (Phase 3) is an ISO 5.18 control as much as a billing
control: a leaver or a lapsed firm must lose access.

SSO (Phase 3, Microsoft first) is how most firms will satisfy *their* 5.16.
Under decision D6 it is **not** a hard Gate B blocker: enforced MFA is.
Gate B opens on MFA-enforced email login only if the named firm accepts
that in writing; SSO is built when a firm needs it, and before costs.

No instance UI that can open a customer's matter. Break-glass is
IAM-authenticated database access under a runbook, evidenced by
CloudTrail on the credential — not a shell into a task, and not claimed
to be session-recorded (the security review rejected ECS Exec session
capture because it would record client files).

### 3. Supplier chain for models — ISO 5.19–5.21, 5.14, UK GDPR Ch. V

Today the deployment's env keys and the user's BYOK decide where a prompt
goes. A unified product needs an **organisation policy**, stored and
enforced:

- which providers are allowed for matter-linked work (default: only
  operators' contracted sub-processors)
- whether user BYOK and MCP connectors are permitted on a matter (default:
  **no** — they are an unvetted international transfer)
- a pre-send notice when a matter document will leave the environment
  ("this prompt is sent to {provider} in {region}; it is not used for
  training by this service")
- a record in `audit_events` of provider + model, not the prompt body

No-training is already true of *this* codebase. It is not automatically
true of a user's OpenRouter key. Org policy is the control; a footer is
not.

International transfers: Anthropic/OpenAI/Google are US companies, but
each now offers EU/UK data-residency or zero-retention terms on
enterprise tiers. Prefer a contracted UK/EU endpoint with no-training and
zero retention as the first mechanism; the UK IDTA / Addendum (Art. 46)
is the fallback where residency is not available. Record which applies
per provider in the sub-processor list. The product must not silently
add a new destination (MCP, BYOK, a new catalogue model) without the org
policy allowing it.

### 4. Records, retention, destruction — ISO 5.33, 8.10; Lexcel; Art. 17

Client-file retention is the firm's policy (often 6–15 years by matter
type). The product's job is to **support** it, in the Phase 2 schema, not
as a follow-up:

- a retention category on the matter (not a hidden global TTL)
- `legal_hold` that **blocks** destruction of the matter *and* deletion
  of documents, versions, and posts within it; placed or lifted by a
  matter admin or org admin, audited (decision D15)
- export of the matter file (documents + tasks + posts + audit), already
  close to tamper-evident exports
- a destruction job that removes database rows *and* storage objects *and*
  does not leave hashes/membership forever without a documented legal-hold
  exception
- backup windows stated in the Art. 28 terms (object replica 35 days;
  database once 2095 exists)

Phase 2 can ship without auto-expiry. It cannot ship without knowing what
"delete this matter" actually does. Extend `docs/data-retention.md` in the
same PR as `matters`.

### 5. Logging, evidence, supervision — ISO 8.15, 5.28; SRA supervision

`audit_events` plus matter history (Phase 7) are how a COLP shows who saw
a file. Requirements:

- membership grant/revoke, matter status change, legal-hold toggle,
  export, destruction, and "sent to model X" are in the audit table
- audit rows are append-only from the application's point of view
- the request log still must **not** grow a matter name, client name, or
  post body (minimisation). Correlation is `requestId` + `userId` +
  `matter_id` in *audit*, not in CloudWatch
- time sync is NTP via AWS; do not invent a legal-hold clock

### 6. Privacy by design on the assistant — ISO 5.34, 27701; Art. 25, 35

Phase 8 is the high-risk processing. Gates before it leaves the operator's
own org (Gate C):

- DPIA written and accepted
- matter tools fail closed (same access module)
- no tool that lists tasks across matters
- org policy from §3 enforced on matter-linked chats
- ICO-style transparency in the UI: what is sent, to whom, for what
- human authority: the assistant suggests; a fee earner accepts document
  edits (this is already the Word/document-edits model — keep it)

### 7. Incident response — ISO 5.24–5.28; GDPR Art. 33 (72 hours)

Unification must not create a second incident path. One runbook, in
Phase 1:

- detect (existing alarms + new tenancy-denial metrics)
- contain (disable org, rotate keys, revoke sessions)
- notify the **firm** (controller) in time for *them* to meet 72 hours
  where the incident is a personal-data breach
- SRA-reportable events are the firm's; the processor supplies facts
- do not enable ECS Exec to debug an incident involving client files
  unless session logging is on and scoped; the current default (off) is
  the safer 27001 position

### 8. Secure development of the new surface — ISO 8.25–8.32

New routes inherit the existing gates (tenancy, schema-privileges,
boundary, trademarks, audit, image scan). Additions:

- every new table revoked from `anon`/`authenticated` in the same
  migration
- authenticated smoke against a matter tenancy case on the live system
  (the current smoke test cannot see this)
- change management stays "one PR per slice"; a schema-only PR that
  nothing reads is also an 8.32 smell (already forbidden in the fold-in
  plan)

### 9. Cryptography and location — ISO 8.24, 5.31; NCSC location principle

Keep processing and stores in **eu-west-2** for the unified product. Do
not put matter rows in a second region "for the Grails app". Object
encryption stays SSE-KMS. Stage 5 RDS encryption at rest is the
certification-aligned answer for Postgres (Supabase today). Decide
explicitly whether backups of RDS use the same customer-managed key.

### 10. Cyber Essentials Plus — practical gate for PI insurance

Plus cares about: patching, boundary firewalls, access control, secure
configuration, malware. Most of the AWS footprint already looks like a
pass if:

- the backend container is not root (Phase 1)
- patch/scan gates stay on
- MFA is **enforced** for matter-holding orgs (Phase 3), not merely
  available, and does not fail open on matter-linked routes
- admin interfaces are not on the public internet without MFA
- there is no instance god-mode

Schedule a Plus assessment against the unified production, not against
`lmm-dev`. Do not schedule it before 1.2 and I.

---

## Launch checklists

A phase can be merged without opening a gate. A gate cannot open with a
checklist item still a ticket.

### Gate A — Operator-only

<a id="gate-a"></a>

The operator may store its own **non-client** material and synthetic
matters (decision D1: the operator is not an SRA-regulated practice, so
no live client files at this gate).

- [ ] Phase 0 accepted: one product, no LMM production, processing roles
      recorded, SoA and Art. 30 records drafted, `lmm-dev` out of
      production scope, `AGENTS.md` rule 1 reworded
- [ ] Gate A content limited to operator-owned non-client material and
      synthetic matters (decision D1: the operator is not an
      SRA-regulated practice)
- [ ] 2095 closed: application runs against data restored from Stage 5
      RDS automated backups (decision D5: no bridge)
- [ ] Backend image non-root; DOCX conversion still works
- [ ] Authenticated live smoke including a tenancy denial
- [ ] Trust centre published (location, sub-processors, export, delete,
      backup tail, incident notify-the-firm)
- [ ] DPIA opened (need not be accepted yet)
- [ ] Phase 2 merged: `matterAccess(userId, matterId, currentOrgId)`
      from the org URL, `checkProjectAccess` **and**
      `project_access_role` / `get_projects_overview` /
      `get_project_summaries` / `get_chats_overview` /
      `listAccessibleProjectIds` / `listOrgResources`
      delegate when `matter_id` is set (tests before UI), cross-matter
      tests including org-inheritance denial **in lists as well as
      URLs**, `audit_events.matter_id`, classification, retention
      category, legal hold, destroy path that does not delete audit
      rows, BYOK/MCP default off, org-admin-only create, no email
      grants, `data-retention.md` updated, `ORG_CONTENT_TABLES`
      includes `matters`
- [ ] Every new RLS table has `service_role_all` (RDS has no
      `BYPASSRLS`)
- [ ] `matters_enabled` was **false** on production until this gate;
      enabling it is a recorded change after 2095 is closed
- [ ] Stage 5 operator Tasks 1–2 closed (RDS cost/AZ/backup window
      per D17 (a) 35 days, dump credentials); PostgREST schema cache
      reload is in the migrate path
- [ ] Log-redaction tests cover matter fields

### Gate B — Paying firm

<a id="gate-b--paying-firm"></a>

A customer may store live matter files.

- [ ] Gate A green
- [ ] Phase 3: MFA **enforced** for that org; session revoke on member
      removal; freeze/read-only works
- [ ] Microsoft SSO available, or the named firm has accepted GoTrue
      email+MFA in writing
- [ ] Art. 28 terms signed (operator + firm); facts match the trust
      centre
- [ ] Cyber Essentials submitted, or Plus scheduled, against this
      production (decision D9: CE → Plus → 27001 → 27701)
- [ ] Stage 5 live and the Supabase project deleted (already required
      by Gate A under D5)
- [ ] Org model-provider policy set for the firm; default is UK/EU
      residency + zero retention (decision D10)
- [ ] Subject-access assistance documented as matter-scoped export;
      per-person search recorded as a residual (decision D11)
- [ ] DPIA and Art. 28 terms owned by the operator (decision D12);
      the SoA records that no external counsel reviewed them
- [ ] No second production; no Grails sidecar
- [ ] Staging still synthetic-only

### Gate C — Matter-aware AI beyond the operator

<a id="gate-c"></a>

- [ ] Gate B green (or Gate A if the only user is the operator)
- [ ] DPIA accepted
- [ ] Org provider policy enforced on matter-linked chats
- [ ] Pre-send notice in the UI
- [ ] Audit records provider + model, never the prompt
- [ ] No cross-matter tool; same `matterAccess` as HTTP
- [ ] Human accept/reject on document edits retained

### Gate D — ISO 27001 certification audit

Operator programme. The product is ready when Gates A–B have been in
production on the operator's data, the SoA matches reality, CE Plus has
been assessed, an independent pentest of the unified origin exists, and
internal audit / management review have run. Software cannot tick this
gate by merging a PR.

---

## How this factors into each fold-in phase

These are **gates on the phase**, not a parallel workstream. A phase is
not done if its controls are missing.

### Phase 0 — ISMS scope

- Record the processing roles (processor of matter data; controller of
  accounts) and the region (`eu-west-2`).
- Draft the sub-processor list from `providerForModel()` and the AWS
  services actually used, with the residency/transfer mechanism per
  provider.
- Draft the SoA from the working map above, and the Art. 30 records.
- Reword `AGENTS.md` fork rule 1 and the delivery-plan README so they no
  longer describe an HTTP seam that this plan cancels; mark 2066–2069
  superseded in `v2/status.csv`. Epic 2065 remains the licence-boundary
  record; 2070 stays Done.
- Do not apply LMM production (second processor = second scope).
- DPIA and Art. 28 owner is the operator alone (decision D12); record
  the absence of external review on the SoA.
- Certification path: CE then Plus; ISO 27001 Stage 1/2 after Gates
  A–B; ISO 27701 after that (decision D9).

### Phase 1 — Control plane

Must exist before Gate A: 2095, non-root image, trust centre, org-policy
flags, authenticated probe, log-redaction tests, incident runbook, DPIA
opened, SoA draft.

### Phase 2 — Matters as a container

Must ship with the Phase 2 slice, not "later":

- `matterAccess(userId, matterId, currentOrgId)` on every new handler
  (`currentOrgId` from `/organizations/[orgId]/matters`, not a cookie);
  `checkProjectAccess` **and** `project_access_role` / overview RPCs /
  `listAccessibleProjectIds` / `listOrgResources` delegate when
  `matter_id` is set; no grant-table cache unless measured; email
  grants on matter-linked projects 403
- `ORG_CONTENT_TABLES` and account-deletion probes include `matters`
- new tables revoked from browser roles **and** given `service_role_all`;
  tenancy CI and a `*.crossMatter.test.ts` suite that includes the
  linked-project inheritance case
- audit events for create / member grant / member revoke / status
  change / legal hold / destroy; `matter_id` column; destroy does not
  delete prior rows
- `matters_enabled` default false; sidebar and create-matter refused
  until Gate A
- classification, retention category, legal hold, destroy path in the
  **same** migration as `matters`
- `docs/data-retention.md` updated
- org setting: "allow BYOK/MCP on matter-linked chats" = false
- UI: do not put client name or matter description in the document title
  sent to a model without the existing redaction path

May wait: inbox, DPIA *acceptance*, retention *auto*-expiry, SSO.

### Phase 3 — Firm identity

- Microsoft SSO against GoTrue; SAML only if a named firm needs it
- org-level MFA enforcement for matter-holding orgs
- disable/freeze is joiner-leaver (5.18)
- still no Grails IdP, still no instance god-mode

### Phase 4 — Workstreams, tasks, posts

- Confidentiality tests include copy/move (must refuse other matters)
  and a CHECK/trigger that a task's workstream belongs to the same
  `matter_id`
- stale writes (`lock_version` mismatch) return 409
- list/tree APIs paged (CloudFront origin timeout is 60s); export /
  destroy / notify on `db_jobs`
- posts treated as LPP-capable content: not in logs, not in LLM tools
  until Phase 8's policy allows
- private workstream members enforced on every read, including search
- sanitised rich text (XSS is an access-control bypass)
- task dates are calendar days in the matter timezone (D16), not instants

### Phase 5 — Taskmap, roadmap, labels

- labels must not leak via URLs or client-side caches across matters
- no decorative status that is the only indicator of risk — accessibility
  and classification labelling are different jobs; RAG risk labels are
  *data*, still need-to-know
- a workstream cannot be map-only; Phase 4's list remains the a11y
  surface; the map is enhancement

### Phase 6 — Templates

- system templates contain no live client data (asset classification:
  internal)
- org templates stay in-org; export/import is an information-transfer
  control (5.14) — require org-admin, audit it

### Phase 7 — Notifications and history

- notifications must not put privileged post bodies in email (SES is a
  sub-processor). Mail: "you have a notification", not the text
- history/export is evidence (5.28) and the Law Society exit artefact;
  same access as the matter. Export is a `db_jobs` kind (CloudFront 60s),
  tamper-evident if existing manifest helpers fit
- subject-access assistance is the matter-scoped export (D11);
  per-person search is a recorded residual

### Phase 8 — Matter-aware AI

Blocked on Gate C. This is the control that makes the union *licensable*
to a COLP rather than merely useful.

- tools in a new module, called once from `toolDispatcher.ts`; same
  `matterAccess` as HTTP; another matter's id is 404
- task posts are untrusted input to the model (prompt injection is an
  LPP issue), same class as document text
- audit records provider + model, never the prompt

### Phase 9 — Costs

- `costs` role is need-to-know: team members without it must 403
- client vs advisor views are two audiences; the wrong view is a
  confidentiality incident, not a display bug
- Excel exports are information transfer: audit, and do not put them on
  a log line
- snapshots are records (5.33): immutable once frozen, destruction only
  via the matter destruction path, blocked by legal hold

---

## Questionnaire facts the product should be able to answer

A firm's IT questionnaire (and an ISO Stage 1) will ask these. After
Gate A they should be answerable from this repo's docs without invention.

| Question | Answer today | After Gate A / B |
| --- | --- | --- |
| Where is data stored? | AWS `eu-west-2`; Postgres via Supabase; objects S3 SSE-KMS | Same region; Stage 5 moves Postgres to operator RDS |
| Who can see a client file? | Project grants + org roles | Matter membership; projects inherit; email grants forbidden; tested |
| Do you train models on our data? | No path in this repo | Unchanged; org policy forbids unvetted BYOK on matters |
| Retention? | Until delete; no TTL | Until delete, with retention category, legal hold, and a defined destroy path |
| Backups? | Objects yes; **database no** (2095) | 2095 closed before Gate A; RDS retention is **D17 (a): 35 days**, matching the object replica |
| Encryption at rest / in transit? | Objects / TLS yes; DB depends on Supabase | RDS encryption at rest at Stage 5 |
| MFA? | Available, optional per user | Enforced for matter-holding orgs at Gate B |
| SSO? | Google only | Microsoft built in Phase 3 for the first firm that needs it; not a Gate B blocker if the firm accepts MFA-enforced email login in writing (decision D6) |
| Sub-processors? | AWS, Supabase, SES, chosen LLM | Published in the trust centre; MCP/BYOK off for matters by default; Supabase removed after Stage 5 |
| How do we get our data out? | Account export, tamper-evident manifests | Plus matter-scoped export |
| How do we delete it? | Account deletion; document delete | Plus matter destruction path with known backup tail; legal hold blocks it |
| Penetration test? | Static review + anonymous smoke | Authenticated tenancy probe on live (Gate A); CE Plus scan; an independent pentest as procurement evidence (neither scheme mandates one) |
| MFA enforced? | No (per-user opt-in) | Flag stored at Phase 2, **enforced** at Phase 3; matter-linked routes fail closed on the MFA schema fault |
| Incident SLA? | Runbooks exist | One path; notify the firm as controller |

---

## What we will not claim

- That this repository **is** ISO 27001 certified. Certification is of an
  organisation's ISMS, with a scope, Statement of Applicability, internal
  audit, and an accredited certification body.
- That using the product makes a firm Lexcel-compliant or discharges their
  SRA duties. It can support those duties.
- That LLM providers are in the UK. They are not, unless the operator
  contracts a UK/EU-only endpoint and the org policy allows only that.
- That dual-running Grails and this service is "temporarily fine" for
  ISO. Two productions are two scopes.
- That a Free-plan Supabase database with no restore is an Art. 32
  measure. It is not, and Gate A will not open on it.

---

## Immediate work this implies

If the fold-in is accepted, these land in **Phase 0 / Phase 1 PRs**, not
in a later "compliance epic" and not after the first matter table:

1. SoA draft from the working map, processing roles, sub-processor list.
2. Ticket 2095 closed on Stage 5 RDS before any matter data other than
   synthetic (decision D5).
3. Non-root backend image, conversion-tested.
4. Trust centre next to `/legal`.
5. Authenticated live tenancy probe.
6. `orgPolicy` flags (MFA, BYOK/MCP) with secure defaults.
7. DPIA opened; Art. 28 facts pack complete enough to sign.
8. Then Phase 2: cross-matter suite, membership audit, retention/legal
   hold/destroy in the same PR as the tables.
9. Then Phase 3 before the first paying firm.

SSO, Plus assessment, and ISO Stage 1 remain operator programmes. The
difference from the previous draft is that the **software is not allowed
to get ahead of them**: paying-firm launch waits for identity and the
contract; AI-to-customers waits for the DPIA; the audit waits for the
ISMS.
