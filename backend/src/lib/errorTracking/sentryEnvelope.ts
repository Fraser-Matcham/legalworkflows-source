/**
 * Sentry's wire protocol, spoken directly. No SDK.
 *
 * `@sentry/node` is deliberately not a dependency here, and the reason is the
 * whole point of ticket 2084. Its value proposition is automatic capture: it
 * patches the HTTP layer, the global rejection handlers and the Express error
 * middleware, and it serialises the thrown object's own properties. That is
 * exactly the behaviour this service must not have. A provider SDK error
 * carries the outgoing request on `error.request` — and that request body is
 * the prompt, which is a client's document. An integration that captures it
 * "helpfully" defeats `safeError.ts` completely, and it does so invisibly,
 * because nothing in the code says the capture is happening.
 *
 * So the transport is ~60 lines instead: parse the DSN, build the event from a
 * value that has ALREADY been through `safeErrorForLog`, and POST it. There is
 * no code path here that can see an unredacted value, because the module never
 * receives one. That property is what makes the ticket's acceptance criterion
 * — "stack traces intact and sensitive values removed" — checkable rather than
 * a matter of trusting a third party's defaults.
 *
 * It is also 0 bytes of new supply chain, on a service whose dependency audit
 * gates the build.
 */

import type { SafeError } from "../safeError";

/** The pieces of a DSN needed to address the ingest endpoint. */
export interface SentryDsn {
    /** Public key. Not a secret — it is designed to ship in browser bundles. */
    publicKey: string;
    projectId: string;
    /** Absolute URL of the envelope endpoint for this project. */
    envelopeUrl: string;
}

/**
 * Parses `https://<publicKey>@<host>/<path>/<projectId>`.
 *
 * Returns null rather than throwing: a malformed DSN must degrade to "error
 * tracking off", never to "the process does not boot". Losing telemetry is an
 * incident; refusing to serve because telemetry is misconfigured is a worse
 * one.
 */
export function parseSentryDsn(dsn: string): SentryDsn | null {
    let url: URL;
    try {
        url = new URL(dsn.trim());
    } catch {
        return null;
    }

    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const publicKey = url.username;
    if (!publicKey) return null;

    // The project id is the last path segment; anything before it is a path
    // prefix, which self-hosted Sentry behind a subpath uses.
    const segments = url.pathname.split("/").filter(Boolean);
    const projectId = segments.pop();
    if (!projectId || !/^\d+$/.test(projectId)) return null;

    const prefix = segments.length > 0 ? `/${segments.join("/")}` : "";
    return {
        publicKey,
        projectId,
        envelopeUrl: `${url.protocol}//${url.host}${prefix}/api/${projectId}/envelope/`,
    };
}

/** The `X-Sentry-Auth` header value for this DSN. */
export function sentryAuthHeader(dsn: SentryDsn): string {
    return [
        "Sentry sentry_version=7",
        "sentry_client=legalworkflows-direct/1.0",
        `sentry_key=${dsn.publicKey}`,
    ].join(", ");
}

/**
 * One frame of a stack, as Sentry models it.
 *
 * Everything here is derived from the redacted stack string, so a frame can
 * carry no more than that string already did.
 */
interface SentryFrame {
    filename?: string;
    function?: string;
    lineno?: number;
    colno?: number;
}

const FRAME_WITH_FUNCTION = /^\s*at\s+(.+?)\s+\((.*?)(?::(\d+):(\d+))?\)\s*$/;
const FRAME_BARE = /^\s*at\s+(.*?)(?::(\d+):(\d+))?\s*$/;

/**
 * Turns a redacted stack string back into structured frames.
 *
 * The string has already been truncated to 12 frames and redacted by
 * `safeStack`, so this parses whatever survived. A line it cannot parse is
 * dropped rather than passed through as a filename, because an unparsed line
 * is the one most likely to be the message rather than a frame.
 *
 * Sentry renders frames innermost-last, the reverse of V8's order.
 */
export function parseStackFrames(stack: string | undefined): SentryFrame[] {
    if (!stack) return [];
    const frames: SentryFrame[] = [];
    for (const line of stack.split("\n")) {
        if (!/^\s*at\s/.test(line)) continue;
        const withFunction = FRAME_WITH_FUNCTION.exec(line);
        if (withFunction) {
            frames.push({
                function: withFunction[1],
                filename: withFunction[2],
                lineno: withFunction[3] ? Number(withFunction[3]) : undefined,
                colno: withFunction[4] ? Number(withFunction[4]) : undefined,
            });
            continue;
        }
        const bare = FRAME_BARE.exec(line);
        if (bare && bare[1]) {
            frames.push({
                filename: bare[1],
                lineno: bare[2] ? Number(bare[2]) : undefined,
                colno: bare[3] ? Number(bare[3]) : undefined,
            });
        }
    }
    return frames.reverse();
}

/** Context attached to an event. Every field is already safe to log. */
export interface ErrorEventContext {
    /** Where the failure was noticed, e.g. "http", "worker", "unhandled". */
    source: string;
    environment: string;
    release?: string;
    serverName?: string;
    /** Ties the event to the request log line. */
    requestId?: string | null;
    /** The authenticated user's uuid. Never an email address — see below. */
    userId?: string | null;
    /** Redacted route pattern and method, when the failure was an HTTP one. */
    method?: string;
    route?: string;
    /** Arbitrary already-redacted extras. */
    extra?: Record<string, unknown>;
}

/**
 * Builds the Sentry event from an ALREADY-REDACTED error.
 *
 * The parameter type is `SafeError`, not `unknown`, and that is the design.
 * The type system, not a code review, is what stops a raw thrown value
 * reaching the wire: there is no overload here that accepts one.
 *
 * `user` carries the uuid alone. The audit trail records email addresses
 * deliberately; a third-party error tracker is a different kind of store with
 * a different set of readers, and it gets the identifier that
 * `docs/observability.md` already says to start from.
 */
export function buildSentryEvent(
    error: SafeError,
    context: ErrorEventContext,
    now: Date = new Date(),
): Record<string, unknown> {
    const values: Array<Record<string, unknown>> = [];
    for (let cause: SafeError | undefined = error; cause; cause = cause.cause) {
        values.push({
            type: cause.name,
            value: cause.message,
            stacktrace: { frames: parseStackFrames(cause.stack) },
            mechanism: { type: context.source, handled: context.source !== "unhandled" },
        });
    }
    // Sentry renders the last entry as the outermost exception, so a cause
    // chain reads root-first the way `error.cause` is written.
    values.reverse();

    const tags: Record<string, string> = { source: context.source };
    if (context.route) tags.route = context.route;
    if (context.method) tags.method = context.method;
    if (error.status !== undefined) tags.status = String(error.status);
    if (error.code !== undefined) tags.code = error.code;

    return {
        event_id: randomEventId(),
        timestamp: now.toISOString(),
        platform: "node",
        level: "error",
        logger: context.source,
        environment: context.environment,
        ...(context.release ? { release: context.release } : {}),
        ...(context.serverName ? { server_name: context.serverName } : {}),
        exception: { values },
        tags,
        ...(context.userId ? { user: { id: context.userId } } : {}),
        extra: {
            ...(context.requestId ? { request_id: context.requestId } : {}),
            ...(context.extra ?? {}),
        },
    };
}

/** Sentry wants 32 lowercase hex characters, with no dashes. */
function randomEventId(): string {
    return globalThis.crypto.randomUUID().replace(/-/g, "");
}

/**
 * Serialises one event as an envelope: a header line, an item header line,
 * and the payload, newline-delimited.
 */
export function encodeEnvelope(event: Record<string, unknown>): string {
    const payload = JSON.stringify(event);
    const header = JSON.stringify({
        event_id: event.event_id,
        sent_at: new Date().toISOString(),
    });
    const itemHeader = JSON.stringify({
        type: "event",
        length: Buffer.byteLength(payload),
        content_type: "application/json",
    });
    return `${header}\n${itemHeader}\n${payload}\n`;
}
