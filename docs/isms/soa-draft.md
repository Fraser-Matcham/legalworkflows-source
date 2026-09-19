# Statement of Applicability — draft

ISO/IEC 27001:2022 Annex A, for the operator of
`https://legalworkflows.co.uk`.

This is the software and operations half of an SoA. It is **not** a
certificate, **not** product copy, and **not** legal advice. A certification
body certifies an organisation's ISMS after internal audit and Stage 1/2,
not a git repository.

Drafted 19 September 2026 as fold-in task **F0-4**, from the working map in
the fold-in compliance annex and from the code and docs in this origin
(`docs/security-review.md`, `docs/data-retention.md`,
`docs/observability.md`, `docs/delivery-plan/v2/architecture.md`,
`infra/`). Every Annex A control has a row. A control that is not yet built
is **planned** (named phase / ticket), not excluded.

## Scope

| | |
| --- | --- |
| Organisation | Fraser Matcham, trading as legalworkflows (sole trader) |
| Production origin | `https://legalworkflows.co.uk` (AWS account `119462788248`, region `eu-west-2`) |
| In scope | This origin's application, identity, database, object storage, deploy pipeline, logs, and the sub-processors it actually uses |
| Out of production scope | `lmm-dev` (living specification, not a customer-facing processor); Matter Management production Terraform (must not be applied — second ISMS); local Docker Compose |
| Certification path | Cyber Essentials, then Plus, then ISO 27001 Stage 1/2 after Gates A–B, then ISO 27701 (decision **D9**) |

**ISMS production scope is this origin only** (architecture decision 7). Two
live processors would be two scopes.

## How to read a row

| Disposition | Meaning |
| --- | --- |
| **Implemented** | True of this origin today; preserve it |
| **Planned** | In scope; not built yet. The phase / task is the work, not an exclusion |
| **Operator ISMS** | People, policy, or organisational process. Belongs in the operator's ISMS, not in this repository |
| **Inherited (AWS)** | Physical / data-centre / utility control delivered by AWS as supplier under the AWS shared-responsibility model |
| **Excluded — N/A** | The product does not do that work. Reason is mandatory |

"We have not built it yet" is never Excluded.

## Processing roles (recorded here, detailed in the Art. 30 records)

| Role | What |
| --- | --- |
| **Processor** | Firm client files, matters, chats, costs, and anything derived from them |
| **Controller** | Account records: email, MFA, org membership, billing contact |

Language-model vendors and any user-configured MCP server are
**sub-processors of the firm**, reached through this service. See
[ropa-draft.md](ropa-draft.md).

## Decision D12 — no external counsel on this draft

The operator owns the DPIA and the Art. 28 terms. **No external counsel has
reviewed this SoA, the Art. 30 records, or a DPIA.** That absence is
recorded so it cannot quietly become "someone must have signed it". The
DPIA is opened in Phase 1 (F1-O3) and accepted before Gate C.

## Annex A:2022 — organisational (5.1–5.37)

| Control | Title | Disposition | One line |
| --- | --- | --- | --- |
| 5.1 | Policies for information security | Operator ISMS; processing roles recorded in this draft (Phase 0) | Operator writes the policy set; this file is the software map it will cite |
| 5.2 | Information security roles and responsibilities | Operator ISMS | Operator is the ISMS owner; there is no separate CISO function yet |
| 5.3 | Segregation of duties | Implemented (partial) / Operator ISMS | Deploy role cannot open a shell (ECS Exec off); operator still holds console access — record that as a people control |
| 5.4 | Management responsibilities | Operator ISMS | Sole-trader operator; management review is an operator programme (Gate D) |
| 5.5 | Contact with authorities | Operator ISMS | ICO, SRA (as a processor supporting firms), AWS support, NCSC CE assessor when CE is submitted |
| 5.6 | Contact with special interest groups | Operator ISMS | Not a software control |
| 5.7 | Threat intelligence | Inherited (AWS) / Implemented (partial) | ECR enhanced scanning + Inspector; `npm audit` gate; no dedicated TI feed |
| 5.8 | Information security in project management | Implemented | Fold-in rule: one PR per slice; tenancy, boundary, schema-privileges, api-contract in CI |
| 5.9 | Inventory of information and other associated assets | Implemented / Planned | One production origin; `lmm-dev` out of production scope; decommission LMM when the spec is spent |
| 5.10 | Acceptable use of information and other associated assets | Operator ISMS | Terms of Use cover users; operator AUP for staff/contractors is organisational |
| 5.11 | Return of assets | Planned (Phase 2 destroy; Phase 3 joiner-leaver) | Account deletion exists (`userDataCleanup.ts`); matter destroy and session revoke are fold-in work |
| 5.12 | Classification of information | Planned (Phase 2) | Matter default Confidential, LPP-capable; not a hidden global TTL |
| 5.13 | Labelling of information | Planned (Phase 2, Phase 5) | Classification on the matter; RAG labels are data, not decorative pills |
| 5.14 | Information transfer | Implemented (partial) / Planned | Exports and LLM prompts already leave the boundary; BYOK/MCP default off and provider residency default UK/EU are Phase 1–2 (D10); template import audited in Phase 6 |
| 5.15 | Access control | Implemented / Planned | Handler-level auth, `npm run tenancy`, deny-all browser grants; matter membership is Phase 2 |
| 5.16 | Identity management | Implemented / Planned | GoTrue + Google OAuth today; Microsoft SSO when a named firm needs it (D6); placeholder people must not authenticate (Phase 2) |
| 5.17 | Authentication information | Implemented | HttpOnly session; TOTP MFA available; secrets in Secrets Manager; MFA *enforced* for matter-holding orgs is Phase 3 |
| 5.18 | Access rights | Implemented / Planned | Project grants and org roles today; freeze / disable and session revoke on member removal are Phase 3 |
| 5.19 | Information security in supplier relationships | Implemented / Planned | Sub-processor list in [ropa-draft.md](ropa-draft.md); no second production; Stage 5 shrinks SaaS; trust-centre publication is F1-4 |
| 5.20 | Addressing information security within supplier agreements | Planned (Phase 1) / Operator ISMS | Art. 28 facts pack and provider contracts are operator-owned (D12); engineering emits the facts |
| 5.21 | Managing information security in the ICT supply chain | Implemented / Planned | Pinned lockfiles, `npm ci`, image-scan gate, catalogue pinned by SHA; org policy must not silently add MCP/BYOK destinations |
| 5.22 | Monitoring, review and change management of supplier services | Operator ISMS | Review AWS / model-provider / (until cutover) Supabase status and contract changes |
| 5.23 | Information security for use of cloud services | Implemented | AWS `eu-west-2`; SSE-KMS customer key; documented model sub-processors; Supabase remains until Stage 5 |
| 5.24 | Information security incident management planning and preparation | Planned (Phase 1) | Runbooks exist per alarm; F1-6 unifies the incident path and notify-the-firm as controller |
| 5.25 | Assessment and decision on information security events | Planned (Phase 1) | Same unified runbook; alarms already fire to subscribed SNS topics |
| 5.26 | Response to information security incidents | Planned (Phase 1) | Existing runbooks (`docs/runbooks/`); notify the firm within 72 hours is the Art. 33/28 duty to put on the facts pack |
| 5.27 | Learning from information security incidents | Operator ISMS | Post-incident review is organisational; 18 September silent-alarms incident is already recorded |
| 5.28 | Collection of evidence | Implemented / Planned | `audit_events` + CloudWatch request line (no bodies); matter-scoped history/export is Phase 7; destroy must not `DELETE FROM audit_events` |
| 5.29 | Information security during disruption | Planned (Phase 1 / Stage 5) | Object restore drilled 18 September 2026; **database restore is ticket 2095** — Gate A does not open on it |
| 5.30 | ICT readiness for business continuity | Planned (Phase 1 / Stage 5) | Stage 5 RDS automated backups, **35-day** retention (D17), matching the object replica |
| 5.31 | Legal, statutory, regulatory and contractual requirements | Implemented / Operator ISMS | UK GDPR / DPA 2018; AGPL source-offer at `/legal`; SRA duties remain the firm's; operator ICO registration is still empty in `operatorDetails.ts` |
| 5.32 | Intellectual property rights | Implemented | AGPL-3.0 `LICENSE` retained; `/legal` notices; workflow catalogue is MIT and forked |
| 5.33 | Protection of records | Implemented (partial) / Planned | Audit rows exist and currently delete with the account; Phase 2 retention category + legal hold; Phase 9 cost snapshots immutable |
| 5.34 | Privacy and protection of PII | Implemented (partial) / Planned | Log minimisation and redaction exist; DPIA opened Phase 1, accepted before Gate C; org model policy Phase 1–8 |
| 5.35 | Independent review of information security | Operator ISMS | CE Plus assessor, then ISO Stage 1/2; independent pentest as procurement evidence (neither scheme mandates one) |
| 5.36 | Compliance with policies, rules and standards for information security | Operator ISMS / Implemented | CI gates (`tenancy`, `boundary`, `schema-privileges`, `trademarks`, image scan) are the software half |
| 5.37 | Documented operating procedures | Implemented | `docs/runbooks/`, `docs/deployment.md`, `docs/release-pipeline.md`, Stage 5 cutover runbooks |

## Annex A:2022 — people (6.1–6.8)

These are **operator ISMS**, not "N/A because we skipped them". The product
does not implement HR.

| Control | Title | Disposition | One line |
| --- | --- | --- | --- |
| 6.1 | Screening | Operator ISMS | Sole trader today; screening applies when anyone else can reach production credentials |
| 6.2 | Terms and conditions of employment | Operator ISMS | |
| 6.3 | Information security awareness, education and training | Operator ISMS | CE/Plus will ask; not a product feature |
| 6.4 | Disciplinary process | Operator ISMS | |
| 6.5 | Responsibilities after termination or change of employment | Operator ISMS / Planned (Phase 3) | Product freeze and session revoke support the firm's leaver process; operator leaver process is organisational |
| 6.6 | Confidentiality or non-disclosure agreements | Operator ISMS | Firms bring their own; operator NDA with contractors is organisational |
| 6.7 | Remote working | Operator ISMS | Operator endpoints, not the product |
| 6.8 | Information security event reporting | Operator ISMS / Planned (Phase 1) | Users need a path; trust-centre contact is F1-4; 6.8 for staff is organisational |

## Annex A:2022 — physical (7.1–7.14)

Production processing runs in AWS `eu-west-2`. Physical controls for that
footprint are **inherited from AWS** as supplier. The operator's own
desk/laptop is **operator ISMS** (clear screen, endpoint, media).

| Control | Title | Disposition | One line |
| --- | --- | --- | --- |
| 7.1 | Physical security perimeters | Inherited (AWS) | AWS data centres; operator premises separately |
| 7.2 | Physical entry | Inherited (AWS) | |
| 7.3 | Securing offices, rooms and facilities | Inherited (AWS) / Operator ISMS | |
| 7.4 | Physical security monitoring | Inherited (AWS) | |
| 7.5 | Protecting against physical and environmental threats | Inherited (AWS) | |
| 7.6 | Working in secure areas | Inherited (AWS) | |
| 7.7 | Clear desk and clear screen | Operator ISMS | |
| 7.8 | Equipment siting and protection | Inherited (AWS) / Operator ISMS | Fargate tasks have no public IPs; operator laptop is organisational |
| 7.9 | Security of assets off-premises | Operator ISMS | Laptops, tokens, recovery codes |
| 7.10 | Storage media | Inherited (AWS) / Implemented | S3 SSE-KMS; no removable media in the production path |
| 7.11 | Supporting utilities | Inherited (AWS) | |
| 7.12 | Cabling security | Inherited (AWS) | |
| 7.13 | Equipment maintenance | Inherited (AWS) | |
| 7.14 | Secure disposal or re-use of equipment | Inherited (AWS) / Operator ISMS | AWS media destruction; operator devices separately |

## Annex A:2022 — technological (8.1–8.34)

| Control | Title | Disposition | One line |
| --- | --- | --- | --- |
| 8.1 | User endpoint devices | Operator ISMS | The product is a browser app; MDM of firm devices is the firm's control |
| 8.2 | Privileged access rights | Implemented | ECS Exec **disabled** in production; deploy role cannot open a shell; no customer-matter god-mode UI |
| 8.3 | Information access restriction | Implemented / Planned | `npm run tenancy`; RLS enabled with no browser policies; `anon`/`authenticated` revoked; `matterAccess` is Phase 2 |
| 8.4 | Access to source code | Implemented | Private GitHub; deploy via OIDC, no long-lived AWS keys in CI; AGPL Corresponding Source offered at `/legal` |
| 8.5 | Secure authentication | Implemented / Planned | GoTrue, Google, TOTP MFA, HttpOnly cookie; **enforced** MFA for matter-holding orgs is Phase 3 |
| 8.6 | Capacity management | Implemented (partial) | ECS CPU autoscaling to two backend tasks; CloudWatch resource alarms; load-test ticket 2098 still open |
| 8.7 | Protection against malware | Implemented (partial) / Operator ISMS | Image-scan gate and ECR enhanced scanning on the running images; operator endpoints separately |
| 8.8 | Management of technical vulnerabilities | Implemented | Image-scan gate (fix-available high/critical), `npm audit` gate, gitleaks, CodeQL, Dependabot, ECR enhanced scanning |
| 8.9 | Configuration management | Implemented / Planned | Terraform for the footprint; **backend container still runs as root** — F1-2, conversion-tested `USER`; blocks Plus if left open |
| 8.10 | Information deletion | Implemented (partial) / Planned | Document/account delete exist (`data-retention.md`); matter destroy that removes rows **and** objects, and refuses `legal_hold`, is Phase 2 |
| 8.11 | Data masking | Implemented | Request-log contract: no bodies, headers, query, IP, or email; `safeErrorForLog`; prompt leak to CloudWatch was finding 1 and is fixed |
| 8.12 | Data leakage prevention | Implemented / Planned | Same log contract; org BYOK/MCP default **off** on matter-linked work (Phase 1–2); posts not in logs (Phase 4) |
| 8.13 | Information backup | Implemented (objects) / Planned (database) | Document bucket versioned + 35-day replica, drilled 18 September 2026. **Database: no accessible backup** (ticket 2095). Stage 5 RDS 35-day automated backups (D17) is the only accepted close (D5) |
| 8.14 | Redundancy of information processing facilities | Implemented (partial) | Multi-AZ network; single-AZ NAT and (planned) single-AZ RDS until traffic justifies more; CloudFront + ECS circuit breaker |
| 8.15 | Logging | Implemented | One JSON request line (`docs/observability.md`); `audit_events` is the durable record; `matter_id` belongs in audit, not in CloudWatch |
| 8.16 | Monitoring activities | Implemented / Planned | Thirteen CloudWatch alarms, SNS subscribed 18 September 2026; authenticated live tenancy probe is F1-5 |
| 8.17 | Clock synchronisation | Inherited (AWS) | NTP via AWS; do not invent a legal-hold clock |
| 8.18 | Use of privileged utility programs | Implemented | ECS Exec off; break-glass is IAM-authenticated database access under a runbook, evidenced by CloudTrail — not a shell into a task |
| 8.19 | Installation of software on operational systems | Implemented | Immutable container images from ECR; deploy pipeline is the only install path; no package install at runtime |
| 8.20 | Networks security | Implemented | Private subnets, no public task IPs, CloudFront prefix list + `X-Origin-Verify` on the ALB |
| 8.21 | Security of network services | Implemented | TLS at CloudFront and ALB; ACM-managed certificates |
| 8.22 | Segregation of networks | Implemented | Public vs private subnets; S3 gateway endpoint; ALB not on the public internet except through CloudFront |
| 8.23 | Web filtering | Operator ISMS | Operator endpoints, not the product |
| 8.24 | Use of cryptography | Implemented / Planned | TLS in transit; S3 SSE-KMS customer key + bucket key; Secrets Manager; download tokens; tamper-evident export manifests; RDS encryption at rest at Stage 5 |
| 8.25 | Secure development life cycle | Implemented | CI tenancy, API contract, schema-drift, boundary/trademark, licence, image scan; one PR per slice |
| 8.26 | Application security requirements | Implemented / Planned | Access restriction is a merge gate; `*.crossMatter.test.ts` is Phase 2; fail-closed MFA on matter routes is Phase 3 |
| 8.27 | Secure system architecture and engineering principles | Implemented | One origin, deny-all PostgREST, service-role only from the backend, licence boundary HTTP-only (no source combination) |
| 8.28 | Secure coding | Implemented | TypeScript, reviewed PRs, tenancy checker, no raw exception messages to clients (`httpError.ts`) |
| 8.29 | Security testing in development and acceptance | Implemented / Planned | Cross-tenant denial tests; anonymous live smoke exists; **authenticated** tenancy probe is F1-5; CE Plus scan is operator |
| 8.30 | Outsourced development | Operator ISMS | Agent-assisted development is in-repo and reviewed; no third-party product development shop |
| 8.31 | Separation of development, test and production environments | Implemented / Planned | Production only today (architecture decision 3); local Compose is the test env; **staging = synthetic only** when it exists (Phase 1) |
| 8.32 | Change management | Implemented | Merge to `main` is the release; Terraform plan before apply; no schema-only PR in the fold-in; documented rollback |
| 8.33 | Test information | Implemented | `docs/safe-local-testing.md`: synthetic documents, disposable resources; no production dumps in CI |
| 8.34 | Protection of information systems during audit testing | Operator ISMS / Planned | CE Plus and pentest against production need a windowed, logged procedure so test traffic is not confused with an incident |

## Controls outside Annex A that this SoA still records

These are on the fold-in compliance annex. They are not ISO exclusions.

| Item | Disposition | One line |
| --- | --- | --- |
| UK GDPR Art. 28 contract | Planned (Phase 1) / Operator (D12) | Facts pack from the trust centre; operator signs with the firm |
| UK GDPR Art. 30 records | This draft (Phase 0) | [ropa-draft.md](ropa-draft.md) — both roles, region `eu-west-2` |
| UK GDPR Art. 32 | Implemented / Planned | See 8.24, 8.13, 8.5. A Free-plan Supabase database with no restore is **not** an Art. 32 measure (2095) |
| UK GDPR Art. 33/34 incidents | Planned (Phase 1) | Notify the firm as controller; 72 hours is the facts-pack figure |
| UK GDPR Art. 35 DPIA | Planned (Phase 1 open, Gate C accept) | Operator-owned; no external counsel (D12) |
| UK GDPR Ch. V transfers | Planned (Phase 1–8) | Prefer contracted UK/EU endpoint + zero retention (D10); UK IDTA/Addendum is the fallback; BYOK/MCP fail closed on matters |
| Art. 28(3)(e) assistance with data-subject requests | Planned (Phase 7) / residual | Matter-scoped export covers part; **per-person search inside a matter does not exist** (D11 residual) |
| SRA confidentiality (Codes 6.3) and firm systems (Firms 2.1, 2.5) | Planned (Phase 2) | Matter membership *is* the confidentiality boundary; a cross-matter read is not a UX bug |
| Legal professional privilege | Planned (Phase 2+) | Documents, posts, and assistant transcripts can be LPP; logs and sub-processors must not waive it by accident |
| Cyber Essentials / Plus | Planned (Gate B / operator) | Non-root image (F1-2) and enforced MFA (F3-1) are the software blockers for Plus |
| SRA Accounts Rules | Excluded — N/A | Product does not hold client money |
| MLR 2017 CDD | Excluded — N/A | No intake/KYC in the fold-in |
| CQS | Excluded — N/A | Not a conveyancing scheme product |
| Lexcel | Excluded as a claim / Planned as support | The product supports a Lexcel firm (audit, status, retention hooks, legal hold); it does not *be* Lexcel |
| SOC 2 Type II | Excluded for now | Same evidence pack as 27001, later, for international firms |

## Known gaps that are in scope (not exclusions)

Copied from the compliance annex so a reviewer does not have to hunt.

| Gap | Annex A / law | Close |
| --- | --- | --- |
| No accessible database backups (2095) | 8.13, 5.29, 5.30; Art. 32 | Stage 5 RDS, 35-day backups (D5, D17). Gate A blocked |
| Backend container runs as root | 8.9; Cyber Essentials | F1-2, conversion-tested |
| No Art. 28 DPA or public sub-processor list as product artefacts | 5.19; Art. 28 | F1-4 trust centre; this draft is the working list |
| No DPIA for AI-on-client-files | 5.34; Art. 35 | F1-O3 open; Gate C accept |
| Anonymous-only live smoke | 8.25, 8.16 | F1-5 |
| BYOK and MCP connectors | 5.19, 5.14, 8.12; Ch. V | Flag in F1-3, default no on matters |
| No content retention or expiry | 8.10, 5.33; Art. 5(1)(e) | Phase 2: category, legal hold, destroy. Auto-TTL can wait |
| Soft-deleted metadata kept forever | 8.10; Art. 17 | Phase 2 destroy path; backup tail stated |
| MFA optional per user | 8.5; Cyber Essentials | Stored F1-3; enforced F3-1 |
| No Microsoft / SAML SSO | 5.16 | F3-4 when a firm needs it (D6) |

## What this SoA will not claim

- That this repository, or Fraser Matcham, **is** ISO 27001 or 27701
  certified.
- That using the product makes a firm Lexcel-compliant or discharges their
  SRA duties.
- That LLM providers are in the UK, unless the operator contracts a UK/EU
  endpoint and org policy allows only that.
- That dual-running a second production (Grails or LMM `environments/prod`)
  is temporarily fine for ISO.
- That a Free-plan Supabase database with no restore is an Art. 32 measure.
