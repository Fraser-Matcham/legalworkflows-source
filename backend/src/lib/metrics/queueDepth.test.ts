import { describe, expect, it, vi } from "vitest";
import { LIVE_JOB_STATUSES, readQueueDepth } from "./queueDepth";

describe("readQueueDepth", () => {
    it("counts only the statuses that represent outstanding work", () => {
        // done and failed grow without bound until the retention sweep runs,
        // so counting them would turn a backlog gauge into a slow-moving total
        // that says nothing about now.
        expect([...LIVE_JOB_STATUSES]).toEqual(["pending", "running"]);
    });

    it("returns one entry per live status", async () => {
        const counts: Record<string, number> = { pending: 7, running: 2 };

        const depth = await readQueueDepth(async (status) => counts[status]);

        expect(depth).toEqual([
            { status: "pending", count: 7 },
            { status: "running", count: 2 },
        ]);
    });

    it("rejects rather than hanging when the query never answers", async () => {
        // A scrape must not outlive its own interval. Gauge.collect turns this
        // rejection into an empty gauge rather than a failed exposition.
        vi.useFakeTimers();
        const pending = readQueueDepth(() => new Promise<number>(() => {}), 50);
        const assertion = expect(pending).rejects.toThrow(/exceeded 50ms/);

        await vi.advanceTimersByTimeAsync(60);
        await assertion;
        vi.useRealTimers();
    });

    it("propagates a query failure so the gauge renders empty", async () => {
        await expect(
            readQueueDepth(async () => {
                throw new Error("database unreachable");
            }),
        ).rejects.toThrow("database unreachable");
    });
});
