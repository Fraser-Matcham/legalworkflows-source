import { describe, expect, it } from "vitest";
import {
    buildSentryEvent,
    encodeEnvelope,
    parseSentryDsn,
    parseStackFrames,
    sentryAuthHeader,
} from "./sentryEnvelope";

describe("parseSentryDsn", () => {
    it("parses a hosted DSN", () => {
        const dsn = parseSentryDsn("https://abc123@o42.ingest.sentry.io/4507");

        expect(dsn).toEqual({
            publicKey: "abc123",
            projectId: "4507",
            envelopeUrl: "https://o42.ingest.sentry.io/api/4507/envelope/",
        });
    });

    it("keeps the path prefix a self-hosted install is mounted under", () => {
        const dsn = parseSentryDsn("https://key@sentry.example.com/errors/9");

        expect(dsn?.envelopeUrl).toBe(
            "https://sentry.example.com/errors/api/9/envelope/",
        );
    });

    it.each([
        ["not a url", "nonsense"],
        ["no public key", "https://o42.ingest.sentry.io/4507"],
        ["no project id", "https://abc123@o42.ingest.sentry.io/"],
        ["non-numeric project id", "https://abc123@o42.ingest.sentry.io/project"],
        ["wrong protocol", "ftp://abc123@o42.ingest.sentry.io/4507"],
    ])("returns null rather than throwing for %s", (_label, dsn) => {
        expect(parseSentryDsn(dsn)).toBeNull();
    });

    it("builds an auth header that carries the public key", () => {
        const dsn = parseSentryDsn("https://abc123@o42.ingest.sentry.io/4507");

        expect(sentryAuthHeader(dsn!)).toContain("sentry_key=abc123");
        expect(sentryAuthHeader(dsn!)).toContain("sentry_version=7");
    });
});

describe("parseStackFrames", () => {
    it("parses named and bare frames and reverses them for Sentry", () => {
        const frames = parseStackFrames(
            [
                "Error: boom",
                "    at inner (/srv/app/a.ts:10:5)",
                "    at /srv/app/b.ts:20:7",
            ].join("\n"),
        );

        // Sentry renders innermost last, so the deepest frame is at the end.
        expect(frames).toEqual([
            { filename: "/srv/app/b.ts", lineno: 20, colno: 7 },
            { function: "inner", filename: "/srv/app/a.ts", lineno: 10, colno: 5 },
        ]);
    });

    it("drops the message line rather than reporting it as a filename", () => {
        const frames = parseStackFrames("Error: boom\n    at x (/a.ts:1:1)");

        expect(frames).toHaveLength(1);
        expect(frames[0].filename).toBe("/a.ts");
    });

    it("is empty for a stack that was stripped", () => {
        expect(parseStackFrames(undefined)).toEqual([]);
    });
});

describe("buildSentryEvent", () => {
    const context = { source: "http", environment: "production" };

    it("carries the exception, tags and request id", () => {
        const event = buildSentryEvent(
            {
                name: "TypeError",
                message: "cannot read x",
                stack: "TypeError: cannot read x\n    at f (/a.ts:1:1)",
                status: 500,
                code: "PGRST301",
            },
            { ...context, requestId: "req-1", route: "/documents/:id", method: "GET" },
        );

        const values = (event.exception as { values: Array<Record<string, unknown>> })
            .values;
        expect(values).toHaveLength(1);
        expect(values[0].type).toBe("TypeError");
        expect(values[0].value).toBe("cannot read x");
        expect(event.tags).toMatchObject({
            source: "http",
            route: "/documents/:id",
            method: "GET",
            status: "500",
            code: "PGRST301",
        });
        expect(event.extra).toMatchObject({ request_id: "req-1" });
        expect(event.event_id).toMatch(/^[0-9a-f]{32}$/);
    });

    it("unrolls a cause chain, root first", () => {
        const event = buildSentryEvent(
            {
                name: "Error",
                message: "outer",
                cause: { name: "Error", message: "inner" },
            },
            context,
        );

        const values = (event.exception as { values: Array<Record<string, unknown>> })
            .values;
        expect(values.map((value) => value.value)).toEqual(["inner", "outer"]);
    });

    it("identifies a user by uuid and never by email", () => {
        const event = buildSentryEvent({ name: "Error", message: "x" }, {
            ...context,
            userId: "11111111-2222-3333-4444-555555555555",
        });

        expect(event.user).toEqual({
            id: "11111111-2222-3333-4444-555555555555",
        });
        expect(JSON.stringify(event)).not.toContain("@");
    });

    it("marks an unhandled failure as unhandled", () => {
        const event = buildSentryEvent({ name: "Error", message: "x" }, {
            source: "unhandled",
            environment: "production",
        });

        const values = (event.exception as { values: Array<Record<string, unknown>> })
            .values;
        expect(values[0].mechanism).toEqual({ type: "unhandled", handled: false });
    });
});

describe("encodeEnvelope", () => {
    it("emits three newline-delimited lines with a byte-accurate length", () => {
        const event = buildSentryEvent({ name: "Error", message: "pound £" }, {
            source: "http",
            environment: "test",
        });

        const [header, itemHeader, payload] = encodeEnvelope(event).split("\n");

        expect(JSON.parse(header).event_id).toBe(event.event_id);
        // Byte length, not character length: "£" is two bytes in UTF-8 and an
        // ingest that trusted the header would truncate the payload.
        expect(JSON.parse(itemHeader)).toMatchObject({
            type: "event",
            length: Buffer.byteLength(payload),
            content_type: "application/json",
        });
        expect(JSON.parse(payload).event_id).toBe(event.event_id);
    });
});
