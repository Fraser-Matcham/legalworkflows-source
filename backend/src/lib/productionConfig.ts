/**
 * The production origin checks `validateRuntimeConfiguration` does not make.
 *
 * That inherited function (lib/runtimeConfig.ts) already covers most of this
 * ground in production: `FRONTEND_URL` and `API_PUBLIC_URL` are required and
 * must be HTTPS, and `WORD_ADDIN_URL` must be HTTPS if set. None of that is
 * repeated here — a second copy of a check is a second thing to keep in step,
 * and it would report the same fault twice.
 *
 * Two things it does not check, both of which reach the CORS allowlist:
 *
 * 1. **`ALLOWED_ORIGINS` is not validated at all.** Its entries are split on
 *    commas and pushed straight into `configuredAllowedOrigins`. Measured:
 *    with `ALLOWED_ORIGINS=http://evil.example.com`, a production deployment
 *    that otherwise passes every existing check trusts that plain-HTTP origin
 *    for credentialed cross-origin requests.
 *
 * 2. **Loopback is not rejected.** `requireHttps` is satisfied by
 *    `https://localhost:3000`, so a copy-pasted development origin survives
 *    into production and trusts a page served from the caller's own machine.
 *
 * Both are quiet failures. Nothing in the server's own logs shows either one;
 * the symptom is in somebody else's browser, or in nobody's until it is used.
 * That is what earns a boot check rather than a note in a runbook.
 *
 * `lib/origins.ts` and `lib/runtimeConfig.ts` are both inherited and still move
 * upstream, so this sits beside them rather than inside them (fork rule 3).
 *
 * Copyright 2026 Fraser Matcham. Licensed under the GNU Affero General Public
 * License v3.0.
 */

export type ConfigIssue = {
    name: string;
    /** What is wrong, in terms of the value supplied. */
    problem: string;
    /** What to do about it. */
    hint: string;
};

/** Hosts that must never appear in a production allowlist. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

function parseOrigin(raw: string): URL | null {
    try {
        return new URL(raw);
    } catch {
        return null;
    }
}

/**
 * Rejects an origin that would widen the allowlist.
 *
 * `checkHttps` is false for variables `validateRuntimeConfiguration` already
 * puts through `requireHttps`: this reports only the loopback case for those,
 * so a single fault is not reported twice by two different checks.
 */
function checkOrigin(
    name: string,
    raw: string | undefined,
    options: { checkHttps: boolean },
): ConfigIssue[] {
    const value = raw?.trim().replace(/\/$/, "");
    // Absence is runtimeConfig's business, not this module's.
    if (!value) return [];

    const url = parseOrigin(value);
    if (!url) {
        return [
            {
                name,
                problem: `is ${JSON.stringify(value)}, which is not an absolute URL.`,
                hint: "Include the scheme, for example https://legalworkflows.co.uk.",
            },
        ];
    }

    const issues: ConfigIssue[] = [];
    if (options.checkHttps && url.protocol !== "https:") {
        issues.push({
            name,
            problem: `is ${JSON.stringify(value)}, which is not HTTPS, and would be trusted for credentialed cross-origin requests.`,
            hint: "Use https://, or remove the entry.",
        });
    }
    if (LOOPBACK.has(url.hostname)) {
        issues.push({
            name,
            problem: `points at ${url.hostname}, which in production trusts a page served from the caller's own machine.`,
            hint: "Use the site's real public origin, or remove the entry.",
        });
    }
    return issues;
}

/**
 * Everything wrong with the parts of the origin configuration nothing else
 * checks. Returns every issue rather than throwing on the first: an operator
 * bringing up a new environment should see the whole list once, not discover
 * the next mistake after each restart.
 */
export function checkProductionConfig(
    env: NodeJS.ProcessEnv = process.env,
): ConfigIssue[] {
    if (env.NODE_ENV !== "production") return [];

    const issues: ConfigIssue[] = [
        // HTTPS on these two is runtimeConfig's; only loopback is ours.
        ...checkOrigin("FRONTEND_URL", env.FRONTEND_URL, { checkHttps: false }),
        ...checkOrigin("WORD_ADDIN_URL", env.WORD_ADDIN_URL, {
            checkHttps: false,
        }),
    ];

    // ALLOWED_ORIGINS is checked by nothing at all, so every part of it is
    // ours: one bad entry widens the allowlist as effectively as a bad
    // FRONTEND_URL would.
    for (const origin of (env.ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)) {
        issues.push(
            ...checkOrigin(
                `ALLOWED_ORIGINS entry ${JSON.stringify(origin)}`,
                origin,
                { checkHttps: true },
            ),
        );
    }

    return issues;
}

/** Renders issues for a boot log. */
export function formatConfigIssues(issues: ConfigIssue[]): string {
    return [
        "Production origin configuration would widen the CORS allowlist:",
        ...issues.map(
            (issue) => `  ${issue.name} ${issue.problem}\n      ${issue.hint}`,
        ),
        "  See docs/deployment.md, 'Production configuration'.",
    ].join("\n");
}

/**
 * Throws when production origins are unsafe, so the caller can exit.
 *
 * index.ts already exits(1) on a malformed MANIFEST_SIGNING_KEY and on
 * validateRuntimeConfiguration; this joins the same boot gate. A container that
 * never becomes healthy rolls back and names the fault; one that starts serves
 * a widened allowlist that nothing will report.
 */
export function assertProductionConfiguration(
    env: NodeJS.ProcessEnv = process.env,
): void {
    const issues = checkProductionConfig(env);
    if (issues.length === 0) return;
    throw new Error(formatConfigIssues(issues));
}
