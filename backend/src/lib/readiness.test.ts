import { afterEach, describe, expect, it, vi } from "vitest";
import { checkReadiness } from "./readiness";

/**
 * The probes are injected, so these tests describe the *policy* — what counts
 * as ready, what a failure does to the response, and what the caller is told —
 * without reaching a database or a bucket.
 */

const ok = () => Promise.resolve();
const fail = () => Promise.reject(new Error("dependency is down"));
const never = () => new Promise<void>(() => {});

afterEach(() => {
    vi.restoreAllMocks();
});

/** Silence the deliberate error logging these tests provoke. */
const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});

const byName = (report: Awaited<ReturnType<typeof checkReadiness>>) =>
    Object.fromEntries(report.checks.map((c) => [c.name, c]));

describe("checkReadiness", () => {
    it("is ready when every dependency answers", async () => {
        const report = await checkReadiness({
            probes: { database: ok, storage: ok },
            storageConfigured: true,
        });

        expect(report.ready).toBe(true);
        expect(report.checks.map((c) => c.name).sort()).toEqual([
            "database",
            "storage",
        ]);
    });

    it("is not ready when the database is unreachable", async () => {
        quiet();

        const report = await checkReadiness({
            probes: { database: fail, storage: ok },
            storageConfigured: true,
        });

        expect(report.ready).toBe(false);
        expect(byName(report).database.ok).toBe(false);
    });

    it("is not ready when storage is unreachable", async () => {
        quiet();

        const report = await checkReadiness({
            probes: { database: ok, storage: fail },
            storageConfigured: true,
        });

        expect(report.ready).toBe(false);
        expect(byName(report).storage.ok).toBe(false);
    });

    it("reports every failure rather than stopping at the first", async () => {
        // An operator looking at a failing instance needs to know whether one
        // dependency is down or all of them.
        quiet();

        const report = await checkReadiness({
            probes: { database: fail, storage: fail },
            storageConfigured: true,
        });

        expect(report.checks.every((c) => c.ok)).toBe(false);
        expect(report.checks).toHaveLength(2);
    });

    it("fails a probe that hangs, rather than hanging itself", async () => {
        // A probe that never returns is worse than one that fails: the load
        // balancer learns nothing and the instance sits in limbo.
        quiet();

        const report = await checkReadiness({
            probes: { database: never, storage: ok },
            timeoutMs: 20,
            storageConfigured: true,
        });

        expect(report.ready).toBe(false);
        expect(byName(report).database.ok).toBe(false);
    });

    it("treats unconfigured storage as skipped, not as a failure", async () => {
        // The local stack and the e2e run legitimately have no bucket.
        const report = await checkReadiness({
            probes: { database: ok },
            storageConfigured: false,
        });

        expect(report.ready).toBe(true);
        expect(byName(report).storage).toMatchObject({
            ok: true,
            skipped: true,
        });
    });

    it("never runs the storage probe when storage is unconfigured", async () => {
        const storage = vi.fn(ok);

        await checkReadiness({
            probes: { database: ok, storage },
            storageConfigured: false,
        });

        expect(storage).not.toHaveBeenCalled();
    });

    it("puts the failure reason in the log and not in the report", async () => {
        // The endpoint is unauthenticated by necessity, so the body must carry
        // booleans only.
        const error = quiet();

        const report = await checkReadiness({
            probes: {
                database: () => Promise.reject(new Error("postgres://u:pw@h/db unreachable")),
                storage: ok,
            },
            storageConfigured: true,
        });

        expect(JSON.stringify(report)).not.toContain("unreachable");
        expect(JSON.stringify(report)).not.toContain("pw");
        expect(error).toHaveBeenCalled();
        expect(String(error.mock.calls[0]?.[0])).toContain("readiness");
    });

    it("times each check", async () => {
        const report = await checkReadiness({
            probes: { database: ok },
            storageConfigured: false,
        });

        expect(byName(report).database.durationMs).toBeGreaterThanOrEqual(0);
    });
});
