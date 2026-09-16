/**
 * Error tracking, retrofitted onto a codebase that already logs its failures.
 *
 * Two problems had to be solved together.
 *
 * **Redaction.** An error tracker that captures raw exception payloads would
 * defeat every protection in `safeError.ts` — see the header of
 * `sentryEnvelope.ts` for why no SDK is used. Nothing here can reach the wire
 * without going through `safeErrorForLog` first, and the transport's own
 * signature refuses anything else.
 *
 * **Coverage.** There are around 180 `console.error` call sites across
 * `backend/src`, nearly all of them in files inherited from upstream. Editing
 * each one to add a `reportError()` beside it would be 180 future merge
 * conflicts for no behavioural gain, which AGENTS.md rule 3 rules out. So the
 * retrofit happens at the sink instead: one bridge over `console.error`
 * captures every existing site at once, and a new site added by an upstream
 * merge is captured the day it lands, without anyone remembering to wire it.
 *
 * The bridge calls the original first and the reporting that follows cannot
 * throw. What it prints is reduced by the same helpers that guard the wire —
 * see `printable` below for why that is worth the change in output.
 *
 * ## What this closes that nothing else did
 *
 * `process.on("unhandledRejection")` was not registered anywhere in this
 * service. Node's default printer for an unhandled rejection dumps the thrown
 * object with `util.inspect`, which walks its own enumerable properties —
 * and a provider SDK error carries the outgoing request on `error.request`.
 * Measured on Node 22 against an error shaped like one of Anthropic's:
 *
 *     Error: Incorrect API key provided: sk-ant-CANARYKEY…   <- the key
 *       …
 *       request: { body: { prompt: 'PRIVILEGED CLIENT DOCUMENT TEXT' } }
 *
 * Both lines go to stdout, unredacted, whatever `safeError.ts` says, because
 * no code of ours is on that path. Registering the handlers below puts the
 * redaction helpers in front of it. That is worth doing even for a deployment
 * that never configures a DSN, which is why the handlers install
 * unconditionally and only the *sending* is gated on configuration.
 */

import { recordLoggedError } from "../metrics/serviceMetrics";
import {
    safeErrorForLog,
    safeLogString,
    safeLogValue,
    type SafeError,
} from "../safeError";
import {
    buildSentryEvent,
    encodeEnvelope,
    parseSentryDsn,
    sentryAuthHeader,
    type ErrorEventContext,
    type SentryDsn,
} from "./sentryEnvelope";

export interface ErrorTrackingConfiguration {
    /** False when no usable DSN is configured. Events are then dropped. */
    enabled: boolean;
    dsn: SentryDsn | null;
    environment: string;
    release?: string;
    serverName?: string;
    /** Ceiling on events sent per minute. A failure loop must not flood. */
    maxEventsPerMinute: number;
}

/**
 * Reads configuration without validating it loudly.
 *
 * A malformed DSN disables tracking and says so once on stderr. It does not
 * join `validateRuntimeConfiguration`'s boot gate: refusing to serve because
 * the telemetry endpoint is misspelled would turn a monitoring gap into an
 * outage.
 */
export function errorTrackingConfiguration(
    env: NodeJS.ProcessEnv = process.env,
): ErrorTrackingConfiguration {
    const raw = env.ERROR_TRACKING_DSN?.trim() ?? "";
    const environment =
        env.ERROR_TRACKING_ENVIRONMENT?.trim() ||
        env.NODE_ENV?.trim() ||
        "development";
    const release = env.ERROR_TRACKING_RELEASE?.trim() || undefined;
    const serverName = env.ERROR_TRACKING_SERVER_NAME?.trim() || undefined;

    const parsedMax = Number.parseInt(
        env.ERROR_TRACKING_MAX_EVENTS_PER_MINUTE ?? "",
        10,
    );
    const maxEventsPerMinute =
        Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : 60;

    if (!raw) {
        return {
            enabled: false,
            dsn: null,
            environment,
            release,
            serverName,
            maxEventsPerMinute,
        };
    }

    const dsn = parseSentryDsn(raw);
    return {
        enabled: dsn !== null,
        dsn,
        environment,
        release,
        serverName,
        maxEventsPerMinute,
    };
}

/** Send function, injectable so tests never touch the network. */
export type EnvelopeSender = (
    url: string,
    body: string,
    headers: Record<string, string>,
) => Promise<void>;

const defaultSender: EnvelopeSender = async (url, body, headers) => {
    // 5 seconds: long enough for a slow ingest, short enough that a wedged
    // endpoint cannot pin a worker slot. The result is discarded — a rejected
    // telemetry POST is not an application failure.
    await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(5_000),
    });
};

interface ReporterState {
    config: ErrorTrackingConfiguration;
    send: EnvelopeSender;
    /** Token bucket, refilled per minute. */
    windowStartedAt: number;
    sentInWindow: number;
    droppedInWindow: number;
    /** Guards the console bridge against reporting its own failures. */
    reporting: boolean;
}

let state: ReporterState | null = null;
let processHandlersInstalled = false;

/** Test seam: the number of events dropped by the rate limit this window. */
export function errorTrackingStats(): {
    enabled: boolean;
    sentInWindow: number;
    droppedInWindow: number;
} {
    return {
        enabled: state?.config.enabled ?? false,
        sentInWindow: state?.sentInWindow ?? 0,
        droppedInWindow: state?.droppedInWindow ?? 0,
    };
}

function withinRateLimit(now: number): boolean {
    if (!state) return false;
    if (now - state.windowStartedAt >= 60_000) {
        // Report suppression once per window, so an operator can tell "quiet"
        // from "throttled" without reading this file.
        if (state.droppedInWindow > 0) {
            console.warn(
                `[error-tracking] rate limit dropped ${state.droppedInWindow} events in the last minute`,
            );
        }
        state.windowStartedAt = now;
        state.sentInWindow = 0;
        state.droppedInWindow = 0;
    }
    if (state.sentInWindow >= state.config.maxEventsPerMinute) {
        state.droppedInWindow += 1;
        return false;
    }
    state.sentInWindow += 1;
    return true;
}

/**
 * Reports a failure. Redacts first, always; never throws; no-op when no DSN
 * is configured.
 *
 * `error` is `unknown` because callers throw anything, but the value is put
 * through `safeErrorForLog` on the very next line and the raw value is not
 * referenced again.
 */
export function reportError(
    error: unknown,
    context: Partial<ErrorEventContext> & { source: string },
): void {
    if (!state || !state.config.enabled || !state.config.dsn) return;
    if (!withinRateLimit(Date.now())) return;

    const safe: SafeError = safeErrorForLog(error);
    void deliver(safe, context);
}

async function deliver(
    safe: SafeError,
    context: Partial<ErrorEventContext> & { source: string },
): Promise<void> {
    const current = state;
    if (!current || !current.config.dsn) return;
    try {
        const event = buildSentryEvent(safe, {
            ...context,
            environment: context.environment ?? current.config.environment,
            release: context.release ?? current.config.release,
            serverName: context.serverName ?? current.config.serverName,
        });
        await current.send(
            current.config.dsn.envelopeUrl,
            encodeEnvelope(event),
            {
                "Content-Type": "application/x-sentry-envelope",
                "X-Sentry-Auth": sentryAuthHeader(current.config.dsn),
            },
        );
    } catch (sendFailure) {
        // Deliberately the original console.error, not the bridged one: a
        // tracker that reports its own delivery failures to itself loops.
        const original = originalConsoleError ?? console.error;
        original.call(
            console,
            "[error-tracking] delivery failed",
            safeErrorForLog(sendFailure),
        );
    }
}

let originalConsoleError: typeof console.error | null = null;

/** Tag in a log label, e.g. "[http/internal-error]" -> "http". */
const LABEL_TAG = /^\[([a-z0-9-]+)[/\]]/i;

function sourceFromArgs(args: unknown[]): string {
    const first = args[0];
    if (typeof first === "string") {
        const match = LABEL_TAG.exec(first);
        if (match) return match[1].toLowerCase();
    }
    return "console";
}

function looksLikeError(value: unknown): boolean {
    if (value instanceof Error) return true;
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as Record<string, unknown>;
    return (
        typeof candidate.message === "string" &&
        (typeof candidate.name === "string" || typeof candidate.stack === "string")
    );
}

/**
 * What the bridge prints, reduced by the same helpers that guard the wire.
 *
 * The bridge used to call the original with the raw arguments, on the
 * principle that a retrofit should not change what a call site prints. That
 * principle cost more than it was worth. The leak this module's header
 * describes for unhandled rejections — a provider SDK error carrying the
 * outgoing request on `error.request`, i.e. the prompt, i.e. the client's
 * document, plus the key in the message — reaches stdout identically through
 * a deliberate `console.error(label, err)`. There are such call sites on the
 * product's hot path (`lib/chat/streaming.ts` logs a failed model stream this
 * way), and stdout is CloudWatch, which the deploy role can read.
 *
 * Measured before this change, against an error shaped like Anthropic's:
 * the key and the document text reached stdout through the bridge, and did
 * not through `handleUnhandledRejection`. Redaction was wired to one path and
 * not the other.
 *
 * `safeErrorForLog` copies named fields only, so `request` and `response` are
 * dropped rather than walked. It keeps name, message, stack, status and code,
 * which is what a person debugging actually reads — so the stack is put back
 * as text here instead of printing a `SafeError` object literal.
 */
function printable(arg: unknown): unknown {
    if (arg instanceof Error || looksLikeError(arg)) {
        const safe = safeErrorForLog(arg);
        const head = safe.stack ?? `${safe.name}: ${safe.message}`;
        const tail = [
            safe.status === undefined ? null : `status=${safe.status}`,
            safe.code ? `code=${safe.code}` : null,
        ]
            .filter(Boolean)
            .join(" ");
        return tail ? `${head}\n  ${tail}` : head;
    }
    return safeLogValue(arg);
}

/** Never throws: a bridge that can throw turns every logged error into a crash. */
function printableArgs(args: unknown[]): unknown[] {
    try {
        return args.map(printable);
    } catch {
        return ["[error-tracking] a log argument could not be reduced for printing"];
    }
}

/**
 * Picks the error out of a `console.error(label, detail)` call.
 *
 * Existing call sites take three shapes: a bare Error, a label plus an Error,
 * and a label plus a context object with the error under `error` (which is
 * what `sendInternalError` does, already reduced by `safeErrorForLog`).
 * Re-reducing an already-reduced SafeError is a no-op, so the third shape
 * needs no special case beyond finding it.
 */
function extractError(args: unknown[]): { error: unknown; rest: unknown[] } {
    const rest: unknown[] = [];
    let found: unknown;
    for (const arg of args) {
        if (found === undefined && looksLikeError(arg)) {
            found = arg;
            continue;
        }
        if (
            found === undefined &&
            typeof arg === "object" &&
            arg !== null &&
            looksLikeError((arg as Record<string, unknown>).error)
        ) {
            found = (arg as Record<string, unknown>).error;
            rest.push(arg);
            continue;
        }
        rest.push(arg);
    }
    return { error: found, rest };
}

function contextFromArgs(rest: unknown[]): {
    requestId?: string | null;
    userId?: string | null;
    method?: string;
    route?: string;
    extra: Record<string, unknown>;
} {
    const extra: Record<string, unknown> = {};
    let requestId: string | null | undefined;
    let userId: string | null | undefined;
    let method: string | undefined;
    let route: string | undefined;

    for (const arg of rest) {
        if (typeof arg === "string") {
            extra.message = safeLogString(arg);
            continue;
        }
        if (typeof arg !== "object" || arg === null) continue;
        const record = arg as Record<string, unknown>;
        if (typeof record.requestId === "string") requestId = record.requestId;
        if (typeof record.userId === "string") userId = record.userId;
        if (typeof record.method === "string") method = record.method;
        // `sendInternalError` logs the redacted path under `path`.
        const candidateRoute = record.route ?? record.path;
        if (typeof candidateRoute === "string") route = candidateRoute;
        for (const [key, value] of Object.entries(record)) {
            if (key === "error") continue;
            extra[key] = safeLogValue(value);
        }
    }
    return { requestId, userId, method, route, extra };
}

/**
 * Bridges `console.error` into the reporter, and registers the global
 * failure handlers.
 *
 * Idempotent: calling it twice does not stack two bridges, which matters
 * because the API process, the worker thread and the standalone worker each
 * call it and two of those can share a process.
 */
export function installErrorTracking(
    options: {
        env?: NodeJS.ProcessEnv;
        send?: EnvelopeSender;
        /**
         * Off in tests. A registered `uncaughtException` handler that calls
         * `process.exit(1)` would take the test runner with it.
         */
        globalHandlers?: boolean;
    } = {},
): () => void {
    uninstallErrorTracking();

    const config = errorTrackingConfiguration(options.env ?? process.env);
    state = {
        config,
        send: options.send ?? defaultSender,
        windowStartedAt: Date.now(),
        sentInWindow: 0,
        droppedInWindow: 0,
        reporting: false,
    };

    if (options.env?.ERROR_TRACKING_DSN?.trim() && !config.enabled) {
        console.warn(
            "[error-tracking] ERROR_TRACKING_DSN is set but could not be parsed; error tracking is off",
        );
    }

    const original = console.error.bind(console);
    originalConsoleError = original;
    console.error = (...args: unknown[]) => {
        original(...printableArgs(args));
        if (!state || state.reporting) return;
        state.reporting = true;
        try {
            const { error, rest } = extractError(args);
            const source = sourceFromArgs(args);
            // Before the reporting, and deliberately not inside it: the
            // counter is a metric, and a deployment with no DSN still needs
            // its error rate. See loggedErrors in lib/metrics.
            recordLoggedError(source);
            const context = contextFromArgs(rest);
            reportError(
                error ??
                    new Error(
                        args
                            .filter((arg) => typeof arg === "string")
                            .join(" ") || "console.error",
                    ),
                { source, ...context },
            );
        } catch {
            // A bridge that can throw turns every logged error into a crash.
        } finally {
            state.reporting = false;
        }
    };

    if (options.globalHandlers !== false) installProcessHandlers();

    return uninstallErrorTracking;
}

/**
 * Handlers for the two failures that otherwise bypass every helper in this
 * repository. Installed once per process, and never removed: an uninstall
 * that left them off would silently restore the raw dump.
 */
function installProcessHandlers(): void {
    if (processHandlersInstalled) return;
    processHandlersInstalled = true;

    process.on("unhandledRejection", handleUnhandledRejection);
    process.on("uncaughtException", handleUncaughtException);
}

/**
 * Both handlers are exported so the redaction can be tested without
 * registering anything that would call `process.exit` under the test runner.
 *
 * They deliberately keep the process's existing life-cycle. Node's default
 * for an unhandled rejection has been `--unhandled-rejections=throw` since
 * v15: it escalates to an uncaught exception and the process exits 1.
 * Registering a handler suppresses that escalation entirely — so a handler
 * that only logged would quietly convert "this service crashes and restarts"
 * into "this service carries on in an unknown state". That is a resilience
 * decision with real operational consequences, and it is not one that
 * redacting a log line should make on an operator's behalf. So both handlers
 * exit 1, exactly as the process did before, and the only thing that changed
 * is what gets printed on the way out.
 */
export function handleUnhandledRejection(reason: unknown): void {
    // console.error is the bridged one by now, so this both prints a redacted
    // line and reports the event, in one call.
    console.error("[unhandled/rejection]", { error: safeErrorForLog(reason) });
    exitAfterFlush();
}

export function handleUncaughtException(error: unknown): void {
    console.error("[unhandled/exception]", { error: safeErrorForLog(error) });
    exitAfterFlush();
}

/**
 * Exits 1, but not on this tick: the envelope POST is in flight and the
 * redacted line has not necessarily reached a shipper. 100ms is not a
 * guarantee, it is the difference between usually having the diagnostic and
 * never having it.
 */
function exitAfterFlush(): void {
    setTimeout(() => process.exit(1), 100).unref();
}

/** Restores the real `console.error`. Used by tests and by re-installation. */
export function uninstallErrorTracking(): void {
    if (originalConsoleError) {
        console.error = originalConsoleError;
        originalConsoleError = null;
    }
    state = null;
}
