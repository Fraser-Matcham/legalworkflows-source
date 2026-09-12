import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

process.env.SUPABASE_URL = "http://supabase.test.local";
process.env.SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
process.env.SUPABASE_SECRET_KEY = "test-service-key";

// The probes themselves are covered in src/lib/readiness.test.ts. What the
// route adds is the status mapping, so that is what is controlled here: a
// balancer acts on the status code, not on the body.
const checkReadiness = vi.hoisted(() => vi.fn());
vi.mock("../../lib/readiness", () => ({ checkReadiness }));

vi.mock("@supabase/supabase-js", () => ({
    createClient: vi.fn(() => ({
        auth: {
            getUser: () =>
                Promise.resolve({ data: { user: null }, error: null }),
        },
    })),
}));

import { app } from "../../app";

beforeEach(() => {
    checkReadiness.mockReset();
});

describe("GET /ready", () => {
    it("returns 200 when every dependency answers", async () => {
        checkReadiness.mockResolvedValue({
            ready: true,
            checks: [{ name: "database", ok: true, durationMs: 3 }],
        });

        const res = await request(app).get("/ready");

        expect(res.status).toBe(200);
        expect(res.body.ready).toBe(true);
    });

    it("returns 503 when a dependency is unreachable", async () => {
        // The whole point: the load balancer must take this instance out.
        checkReadiness.mockResolvedValue({
            ready: false,
            checks: [{ name: "database", ok: false, durationMs: 2001 }],
        });

        const res = await request(app).get("/ready");

        expect(res.status).toBe(503);
    });

    it("sends no body on the failure path", async () => {
        // protectInternalErrorResponses rewrites any res.json body at status
        // >= 500 into the generic internal error and logs a sanitised-error
        // line. Sending nothing keeps the status honest, avoids a spurious
        // error log on every unhealthy probe, and cannot leak regardless of
        // what that middleware intercepts. The failing check is named in the
        // {"kind":"readiness"} log line instead.
        checkReadiness.mockResolvedValue({
            ready: false,
            checks: [{ name: "database", ok: false, durationMs: 2001 }],
        });

        const res = await request(app).get("/ready");

        expect(res.text).toBe("");
        expect(res.body).toEqual({});
        // In particular, not the generic internal-error body.
        expect(res.text).not.toContain("internal_error");
    });

    it("reports each check by name when ready, so an operator can see the detail", async () => {
        checkReadiness.mockResolvedValue({
            ready: true,
            checks: [
                { name: "database", ok: true, durationMs: 3 },
                { name: "storage", ok: true, durationMs: 0, skipped: true },
            ],
        });

        const res = await request(app).get("/ready");

        expect(res.body.checks).toEqual([
            { name: "database", ok: true, durationMs: 3 },
            { name: "storage", ok: true, durationMs: 0, skipped: true },
        ]);
    });

    it("is reachable without authentication", async () => {
        // A load balancer cannot log in.
        checkReadiness.mockResolvedValue({ ready: true, checks: [] });

        const res = await request(app).get("/ready");

        expect(res.status).not.toBe(401);
    });

    it("does not change /health, which stays unconditionally 200", async () => {
        // /health is a liveness gate for the e2e wait-on, playwright's
        // webServer and the add-in dev script. A dependency being down must
        // not affect it.
        checkReadiness.mockResolvedValue({
            ready: false,
            checks: [{ name: "database", ok: false, durationMs: 2001 }],
        });

        const res = await request(app).get("/health");

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true });
    });
});
