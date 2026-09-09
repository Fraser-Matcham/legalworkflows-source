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
