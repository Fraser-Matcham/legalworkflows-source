# Stage 1 — your tasks (frontend)

Five tasks. Do them in any order; none depends on another. Task 1 has a
waiting period, so start it first even though the others are quicker.

Each task is self-contained. Where a task ends with **"Tell me"**, that is
information I need before I can finish the matching engineering work — send it
back in the chat.

Nothing here requires any software to be installed.

---

## Task 1 — Register the domain name — ✅ DONE

> **Registered 12 September 2026: `legalworkflows.co.uk`.** Recorded as
> decision 5 in `../architecture.md` and wired into
> `frontend/.env.example` and the Word add-in's fallback URL.
>
> Taken as the **bare domain** (`legalworkflows.co.uk`, not
> `app.legalworkflows.co.uk`) — the default offered below, since no preference
> was stated. Say so if you would rather have the subdomain: it is cheap to
> change now and expensive once Stage 3 issues the certificate against it.
>
> Two things still outstanding from this task, neither blocking: **which
> registrar** you used (needed for the DNS steps in Stage 2 Task 5 and Stage 3
> Task 7 — the instructions currently assume Cloudflare), and the
> **nameservers** from step 5, which Stage 3 Task 7 needs.

**Why:** every later stage points at a domain. The TLS certificate, the
sign-in redirect, the CDN and the Word add-in manifest all need it. Registering
it now means the DNS propagation delay is not on the critical path in Stage 3.

**Time:** 20 minutes, then up to 24 hours of waiting.

**Cost:** roughly £10–15 per year for a `.com`, £8–12 for a `.co.uk`.

### Steps

1. Open a browser and go to **https://www.cloudflare.com/products/registrar/**
   and sign in, or create a free Cloudflare account if you do not have one.
   *Cloudflare is suggested because it sells domains at cost with no markup on
   renewal, and includes free DNS. Any registrar works — if you already use
   one, use that instead and skip to step 5.*
2. In the Cloudflare dashboard, click **Domain Registration** in the left
   sidebar, then **Register Domain**.
3. Type the domain you want and press Enter. You are looking for something
   short that matches the brand — for example `legalworkflows.co.uk` or
   `legalworkflows.app`. Avoid hyphens and numbers.
4. When one shows as available, click **Purchase**, complete the checkout, and
   make sure **Auto-renew** is left switched **on**. Losing the domain
   accidentally would take the whole service offline.
5. Find the **nameservers** for your domain. In Cloudflare this is under
   **Websites → your domain → DNS → Records**, and the nameservers are shown
   near the top of the **Overview** page. They look like
   `ana.ns.cloudflare.com`. Write them down.

### Tell me

- The exact domain you registered, including the ending — for example
  `legalworkflows.co.uk`.
- Which registrar you used.
- Whether you want the application at the bare domain (`legalworkflows.co.uk`)
  or on a subdomain (`app.legalworkflows.co.uk`). *If you have no strong view,
  say so and I will use the bare domain, which is simpler.*

---

## Task 2 — Approve the new brand mark — ✅ DONE

> **Approved.** The mark shown in chat was approved and is now applied
> everywhere it needs to be: `frontend/src/shared/ui/BrandMarkUI.tsx` is the
> mark itself, and the favicon, Open Graph link-preview image and Word add-in
> ribbon icons are generated from it by `npm run brand-assets` and
> drift-checked in CI (`npm run brand-assets:check`). Nothing left to do here.

**Why:** the mark replaces the inherited one. It appears in the sidebar, the
sign-in page, the browser tab, link previews and the Word ribbon, so it is
worth a deliberate look before it is applied everywhere.

**Why:** the mark replaces the inherited one. It appears in the sidebar, the
sign-in page, the browser tab, link previews and the Word ribbon, so it is
worth a deliberate look before it is applied everywhere.

**Time:** 5 minutes.

### Steps

1. Look at the image I sent in the chat, captioned *"New brand mark: four
   graduated segments…"*. It shows the mark at the real sizes it will be used
   at, on both light and dark backgrounds, in its normal, success and error
   states, and beside the wordmark.
2. Check the smallest size (20px, far left). That is how it appears in the
   sidebar and is the size that matters most — if it is unclear there, it is
   the wrong mark.
3. Look at the bottom row, where the mark sits next to the word
   *legalworkflows*. Decide whether the pairing looks right to you.

### Tell me

One of:

- **"Approved"** — and I apply it everywhere, including generating the
  favicon, the link-preview image and the Word ribbon icons from it.
- **"Change it"** — and say what you want different. Useful things to say:
  *heavier*, *lighter*, *more/fewer segments*, *a different shape entirely*,
  or *try it in a colour rather than black*. You do not need design vocabulary;
  plain description is enough.

---

## Task 3 — Obtain your Terms of Use — ✅ DONE, by a different route

> **Drafted, not obtained.** Rather than a template service or a solicitor,
> you asked me to write standard UK terms directly from the codebase's own
> behaviour, and I did: `frontend/src/app/terms/page.tsx`, served at
> `/terms`, with the sign-up links pointing at it. It covers everything step 2
> below lists — who provides the service, that AI output is not legal advice
> and must be checked, limitation of liability, and how to terminate an
> account — plus specifics a generic template would not know: the £100
> liability floor, that the service is "not a system of record and is not a
> backup", and the AGPL licence notices.
>
> **This is a drafting baseline, not legal advice.** I said so when I wrote
> it and I am saying it again here: for software holding privileged client
> material, it is worth a solicitor's review before real clients sign up.
> Nothing below is wrong to still do — a solicitor's pass over the existing
> draft is cheaper than commissioning one from nothing.

**Why:** the sign-up page has a line reading *"By signing up, you agree to our
Terms of Use and Privacy Policy."* Those two links currently point at the
domain of the project this was forked from. They must point at your own terms
before anyone signs up. This is the deferred item you chose to leave earlier —
it now has to be resolved to launch.

**Time:** 1–2 hours if you write it from a template; longer if you use a
solicitor.

### Steps

1. Decide how you want to obtain the terms. Three realistic routes:
   - **A template service.** Search for "SaaS terms of use template UK".
     Services such as Rocket Lawyer or Genie AI produce a usable document for
     roughly £20–100.
   - **A solicitor.** Appropriate if clients will be law firms, who may review
     your terms before signing up. Budget £500–1,500.
   - **Write it yourself from a template.** Free, and legitimate for a first
     launch, but read it properly rather than pasting it.
2. Whichever route you choose, the document must cover at least: who provides
   the service (you, Fraser Matcham, trading as legalworkflows), what the
   service does, acceptable use, that AI output is not legal advice and must be
   checked by a qualified person, limitation of liability, and how to
   terminate an account.
3. The AI disclaimer matters more than usual here. The product summarises and
   drafts legal documents. Your terms should say plainly that output is
   assistive, is not legal advice, and that the user remains responsible for
   checking it.
4. Save the finished document. You need it as a web page, so keep it as text
   you can paste — not only as a PDF.

### Tell me

- The full text of the terms, pasted into the chat, **or** a URL if you have
  published them somewhere already.
- I will then build them into the application at `/terms` and point the sign-up
  link at it.

---

## Task 4 — Obtain your Privacy Policy — ✅ DONE, by the same route as Task 3

> **Drafted from `docs/data-retention.md`, not obtained.** Same route as
> Task 3: `frontend/src/app/privacy/page.tsx`, served at `/privacy`. It states
> the facts step 2 below lists precisely because it was written from that
> document rather than a template — including the two disclosures a generic
> policy would get wrong for this specific service: that nothing you upload
> expires automatically, and that an unnamed chat's audit record carries the
> first 120 characters of your message plus filenames. The same "drafting
> baseline, not legal advice" caveat from Task 3 applies here too.
>
> **Still open from this task:** whether you have registered with the ICO —
> see Task 5, which carries the same open question.

**Why:** the same sign-up line links to a privacy policy. Beyond the link, UK
GDPR requires one, because the service stores personal data — names, email
addresses, and the contents of documents that clients upload.

**Time:** 1–2 hours.

### Steps

1. Obtain the document by the same route you chose for Task 3.
2. It must reflect what the software actually does. I have already documented
   that precisely, so use it rather than guessing — open
   `docs/data-retention.md` in the repository, or ask me and I will paste the
   relevant parts into the chat. The facts your policy needs are:
   - **What is stored:** uploaded documents and every version of them, their
     extracted text, chat messages, tabular review data, account details, and
     an audit trail.
   - **Where:** a Supabase database and an Amazon S3 bucket, both in the UK or
     EU region.
   - **How long:** until deleted. There is currently no automatic expiry — say
     so, rather than inventing a retention period the software does not
     enforce.
   - **Who else sees it:** whichever AI provider is configured — Anthropic,
     OpenAI or Google — receives document text and prompts in order to answer.
     They are your sub-processors and should be named.
   - **What deletion does:** deleting a document removes the file and its
     text; deleting an account removes essentially everything. Deleted file
     *metadata* — filename, size, page count — is retained.
3. Include your contact address for data-protection queries. A business email
   is sufficient for a sole trader.
4. Consider whether you need to register with the **Information
   Commissioner's Office**. Most UK organisations processing personal data
   electronically must, and it costs £52 a year. Check at
   **https://ico.org.uk/for-organisations/data-protection-fee/**.

### Tell me

- The full text of the privacy policy, pasted into the chat, **or** a URL.
- Whether you have registered with the ICO, so I know whether to include a
  registration number in the policy page.

---

## Task 5 — Confirm the operator identity shown in legal notices — defaulted, not confirmed

> **This one is genuinely still open**, not done — everything below still
> applies. `frontend/src/app/lib/operatorDetails.ts` currently holds
> reasonable defaults rather than your confirmation: `OPERATOR_NAME` is
> "Fraser Matcham" and `TRADING_NAME` is "legalworkflows" (both already used
> by `legalNotice.ts`), and the contact addresses are
> `support@legalworkflows.co.uk` / `privacy@legalworkflows.co.uk`, derived
> from the domain rather than stated by you. `ICO_REGISTRATION_NUMBER` and
> `POSTAL_ADDRESS` are left **empty on purpose** — the Terms and Privacy
> Policy pages render nothing where they are unset rather than showing a
> placeholder, which is lawful (UK GDPR Article 13 needs only a name and a
> means of contact) but a law firm's due-diligence questionnaire will still
> ask for both.

**Why:** the `/legal` page already names you as the copyright holder and
states when modification began. Before launch, that page should also carry the
trading details a visitor would expect. I need you to confirm them rather than
infer them.

**Time:** 5 minutes.

### Steps

1. Decide the exact trading name you want shown. At present the notices say
   **Fraser Matcham** as the copyright holder and **legalworkflows** as the
   product. Confirm both, or give me the wording you prefer.
2. Decide the contact email address to publish for legal and support enquiries.
   A role address such as `support@legalworkflows.co.uk` is better than a
   personal one,
   and you can create it once the domain from Task 1 exists.
3. If you have registered a business address you are willing to publish, note
   it. A sole trader is not obliged to publish a home address; a
   correspondence address or "available on request" is acceptable.

### Tell me

- The copyright holder name, exactly as it should appear.
- The contact email address for legal and support.
- The business address to publish, or **"none"**.

---

## When all five are done

Four of the five are done. Only **Task 5** is genuinely still open — send me
the operator name, contact email, ICO registration number (or confirmation
you have not registered) and postal address (or "none"), and I will update
`operatorDetails.ts` and the two policy pages to match. Everything else
Stage 1's engineering could do without your answers is already built: the
mark is applied everywhere, the favicon and link-preview image are generated,
and the `/terms` and `/privacy` pages exist with the sign-up links pointed at
them.

Stage 2's runbook is already open — see `stage-2-backend.md` — which is where
the Supabase project and the AI provider keys are set up. You do not need to
finish Task 5 before starting it; the two are independent.
