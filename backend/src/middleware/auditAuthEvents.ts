// Audit trail for authentication events: sign-in, sign-out, password reset,
// email change, and MFA enrolment, verification and removal.
//
// Implemented as one middleware on authRouter rather than a recordAudit call
// inside each of the nine handlers. Two reasons: routes/auth.ts is inherited
// and still changes upstream, so one insertion point is one future merge
// conflict instead of nine (fork rule 3); and recording on the response's
// "finish" event means the audit write cannot delay the reply, which matters
// on /login where a measurable delay would be an account-enumeration oracle.

import type { NextFunction, Request, Response } from "express";

import { recordAudit, type AuditStatus } from "../lib/audit";
import { requestOriginIsWordAddin } from "../lib/origins";
import { createServerSupabase } from "../lib/supabase";

type AuthEventRoute = {
    method: string;
    path: RegExp;
    action: string;
};

/**
 * Paths are matched against req.path, which is relative to the router's mount
 * point, so these are the paths as written in routes/auth.ts.
 */
const AUTH_EVENTS: AuthEventRoute[] = [
    { method: "POST", path: /^\/login$/, action: "auth.login" },
    { method: "POST", path: /^\/signup$/, action: "auth.signup" },
    { method: "POST", path: /^\/logout$/, action: "auth.logout" },
    { method: "POST", path: /^\/exchange$/, action: "auth.login" },
    { method: "POST", path: /^\/handoff$/, action: "auth.handoff" },
    {
        method: "POST",
        path: /^\/password-reset$/,
        action: "auth.password_reset_requested",
    },
    { method: "PATCH", path: /^\/password$/, action: "auth.password_changed" },
    {
        method: "PATCH",
        path: /^\/email$/,
        action: "auth.email_change_requested",
    },
    { method: "POST", path: /^\/mfa\/enroll$/, action: "auth.mfa_enrolled" },
    { method: "POST", path: /^\/mfa\/verify$/, action: "auth.mfa_verified" },
    {
        method: "POST",
        path: /^\/mfa\/challenge-and-verify$/,
        action: "auth.mfa_verified",
    },
    {
        method: "DELETE",
        path: /^\/mfa\/factors\/[^/]+$/,
        action: "auth.mfa_removed",
    },
];

function matchAuthEvent(method: string, path: string): AuthEventRoute | null {
    return (
        AUTH_EVENTS.find((e) => e.method === method && e.path.test(path)) ??
        null
    );
}

/** The body shape the auth routes return on success. */
type MaybeUserBody = { user?: { id?: unknown; email?: unknown } };

export function auditAuthEvents(
    req: Request,
    res: Response,
    next: NextFunction,
): void {
    const event = matchAuthEvent(req.method, req.path);
    if (!event) return next();

    // The actor is not on res.locals for the unauthenticated routes, so
    // capture it from the response body the handler is about to send.
    let body: MaybeUserBody | null = null;
    const json = res.json.bind(res);
    res.json = (payload: unknown) => {
        body = payload as MaybeUserBody;
        return json(payload);
    };

    res.on("finish", () => {
        // Everything below runs in an event handler, outside the request's
        // promise chain: an exception here is an UNCAUGHT exception, which by
        // default takes the process down. recordAudit swallows insert
        // failures, but createServerSupabase throws when the environment is
        // not configured, so the whole body needs the guard — a misconfigured
        // deployment must lose its audit trail, not its API.
        try {
            recordAuthEvent(req, res, event, body);
        } catch (err) {
            console.error(
                "[audit/auth] failed to record event:",
                err instanceof Error ? err.message : err,
            );
        }
    });

    next();
}

function recordAuthEvent(
    req: Request,
    res: Response,
    event: AuthEventRoute,
    body: MaybeUserBody | null,
): void {
    {
        const failed = res.statusCode >= 400;
        const status: AuditStatus = failed ? "failed" : "completed";

        const actorId =
            (res.locals.userId as string | undefined) ??
            (typeof body?.user?.id === "string" ? body.user.id : undefined);

        // A failed sign-in carries no user: signInWithPassword returns an
        // error and no user object, and audit_events.user_id is NOT NULL with
        // a foreign key to auth.users, so there is no row to attribute it to.
        // Skipping is the honest outcome — see docs/testing-coverage.md's
        // sibling note in the PR for why this is a schema limit, not an
        // oversight. Recording it against a looked-up id would also make the
        // response time depend on whether the address exists.
        if (!actorId) return;

        const actorEmail =
            (res.locals.userEmail as string | undefined) ??
            (typeof body?.user?.email === "string"
                ? body.user.email
                : undefined);

        void recordAudit(createServerSupabase(), {
            userId: actorId,
            userEmail: actorEmail ?? null,
            action: event.action,
            status,
            surface: requestOriginIsWordAddin(req.get("origin"))
                ? "word"
                : "account",
            detail: {
                status_code: res.statusCode,
                // The client origin is the "source" of the event. The remote
                // IP is deliberately not stored: it is personal data under
                // UK GDPR and nothing here needs it yet.
                origin: req.get("origin") ?? null,
            },
        });
    }
}
