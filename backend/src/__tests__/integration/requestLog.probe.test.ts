/**
 * End-to-end probe: run real requests through a real Express app with the
 * logging middleware mounted, capture every line the process writes, and
 * search all of it for values that must never be logged.
 *
 * The unit tests in safeError.test.ts prove the helpers redact. This proves
 * the wiring does — that nothing on the path from request to log line writes
 * a body, a header or a query string before the helper is ever consulted.
 */

import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { inspect } from "node:util";
import { requestLog } from "../../middleware/requestLog";
import {
    handleUnhandledError,
    protectInternalErrorResponses,
} from "../../middleware/internalErrorResponse";

const CANARY = {
    envKey: "sk-live-CANARY-env-openai-key-9f2b1c",
    body: "CANARY-REQUEST-BODY indemnity clause 14.2",
    query: "CANARY-QUERY-FILENAME completion-statement.docx",
    header: "Bearer CANARY-SESSION-TOKEN-0123456789",
    thrown: "CANARY-THROWN-PROMPT You are a legal assistant. Here is the deed:",
    cookie: "sb-access-token=CANARY-COOKIE-VALUE-0123456789",
    email: "canary.client@example.invalid",
    pathToken: "CANARY-SIGNED-DOWNLOAD-TOKEN-0123456789",
};

let lines: string[] = [];

const originalEnv = { ...process.env };

/**
 * Renders a console argument the way Node actually renders it to stdout.
 *
 * String(arg) is not good enough and quietly makes this whole file useless:
 * every error log site passes an OBJECT as its second argument, and
 * String({...}) is "[object Object]", so a probe built on it would pass with
 * the redaction removed. util.inspect is what console itself uses.
 */
const render = (arg: unknown) =>
    typeof arg === "string" ? arg : inspect(arg, { depth: null });

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use(protectInternalErrorResponses);
    app.use((_req, res, next) => {
        res.locals.requestId = randomUUID();
        // Auth would have set both of these. The email is present precisely so
        // the probe can prove the log line does not reach for it.
        res.locals.userId = "11111111-2222-3333-4444-555555555555";
        res.locals.userEmail = CANARY.email;
        next();
    });
    app.use(requestLog);
    app.post("/single-documents/:documentId/notes", (_req, res) => {
        res.status(201).json({ ok: true });
    });
    app.get("/download/:token", (_req, res) => {
        res.status(200).send("file bytes");
    });
    app.get("/boom", () => {
        throw new Error("handler exploded");
    });
    // The two paths that log a caught value, wired as app.ts wires them, so
    // the probe covers the real error-logging code and not a stand-in.
    app.get("/throws-a-secret", () => {
        throw Object.assign(new Error(`provider rejected: ${CANARY.envKey}`), {
            request: { body: { prompt: CANARY.thrown } },
        });
    });
    app.get("/download/:token/boom", () => {
        throw new Error("storage unavailable");
    });
    app.get("/leaky-5xx", (_req, res) => {
        res.status(500).json({ detail: CANARY.thrown, stack: CANARY.envKey });
    });
    app.use(handleUnhandledError);
    return app;
}

beforeEach(() => {
    process.env.OPENAI_API_KEY = CANARY.envKey;
    lines = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        lines.push(args.map(render).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
        lines.push(args.map(render).join(" "));
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
});

/** The only http line the middleware emitted, parsed. */
function httpLine() {
    const raw = lines.find((line) => line.includes('"kind":"http"'));
    expect(raw, "no request log line was emitted").toBeTruthy();
    return JSON.parse(raw as string);
}

describe("request logging", () => {
    it("records the identifiers an operator needs to find a request", async () => {
        await request(buildApp())
            .post("/single-documents/doc-123/notes")
            .send({ note: CANARY.body })
            .expect(201);

        const line = httpLine();
        expect(line.requestId).toMatch(/^[0-9a-f-]{36}$/);
        expect(line.userId).toBe("11111111-2222-3333-4444-555555555555");
        expect(line.method).toBe("POST");
        expect(line.status).toBe(201);
        expect(typeof line.durationMs).toBe("number");
    });

    it("groups by route pattern, not by the document id in the path", async () => {
        const app = buildApp();
        await request(app).post("/single-documents/doc-aaa/notes").send({}).expect(201);
        await request(app).post("/single-documents/doc-bbb/notes").send({}).expect(201);

        const routes = lines
            .filter((line) => line.includes('"kind":"http"'))
            .map((line) => JSON.parse(line).route);
        expect(routes).toEqual([
            "/single-documents/:documentId/notes",
            "/single-documents/:documentId/notes",
        ]);
    });

    it("emits nothing from the request body, query, headers or cookies", async () => {
        await request(buildApp())
            .post(`/single-documents/doc-123/notes?filename=${encodeURIComponent(CANARY.query)}`)
            .set("Authorization", CANARY.header)
            .set("Cookie", CANARY.cookie)
            .send({ note: CANARY.body })
            .expect(201);

        const everything = lines.join("\n");
        expect(everything).not.toContain("CANARY-REQUEST-BODY");
        expect(everything).not.toContain("CANARY-QUERY-FILENAME");
        expect(everything).not.toContain("CANARY-SESSION-TOKEN");
        expect(everything).not.toContain("CANARY-COOKIE-VALUE");
    });

    it("does not log the caller's email even though auth put it in scope", async () => {
        await request(buildApp()).post("/single-documents/d/notes").send({}).expect(201);
        expect(lines.join("\n")).not.toContain(CANARY.email);
    });

    it("does not log a signed token that arrived as a path segment", async () => {
        // A signed download token is a credential with no recognisable shape,
        // so redaction cannot save it — only recording the route pattern
        // instead of the concrete path can. This test found that hole.
        await request(buildApp()).get(`/download/${CANARY.pathToken}`).expect(200);
        expect(lines.join("\n")).not.toContain("CANARY-SIGNED-DOWNLOAD-TOKEN");
        expect(httpLine().route).toBe("/download/:token");
    });

    it("records the raw path only when no route matched, so probes stay visible", async () => {
        await request(buildApp()).get("/../../etc/passwd?q=secret").expect(404);
        const line = httpLine();
        expect(line.status).toBe(404);
        expect(line.route).toContain("etc/passwd");
        expect(line.route).not.toContain("q=secret");
    });

    it("carries no concrete resource id, only the pattern", async () => {
        await request(buildApp()).post("/single-documents/doc-secret-123/notes").send({}).expect(201);
        expect(lines.join("\n")).not.toContain("doc-secret-123");
    });

    it("still emits a line when the handler throws", async () => {
        await request(buildApp()).get("/boom").expect(500);
        const line = httpLine();
        expect(line.status).toBe(500);
        expect(line.route).toBe("/boom");
    });

    it("redacts the error the internal-error handler logs", async () => {
        await request(buildApp()).get("/throws-a-secret").expect(500);

        const everything = lines.join("\n");
        expect(everything).toContain("[http/internal-error]");
        expect(everything).not.toContain(CANARY.envKey);
        // The prompt hangs off error.request, which is never copied.
        expect(everything).not.toContain("CANARY-THROWN-PROMPT");
    });

    it("keeps the query string and path credentials out of the error line", async () => {
        // Mutation check: this is the only test that fails if the error log
        // stops running its path through safePathForLog.
        await request(buildApp())
            .get(
                `/download/${CANARY.pathToken}/boom?filename=${encodeURIComponent(CANARY.query)}`,
            )
            .expect(500);

        const everything = lines.join("\n");
        expect(everything).toContain("[http/internal-error]");
        expect(everything).not.toContain("CANARY-QUERY-FILENAME");
        expect(everything).not.toContain("CANARY-SIGNED-DOWNLOAD-TOKEN");
    });

    it("redacts a 5xx body a handler tried to return", async () => {
        await request(buildApp()).get("/leaky-5xx").expect(500);

        const everything = lines.join("\n");
        expect(everything).toContain("[http/sanitized-internal-error]");
        expect(everything).not.toContain("CANARY-THROWN-PROMPT");
        expect(everything).not.toContain(CANARY.envKey);
        // Shape, not content: enough to find the handler that misbehaved.
        expect(everything).toContain("chars");
    });

    it("emits exactly one line per request", async () => {
        await request(buildApp()).post("/single-documents/d/notes").send({}).expect(201);
        expect(lines.filter((line) => line.includes('"kind":"http"'))).toHaveLength(1);
    });
});
