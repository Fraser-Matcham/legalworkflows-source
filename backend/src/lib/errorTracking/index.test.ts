import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loggedErrors } from "../metrics/serviceMetrics";
import {
    errorTrackingConfiguration,
    handleUncaughtException,
    handleUnhandledRejection,
    installErrorTracking,
    reportError,
    uninstallErrorTracking,
    type EnvelopeSender,
} from "./index";

const DSN = "https://publickey@o1.ingest.sentry.io/4507";

interface Sent {
    url: string;
    body: string;
    headers: Record<string, string>;
}

function recorder(): { sent: Sent[]; send: EnvelopeSender } {
    const sent: Sent[] = [];
    const send: EnvelopeSender = async (url, body, headers) => {
        sent.push({ url, body, headers });
    };
    return { sent, send };
}

/** The event object out of the middle of an envelope. */
function eventOf(entry: Sent): Record<string, any> {
    return JSON.parse(entry.body.split("\n")[2]);
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    // Silences the pass-through print. The bridge wraps whatever console.error
    // is at install time, so the spy must be in place first.
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    uninstallErrorTracking();
    vi.restoreAllMocks();
});

describe("errorTrackingConfiguration", () => {
    it("is disabled when no DSN is set", () => {
        const config = errorTrackingConfiguration({ NODE_ENV: "production" });

        expect(config.enabled).toBe(false);
        expect(config.dsn).toBeNull();
        expect(config.environment).toBe("production");
    });

    it("is disabled, not fatal, when the DSN is malformed", () => {
        const config = errorTrackingConfiguration({ ERROR_TRACKING_DSN: "nope" });

        expect(config.enabled).toBe(false);
    });

    it("reads environment, release and server name", () => {
        const config = errorTrackingConfiguration({
            ERROR_TRACKING_DSN: DSN,
            ERROR_TRACKING_ENVIRONMENT: "staging",
            ERROR_TRACKING_RELEASE: "abc1234",
            ERROR_TRACKING_SERVER_NAME: "api-1",
        });

        expect(config.enabled).toBe(true);
        expect(config.environment).toBe("staging");
        expect(config.release).toBe("abc1234");
        expect(config.serverName).toBe("api-1");
    });

    it("defaults and floors the rate limit", () => {
        expect(
            errorTrackingConfiguration({ ERROR_TRACKING_DSN: DSN })
                .maxEventsPerMinute,
        ).toBe(60);
        expect(
            errorTrackingConfiguration({
                ERROR_TRACKING_DSN: DSN,
                ERROR_TRACKING_MAX_EVENTS_PER_MINUTE: "0",
            }).maxEventsPerMinute,
        ).toBe(60);
        expect(
            errorTrackingConfiguration({
                ERROR_TRACKING_DSN: DSN,
                ERROR_TRACKING_MAX_EVENTS_PER_MINUTE: "5",
            }).maxEventsPerMinute,
        ).toBe(5);
    });
});

describe("reportError", () => {
    it("sends nothing at all when tracking is not configured", async () => {
        const { sent, send } = recorder();
        installErrorTracking({ env: {}, send, globalHandlers: false });

        reportError(new Error("boom"), { source: "test" });
        await vi.waitFor(() => expect(consoleErrorSpy).toHaveBeenCalledTimes(0));

        expect(sent).toHaveLength(0);
    });

    it("posts an envelope to the DSN's ingest endpoint", async () => {
        const { sent, send } = recorder();
        installErrorTracking({
            env: { ERROR_TRACKING_DSN: DSN, NODE_ENV: "production" },
            send,
            globalHandlers: false,
        });

        reportError(new Error("boom"), { source: "test" });
        await vi.waitFor(() => expect(sent).toHaveLength(1));

        expect(sent[0].url).toBe("https://o1.ingest.sentry.io/api/4507/envelope/");
        expect(sent[0].headers["X-Sentry-Auth"]).toContain("sentry_key=publickey");
        expect(sent[0].headers["Content-Type"]).toBe(
            "application/x-sentry-envelope",
        );
        expect(eventOf(sent[0]).environment).toBe("production");
    });

    it("keeps the stack while removing the secrets in it", async () => {
        // The acceptance criterion for ticket 2084, asserted directly.
        const { sent, send } = recorder();
        installErrorTracking({
            env: { ERROR_TRACKING_DSN: DSN },
            send,
            globalHandlers: false,
        });

        const error = new Error(
            "Incorrect API key provided: sk-ant-CANARYKEYVALUE1234567890",
        );

        reportError(error, { source: "test" });
        await vi.waitFor(() => expect(sent).toHaveLength(1));

        const event = eventOf(sent[0]);
        expect(sent[0].body).not.toContain("CANARYKEYVALUE1234567890");
        expect(event.exception.values[0].value).toContain("[redacted]");
        // Intact, not merely present: the frame that threw is still nameable.
        expect(event.exception.values[0].stacktrace.frames.length).toBeGreaterThan(0);
        expect(
            event.exception.values[0].stacktrace.frames.some(
                (frame: { filename?: string }) =>
                    frame.filename?.includes("index.test.ts"),
            ),
        ).toBe(true);
    });

    it("never sends the raw request body a provider SDK hangs off the error", async () => {
        // safeErrorForLog copies named fields only. This proves the transport
        // inherits that, rather than re-serialising the thrown object.
        const { sent, send } = recorder();
        installErrorTracking({
            env: { ERROR_TRACKING_DSN: DSN },
            send,
            globalHandlers: false,
        });

        const error = Object.assign(new Error("provider rejected the request"), {
            request: { body: { prompt: "PRIVILEGED CLIENT DOCUMENT TEXT" } },
            status: 401,
        });

        reportError(error, { source: "test" });
        await vi.waitFor(() => expect(sent).toHaveLength(1));

        expect(sent[0].body).not.toContain("PRIVILEGED CLIENT DOCUMENT TEXT");
        expect(eventOf(sent[0]).tags.status).toBe("401");
    });

    it("stops sending once the per-minute ceiling is reached", async () => {
        const { sent, send } = recorder();
        installErrorTracking({
            env: {
                ERROR_TRACKING_DSN: DSN,
                ERROR_TRACKING_MAX_EVENTS_PER_MINUTE: "2",
            },
            send,
            globalHandlers: false,
        });

        for (let i = 0; i < 10; i += 1) {
            reportError(new Error(`boom ${i}`), { source: "test" });
        }
        await vi.waitFor(() => expect(sent).toHaveLength(2));

        expect(sent).toHaveLength(2);
    });

    it("does not throw when delivery fails", async () => {
        const failing: EnvelopeSender = async () => {
            throw new Error("ingest unreachable");
        };
        installErrorTracking({
            env: { ERROR_TRACKING_DSN: DSN },
            send: failing,
            globalHandlers: false,
        });

        expect(() => reportError(new Error("boom"), { source: "test" })).not.toThrow();
        await vi.waitFor(() =>
            expect(
                consoleErrorSpy.mock.calls.some(
                    (call) => call[0] === "[error-tracking] delivery failed",
                ),
            ).toBe(true),
        );
    });
});

describe("the console.error bridge", () => {
    it("still prints exactly what it was given", () => {
        const { send } = recorder();
        installErrorTracking({
            env: { ERROR_TRACKING_DSN: DSN },
            send,
            globalHandlers: false,
        });

        const error = new Error("boom");
        console.error("[http/internal-error]", { requestId: "req-9", error });

        expect(consoleErrorSpy).toHaveBeenCalledWith("[http/internal-error]", {
            requestId: "req-9",
            error,
        });
    });

    it("captures an existing call site without that site being changed", async () => {
        // This is the shape sendInternalError already logs: a bracketed label
        // and a context object whose `error` has been through safeErrorForLog.
        const { sent, send } = recorder();
        installErrorTracking({
            env: { ERROR_TRACKING_DSN: DSN },
            send,
            globalHandlers: false,
        });

        console.error("[http/internal-error]", {
            requestId: "req-9",
            method: "POST",
            path: "/documents/:id/versions",
            error: { name: "TypeError", message: "cannot read x" },
        });
        await vi.waitFor(() => expect(sent).toHaveLength(1));

        const event = eventOf(sent[0]);
        expect(event.logger).toBe("http");
        expect(event.tags.route).toBe("/documents/:id/versions");
        expect(event.tags.method).toBe("POST");
        expect(event.extra.request_id).toBe("req-9");
        expect(event.exception.values[0].value).toBe("cannot read x");
    });

    it("reports a bare label with no error as an event rather than dropping it", async () => {
        const { sent, send } = recorder();
        installErrorTracking({
            env: { ERROR_TRACKING_DSN: DSN },
            send,
            globalHandlers: false,
        });

        console.error("[worker-thread] exited with code 7; respawning in 5s");
        await vi.waitFor(() => expect(sent).toHaveLength(1));

        const event = eventOf(sent[0]);
        expect(event.logger).toBe("worker-thread");
        expect(event.exception.values[0].value).toContain("exited with code 7");
    });

    it("does not loop when delivery itself logs a failure", async () => {
        let calls = 0;
        const failing: EnvelopeSender = async () => {
            calls += 1;
            throw new Error("ingest unreachable");
        };
        installErrorTracking({
            env: { ERROR_TRACKING_DSN: DSN },
            send: failing,
            globalHandlers: false,
        });

        console.error("[test] boom");
        await vi.waitFor(() => expect(calls).toBe(1));
        // A moment for any recursive attempt to land.
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(calls).toBe(1);
    });

    it("is restored by uninstall", () => {
        const { send } = recorder();
        installErrorTracking({
            env: { ERROR_TRACKING_DSN: DSN },
            send,
            globalHandlers: false,
        });
        const bridged = console.error;

        uninstallErrorTracking();

        expect(console.error).not.toBe(bridged);
    });

    it("installs one bridge however many times it is called", () => {
        const { send } = recorder();
        installErrorTracking({ env: {}, send, globalHandlers: false });
        installErrorTracking({ env: {}, send, globalHandlers: false });

        console.error("[test] once");

        // Two stacked bridges would each call through, printing twice.
        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it("counts every logged failure by subsystem, whether or not tracking is configured", () => {
        // logged_errors_total is metrics, not error reporting: a deployment
        // with no DSN still needs an error rate to alert on.
        installErrorTracking({ env: {}, globalHandlers: false });
        const before = loggedErrors.get(["storage"]);

        console.error("[storage] getSignedUploadUrl failed", {
            key: "k",
            error: new Error("boom"),
        });

        expect(loggedErrors.get(["storage"])).toBe(before + 1);
    });
});

describe("the global failure handlers", () => {
    it("redacts an unhandled rejection that Node would have dumped raw", async () => {
        // Node's default printer walks the thrown object's own properties, so
        // both the key and the request body reach stdout unredacted. This is
        // the path that had no handler at all before ticket 2084.
        vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
        const { sent, send } = recorder();
        installErrorTracking({
            env: { ERROR_TRACKING_DSN: DSN },
            send,
            globalHandlers: false,
        });

        handleUnhandledRejection(
            Object.assign(
                new Error(
                    "Incorrect API key provided: sk-ant-CANARYKEYVALUE1234567890",
                ),
                { request: { body: { prompt: "PRIVILEGED CLIENT DOCUMENT TEXT" } } },
            ),
        );
        await vi.waitFor(() => expect(sent).toHaveLength(1));

        const printed = JSON.stringify(consoleErrorSpy.mock.calls);
        expect(printed).not.toContain("CANARYKEYVALUE1234567890");
        expect(printed).not.toContain("PRIVILEGED CLIENT DOCUMENT TEXT");
        expect(sent[0].body).not.toContain("CANARYKEYVALUE1234567890");
        expect(sent[0].body).not.toContain("PRIVILEGED CLIENT DOCUMENT TEXT");
        expect(eventOf(sent[0]).logger).toBe("unhandled");
    });

    it("still exits on an unhandled rejection, as Node did before the handler", () => {
        // Registering a handler suppresses Node's escalation to an uncaught
        // exception. Without this the change would silently turn a crash into
        // a service carrying on in an unknown state.
        vi.useFakeTimers();
        const exit = vi
            .spyOn(process, "exit")
            .mockImplementation((() => undefined) as never);
        installErrorTracking({ env: {}, globalHandlers: false });

        handleUnhandledRejection(new Error("boom"));

        expect(exit).not.toHaveBeenCalled();
        vi.advanceTimersByTime(200);
        expect(exit).toHaveBeenCalledWith(1);
        vi.useRealTimers();
    });

    it("redacts an uncaught exception and then exits", () => {
        vi.useFakeTimers();
        const exit = vi
            .spyOn(process, "exit")
            .mockImplementation((() => undefined) as never);
        installErrorTracking({ env: {}, globalHandlers: false });

        handleUncaughtException(
            new Error("Incorrect API key provided: sk-ant-CANARYKEYVALUE1234567890"),
        );

        expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain(
            "CANARYKEYVALUE1234567890",
        );
        expect(exit).not.toHaveBeenCalled();
        vi.advanceTimersByTime(200);
        expect(exit).toHaveBeenCalledWith(1);
        vi.useRealTimers();
    });

    it("redacts even when nothing is configured to receive the event", () => {
        // The handlers install unconditionally, because the raw-dump problem
        // exists whether or not a DSN is set.
        vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
        installErrorTracking({ env: {}, globalHandlers: false });

        handleUnhandledRejection(
            new Error("Incorrect API key provided: sk-ant-CANARYKEYVALUE1234567890"),
        );

        expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain(
            "CANARYKEYVALUE1234567890",
        );
    });
});
