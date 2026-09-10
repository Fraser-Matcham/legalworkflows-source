/**
 * Validates the environment once, when the server starts.
 *
 * Next calls `register()` on server boot — verified on both `next start` and
 * the `output: "standalone"` server the production image runs, and verified
 * *not* to run during `next build`, so this cannot fail a CI build that has no
 * runtime configuration.
 *
 * Deliberately thin. The contract and every decision about it live in
 * `@/app/lib/env`, which is under the frontend coverage ratchet; this file
 * only reads the values and decides whether to die.
 *
 * Copyright 2026 Fraser Matcham. Licensed under the GNU Affero General Public
 * License v3.0.
 */

import { checkFrontendEnv, formatEnvIssues } from "@/app/lib/env";

export function register() {
    // Each variable is named explicitly rather than spread from `process.env`.
    // Next inlines `NEXT_PUBLIC_*` by literal textual substitution on this
    // exact expression at build time; a spread would read the runtime value
    // instead, which is routinely empty even when the build inlined a real
    // one — and this guard would then report a mistake that does not exist.
    const issues = checkFrontendEnv(
        {
            API_BASE_URL: process.env.API_BASE_URL,
            NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
            NEXT_PUBLIC_WORKFLOW_CONTRIBUTIONS_ENABLED:
                process.env.NEXT_PUBLIC_WORKFLOW_CONTRIBUTIONS_ENABLED,
        },
        { production: process.env.NODE_ENV === "production" },
    );

    if (issues.length === 0) {
        return;
    }

    const report = formatEnvIssues(issues);
    if (issues.some((issue) => issue.severity === "fatal")) {
        console.error(report);
        // Exit rather than throw. Throwing from this hook is *not* enough:
        // Next catches it, logs an unhandledRejection, and keeps the process
        // alive answering 500 to every request — verified against the
        // standalone server. A TCP health check passes that quite happily, so
        // a broken deploy would look healthy and never roll back. Exiting
        // means the container dies at boot with the reason on stderr, which
        // is the whole point of checking at startup instead of per request.
        if (typeof process.exit === "function") {
            process.exit(1);
        }
        // Runtimes without process.exit (the edge runtime) still get a throw.
        throw new Error(report);
    }
    console.warn(report);
}
