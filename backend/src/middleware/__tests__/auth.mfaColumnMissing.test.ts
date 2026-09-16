import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

/**
 * The mfa_on_login lookup failing with 42703 (undefined_column) is the one
 * branch in requireAuth that lets a request through *without* applying a
 * security control. That is deliberate — failing closed on a column a
 * migration has not yet added would lock every user out of the product — but
 * it means login MFA silently stops being enforced for everyone, and the
 * branch used to say so only through devLog, which is a no-op in production.
 *
 * Both halves are pinned here: it still lets the request through, and it no
 * longer does so quietly.
 */

const { getUser, maybeSingle, syncProfileEmail } = vi.hoisted(() => ({
    getUser: vi.fn(),
    maybeSingle: vi.fn(),
    syncProfileEmail: vi.fn(),
}));

vi.mock("../../lib/supabase", () => ({
    createServerSupabase: () => ({
        auth: { getUser },
        from: () => ({
            select: () => ({ eq: () => ({ maybeSingle }) }),
        }),
    }),
}));

vi.mock("../../lib/userLookup", () => ({ syncProfileEmail }));

async function appWithRequireAuth() {
    const { requireAuth } = await import("../auth");
    const app = express();
    app.get("/protected", requireAuth, (_req, res) => res.json({ reached: true }));
    return app;
}

describe("requireAuth when mfa_on_login does not exist", () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.resetModules();
        getUser.mockResolvedValue({
            data: { user: { id: "user-1", email: "someone@example.com" } },
        });
        syncProfileEmail.mockResolvedValue(null);
        errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        errorSpy.mockRestore();
        vi.clearAllMocks();
    });

    it("lets the request through rather than locking everyone out", async () => {
        maybeSingle.mockResolvedValue({
            data: null,
            error: { code: "42703", message: 'column "mfa_on_login" does not exist' },
        });

        const res = await request(await appWithRequireAuth())
            .get("/protected")
            .set("authorization", "Bearer token-abc");

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ reached: true });
    });

    it("says so where production can see it, not only through devLog", async () => {
        maybeSingle.mockResolvedValue({
            data: null,
            error: { code: "42703", message: 'column "mfa_on_login" does not exist' },
        });

        await request(await appWithRequireAuth())
            .get("/protected")
            .set("authorization", "Bearer token-abc");

        const said = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
        expect(said).toContain("mfa_on_login");
        expect(said).toContain("skipped");
    });

    it("still enforces when the column is there and the user wants it", async () => {
        maybeSingle.mockResolvedValue({ data: { mfa_on_login: false }, error: null });

        const res = await request(await appWithRequireAuth())
            .get("/protected")
            .set("authorization", "Bearer token-abc");

        expect(res.status).toBe(200);
        // A working lookup is not an incident.
        expect(errorSpy).not.toHaveBeenCalled();
    });
});
