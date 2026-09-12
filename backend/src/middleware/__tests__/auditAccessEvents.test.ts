import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { EventEmitter } from "node:events";

const recordAudit = vi.hoisted(() => vi.fn());
vi.mock("../../lib/audit", () => ({ recordAudit }));
vi.mock("../../lib/supabase", () => ({ createServerSupabase: () => ({}) }));

import { auditAccessEvents, matchAccessEvent } from "../auditAccessEvents";

/**
 * The middleware records on the response's "finish" event, so these fake a
 * response, emit "finish", and read what reached recordAudit.
 */
type FakeRes = Response & { emitFinish: () => void };

const makeRes = (statusCode: number, locals: Record<string, unknown>) => {
    const emitter = new EventEmitter();
    const res = {
        statusCode,
        locals,
        on: emitter.on.bind(emitter),
        emitFinish: () => emitter.emit("finish"),
    } as unknown as FakeRes;
    return res;
};

const makeReq = (
    method: string,
    path: string,
    body?: unknown,
    origin?: string,
) =>
    ({
        method,
        path,
        body,
        get: (header: string) =>
            header.toLowerCase() === "origin" ? origin : undefined,
    }) as unknown as Request;

const run = (req: Request, res: FakeRes): NextFunction => {
    const next = vi.fn() as unknown as NextFunction;
    auditAccessEvents(req, res, next);
    res.emitFinish();
    return next;
};

const PROJECT = "11111111-2222-3333-4444-555555555555";
const ACTOR = { userId: "actor-1", userEmail: "owner@firm.test" };

// Braces matter. `() => recordAudit.mockReset()` implicitly returns the mock,
// Vitest awaits whatever a hook returns, and a Vitest mock proxies property
// access — so `await mockFn` sees a callable `.then`, treats the mock as a
// thenable and CALLS it. With a throwing implementation set by a test, that
// throw surfaces as a failure of the next test, pointing at a line that is not
// the problem. Cost an hour; hence this note.
beforeEach(() => {
    recordAudit.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("matchAccessEvent", () => {
    it("matches a grant and takes the target from the body", () => {
        expect(
            matchAccessEvent("POST", `/${PROJECT}/access`, {
                email: "grantee@firm.test",
                role: "editor",
            }),
        ).toEqual({
            action: "access.granted",
            projectId: PROJECT,
            targetEmail: "grantee@firm.test",
            role: "editor",
        });
    });

    it("matches a revoke and takes the target from the path", () => {
        expect(
            matchAccessEvent(
                "DELETE",
                `/${PROJECT}/access/grantee%40firm.test`,
                undefined,
            ),
        ).toEqual({
            action: "access.revoked",
            projectId: PROJECT,
            targetEmail: "grantee@firm.test",
            role: null,
        });
    });

    it("keeps a malformed escape rather than losing the row", () => {
        const match = matchAccessEvent(
            "DELETE",
            `/${PROJECT}/access/%E0%A4%A`,
            undefined,
        );

        expect(match?.targetEmail).toBe("%E0%A4%A");
    });

    it("ignores reads of the access list", () => {
        // GET /:projectId/access is a read. Auditing it would bury the two
        // events that matter in noise.
        expect(matchAccessEvent("GET", `/${PROJECT}/access`, undefined)).toBe(
            null,
        );
    });

    it("ignores unrelated project routes", () => {
        expect(
            matchAccessEvent("PATCH", `/${PROJECT}`, { name: "x" }),
        ).toBe(null);
        expect(
            matchAccessEvent("POST", `/${PROJECT}/folders`, {}),
        ).toBe(null);
    });
});

describe("auditAccessEvents", () => {
    it("records a successful grant, with the project and the grantee", () => {
        const req = makeReq("POST", `/${PROJECT}/access`, {
            email: "grantee@firm.test",
            role: "editor",
        });
        const next = run(req, makeRes(200, { ...ACTOR }));

        expect(next).toHaveBeenCalled();
        expect(recordAudit).toHaveBeenCalledTimes(1);
        expect(recordAudit.mock.calls[0][1]).toMatchObject({
            userId: "actor-1",
            userEmail: "owner@firm.test",
            action: "access.granted",
            status: "completed",
            projectId: PROJECT,
            detail: {
                status_code: 200,
                target_email: "grantee@firm.test",
                role: "editor",
            },
        });
    });

    it("records a revoke", () => {
        const req = makeReq(
            "DELETE",
            `/${PROJECT}/access/grantee%40firm.test`,
        );
        run(req, makeRes(204, { ...ACTOR }));

        expect(recordAudit.mock.calls[0][1]).toMatchObject({
            action: "access.revoked",
            status: "completed",
            detail: { target_email: "grantee@firm.test" },
        });
    });

    it("records a refused attempt as failed", () => {
        // An attempt to grant access that was refused is more interesting than
        // one that succeeded, not less.
        const req = makeReq("POST", `/${PROJECT}/access`, {
            email: "outsider@elsewhere.test",
            role: "owner",
        });
        run(req, makeRes(403, { ...ACTOR }));

        expect(recordAudit.mock.calls[0][1]).toMatchObject({
            action: "access.granted",
            status: "failed",
            detail: { status_code: 403 },
        });
    });

    it("records nothing for an unauthenticated request", () => {
        // requireAuth runs after this middleware, so there is no actor to
        // attribute the row to and audit_events.user_id is NOT NULL.
        const req = makeReq("POST", `/${PROJECT}/access`, {
            email: "x@firm.test",
        });
        run(req, makeRes(401, {}));

        expect(recordAudit).not.toHaveBeenCalled();
    });

    it("records nothing for a route that is not an access change", () => {
        run(makeReq("GET", `/${PROJECT}/documents`), makeRes(200, { ...ACTOR }));

        expect(recordAudit).not.toHaveBeenCalled();
    });

    it("marks the surface as word when the add-in made the call", () => {
        const req = makeReq(
            "POST",
            `/${PROJECT}/access`,
            { email: "g@firm.test" },
            "https://localhost:3200",
        );
        run(req, makeRes(200, { ...ACTOR }));

        expect(recordAudit.mock.calls[0][1].surface).toBe("word");
    });

    it("keeps the origin but never the remote IP", () => {
        const req = makeReq(
            "POST",
            `/${PROJECT}/access`,
            { email: "g@firm.test" },
            "https://legalworkflows.co.uk",
        );
        run(req, makeRes(200, { ...ACTOR }));

        const detail = recordAudit.mock.calls[0][1].detail;
        expect(detail.origin).toBe("https://legalworkflows.co.uk");
        expect(JSON.stringify(detail)).not.toMatch(/\b\d+\.\d+\.\d+\.\d+\b/);
    });

    it("does not let a recording failure take the process down", () => {
        // "finish" runs outside the request's promise chain, so an exception
        // here would be an uncaught exception.
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        recordAudit.mockImplementation(() => {
            throw new Error("supabase is not configured");
        });

        const req = makeReq("POST", `/${PROJECT}/access`, {
            email: "g@firm.test",
        });

        expect(() => run(req, makeRes(200, { ...ACTOR }))).not.toThrow();
        expect(error).toHaveBeenCalled();
    });
});
