/**
 * Audit trail for project access changes: who granted access to whom, and who
 * took it away.
 *
 * Ticket 2056 put it plainly: eighteen actions were audited, and none of them
 * was this. For software holding privileged material, "who could see this
 * matter, and since when?" is the question you will actually be asked — by a
 * client, by an insurer, or after an incident. `routes/projects.ts` had no
 * `recordAudit` call at all, so sharing a project left no trace beyond the
 * current state of `project_access_grants`, which says who has access now and
 * nothing about how they got it or who else used to.
 *
 * Implemented as one middleware on the router, exactly as `auditAuthEvents.ts`
 * is, and for the same two reasons: `routes/projects.ts` is inherited and still
 * changes upstream, so one insertion point is one future merge conflict instead
 * of several (fork rule 3); and recording on the response's "finish" event
 * keeps the audit write off the request's critical path.
 *
 * Failed attempts are recorded too, with status "failed". An attempt to grant
 * access that was refused is more interesting than one that succeeded, not
 * less.
 *
 * Copyright 2026 Fraser Matcham. Licensed under the GNU Affero General Public
 * License v3.0.
 */

import type { NextFunction, Request, Response } from "express";

import { recordAudit, type AuditStatus } from "../lib/audit";
import { requestOriginIsWordAddin } from "../lib/origins";
import { createServerSupabase } from "../lib/supabase";

type AccessEventRoute = {
    method: string;
    /** First capture group is the project id. */
    path: RegExp;
    action: string;
};

/**
 * Paths are matched against `req.path`, which inside a router is relative to
 * its mount point — so these are the paths as written in routes/projects.ts.
 *
 * POST covers both a first grant and a change of role; the role lands in the
 * detail either way, so the trail shows what someone was given, not merely
 * that something happened.
 */
const ACCESS_EVENTS: AccessEventRoute[] = [
    {
        method: "POST",
        path: /^\/([^/]+)\/access$/,
        action: "access.granted",
    },
    {
        method: "DELETE",
        path: /^\/([^/]+)\/access\/([^/]+)$/,
        action: "access.revoked",
    },
];

type MatchedEvent = {
    action: string;
    projectId: string;
    /** The person whose access changed, as the request identified them. */
    targetEmail: string | null;
    role: string | null;
};

function decodeEmail(raw: string | undefined): string | null {
    if (!raw) return null;
    try {
        return decodeURIComponent(raw);
    } catch {
        // A malformed escape sequence is the client's problem, not a reason to
        // lose the audit row; record what was actually sent.
        return raw;
    }
}

export function matchAccessEvent(
    method: string,
    path: string,
    body: unknown,
): MatchedEvent | null {
    for (const event of ACCESS_EVENTS) {
        if (event.method !== method) continue;
        const match = event.path.exec(path);
        if (!match) continue;

        const fields = (body ?? {}) as { email?: unknown; role?: unknown };
        return {
            action: event.action,
            projectId: match[1],
            targetEmail:
                typeof fields.email === "string" && fields.email
                    ? fields.email
                    : decodeEmail(match[2]),
            role: typeof fields.role === "string" ? fields.role : null,
        };
    }
    return null;
}

export function auditAccessEvents(
    req: Request,
    res: Response,
    next: NextFunction,
): void {
    // Read the body now: a handler is free to reassign req.body, and by the
    // time "finish" runs the request is over.
    const event = matchAccessEvent(req.method, req.path, req.body);
    if (!event) return next();

    res.on("finish", () => {
        // This runs in an event handler, outside the request's promise chain,
        // so an exception here is an UNCAUGHT exception — which by default
        // takes the process down. recordAudit swallows insert failures, but
        // createServerSupabase throws when the environment is not configured,
        // so the whole body needs the guard. A misconfigured deployment must
        // lose its audit trail, not its API.
        try {
            recordAccessEvent(req, res, event);
        } catch (err) {
            console.error(
                "[audit/access] failed to record event:",
                err instanceof Error ? err.message : err,
            );
        }
    });

    next();
}

function recordAccessEvent(
    req: Request,
    res: Response,
    event: MatchedEvent,
): void {
    const actorId = res.locals.userId as string | undefined;
    // requireAuth runs after this middleware, so an unauthenticated request
    // reaches "finish" with no actor. There is nobody to attribute the row to
    // — audit_events.user_id is NOT NULL with a foreign key to auth.users —
    // and an unauthenticated 401 is the request log's business, not the audit
    // trail's.
    if (!actorId) return;

    const status: AuditStatus = res.statusCode >= 400 ? "failed" : "completed";

    void recordAudit(createServerSupabase(), {
        userId: actorId,
        userEmail: (res.locals.userEmail as string | undefined) ?? null,
        action: event.action,
        status,
        projectId: event.projectId,
        surface: requestOriginIsWordAddin(req.get("origin"))
            ? "word"
            : "account",
        detail: {
            status_code: res.statusCode,
            // The grantee's address is the point of the record: an audit trail
            // that says access changed without saying whose is not an answer
            // to the question anyone asks. It is already held in
            // project_access_grants and in audit_events.user_email for that
            // person's own rows.
            target_email: event.targetEmail,
            role: event.role,
            // As in auditAuthEvents: the client origin is kept, the remote IP
            // deliberately is not — it is personal data under UK GDPR and
            // nothing here needs it yet.
            origin: req.get("origin") ?? null,
        },
    });
}
