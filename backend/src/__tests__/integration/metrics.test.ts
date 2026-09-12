import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

process.env.SUPABASE_URL = "http://supabase.test.local";
process.env.SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
process.env.SUPABASE_SECRET_KEY = "test-service-key";

vi.mock("@supabase/supabase-js", () => ({
    createClient: vi.fn(() => ({
        auth: {
            getUser: () =>
                Promise.resolve({ data: { user: null }, error: null }),
        },
    })),
}));

import { app } from "../../app";
import { httpRequests } from "../../lib/metrics/serviceMetrics";

const TOKEN = "integration-metrics-token";

/**
 * The unit tests cover the registry, the label discipline and the token gate.
 * What only a request through the real app can show is that the pieces are
 * actually wired: that the route exists, that the middleware chain records the
 * request that reached it, and that the unmatched-path label survives the trip
 * through Express rather than being a property of a hand-built fake.
 */

beforeEach(() => {
    process.env.METRICS_TOKEN = TOKEN;
});

afterEach(() => {
    delete process.env.METRICS_TOKEN;
});

async function scrape(): Promise<string> {
    const res = await request(app)
        .get("/metrics")
        .set("Authorization", `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    return res.text;
}

describe("GET /metrics", () => {
    it("is absent when no token is configured", async () => {
        delete process.env.METRICS_TOKEN;

        const res = await request(app).get("/metrics");

        // 404 and not 401, so a scan cannot learn the endpoint is there.
        expect(res.status).toBe(404);
    });

    it("refuses a wrong token", async () => {
        const res = await request(app)
            .get("/metrics")
            .set("Authorization", "Bearer wrong-token-entirely");

        expect(res.status).toBe(401);
    });

    it("serves Prometheus text to a correct token", async () => {
        const res = await request(app)
            .get("/metrics")
            .set("Authorization", `Bearer ${TOKEN}`);

        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toContain("text/plain");
        expect(res.headers["content-type"]).toContain("version=0.0.4");
        for (const name of [
            "http_requests_total",
            "http_request_duration_seconds",
            "job_outcomes_total",
            "job_duration_seconds",
            "job_queue_depth",
            "llm_calls_total",
            "llm_tokens_total",
        ]) {
            expect(res.text).toContain(`# TYPE ${name}`);
        }
    });

    it("counts a request that actually went through the middleware chain", async () => {
        const before = httpRequests.get(["GET", "/health", "200"]);

        await request(app).get("/health").expect(200);

        // The counter is incremented by requestLog on response finish, which
        // can land just after supertest resolves.
        await vi.waitFor(() =>
            expect(httpRequests.get(["GET", "/health", "200"])).toBe(before + 1),
        );
        expect(await scrape()).toContain(
            'http_requests_total{method="GET",route="/health",status="200"}',
        );
    });

    it("collapses probed paths to one series, through the real router", async () => {
        // The cardinality guard, end to end: Express matches no route for
        // these, so buildRequestLogLine would record the raw path. If the
        // metric label followed it, each probe would mint a retained series.
        const before = httpRequests.get(["GET", "<unmatched>", "404"]);

        await request(app).get("/wp-admin/setup-config.php");
        await request(app).get("/.env");
        await request(app).get("/vendor/phpunit/phpunit/eval-stdin.php");

        await vi.waitFor(() =>
            expect(httpRequests.get(["GET", "<unmatched>", "404"])).toBe(
                before + 3,
            ),
        );

        const body = await scrape();
        expect(body).toContain('route="<unmatched>"');
        expect(body).not.toContain("wp-admin");
        expect(body).not.toContain("phpunit");
    });

    it("does not record the scrape's own token anywhere in the exposition", async () => {
        await scrape();

        expect(await scrape()).not.toContain(TOKEN);
    });
});
