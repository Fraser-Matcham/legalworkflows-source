import { afterEach, describe, expect, it } from "vitest";
import {
    httpDuration,
    httpRequests,
    jobDuration,
    jobOutcomes,
    loggedErrors,
    providerCalls,
    providerTokens,
    recordHttpRequest,
    recordJobOutcome,
    recordLoggedError,
    recordProviderCall,
    recordProviderTokens,
    recordStorageCleanupFailure,
    registry,
    safeRouteLabel,
    setQueueDepthReader,
    storageCleanupFailures,
} from "./serviceMetrics";

/**
 * The registry is a module singleton, deliberately — there is one process and
 * one set of counters. Tests therefore assert on deltas or on labels unique to
 * the test, never on an absolute total.
 */

afterEach(() => {
    setQueueDepthReader(null);
});

describe("safeRouteLabel", () => {
    it("keeps a matched route pattern", () => {
        expect(safeRouteLabel("/single-documents/:documentId", true)).toBe(
            "/single-documents/:documentId",
        );
    });

    it("collapses an unmatched path to one series", () => {
        // buildRequestLogLine falls back to the raw probed path, which is
        // right for a log line and a cardinality bomb as a metric label.
        expect(safeRouteLabel("/wp-admin/setup-config.php", false)).toBe(
            "<unmatched>",
        );
        expect(safeRouteLabel("/.env", false)).toBe("<unmatched>");
    });
});

describe("recordHttpRequest", () => {
    it("counts by method, route and status, and times in seconds", () => {
        const before = httpRequests.get(["GET", "/metrics-test/:id", "200"]);
        const timedBefore = httpDuration.count(["GET", "/metrics-test/:id"]);

        recordHttpRequest({
            method: "GET",
            route: "/metrics-test/:id",
            matched: true,
            status: 200,
            durationMs: 250,
        });

        expect(httpRequests.get(["GET", "/metrics-test/:id", "200"])).toBe(
            before + 1,
        );
        expect(httpDuration.count(["GET", "/metrics-test/:id"])).toBe(
            timedBefore + 1,
        );
        // Prometheus convention is seconds, not milliseconds.
        expect(httpDuration.render()).toContain(
            'http_request_duration_seconds_sum{method="GET",route="/metrics-test/:id"} 0.25',
        );
    });

    it("labels every unmatched path as one series, whatever was probed", () => {
        const before = httpRequests.get(["GET", "<unmatched>", "404"]);

        for (const path of ["/a", "/b", "/wp-login.php"]) {
            recordHttpRequest({
                method: "GET",
                route: path,
                matched: false,
                status: 404,
                durationMs: 1,
            });
        }

        expect(httpRequests.get(["GET", "<unmatched>", "404"])).toBe(before + 3);
        expect(httpRequests.get(["GET", "/wp-login.php", "404"])).toBe(0);
    });
});

describe("recordJobOutcome", () => {
    it("separates a retry from a permanent failure", () => {
        // A queue that retries steadily and one that is losing work look
        // identical if both are counted as failures.
        const retriesBefore = jobOutcomes.get(["metrics_test_kind", "retry"]);
        const failuresBefore = jobOutcomes.get(["metrics_test_kind", "failed"]);

        recordJobOutcome("metrics_test_kind", "retry", 1000);
        recordJobOutcome("metrics_test_kind", "failed", 2000);

        expect(jobOutcomes.get(["metrics_test_kind", "retry"])).toBe(
            retriesBefore + 1,
        );
        expect(jobOutcomes.get(["metrics_test_kind", "failed"])).toBe(
            failuresBefore + 1,
        );
        expect(jobDuration.count(["metrics_test_kind"])).toBe(2);
    });
});

describe("recordProviderCall", () => {
    it("counts by provider, model and outcome", () => {
        recordProviderCall({
            provider: "metrics-test-provider",
            model: "m-1",
            outcome: "error",
            durationMs: 1500,
        });

        expect(
            providerCalls.get(["metrics-test-provider", "m-1", "error"]),
        ).toBe(1);
    });
});

describe("recordProviderTokens", () => {
    it("records what the provider reported", () => {
        recordProviderTokens({
            provider: "tokens-test",
            model: "m-1",
            inputTokens: 120,
            outputTokens: 30,
        });

        expect(providerTokens.get(["tokens-test", "m-1", "input"])).toBe(120);
        expect(providerTokens.get(["tokens-test", "m-1", "output"])).toBe(30);
    });

    it("records nothing for a count the provider did not report", () => {
        // The AI SDK's usage fields are `number | undefined`. Treating absent
        // as zero would quietly understate spend, which is the one thing a
        // token metric exists to get right.
        recordProviderTokens({
            provider: "tokens-absent",
            model: "m-1",
            inputTokens: undefined,
            outputTokens: 7,
        });

        expect(providerTokens.get(["tokens-absent", "m-1", "input"])).toBe(0);
        expect(
            providerTokens.render().includes('provider="tokens-absent",model="m-1",direction="input"'),
        ).toBe(false);
        expect(providerTokens.get(["tokens-absent", "m-1", "output"])).toBe(7);
    });

    it("ignores a negative or non-finite count", () => {
        recordProviderTokens({
            provider: "tokens-bad",
            model: "m-1",
            inputTokens: -5,
            outputTokens: Number.NaN,
        });

        expect(providerTokens.get(["tokens-bad", "m-1", "input"])).toBe(0);
        expect(providerTokens.get(["tokens-bad", "m-1", "output"])).toBe(0);
    });
});

describe("recordLoggedError", () => {
    it("counts by the subsystem source label", () => {
        const before = loggedErrors.get(["metrics-test-source"]);

        recordLoggedError("metrics-test-source");
        recordLoggedError("metrics-test-source");

        expect(loggedErrors.get(["metrics-test-source"])).toBe(before + 2);
    });
});

describe("recordStorageCleanupFailure", () => {
    it("counts by operation and stage, and accepts a batch count", () => {
        const before = storageCleanupFailures.get([
            "metrics-test-op",
            "delete",
        ]);

        recordStorageCleanupFailure("metrics-test-op", "delete", 3);

        expect(storageCleanupFailures.get(["metrics-test-op", "delete"])).toBe(
            before + 3,
        );
    });

    it("defaults to counting one failure", () => {
        const before = storageCleanupFailures.get([
            "metrics-test-op",
            "sweep",
        ]);

        recordStorageCleanupFailure("metrics-test-op", "sweep");

        expect(storageCleanupFailures.get(["metrics-test-op", "sweep"])).toBe(
            before + 1,
        );
    });
});

describe("the queue depth gauge", () => {
    it("reports nothing when no reader is wired", async () => {
        setQueueDepthReader(null);

        const body = await registry.expose();

        expect(body).toContain("# TYPE job_queue_depth gauge");
        expect(body).not.toMatch(/^job_queue_depth\{/m);
    });

    it("reads the depth at scrape time", async () => {
        let pending = 4;
        setQueueDepthReader(async () => [
            { status: "pending", count: pending },
            { status: "running", count: 1 },
        ]);

        expect(await registry.expose()).toContain(
            'job_queue_depth{status="pending"} 4',
        );
        pending = 11;
        expect(await registry.expose()).toContain(
            'job_queue_depth{status="pending"} 11',
        );
    });

    it("does not fail the scrape when the queue cannot be read", async () => {
        setQueueDepthReader(async () => {
            throw new Error("database unreachable");
        });

        const body = await registry.expose();

        expect(body).toContain("# TYPE http_requests_total counter");
        expect(body).not.toContain("database unreachable");
    });
});
