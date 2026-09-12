import type { Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configuredMetricsToken, metricsHandler } from "./endpoint";
import { Counter, Registry } from "./registry";

const TOKEN = "a-long-enough-metrics-token";

function fakeRequest(authorization?: string): Request {
    return {
        get: (name: string) =>
            name.toLowerCase() === "authorization" ? authorization : undefined,
    } as unknown as Request;
}

function fakeResponse() {
    const state = { status: 0, body: "", contentType: "" };
    const res = {
        status(code: number) {
            state.status = code;
            return res;
        },
        type(value: string) {
            state.contentType = value;
            return res;
        },
        send(body: string) {
            state.body = body;
            return res;
        },
        end() {
            return res;
        },
    };
    return { res: res as unknown as Response, state };
}

function populatedRegistry(): Registry {
    const registry = new Registry();
    registry.register(new Counter("test_total", "Test.", ["a"])).inc(["x"]);
    return registry;
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("the metrics endpoint", () => {
    it("does not exist when no token is configured", async () => {
        // 404, not 401: the default posture is "no metrics endpoint", so a
        // deployment that never thinks about this cannot expose one, and a
        // scan cannot learn the endpoint is there but locked.
        const { res, state } = fakeResponse();

        await metricsHandler(populatedRegistry(), {})(fakeRequest(), res);

        expect(state.status).toBe(404);
        expect(state.body).toBe("");
    });

    it("is still absent when a token is presented but none is configured", async () => {
        const { res, state } = fakeResponse();

        await metricsHandler(populatedRegistry(), {})(
            fakeRequest(`Bearer ${TOKEN}`),
            res,
        );

        expect(state.status).toBe(404);
    });

    it("refuses a request with no credentials", async () => {
        const { res, state } = fakeResponse();

        await metricsHandler(populatedRegistry(), { METRICS_TOKEN: TOKEN })(
            fakeRequest(),
            res,
        );

        expect(state.status).toBe(401);
        expect(state.body).toBe("");
    });

    // Each case is the complete Authorization header, so a case cannot
    // accidentally be rewritten into a valid one by a helper.
    it.each([
        ["a wrong token of the same length", `Bearer b-long-enough-metrics-token`],
        ["a prefix of the real token", `Bearer a-long-enough`],
        ["the real token with a suffix", `Bearer ${TOKEN}x`],
        ["the token with no scheme", TOKEN],
        ["the wrong scheme", `Basic ${TOKEN}`],
        ["an empty bearer", "Bearer "],
    ])("refuses %s", async (_label, authorization) => {
        const { res, state } = fakeResponse();

        await metricsHandler(populatedRegistry(), { METRICS_TOKEN: TOKEN })(
            fakeRequest(authorization),
            res,
        );

        expect(state.status).toBe(401);
    });

    it("serves the exposition to a correct token", async () => {
        const { res, state } = fakeResponse();

        await metricsHandler(populatedRegistry(), { METRICS_TOKEN: TOKEN })(
            fakeRequest(`Bearer ${TOKEN}`),
            res,
        );

        expect(state.status).toBe(200);
        expect(state.contentType).toBe(
            "text/plain; version=0.0.4; charset=utf-8",
        );
        expect(state.body).toContain('test_total{a="x"} 1');
    });

    it("accepts the scheme case-insensitively and tolerates padding", async () => {
        const { res, state } = fakeResponse();

        await metricsHandler(populatedRegistry(), { METRICS_TOKEN: TOKEN })(
            fakeRequest(`  bearer   ${TOKEN}  `),
            res,
        );

        expect(state.status).toBe(200);
    });

    it("answers 500 without describing the failure when a scrape throws", async () => {
        const consoleError = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        const failing = {
            expose: async () => {
                throw new Error("collector exploded");
            },
        } as unknown as Registry;
        const { res, state } = fakeResponse();

        await metricsHandler(failing, { METRICS_TOKEN: TOKEN })(
            fakeRequest(`Bearer ${TOKEN}`),
            res,
        );

        expect(state.status).toBe(500);
        expect(state.body).toBe("");
        expect(consoleError).toHaveBeenCalled();
    });
});

describe("configuredMetricsToken", () => {
    it("treats whitespace as unset, so a blank value cannot open the endpoint", () => {
        expect(configuredMetricsToken({})).toBe("");
        expect(configuredMetricsToken({ METRICS_TOKEN: "   " })).toBe("");
        expect(configuredMetricsToken({ METRICS_TOKEN: ` ${TOKEN} ` })).toBe(
            TOKEN,
        );
    });
});
