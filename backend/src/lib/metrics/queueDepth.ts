/**
 * Queue depth, read from the table rather than accumulated in a process.
 *
 * Backlog is the single most useful queue signal — a worker that has stopped
 * claiming shows up here before anything else notices — and it is the one
 * number a per-process counter cannot produce. `db_jobs` is shared by the API
 * process, the worker thread and any standalone worker; each of them counting
 * its own view would report a fraction, and a scrape summing across tasks
 * would report a multiple.
 *
 * So it is read at scrape time, with two head-count queries. `head: true`
 * means no rows cross the wire — the count comes back in the Content-Range
 * header — so this stays cheap enough to sit on a scrape interval.
 *
 * Only the two live statuses are counted. `done` and `failed` grow without
 * bound until the retention sweep runs, so counting them would turn a
 * backlog gauge into a slow-moving total that says nothing about now; job
 * terminations are already counted properly by `job_outcomes_total`.
 *
 * Copyright 2026 Fraser Matcham. Licensed under the GNU Affero General Public
 * License v3.0.
 */

import { createServerSupabase } from "../supabase";
import { setQueueDepthReader } from "./serviceMetrics";

/** The statuses a job can be in while it still represents outstanding work. */
export const LIVE_JOB_STATUSES = ["pending", "running"] as const;

/**
 * Ceiling on one depth read. A scrape must not outlive its own interval, and
 * a gauge that cannot be read is rendered empty rather than failing the whole
 * exposition — see Gauge.collect.
 */
export const QUEUE_DEPTH_TIMEOUT_MS = 2000;

type CountQuery = (status: string) => Promise<number>;

async function countByStatus(status: string): Promise<number> {
    const db = createServerSupabase();
    const { count, error } = await db
        .from("db_jobs")
        .select("id", { head: true, count: "exact" })
        .eq("status", status);
    if (error) throw new Error(error.message);
    return count ?? 0;
}

/**
 * Reads the live depths. Exported with an injectable query so a test can
 * exercise it without a database, and so the timeout is testable.
 */
export async function readQueueDepth(
    count: CountQuery = countByStatus,
    timeoutMs = QUEUE_DEPTH_TIMEOUT_MS,
): Promise<Array<{ status: string; count: number }>> {
    const withTimeout = <T,>(work: Promise<T>): Promise<T> =>
        Promise.race([
            work,
            new Promise<T>((_resolve, reject) => {
                const timer = setTimeout(
                    () => reject(new Error(`queue depth read exceeded ${timeoutMs}ms`)),
                    timeoutMs,
                );
                timer.unref?.();
            }),
        ]);

    const counts = await Promise.all(
        LIVE_JOB_STATUSES.map(async (status) => ({
            status,
            count: await withTimeout(count(status)),
        })),
    );
    return counts;
}

/**
 * Wires the reader in. Called by an entrypoint rather than at import, so that
 * importing the Express app in a unit test does not reach for a database
 * client that the test has no credentials for.
 */
export function installQueueDepthMetric(): void {
    setQueueDepthReader(() => readQueueDepth());
}
