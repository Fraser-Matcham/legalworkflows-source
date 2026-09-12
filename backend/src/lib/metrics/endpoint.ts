/**
 * The scrape endpoint, and how it refuses to be exposed by accident.
 *
 * A metrics endpoint is not neutral data. Route labels enumerate the API
 * surface; counts of 401s and 429s tell an attacker when a probe is working;
 * queue depth and token spend describe the business. None of that should be
 * readable by whoever finds the hostname.
 *
 * Two decisions follow, and the order matters.
 *
 * **Unset means the route does not exist.** With no `METRICS_TOKEN`, the
 * handler answers 404, not 401 — the same answer as any other unrouted path.
 * The default posture is therefore "no metrics endpoint", so a deployment that
 * never thinks about this cannot expose one, and a scan cannot learn the
 * endpoint is there but locked.
 *
 * **The comparison is constant-time.** A token checked with `===` leaks its
 * length and its matching prefix through response timing, which is the whole
 * reason `timingSafeEqual` exists. Lengths are compared first because
 * `timingSafeEqual` throws on a length mismatch, and the length of a
 * configured token is not the secret.
 */

import { timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { CONTENT_TYPE, type Registry } from "./registry";

export function configuredMetricsToken(
    env: NodeJS.ProcessEnv = process.env,
): string {
    return env.METRICS_TOKEN?.trim() ?? "";
}

/** Reads the bearer token, accepting `Authorization: Bearer <token>` only. */
function presentedToken(req: Request): string {
    const header = req.get("authorization");
    if (!header) return "";
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    return match ? match[1].trim() : "";
}

function tokensMatch(expected: string, presented: string): boolean {
    if (expected.length !== presented.length) return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(presented));
}

/**
 * Builds the handler. The registry is a parameter rather than an import so a
 * test can scrape a registry it populated itself, without the module-level
 * counters of a whole running service in the way.
 */
export function metricsHandler(
    registry: Registry,
    env: NodeJS.ProcessEnv = process.env,
) {
    return async (req: Request, res: Response): Promise<void> => {
        const expected = configuredMetricsToken(env);
        if (!expected) {
            // Not "forbidden" — absent. See the header.
            res.status(404).end();
            return;
        }
        if (!tokensMatch(expected, presentedToken(req))) {
            res.status(401).end();
            return;
        }

        try {
            const body = await registry.expose();
            res.status(200).type(CONTENT_TYPE).send(body);
        } catch (err) {
            // A scrape that fails must not take a request thread with it, and
            // must not describe its own failure to an unauthenticated-adjacent
            // caller. The reason goes to the log, redacted by the bridge.
            console.error("[metrics] scrape failed", err);
            res.status(500).end();
        }
    };
}
