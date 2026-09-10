/**
 * One structured line per request: who, what, and how it ended.
 *
 * Before this, the service logged only when something went wrong, and those
 * lines carried no user and no timing. A support question of the form "this
 * request failed for this client at about this time" had no way to be
 * answered, and a slow route had no way to be found.
 *
 * The line is deliberately narrow. It carries identifiers and outcomes, and
 * nothing that could hold a client's content:
 *
 *   requestId  the value already minted in app.ts and returned to the caller
 *              in X-Request-ID, so a user reporting an error quotes the exact
 *              key this line is indexed by.
 *   userId     the opaque uuid. NOT the email: res.locals.userEmail is right
 *              there and is personal data, and a log store is the wrong place
 *              for it. Joining uuid to account is a database query away for
 *              anyone with a reason to make it.
 *   route      the matched Express route pattern, never the concrete path.
 *              This is not only for aggregation. A path segment can BE a
 *              credential: /download/:token carries a signed token, and it
 *              has no recognisable shape for redactSecrets to catch, so the
 *              only safe answer is not to write concrete segments at all.
 *              (The probe test in requestLog.probe.test.ts found this by
 *              planting a token in the path and reading back the line.)
 *              When nothing matched — a 404, a scanner — the raw path is
 *              recorded instead, redacted and truncated, because seeing what
 *              was probed is the whole value of logging an unmatched request,
 *              and no real signed token reaches that branch.
 *   status     including the 499-style case where the client disconnects
 *              first, which "finish" would otherwise report as a success.
 *   durationMs measured from the moment this middleware runs.
 *
 * Never included: the request body, the response body, headers, cookies, the
 * remote IP (as with the auth audit events in auditAuthEvents.ts, under UK
 * GDPR data minimisation), or a query string.
 */

import type { NextFunction, Request, Response } from "express";
import { safePathForLog } from "../lib/safeError";

export interface RequestLogLine {
    kind: "http";
    requestId: string | null;
    userId: string | null;
    method: string;
    /** Matched route pattern, or the redacted raw path when none matched. */
    route: string;
    status: number;
    durationMs: number;
    /** True when the client went away before the response completed. */
    aborted?: true;
}

/** Longest path recorded. A path this long is an attack, not a route. */
const MAX_PATH = 200;

function readLocal(res: Response, key: string): string | null {
    const value = res.locals?.[key];
    return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * The path without its query string, for the unmatched case only. A query
 * string carries filenames and search terms, so it never survives; the
 * remainder is redacted and truncated because an unmatched path is attacker-
 * controlled text.
 */
function unmatchedPath(req: Request): string {
    return safePathForLog(req.originalUrl ?? req.url, MAX_PATH);
}

/**
 * The matched route pattern, once Express has matched one. Reading it at
 * finish time rather than on the way in is what makes it available at all:
 * on the way in, no route has been matched yet.
 */
function matchedRoute(req: Request, fallback: string): string {
    const route = (req as Request & { route?: { path?: unknown } }).route;
    const pattern = typeof route?.path === "string" ? route.path : null;
    if (!pattern) return fallback;
    const mount = typeof req.baseUrl === "string" ? req.baseUrl : "";
    const joined = `${mount}${pattern === "/" ? "" : pattern}`;
    return joined.length > 0 ? joined : fallback;
}

export function buildRequestLogLine(
    req: Request,
    res: Response,
    durationMs: number,
    aborted: boolean,
): RequestLogLine {
    const line: RequestLogLine = {
        kind: "http",
        requestId: readLocal(res, "requestId"),
        userId: readLocal(res, "userId"),
        method: req.method,
        route: matchedRoute(req, unmatchedPath(req)),
        status: res.statusCode,
        durationMs,
    };
    if (aborted) line.aborted = true;
    return line;
}

/**
 * Emits the line once, on whichever of "finish" or "close" comes first.
 *
 * The try/catch is not defensive dressing. A throw inside a response event
 * handler is an uncaught exception, and an uncaught exception in Node takes
 * the process down — a logging bug would become an outage. It has happened in
 * this repository before, in the auth audit middleware.
 */
export function requestLog(req: Request, res: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();
    let emitted = false;

    const emit = (aborted: boolean) => {
        if (emitted) return;
        emitted = true;
        try {
            const durationMs =
                Number(process.hrtime.bigint() - startedAt) / 1_000_000;
            console.log(
                JSON.stringify(
                    buildRequestLogLine(req, res, Math.round(durationMs * 100) / 100, aborted),
                ),
            );
        } catch (err) {
            console.error("[http/request-log] failed to emit line:", (err as Error)?.name);
        }
    };

    res.on("finish", () => emit(false));
    res.on("close", () => emit(!res.writableEnded));

    next();
}
