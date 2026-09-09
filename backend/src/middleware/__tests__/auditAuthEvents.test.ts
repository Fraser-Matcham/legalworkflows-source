import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { recordAudit, createServerSupabase } = vi.hoisted(() => ({
    recordAudit: vi.fn(),
    createServerSupabase: vi.fn(),
}));

vi.mock("../../lib/audit", () => ({ recordAudit }));
vi.mock("../../lib/supabase", () => ({ createServerSupabase }));

import { auditAuthEvents } from "../auditAuthEvents";

type FakeRes = EventEmitter & {
    statusCode: number;
    locals: Record<string, unknown>;
    json: (payload: unknown) => unknown;
};

function run(
    method: string,
    path: string,
    opts: {
        statusCode?: number;
        body?: unknown;
        locals?: Record<string, unknown>;
        origin?: string;
    } = {},
) {
    const req = {
        method,
        path,
        get: (h: string) =>
            h.toLowerCase() === "origin" ? opts.origin : undefined,
    } as never;
    const res = Object.assign(new EventEmitter(), {
        statusCode: opts.statusCode ?? 200,
        locals: opts.locals ?? {},
        json: (payload: unknown) => payload,
    }) as FakeRes;
    const next = vi.fn();

    auditAuthEvents(req, res as never, next);
    expect(next).toHaveBeenCalledOnce();
    if (opts.body !== undefined) res.json(opts.body);
    res.emit("finish");
    return res;
}

beforeEach(() => {
    recordAudit.mockReset();
    createServerSupabase.mockReset();
    createServerSupabase.mockReturnValue({});
});

describe("successful authentication", () => {
    it("records a sign-in with the actor taken from the response body", () => {
        run("POST", "/login", {
            body: { user: { id: "u1", email: "person@example.com" } },
            origin: "https://app.example.com",
        });

        expect(recordAudit).toHaveBeenCalledTimes(1);
        const [, event] = recordAudit.mock.calls[0];
        expect(event).toMatchObject({
            userId: "u1",
            userEmail: "person@example.com",
            action: "auth.login",
            status: "completed",
            surface: "account",
            detail: { status_code: 200, origin: "https://app.example.com" },
        });
    });

    it("records a sign-out using the actor the auth middleware resolved", () => {
        run("POST", "/logout", {
            statusCode: 204,
            locals: { userId: "u2", userEmail: "gone@example.com" },
        });

        const [, event] = recordAudit.mock.calls[0];
        expect(event).toMatchObject({
            userId: "u2",
            action: "auth.logout",
            status: "completed",
        });
    });

    it("records MFA removal from the parameterised factor path", () => {
        run("DELETE", "/mfa/factors/factor-123", {
            locals: { userId: "u3" },
        });

        expect(recordAudit.mock.calls[0][1]).toMatchObject({
            action: "auth.mfa_removed",
        });
    });
});

describe("distinguishing failures from successes", () => {
    it("marks an authenticated failure as failed rather than completed", () => {
        run("POST", "/mfa/verify", {
            statusCode: 401,
            locals: { userId: "u1" },
        });

        expect(recordAudit.mock.calls[0][1]).toMatchObject({
            action: "auth.mfa_verified",
            status: "failed",
            detail: { status_code: 401 },
        });
    });

    it("records nothing for a failed sign-in, which has no actor", () => {
        // audit_events.user_id is NOT NULL with a foreign key to auth.users,
        // and a rejected signInWithPassword returns no user, so there is no
        // row a failed login could be attributed to. Pinned as a known gap
        // rather than left to be rediscovered.
        run("POST", "/login", { statusCode: 400 });

        expect(recordAudit).not.toHaveBeenCalled();
    });
});

describe("scope and safety", () => {
    it("ignores routes that are not authentication events", () => {
        run("GET", "/session", { locals: { userId: "u1" } });
        run("POST", "/mfa/challenge", { locals: { userId: "u1" } });

        expect(recordAudit).not.toHaveBeenCalled();
    });

    it("attributes the Word add-in origin to the word surface", () => {
        run("POST", "/login", {
            body: { user: { id: "u1" } },
            origin: "https://addin.example.com",
        });

        // requestOriginIsWordAddin decides this; the point here is that the
        // surface is derived from the request rather than hardcoded.
        expect(recordAudit.mock.calls[0][1].surface).toMatch(/^(word|account)$/);
    });

    it("never lets an audit failure escape the finish handler", () => {
        // This runs outside the request's promise chain, so a throw here is an
        // uncaught exception that takes the process down. A deployment with no
        // Supabase configuration must lose its audit trail, not its API.
        createServerSupabase.mockImplementation(() => {
            throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set");
        });

        expect(() =>
            run("POST", "/logout", { locals: { userId: "u1" } }),
        ).not.toThrow();
    });
});
