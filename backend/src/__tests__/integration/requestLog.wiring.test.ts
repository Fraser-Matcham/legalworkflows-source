/**
 * Proves the middleware is actually mounted in app.ts.
 *
 * requestLog.probe.test.ts builds its own small Express app, which tests the
 * middleware but would keep passing if someone removed the app.use() line.
 * This one imports the real app, so deleting that line turns it red.
 */

import { describe, expect, it, vi } from "vitest";
import request from "supertest";

// requireAuth reads these at request time, so setting them here is early
// enough even though imported modules evaluate first.
process.env.SUPABASE_URL = "http://supabase.test.local";
process.env.SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
process.env.SUPABASE_SECRET_KEY = "test-service-key";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => ({})) }));

import { app } from "../../app";

describe("request logging is mounted on the real app", () => {
    it("emits one line for a request that never reaches a router", async () => {
        const lines: string[] = [];
        const spy = vi
            .spyOn(console, "log")
            .mockImplementation((...args: unknown[]) => {
                lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
            });

        await request(app).get("/health");
        spy.mockRestore();

        const raw = lines.find((line) => line.includes('"kind":"http"'));
        expect(raw, "app.ts is not mounting requestLog").toBeTruthy();

        const line = JSON.parse(raw as string);
        expect(line.route).toBe("/health");
        expect(line.status).toBe(200);
        expect(line.requestId).toMatch(/^[0-9a-f-]{36}$/);
        // No user is signed in, so there is nothing to attribute the line to.
        expect(line.userId).toBeNull();
    });
});
