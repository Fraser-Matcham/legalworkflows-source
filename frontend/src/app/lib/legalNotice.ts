/**
 * Single source of truth for the licence notices this service is obliged to
 * display, so the UI at /legal and the NOTICE file at the repository root
 * cannot drift apart on the facts that matter.
 *
 * These are compliance values, not copy. Changing the holder, the year or the
 * modification date changes what the service asserts under sections 5(a), 5(b)
 * and 5(d) of the GNU Affero General Public License — check with whoever owns
 * the licence position before editing them.
 */

/** Copyright holder for the modifications. The operator is a sole trader. */
export const COPYRIGHT_HOLDER = "Fraser Matcham";

/** Year the modified work was first published under this holder. */
export const COPYRIGHT_YEAR = "2026";

/**
 * The "relevant date" section 5(a) asks for: when modification began. Taken
 * from the first commit in this repository that is not present upstream.
 */
export const MODIFICATION_DATE = "8 September 2026";

export const UPSTREAM_NAME = "Mike";
export const UPSTREAM_ORG = "Open Legal Products";
export const UPSTREAM_URL = "https://github.com/open-legal-products/mike";

export const LICENCE_NAME = "GNU Affero General Public License v3.0";
export const LICENCE_URL = "https://www.gnu.org/licenses/agpl-3.0.html";

/**
 * Where the Corresponding Source of the running version can be obtained —
 * the "prominent offer" AGPL-3.0 section 13 requires of a service used over
 * a network.
 *
 * The release pipeline (`.github/workflows/deploy.yml`) builds the frontend
 * with `NEXT_PUBLIC_SOURCE_URL` set to the public mirror at exactly the
 * commit being deployed, so the link is version-accurate (ticket 2076). A
 * build made without it — local, e2e — falls back to the upstream
 * repository, which satisfies the letter for an unmodified tree and is the
 * honest thing to show rather than a broken link.
 *
 * Takes the value as an argument rather than reading `process.env` itself:
 * Next inlines `NEXT_PUBLIC_*` only on the literal expression
 * `process.env.NEXT_PUBLIC_SOURCE_URL`, so the caller must write that out.
 */
export function correspondingSourceUrl(configured: string | undefined): string {
    const value = configured?.trim();
    return value ? value : UPSTREAM_URL;
}
