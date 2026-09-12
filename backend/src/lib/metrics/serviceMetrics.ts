/**
 * The metrics ticket 2086 asks for, across its three named areas: request
 * rate, latency and error rate per route; queue depth, job duration and
 * failure rate; model provider latency, errors and token consumption.
 *
 * Each is recorded at a chokepoint that already exists, so no call site had to
 * be hunted down:
 *
 *   HTTP      `requestLog`'s emit, which already computes route, status and
 *             duration for the log line.
 *   Jobs      `processClaimedJob`, the one function every db_jobs job passes
 *             through on success, retry and permanent failure alike.
 *   Provider  the adapter in `lib/llm/aiSdk.ts`, which is where the model call
 *             is made and where usage was previously discarded.
 *
 * Queue depth is a gauge rather than a counter because it is a property of a
 * table, not of this process: two API tasks each counting it would report
 * double the real backlog.
 */

import { Counter, Gauge, Histogram, Registry } from "./registry";

export const registry = new Registry();

/**
 * Latency buckets, in seconds, matching Prometheus convention.
 *
 * HTTP is bucketed tightly at the low end because that is where a regression
 * is visible; jobs are bucketed out to ten minutes because a LibreOffice
 * conversion legitimately takes minutes and its wall-clock budget is fifteen.
 */
const HTTP_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;
const JOB_BUCKETS = [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 600] as const;
const PROVIDER_BUCKETS = [0.25, 0.5, 1, 2.5, 5, 10, 20, 30, 60, 120] as const;

// --- HTTP -----------------------------------------------------------------

export const httpRequests = registry.register(
    new Counter(
        "http_requests_total",
        "HTTP requests by method, matched route pattern and status code.",
        ["method", "route", "status"],
    ),
);

export const httpDuration = registry.register(
    new Histogram(
        "http_request_duration_seconds",
        "HTTP request duration by method and matched route pattern.",
        ["method", "route"],
        HTTP_BUCKETS,
    ),
);

/**
 * The label discipline that keeps cardinality bounded.
 *
 * `buildRequestLogLine` records the raw (redacted) path when Express matched
 * no route, which is right for a log line and wrong for a metric label: the
 * values are attacker-controlled, and each distinct one is a series retained
 * for the life of the process. A scanner would mint one per request.
 *
 * A matched route pattern always contains a parameter placeholder or is a
 * literal mount that exists in the code, so the set is closed. Anything else
 * collapses to a single `<unmatched>` series — which still answers the
 * question an operator actually asks of it ("are we serving a lot of 404s?")
 * without letting the asker choose the label.
 */
export function safeRouteLabel(route: string, matched: boolean): string {
    return matched ? route : "<unmatched>";
}

export function recordHttpRequest(input: {
    method: string;
    route: string;
    matched: boolean;
    status: number;
    durationMs: number;
}): void {
    const route = safeRouteLabel(input.route, input.matched);
    httpRequests.inc([input.method, route, String(input.status)]);
    httpDuration.observe(input.durationMs / 1000, [input.method, route]);
}

// --- Background jobs ------------------------------------------------------

export type JobOutcome = "done" | "retry" | "failed" | "unknown_kind";

export const jobOutcomes = registry.register(
    new Counter(
        "job_outcomes_total",
        "Background job terminations by kind and outcome. 'retry' is a failed attempt that will run again; 'failed' is one that has exhausted its attempts.",
        ["kind", "outcome"],
    ),
);

export const jobDuration = registry.register(
    new Histogram(
        "job_duration_seconds",
        "Wall-clock duration of one background job attempt, by kind.",
        ["kind"],
        JOB_BUCKETS,
    ),
);

export function recordJobOutcome(
    kind: string,
    outcome: JobOutcome,
    durationMs: number,
): void {
    jobOutcomes.inc([kind, outcome]);
    jobDuration.observe(durationMs / 1000, [kind]);
}

// --- Model provider -------------------------------------------------------

export const providerCalls = registry.register(
    new Counter(
        "llm_calls_total",
        "Model provider calls by provider, model and outcome.",
        ["provider", "model", "outcome"],
    ),
);

export const providerDuration = registry.register(
    new Histogram(
        "llm_call_duration_seconds",
        "Model provider call duration by provider and model. For a stream this is measured to the end of the stream, not to first token.",
        ["provider", "model"],
        PROVIDER_BUCKETS,
    ),
);

export const providerTokens = registry.register(
    new Counter(
        "llm_tokens_total",
        "Tokens reported by the provider, by provider, model and direction.",
        ["provider", "model", "direction"],
    ),
);

export function recordProviderCall(input: {
    provider: string;
    model: string;
    outcome: "ok" | "error";
    durationMs: number;
}): void {
    providerCalls.inc([input.provider, input.model, input.outcome]);
    providerDuration.observe(input.durationMs / 1000, [
        input.provider,
        input.model,
    ]);
}

/**
 * Token counts, when the provider reported them.
 *
 * Every field is optional because the AI SDK's usage object is: a provider
 * that does not report usage, or a stream that aborted before the final
 * message, leaves it partly or wholly undefined. Recording a missing count as
 * zero would quietly understate spend, so an absent figure records nothing.
 */
export function recordProviderTokens(input: {
    provider: string;
    model: string;
    inputTokens?: number;
    outputTokens?: number;
}): void {
    const add = (direction: string, value: number | undefined) => {
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
            return;
        }
        providerTokens.inc([input.provider, input.model, direction], value);
    };
    add("input", input.inputTokens);
    add("output", input.outputTokens);
}

// --- Logged failures ------------------------------------------------------

/**
 * One counter for every logged failure in the service, keyed by subsystem.
 *
 * Ticket 2087 names five silent paths to alert on — queue backlog, repeated
 * job failures, model provider errors, storage failures, migration failures —
 * and three of them already have a purpose-built metric above. Storage is the
 * awkward one: `lib/storage.ts` logs its failures and then returns `null`, so
 * the log line is the only signal a caller ever sees, and adding a counter
 * beside each `console.error` would mean editing an inherited file five times
 * for one number.
 *
 * The error-tracking bridge already passes every `console.error` in the
 * service, and already derives a `source` from the bracketed label the call
 * sites use — `[storage]`, `[dbq]`, `[worker-thread]`. Counting there gives
 * an alertable error rate for every subsystem at once, from one place, with
 * no further edits and none needed for a subsystem added later.
 *
 * The source label is bounded by construction: it comes from our own log
 * labels, matched as `[a-z0-9-]+`, never from a request. The registry's cap
 * sits behind that anyway.
 *
 * This counts independently of whether error tracking has a DSN. Metrics and
 * error reporting are separate concerns, and a deployment with no tracker
 * still needs to know its error rate.
 */
export const loggedErrors = registry.register(
    new Counter(
        "logged_errors_total",
        "Failures written to console.error, by subsystem, taken from the bracketed log label. For storage this is the only signal: those helpers log and then return null.",
        ["source"],
    ),
);

export function recordLoggedError(source: string): void {
    loggedErrors.inc([source]);
}

/**
 * Best-effort cleanup steps that failed.
 *
 * Separate from `logged_errors_total` because these are the failures the code
 * deliberately does NOT propagate: the operation that triggered them reports
 * success either way, by design. That makes this counter the only durable
 * record that anything went wrong, which is a different alerting question
 * from a generic error rate — a slow, quiet leak rather than a spike.
 */
export const storageCleanupFailures = registry.register(
    new Counter(
        "storage_cleanup_failures_total",
        "Best-effort storage cleanup steps that failed. These never fail the operation that triggered them, so this counter is the only lasting signal that they happened.",
        ["operation", "stage"],
    ),
);

export function recordStorageCleanupFailure(
    operation: string,
    stage: string,
    count = 1,
): void {
    storageCleanupFailures.inc([operation, stage], count);
}

// --- Queue depth ----------------------------------------------------------

/**
 * Reads pending and running job counts. Injected rather than imported so the
 * metrics layer does not reach for a database client, and so a test can
 * exercise the scrape without one.
 */
export type QueueDepthReader = () => Promise<Array<{ status: string; count: number }>>;

let queueDepthReader: QueueDepthReader | null = null;

/** Wired at boot by whichever process owns a database handle. */
export function setQueueDepthReader(reader: QueueDepthReader | null): void {
    queueDepthReader = reader;
}

registry.register(
    new Gauge(
        "job_queue_depth",
        "Jobs currently in the db_jobs queue, by status. Read at scrape time, because the queue belongs to the database rather than to any one process.",
        ["status"],
        async () => {
            if (!queueDepthReader) return [];
            const rows = await queueDepthReader();
            return rows.map((row) => ({
                labels: [row.status],
                value: row.count,
            }));
        },
    ),
);
