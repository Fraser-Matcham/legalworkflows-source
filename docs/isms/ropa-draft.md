# Records of processing — draft (UK GDPR Art. 30)

Working Article 30 records for the operator of
`https://legalworkflows.co.uk`. They are **not** a certificate, **not**
product copy, and **not** legal advice.

Drafted 19 September 2026 as fold-in task **F0-4**. Region for operator-
controlled processing is **`eu-west-2`** (London). Processing roles:

| Record | GDPR role | Subject-matter |
| --- | --- | --- |
| [R1](#r1--processor--matter-and-client-files) | **Processor** (Art. 28 / Art. 30(2)) | Firm client files, matters, chats, reviews, costs, and anything derived from them |
| [R2](#r2--controller--account-records) | **Controller** (Art. 30(1)) | Account records: email, MFA, org membership, billing contact |

The firm is the controller of R1. Their SRA confidentiality duty
(Codes 6.3; Firms 2.1 and 2.5) does not move to this service.

**Decision D12:** the operator owns the DPIA and the Art. 28 terms. No
external counsel has reviewed these records.

The production ISMS scope is this origin only (architecture decision 7).
`lmm-dev` is out of production scope. Do not apply Matter Management
production Terraform — that would be a second processor and a second
record.

---

## R1 — Processor — matter and client files

### Identity of the processor

| | |
| --- | --- |
| Name | Fraser Matcham, trading as legalworkflows |
| Contact | `frasermatcham@gmail.com` (`operatorDetails.ts`) |
| Postal address | Not published (`POSTAL_ADDRESS` is empty) |
| ICO registration | Not published (`ICO_REGISTRATION_NUMBER` is empty) |
| Public origin | `https://legalworkflows.co.uk` |
| Processing region the operator controls | AWS `eu-west-2` |

Each **firm** (the customer) is the controller of the personal data in
this record. This service processes it on the firm's documented
instructions (Art. 28), once those instructions exist as signed terms.
Until Gate B there is no paying-firm controller; Gate A is operator-owned
non-client and synthetic material only (decision D1).

### Categories of processing

Hosting, retrieval, sharing inside a matter, conversion (PDF), tabular
extraction, and — when the firm uses the assistant — sending document
text and prompts to a language-model sub-processor. Later fold-in slices
add workstreams, tasks, posts, notifications, matter-scoped export, and
costs. Matter-aware AI beyond the operator is Gate C (DPIA accepted).

### Categories of data subjects (as determined by the firm)

- The firm's clients and counterparties, as they appear in uploaded
  files, chats, posts, and costs
- The firm's staff and invited collaborators who are members of a matter
- Third parties named in client documents (witnesses, experts, other
  solicitors) — the service does not collect them separately; they arrive
  inside files the firm uploads

### Categories of personal data

| Store | What it holds | Where defined |
| --- | --- | --- |
| PostgreSQL (Supabase today; operator RDS after Stage 5) | Document and version metadata, chat and message rows, tabular reviews and cells, workflows, organizations, access grants, `audit_events` | `docs/data-retention.md` |
| S3 `eu-west-2`, SSE-KMS customer key | Uploaded files, PDF renditions, generated documents, extracted text, export archives | `infra/modules/storage`, `data-retention.md` |

There is **no automatic content TTL**. Content lives until the firm (or
the user, for personal work) deletes it. Upload sessions, pre-signed
URLs, auth handoff tickets, and download tokens expire; none of those is
content.

Personal data in this record **may include** special-category data
(health, ethnicity, criminal-offence data in a litigation file) and
material covered by **legal professional privilege**. LPP is not a GDPR
category. A leak across matters, or an LLM prompt that leaves the UK/EEA
without the firm's informed choice, is a privilege and SRA problem even
when it is also a personal-data problem.

`audit_events` can carry a filename and up to 120 characters of a user's
message (`data-retention.md`). Treat audit rows as client data.

### Recipients and sub-processors

See [Sub-processors](#sub-processors). Recipients inside a firm are
whoever the firm grants access to. Email grants on matter-linked
projects will be refused (Phase 2). There is no instance UI that can
open a customer's matter.

### International transfers

Object storage, the application, and (after Stage 5) the database stay
in `eu-west-2`. **Model providers are not in the UK** unless the operator
contracts a UK/EU-only endpoint and org policy allows only that.

Default for matter-linked work (decision **D10**, enforced from Phase 1
flags / Phase 8): UK/EU residency + zero retention, where the operator
has that contract. Fallback: UK IDTA / Addendum (Art. 46). BYOK and MCP
are an unvetted transfer and default **off** on matter-linked work.

This service does not train on customer content: there is no training
pipeline in this repository (`data-retention.md`). That is not
automatically true of a user's own provider key.

### Time limits for erasure

| Store | Live copy | Backup tail |
| --- | --- | --- |
| Objects | Deleted through `storage.cleanup` (hard delete of bytes) | Live bucket keeps a noncurrent version ≤ 1 day; replica bucket **35 days** (`infra/modules/backup`). Drilled 18 September 2026 |
| Database | Account deletion and document delete as in `data-retention.md`; matter destroy is Phase 2 | **None today.** Ticket **2095**: the Supabase organisation is on the Free plan; there is no accessible daily backup and no self-managed dump. Stage 5 RDS automated backups at **35 days** (D17) is the accepted close (D5). Gate A does not open without it |
| Soft-deleted version metadata | Kept indefinitely today (filename, size, `content_sha256`) | Phase 2 destroy path is the close |

A `content_sha256` of a deleted file is a fingerprint of client content.
It cannot reconstruct the document; treat it as retained metadata.

### Technical and organisational measures (Art. 32 / Art. 30(2)(d))

Summarised; the SoA is the numbered map.

- Handler-level authorisation; `npm run tenancy`; PostgREST browser roles
  revoked (`npm run schema-privileges`)
- TLS at CloudFront/ALB; S3 SSE-KMS; Secrets Manager; ECS Exec off
- Request logs omit bodies, headers, query, IP, and email
- Object backup drilled; **database backup is a known gap (2095)**
- MFA available per user; **enforced** for matter-holding orgs in Phase 3
- Matter membership as the confidentiality boundary (Phase 2), with
  cross-matter tests

A Free-plan database with no restore is **not** an Art. 32 measure.

---

## R2 — Controller — account records

### Identity of the controller

Same operator as R1. For this record the operator **is** the controller
(Art. 13 already asserted on the Privacy Policy via `operatorDetails.ts`).

### Purposes of the processing

Create and authenticate user accounts, enforce org membership, send
transactional mail (address confirmation, password reset), operate MFA,
and keep the audit of those account events. Not marketing.

### Lawful basis (working; operator to confirm)

| Purpose | Working basis |
| --- | --- |
| Account creation, session, MFA, org membership | Contract (Art. 6(1)(b)) — providing the service the user signed up for |
| Security logs, abuse, restore | Legitimate interests (Art. 6(1)(f)) — securing the service |
| Legal obligation (ICO, AGPL source offer) | Art. 6(1)(c) where it applies |

Confirm before Gate B. This row is not a substitute for the Privacy
Policy.

### Categories of data subjects

People who register for legalworkflows: the operator, invited org
members, and (later) staff at paying firms in their **account** capacity.
A firm's *client* is not a data subject in R2 unless they also have a
login.

### Categories of personal data

Email address, authentication secrets (hashed credentials / TOTP secret
in GoTrue — not held in application tables as plaintext), org
membership and role, optional display name, billing contact when it
exists, IP-free request logs keyed by user **id**, `audit_events` for
account actions.

Not in R2: document bytes, chat contents, matter files. Those are R1.

### Recipients

| Recipient | Why |
| --- | --- |
| Supabase (GoTrue + Postgres) until Stage 5 | Identity and account rows |
| Operator RDS + in-VPC GoTrue after Stage 5 | Same, in the operator's account |
| Amazon SES | Transactional email from the service domain |
| AWS (CloudFront, ECS, CloudWatch, Secrets Manager) | Hosting and encrypted secrets |

Google is an identity provider when the user chooses Google OAuth; that
is the user's own Google account, not a document sub-processor.

### International transfers

Account data the operator controls stays in `eu-west-2` (Supabase
London today; RDS `eu-west-2` after Stage 5). SES sending is from the
region of the identity (`eu-west-2`). Google OAuth is a user-chosen
redirect to Google.

### Time limits for erasure

Until the user deletes the account (`deleteUserAccountData()`), which
removes application rows including that user's `audit_events`. Auth-user
deletion cascades `audit_events.user_id`. Org-owned content is
**detached**, not deleted, so a colleague's work does not vanish — that
content is R1, retained for the remaining controller (the firm / org).

Backup tails are the same as R1: objects 35 days; database none until
2095 closes.

### Technical and organisational measures

Same origin, same SoA. MFA is optional per user today; org-enforced MFA
is Phase 3.

---

## Sub-processors

Taken from the production footprint and from `providerForModel()` in
`backend/src/lib/llm/models.ts`, not from memory. A name listed in
`frontend/src/app/lib/operatorDetails.ts` that disagrees with this table
is **drift** — close it on the F1-4 trust centre (notably **Resend**,
which architecture decision 6 replaced with SES; the `resend` npm
package is unused).

Which model vendors actually receive content depends on which API keys
the deployment sets. A deployment that configures only a local Ollama
endpoint sends nothing to a third-party model vendor. Production keys
are operator-held in Secrets Manager; Anthropic is currently deferred
by the operator (human-tasks Task 3).

### Always in the production path (operator-controlled)

| Party | Purpose | Location / transfer | Mechanism |
| --- | --- | --- | --- |
| Amazon Web Services — CloudFront, Route 53, ACM, ALB, ECS/Fargate, ECR, VPC/NAT, S3, KMS, Secrets Manager, CloudWatch, SNS, EventBridge, SES, IAM/OIDC, Inspector (enhanced ECR scanning) | Hosting, TLS, object storage, secrets, logs, alarms, transactional email, image scanning | `eu-west-2` (ACM for CloudFront is `us-east-1` — certificate only, not client files) | In-region processing; AWS DPA / SCCs as AWS publishes them. SES never receives document content |
| Amazon S3 backup bucket (`infra/modules/backup`) | 35-day replica of document objects, write-locked | `eu-west-2` | Same account, separate key |
| Supabase | Hosted PostgreSQL, GoTrue (auth, Google OAuth, TOTP MFA), PostgREST (not reachable for data: browser roles revoked) | United Kingdom (London), until Stage 5 cutover | Supplier DPA; **retire after Stage 5** (delete the project — Gate A/B) |
| GitHub Actions (OIDC deploy) | CI and deploy. Does not receive client file bytes; images and Terraform run in AWS | United States (GitHub) | No client-content path by design; still a supplier of the pipeline |

Stage 5 adds **Amazon RDS PostgreSQL** in `eu-west-2` (encryption at
rest, automated backups **35 days** per D17) and runs GoTrue and
PostgREST as in-VPC tasks. That **removes Supabase** from this list.

### Language-model sub-processors (content leaves the origin when used)

Routed by `providerForModel()` from the model id. Each is a
sub-processor **of the firm** for R1 when a prompt or document text is
sent.

| Party | How it is selected | Location (honest default) | Transfer mechanism (working) | What is sent |
| --- | --- | --- | --- | --- |
| Anthropic | `claude*` ids; `ANTHROPIC_API_KEY` / `CLAUDE_API_KEY` | United States unless an enterprise UK/EU endpoint is contracted | Prefer UK/EU residency + zero retention (D10); else UK IDTA/Addendum | Prompts and document text for assistant / tabular / title jobs |
| Google (Gemini) | `gemini*` ids; `GEMINI_API_KEY` | United States unless a UK/EU endpoint is contracted | Same | Same |
| OpenAI | `gpt-*` ids; `OPENAI_API_KEY` | United States unless a UK/EU endpoint is contracted | Same | Same |
| OpenRouter | `openrouter/…` ids; `OPENROUTER_API_KEY` | Router in the United States; downstream model varies | Unvetted downstream unless org policy allows a named route | Same; **do not enable on matters by default** |
| Vercel AI Gateway | `vercel/…` ids; `AI_GATEWAY_API_KEY` | Depends on Vercel routing | Same as OpenRouter unless contracted otherwise | Same; default off on matters |
| OpenCode Go | `opencode-go/…` ids; `OPENCODE_API_KEY` | OpenCode's published endpoints | Record the actual endpoint before enabling on matters | Same |
| Operator-declared OpenAI-compatible (`MIKE_MODEL_CONFIG_JSON`) | Configured id | Wherever `baseUrl` points | Org policy must allow the destination; local `location` stays in-operator | Same |
| Ollama | `ollama/…` ids | Local to the deployment | No third-party transfer if the endpoint is in-VPC | Same, kept on the operator's host |
| User BYOK / MCP server | User-configured | Unknown | **Default forbidden** on matter-linked work (F1-3 / Phase 2 / 8) | Could be anything; treat as an international transfer until proven otherwise |

This service does not add a new destination silently. A new catalogue
model, MCP connector, or BYOK path needs the org policy to allow it.

### Not sub-processors of client files

| Party | Why |
| --- | --- |
| Resend | Architecture decision 6 moved auth mail to SES. Do not list Resend as current |
| Cloudflare R2 | Production object storage is S3 `eu-west-2`, not R2 |
| Open Legal Products / upstream `mike` | Source heritage (AGPL attribution), not a runtime processor of this deployment's data |
| `Fraser-Matcham/mike-workflows` | MIT catalogue fetched at deploy; not live client files |

---

## Art. 28 facts this record must still grow (Phase 1)

Engineering emits; the operator signs (D12). Missing today:

- Signed Art. 28 terms with any firm
- Published trust-centre sub-processor page (F1-4) — this file is the
  working list
- DPIA for AI-on-client-files (opened F1-O3, accepted before Gate C)
- RPO/RTO on the facts pack (objects: replica 35 days, drill passed;
  database: none until 2095)
- ICO registration number, if/when the operator is required to register
- Per-provider contract: residency, zero retention, no-training, and
  the Art. 46 mechanism actually in force

## Residuals

| Residual | Decision | Effect |
| --- | --- | --- |
| No per-person search inside a matter | D11 | Subject-access assistance is the matter-scoped export (Phase 7), not a named-person query |
| No interim database backup on Supabase Pro | D5 | Do not buy a bridge; Stage 5 RDS is the close |
| No external counsel on DPIA / Art. 28 / these records | D12 | Recorded on the SoA so it stays visible |
| SSO not a hard Gate B blocker | D6 | MFA-enforced email login is acceptable if the named firm accepts it in writing |
