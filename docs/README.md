# Documentation

## This fork

- [Delivery plan](delivery-plan/README.md) — phases, sprints, blockers, and the
  [review](delivery-plan/plan-review.md) of the plan against this tree
- [Private repository setup](private-repo-setup.md) — remote topology, branch
  protection, required checks, and what still needs an organisation owner
- [Upstream sync](upstream-sync.md) — the routine for taking upstream fixes and
  the lockfile conflict convention

The fork rules that constrain every change here are at the top of
[AGENTS.md](../AGENTS.md).

## Run and deploy Mike

- [Local development](local-development.md) — Docker Compose, local services,
  registration, Ollama, and first-run setup
- [Manual and production deployment](deployment.md) — managed infrastructure,
  environment variables, database upgrades, and deployment safety
- [Troubleshooting](troubleshooting.md) — common local and production problems
- [Safe local testing](safe-local-testing.md) — disposable resources, synthetic
  documents, and secret handling
- [Observability](observability.md) — the per-request log line, what it
  deliberately omits, and the redaction helpers every log site uses
- [Data retention, storage and deletion](data-retention.md) — what is stored,
  where, for how long, and what deletion actually does, with its known gaps
- [Rebrand verification](rebrand-verification.md) — the naming convention, and
  the per-screen checklist for the manual pass CI cannot do

## Features and clients

- [CourtListener integration](courtlistener.md) — live US case-law tools and
  optional bulk data
- [Microsoft Word add-in](../word-addin/README.md) — concise setup and command
  reference
- [Word add-in development and deployment](word-addin-development.md) — manual
  setup, sideloading, builds, storage behavior, testing, and troubleshooting
- [Tamper-evident exports](tamper-evident-exports.md) — document hashes and
  optional signed manifests

## Frontend

- [Design system](design-system.md) — color/typography/spacing tokens, the shared
  `components/ui` primitives, and the accessibility baseline

## Testing and CI

- [End-to-end tests in CI](e2e-ci.md)
- [Backend unit-test coverage](testing-coverage.md)
- [Frontend unit-test coverage](frontend-testing.md)
- [Mutation testing and the SSE load harness](test-depth.md)

## Historical design and investigation notes

These files preserve the context of completed work. They are not current setup
or architecture guidance.

- [Legal workflows design spec](superpowers/specs/2026-06-29-legal-workflows-design.md)
- [Word add-in assistant scroll-jump report](word-addin-chat-scroll-report.md)

Contribution and disclosure policies live in [CONTRIBUTING.md](../CONTRIBUTING.md)
and [SECURITY.md](../SECURITY.md).
