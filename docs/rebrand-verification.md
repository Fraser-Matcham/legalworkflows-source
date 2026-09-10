# Rebrand verification

The rebrand is enforced continuously — `npm run trademarks` fails CI on an
upstream name reaching a user-visible surface, and prints every allowlisted
reference on each run. What CI cannot do is *look* at a screen. This is the
checklist for the human half.

## The naming convention

Two forms, both deliberate:

| Form | Where it belongs |
| --- | --- |
| `legalworkflows` | The wordmark. Page titles, Open Graph metadata, the sidebar and add-in logos, the MFA issuer. |
| `LWF` | The short form in body copy, where the full wordmark would read heavily. Established in the add-in ribbon (`TaskpaneButton.Label`) in ticket 2033. |

If either form is wrong, it is wrong everywhere — grep for it rather than
fixing one screen.

## Automated verification

Last run against `main` (see the git history of this file for when):

| Check | Result |
| --- | --- |
| `npm test --prefix frontend` | 142 files, 985 tests, all passing |
| `npm run lint --prefix frontend` | 0 errors (35 pre-existing warnings) |
| `npm run build --prefix frontend` | succeeds |
| `npm run typecheck --prefix word-addin` | clean |
| `npm run build --prefix word-addin` | succeeds (needs `REACT_APP_WEB_APP_URL` and `WORD_ADDIN_PUBLIC_URL`) |
| `npm run build --prefix backend` | `tsc` clean |
| `npm test --prefix backend` | 129 files, 1493 passing, 39 skipped |
| `npm run trademarks` | 8 allowlisted, 5 deferred, no unexplained surfaces |

The ticket that commissioned this pass quoted 141 frontend test files; there
are 142 now. The figure moves, so treat it as "all of them pass", not a
target.

## How to run the pass

No deployment is needed. The local stack in
[docs/local-development.md](local-development.md) covers every screen below:
`docker compose up` serves the app at `http://localhost:3000` with Supabase,
Postgres, RustFS and Mailpit beside it, and local registration
auto-confirms, so the authenticated screens are reachable immediately. The
add-in sideloads from `https://localhost:3200` behind the trusted development
certificate, so Word renders the real ribbon, labels and icons — see
[docs/word-addin-development.md](word-addin-development.md).

Two things to know before you start.

**The link-preview unfurl is the one exception.** The Open Graph and Twitter
tags are readable from the local page source, but how a third-party client
*renders* the card is not: localhost does not unfurl in Slack, WhatsApp or
LinkedIn. Check the tags locally; check the rendered card against a deployed
URL or a tunnel, whenever one next exists.

**The add-in setup doc will show you an upstream URL.**
`docs/word-addin-development.md` sets `REACT_APP_WEB_APP_URL` to the upstream
domain in its example. Following it verbatim makes that domain appear in the
add-in, which looks like a missed rebrand and is not — it is the deferred
fallback listed under [Known exceptions](#known-exceptions). A production
build cannot reach it, because webpack throws without that variable set.

## Screens to look at

Each row is a place a person or a link preview sees the name. Grouped by what
would break them, so a single bad edit is caught by one row rather than none.

### Web app

| Surface | Where | What to confirm |
| --- | --- | --- |
| Browser tab and OG preview | `app/layout.tsx` | Title, `siteName`, OG title, Twitter title, image `alt`. Readable in local page source; the rendered unfurl needs a public URL. |
| Sidebar wordmark | `components/shared/AppSidebar.tsx` | Renders, wraps correctly at narrow widths. |
| Logo lockup | `components/site-logo.tsx` | Artwork and wordmark align; still legible in dark mode. |
| Crash page | `app/global-error.tsx` | Its `<title>` — only visible when the app has already failed, so easy to miss. |
| MFA enrolment | `settings/security/page.tsx` | The issuer name as it appears **inside the authenticator app**, not just on screen. This is the one surface that leaves the product and persists in someone else's app. |
| Appearance settings | `settings/appearance/page.tsx` | Short-form copy. |
| Personalisation | `onboarding/profile/page.tsx`, `settings/personalisation/page.tsx` | Short-form copy. |
| Support page | `app/support/page.tsx` | Short-form copy and the share-link placeholder. |
| Tabular column prompts | `tabular/AddColumnModal.tsx`, `workflows/WFEditColumnModal.tsx` | Placeholder text, which is long and easy to truncate. |
| Assistant prompts | `assistant/AskInputPopup.tsx` | Copy that is echoed back into a generated answer. |
| Sharing errors | `shared/AddUserInput.tsx` | The "does not belong to an LWF user" path — needs a real failed invite to see. |

### Word add-in

| Surface | Where | What to confirm |
| --- | --- | --- |
| Ribbon group and button | `manifest.xml` resources | Group label, button label, tooltip, as Word renders them. The control **ids** stay upstream-named on purpose — they are invisible, and fork rule 2 keeps them. |
| Task-pane title | `taskpane/index.html` | Shown in the pane chrome in some Word hosts. |
| Commands page title | `commands/commands.html` | Rarely visible; check it anyway. |
| Pane logo | `taskpane/components/shell/WordAddinLogo.tsx` | Renders at the pane's narrow width. |
| Edit and error copy | `assistant/EditCard.tsx`, `hooks/useWordAssistantChat.ts`, `hooks/useWordDoc.ts` | Short-form copy in states that need a failure to reach. |

### Known exceptions

Deliberate, and printed as `[DEFERRED]` by `npm run trademarks` on every run
so they cannot quietly become permanent:

- Signup Terms and Privacy links still point at the upstream domain.
- The add-in's `REACT_APP_WEB_APP_URL` fallback. Unreachable in a production
  build, which throws without the variable set.
- The open-source contribution modal names the upstream catalogue, because
  that is genuinely where contributed workflows are published today.

`frontend/src/app/lib/legalNotice.ts` names the upstream work on purpose:
AGPL-3.0 sections 5(a) and 5(b) require it. It is attribution, not branding.
Removing it would breach the licence — see
[AGENTS.md](../AGENTS.md) fork rule 2.
