/**
 * The deliberate probe ticket 2083 asks for.
 *
 * Redaction is only worth having if it is tested the way an attacker would
 * test it: plant a value that must never be logged, put it everywhere a real
 * error could carry it, serialise the result, and search the whole string.
 * Asserting on individual fields would pass while the same secret sat in a
 * sibling field nobody thought to check.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    MAX_LOGGED_STRING,
    redactSecrets,
    safeErrorForLog,
    safeLogString,
    safeLogValue,
    safePathForLog,
} from "./safeError";

/**
 * Canaries. Each is a value that must never reach a log, in the shape it
 * really arrives in. They are written so that a partial match still fails the
 * assertion: no canary is a substring of ordinary English.
 */
const CANARY = {
    envKey: "sk-live-CANARY-env-openai-key-9f2b1c",
    userKey: "sk-ant-api03-CANARYuserkey0123456789abcdef",
    jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJDQU5BUlkifQ.CANARYsignature0123",
    bearer: "Bearer CANARYsessiontoken0123456789",
    documentText:
        "CANARY-DOCUMENT-BODY The Purchaser shall indemnify the Vendor against all losses.",
    prompt: "CANARY-PROMPT You are a legal assistant. Summarise the attached deed.",
};

const originalEnv = { ...process.env };

beforeEach(() => {
    process.env.OPENAI_API_KEY = CANARY.envKey;
    process.env.DOWNLOAD_SIGNING_SECRET = "CANARY-download-signing-secret-value";
});

afterEach(() => {
    process.env = { ...originalEnv };
});

/** Everything a log line would actually contain, as one searchable string. */
const serialise = (value: unknown) => JSON.stringify(value);

describe("redactSecrets", () => {
    it("masks a live environment secret by its exact value", () => {
        const out = redactSecrets(`request failed with key ${CANARY.envKey}`);
        expect(out).not.toContain(CANARY.envKey);
        expect(out).toContain("[redacted:OPENAI_API_KEY]");
    });

    it("masks a secret whose env var it has never heard of", () => {
        process.env.SOME_NEW_PROVIDER_API_KEY = "CANARY-unheard-of-key-value";
        const out = redactSecrets("boom: CANARY-unheard-of-key-value");
        expect(out).not.toContain("CANARY-unheard-of-key-value");
    });

    it("masks a caller's own key, which the environment never holds", () => {
        const out = redactSecrets(`invalid api key: ${CANARY.userKey}`);
        expect(out).not.toContain(CANARY.userKey);
    });

    it("masks a JWT and an Authorization header", () => {
        const out = redactSecrets(`${CANARY.bearer} / token=${CANARY.jwt}`);
        expect(out).not.toContain("CANARYsessiontoken0123456789");
        expect(out).not.toContain("CANARYsignature0123");
    });

    it("leaves ordinary diagnostic text alone", () => {
        const message = "connect ETIMEDOUT 10.0.0.4:5432 after 3 attempts";
        expect(redactSecrets(message)).toBe(message);
    });

    it("does not blank short environment values that are not secrets", () => {
        process.env.NODE_ENV = "test";
        expect(redactSecrets("running in test mode")).toBe("running in test mode");
    });
});

describe("safeLogString", () => {
    it("truncates, because document text leaks by volume and not by shape", () => {
        const out = safeLogString(CANARY.documentText.repeat(200));
        expect(out.length).toBeLessThan(MAX_LOGGED_STRING + 60);
        expect(out).toContain("truncated");
    });

    it("redacts before truncating, so a secret past the cut is still masked", () => {
        const out = safeLogString(`${"x".repeat(MAX_LOGGED_STRING)}${CANARY.envKey}`);
        expect(out).not.toContain(CANARY.envKey);
    });
});

describe("safeErrorForLog", () => {
    it("does not copy the thrown object's own properties", () => {
        // The shape a provider SDK really throws: the prompt is hanging off
        // the error on `request`, and the response body on `response`.
        const error = Object.assign(new Error("400 Bad Request"), {
            request: { body: { messages: [{ content: CANARY.prompt }] } },
            response: { data: { text: CANARY.documentText } },
            config: { headers: { Authorization: CANARY.bearer } },
        });

        const out = serialise(safeErrorForLog(error));
        expect(out).not.toContain("CANARY-PROMPT");
        expect(out).not.toContain("CANARY-DOCUMENT-BODY");
        expect(out).not.toContain("CANARYsessiontoken0123456789");
        expect(out).toContain("400 Bad Request");
    });

    it("redacts the message, the stack and the cause chain", () => {
        const root = new Error(`upstream rejected ${CANARY.envKey}`);
        const wrapper = new Error(`retry failed for ${CANARY.userKey}`, { cause: root });

        const out = serialise(safeErrorForLog(wrapper));
        expect(out).not.toContain(CANARY.envKey);
        expect(out).not.toContain(CANARY.userKey);
        expect(out).not.toContain("CANARYuserkey");
    });

    it("keeps the fields an operator actually needs", () => {
        const error = Object.assign(new Error("rate limited"), {
            status: 429,
            code: "rate_limit_exceeded",
        });
        const safe = safeErrorForLog(error);
        expect(safe.message).toBe("rate limited");
        expect(safe.status).toBe(429);
        expect(safe.code).toBe("rate_limit_exceeded");
        expect(safe.stack).toBeTruthy();
    });

    it("survives the values that are not errors at all", () => {
        expect(safeErrorForLog(undefined).message).toContain("undefined");
        expect(safeErrorForLog(null).message).toContain("null");
        expect(safeErrorForLog("just a string").message).toBe("just a string");
        expect(safeErrorForLog(42).message).toBe("42");
    });

    it("does not recurse forever on a self-referencing cause", () => {
        const error = new Error("loop") as Error & { cause?: unknown };
        error.cause = error;
        expect(() => serialise(safeErrorForLog(error))).not.toThrow();
    });
});

describe("safePathForLog", () => {
    it("drops the query string, where filenames and search terms live", () => {
        const out = safePathForLog(
            "/library/search?q=completion%20statement&filename=deed.docx",
        );
        expect(out).toBe("/library/search");
    });

    it("masks a signed download token, whose payload is not even encrypted", () => {
        // The real shape: base64url payload, dot, 43-char base64url HMAC.
        const token = `${"eyJwIjoiZG9jcy9jbGllbnQtYS9kZWVkLmRvY3giLCJmIjoiZGVlZC5kb2N4In0"}.${"a".repeat(43)}`;
        const out = safePathForLog(`/download/${token}`);
        expect(out).not.toContain("eyJwIjoi");
        expect(out).not.toContain("a".repeat(43));
    });

    it("keeps a uuid, because that is how a document is named in support", () => {
        const id = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
        expect(safePathForLog(`/single-documents/${id}/notes`)).toBe(
            `/single-documents/${id}/notes`,
        );
    });

    it("masks any other long opaque segment", () => {
        const opaque = "Zm9vYmFyYmF6cXV4Y29ycmdlZ3JhdWx0Z2FycGx5".repeat(1);
        expect(opaque.length).toBeGreaterThanOrEqual(32);
        expect(safePathForLog(`/x/${opaque}`)).toBe("/x/[redacted:opaque]");
    });

    it("leaves ordinary route paths untouched", () => {
        expect(safePathForLog("/workflows/run")).toBe("/workflows/run");
    });

    it("survives a missing url", () => {
        expect(safePathForLog(undefined)).toBe("");
        expect(safePathForLog("")).toBe("");
    });
});

describe("safeLogValue", () => {
    it("drops a value whose key names a secret, whatever it holds", () => {
        const out = serialise(
            safeLogValue({ userApiKey: CANARY.userKey, encryptedToken: "opaque-blob" }),
        );
        expect(out).not.toContain("CANARYuserkey");
        expect(out).not.toContain("opaque-blob");
    });

    it("truncates a long string nested inside a response body", () => {
        const out = serialise(
            safeLogValue({ detail: { extracted: CANARY.documentText.repeat(50) } }),
        );
        expect(out).toContain("truncated");
        expect(out.length).toBeLessThan(1200);
    });

    it("bounds depth and width instead of walking an arbitrary object", () => {
        const deep = { a: { b: { c: { d: { e: { f: "CANARY-DEEPLY-NESTED" } } } } } };
        expect(serialise(safeLogValue(deep))).not.toContain("CANARY-DEEPLY-NESTED");

        const wide = Object.fromEntries(
            Array.from({ length: 60 }, (_, i) => [`k${i}`, i]),
        );
        expect(serialise(safeLogValue(wide))).toContain("more keys");
    });
});
