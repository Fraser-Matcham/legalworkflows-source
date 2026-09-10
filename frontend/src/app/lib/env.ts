/**
 * The frontend's environment contract, in one place.
 *
 * The frontend reads exactly three variables (`frontend/.env.example`
 * documents them). Until this module existed, each was validated — or not —
 * at its point of use, with two consequences worth stating plainly:
 *
 * 1. A missing `API_BASE_URL` in production was discovered per request, inside
 *    the `/api` proxy's try/catch. The thrown error was caught by the same
 *    handler that catches a genuinely unreachable backend, so the operator saw
 *    "The API is temporarily unavailable" (502) on every request and went
 *    looking at a backend that was perfectly healthy. A configuration mistake
 *    presented as an outage of a different component.
 *
 * 2. A missing `NEXT_PUBLIC_APP_URL` fell back to `http://localhost:3000`
 *    silently. In production that means every canonical URL and every Open
 *    Graph link preview points at localhost — invisible in the application
 *    itself, visible to anyone who pastes a link into Slack or WhatsApp.
 *
 * The fix is to check the contract once, when the server starts, and refuse to
 * start on a fatal misconfiguration: a container that never becomes healthy is
 * a far better signal than one that serves errors. `src/instrumentation.ts` is
 * the caller; it stays thin so the logic lives here, under the coverage
 * ratchet.
 *
 * Everything here is pure — it takes the values as an argument rather than
 * reading `process.env` itself. That is not only for testability. Next inlines
 * `NEXT_PUBLIC_*` by literal textual substitution on the exact expression
 * `process.env.NEXT_PUBLIC_FOO` at build time, so a module that received a
 * spread of `process.env` would read the *runtime* value, which for a
 * `NEXT_PUBLIC_` variable is routinely empty even when the build inlined a
 * real one. The caller must name each variable explicitly.
 *
 * Copyright 2026 Fraser Matcham. Licensed under the GNU Affero General Public
 * License v3.0.
 */

/**
 * `fatal` refuses to start the server. `warning` is printed and continues.
 *
 * The line between them is whether the application can serve correctly
 * without the value, not whether the value matters. `NEXT_PUBLIC_APP_URL`
 * matters a great deal, but the e2e suite serves a production build without
 * it quite legitimately, so its absence cannot be fatal. A *malformed* value
 * is fatal whatever the variable: nobody sets a broken URL on purpose.
 */
export type EnvSeverity = "fatal" | "warning";

export type EnvIssue = {
    name: string;
    severity: EnvSeverity;
    /** What is wrong, in terms of the value that was supplied. */
    problem: string;
    /** What to do about it. */
    hint: string;
};

/** The variables the frontend reads. See `frontend/.env.example`. */
export type FrontendEnv = {
    API_BASE_URL?: string | undefined;
    NEXT_PUBLIC_APP_URL?: string | undefined;
    NEXT_PUBLIC_WORKFLOW_CONTRIBUTIONS_ENABLED?: string | undefined;
};

/** Where a local backend answers when nothing is configured. */
export const DEV_API_BASE_URL = "http://localhost:3001";

/** The origin `layout.tsx` falls back to when nothing is configured. */
export const DEV_APP_URL = "http://localhost:3000";

/**
 * Parses an absolute http(s) URL, or returns null.
 *
 * `new URL()` accepts a great deal that is not a usable origin — `foo:bar`
 * parses happily with protocol `foo:` — so the protocol check is the point of
 * this, not an afterthought.
 */
function parseHttpUrl(raw: string): URL | null {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return null;
    }
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
}

/**
 * Resolves `API_BASE_URL` to an origin with no trailing slash, or throws.
 *
 * Kept as the single definition so the `/api` proxy and the startup guard
 * cannot disagree about what a valid value is — the proxy used to carry its
 * own copy.
 */
export function resolveApiBaseUrl(
    raw: string | undefined,
    options: { production: boolean },
): string {
    const configured = raw?.trim();
    if (!configured) {
        if (options.production) {
            throw new Error("API_BASE_URL is required at runtime.");
        }
        return DEV_API_BASE_URL;
    }
    const url = parseHttpUrl(configured);
    if (!url) {
        throw new Error("API_BASE_URL must use http or https.");
    }
    return url.toString().replace(/\/$/, "");
}

/**
 * Checks the whole contract and returns everything wrong with it.
 *
 * Returns every issue rather than throwing on the first: an operator bringing
 * up a new environment should see the full list once, not discover the next
 * mistake after each restart.
 *
 * Outside production nothing is fatal. Local development legitimately runs
 * with none of these set, and a dev server that refuses to boot over a link
 * preview URL would be a worse tool than one that warns.
 */
export function checkFrontendEnv(
    env: FrontendEnv,
    options: { production: boolean },
): EnvIssue[] {
    const issues: EnvIssue[] = [];
    const escalate = (severity: EnvSeverity): EnvSeverity =>
        options.production ? severity : "warning";

    const apiBaseUrl = env.API_BASE_URL?.trim();
    if (!apiBaseUrl) {
        issues.push({
            name: "API_BASE_URL",
            severity: escalate("fatal"),
            problem: "is not set, so server-side calls have no backend to reach.",
            hint: `Set it to the backend's origin, for example ${DEV_API_BASE_URL} locally or http://backend:3001 under docker-compose.`,
        });
    } else if (!parseHttpUrl(apiBaseUrl)) {
        issues.push({
            name: "API_BASE_URL",
            severity: escalate("fatal"),
            problem: `is ${JSON.stringify(apiBaseUrl)}, which is not an absolute http or https URL.`,
            hint: "Include the scheme, for example http://backend:3001 rather than backend:3001.",
        });
    }

    const appUrl = env.NEXT_PUBLIC_APP_URL?.trim();
    if (!appUrl) {
        // Never fatal: the e2e suite serves a production build without it.
        issues.push({
            name: "NEXT_PUBLIC_APP_URL",
            severity: "warning",
            problem: `is not set, so canonical URLs and link previews will point at ${DEV_APP_URL}.`,
            hint: "Set it to the site's own public origin, with no trailing slash. Harmless in tests; wrong in production.",
        });
    } else if (!parseHttpUrl(appUrl)) {
        issues.push({
            name: "NEXT_PUBLIC_APP_URL",
            severity: escalate("fatal"),
            problem: `is ${JSON.stringify(appUrl)}, which is not an absolute http or https URL.`,
            hint: "Include the scheme and no trailing slash, for example https://example.com.",
        });
    } else if (appUrl.endsWith("/")) {
        issues.push({
            name: "NEXT_PUBLIC_APP_URL",
            severity: "warning",
            problem: `is ${JSON.stringify(appUrl)}, whose trailing slash produces double-slashed URLs in metadata.`,
            hint: "Remove the trailing slash.",
        });
    }

    // Read with `=== "true"`, so any other spelling silently disables the
    // feature. "TRUE" and "1" are the plausible mistakes and neither is
    // visible in the UI — the flow simply never appears.
    const contributions = env.NEXT_PUBLIC_WORKFLOW_CONTRIBUTIONS_ENABLED?.trim();
    if (
        contributions !== undefined &&
        contributions !== "" &&
        contributions !== "true" &&
        contributions !== "false"
    ) {
        issues.push({
            name: "NEXT_PUBLIC_WORKFLOW_CONTRIBUTIONS_ENABLED",
            severity: "warning",
            problem: `is ${JSON.stringify(contributions)}, which is read as "not true", so the contribution flow stays hidden.`,
            hint: 'Use exactly "true" or "false", in lower case.',
        });
    }

    return issues;
}

/** Renders issues for a server log, worst first. */
export function formatEnvIssues(issues: EnvIssue[]): string {
    const fatal = issues.filter((issue) => issue.severity === "fatal");
    const warnings = issues.filter((issue) => issue.severity === "warning");
    const lines = [...fatal, ...warnings].map(
        (issue) =>
            `  [${issue.severity}] ${issue.name} ${issue.problem}\n      ${issue.hint}`,
    );
    return [
        fatal.length
            ? "Frontend environment is not usable:"
            : "Frontend environment warnings:",
        ...lines,
        "  See frontend/.env.example for the full contract.",
    ].join("\n");
}
