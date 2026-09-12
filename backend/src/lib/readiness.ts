/**
 * Readiness: are this process's dependencies actually reachable?
 *
 * `/health` answers a different question — "is the process running?" — and it
 * must keep answering only that. Four things already depend on it being cheap
 * and unconditionally 200: the e2e workflow's `wait-on`, `playwright.config.ts`'s
 * webServer gate, `word-addin/scripts/dev.sh`, and its own integration test. A
 * load balancer pointed at it will happily keep routing traffic to an instance
 * that has lost its database, because the process is still very much alive.
 *
 * So this is a second, additive endpoint rather than a change to that one.
 *
 * Three properties matter more than thoroughness:
 *
 * - **Cheap.** A probe that costs real work becomes a self-inflicted load
 *   problem when the load balancer calls it every few seconds across every
 *   instance. The database probe returns no rows; the storage probe is a single
 *   HEAD for a key that does not exist.
 * - **Bounded.** A probe that hangs is worse than one that fails: the balancer
 *   learns nothing and the instance sits in limbo. Every check races a timeout.
 * - **Quiet.** The response carries check names and booleans, never an error
 *   message. Details go to the log, through the redaction helpers, because this
 *   endpoint is unauthenticated by necessity — the balancer cannot log in.
 *
 * Copyright 2026 Fraser Matcham. Licensed under the GNU Affero General Public
 * License v3.0.
 */

import { safeErrorForLog } from "./safeError";
import { createServerSupabase } from "./supabase";
import { headFile, storageEnabled } from "./storage";

export type CheckName = "database" | "storage";

export type ReadinessCheck = {
    name: CheckName;
    ok: boolean;
    durationMs: number;
    /** True when the dependency is deliberately not configured here. */
    skipped?: boolean;
};

export type ReadinessReport = {
    ready: boolean;
    checks: ReadinessCheck[];
};

/**
 * Long enough to absorb a slow but working dependency, short enough that the
 * balancer gets an answer within one interval.
 */
export const DEFAULT_PROBE_TIMEOUT_MS = 2000;

/** A probe resolves if the dependency answered, and rejects if it did not. */
export type Probe = () => Promise<void>;

export class ProbeTimeoutError extends Error {
    constructor(name: string, ms: number) {
        super(`${name} probe exceeded ${ms}ms`);
        this.name = "ProbeTimeoutError";
    }
}

/**
 * Reads no rows: `head: true` asks PostgREST for the response headers only.
 * The point is to prove the connection and credentials work, not to look at
 * anyone's data — which is also why a table under `data/` scoping rules is
 * safe to name here.
 */
const databaseProbe: Probe = async () => {
    const supabase = createServerSupabase();
    const { error } = await supabase
        .from("user_profiles")
        .select("id", { head: true })
        .limit(1);
    // supabase-js reports failures in the result rather than throwing.
    if (error) throw error;
};

/**
 * A HEAD for a key that will not exist. `headFile` returns null on a 404 and
 * throws on anything else, so a "not found" is exactly the answer we want: the
 * bucket was reachable and the credentials were accepted.
 */
const storageProbe: Probe = async () => {
    await headFile(`.readiness-probe/${Date.now()}`);
};

function withTimeout<T>(
    name: string,
    ms: number,
    work: Promise<T>,
): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ProbeTimeoutError(name, ms)), ms);
        // Do not hold the event loop open on the probe's account.
        timer.unref?.();
    });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

async function runCheck(
    name: CheckName,
    probe: Probe,
    timeoutMs: number,
): Promise<ReadinessCheck> {
    const started = Date.now();
    try {
        await withTimeout(name, timeoutMs, probe());
        return { name, ok: true, durationMs: Date.now() - started };
    } catch (error) {
        // The caller gets a boolean; the operator gets the reason, redacted.
        console.error(
            JSON.stringify({
                kind: "readiness",
                check: name,
                ok: false,
                error: safeErrorForLog(error),
            }),
        );
        return { name, ok: false, durationMs: Date.now() - started };
    }
}

/**
 * Runs every check and reports the lot.
 *
 * Checks run concurrently and none short-circuits: an operator looking at a
 * failing instance wants to know whether one dependency is down or all of
 * them, and stopping at the first failure hides that.
 */
export async function checkReadiness(options?: {
    timeoutMs?: number;
    probes?: Partial<Record<CheckName, Probe>>;
    storageConfigured?: boolean;
}): Promise<ReadinessReport> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    const probes = options?.probes ?? {};
    const hasStorage = options?.storageConfigured ?? storageEnabled;

    const checks: ReadinessCheck[] = [];

    const pending: Promise<ReadinessCheck>[] = [
        runCheck("database", probes.database ?? databaseProbe, timeoutMs),
    ];

    if (hasStorage) {
        pending.push(
            runCheck("storage", probes.storage ?? storageProbe, timeoutMs),
        );
    }

    checks.push(...(await Promise.all(pending)));

    // Storage that was never configured is not a failure: the local stack and
    // the e2e run legitimately have none, and reporting those as unready would
    // make the endpoint useless exactly where it is first exercised. It is
    // reported as skipped so the omission stays visible rather than looking
    // like a passing check.
    if (!hasStorage) {
        checks.push({
            name: "storage",
            ok: true,
            durationMs: 0,
            skipped: true,
        });
    }

    return { ready: checks.every((check) => check.ok), checks };
}
