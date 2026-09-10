/**
 * Redaction for anything on its way to a log.
 *
 * Logs are the one place where every other protection in this service is moot.
 * Authorization decides who may read a document through the API; it says
 * nothing about what a stack trace prints to stdout, where the log shipper,
 * the platform's log viewer and everyone with access to it can read it. Three
 * classes of value must therefore never survive a trip through here:
 *
 *   API keys       - provider SDKs put the outgoing Authorization header, and
 *                    sometimes the key itself, into the error they throw.
 *   Prompts and    - an LLM or parser error frequently echoes the input that
 *   document text    caused it, and that input is a client's document.
 *   Credentials    - session JWTs, signed download tokens, handoff secrets.
 *
 * Two defences, because neither alone is enough:
 *
 *   By value.  Any environment variable that looks like a secret has its
 *              value searched for verbatim. This catches a key of any shape,
 *              including one this file has never heard of, and it is exact:
 *              no pattern to evade.
 *   By shape.  Bearer headers, JWTs and the common provider key prefixes are
 *              matched by form. This catches the secrets the process env does
 *              NOT hold - a caller's own stored API key, a user's session
 *              token - which value-based redaction cannot see.
 *   By context. A secret of no recognisable shape, held by no environment
 *              variable, betrayed only by the label next to it: OpenAI's
 *              "Incorrect API key provided: ..." echoes the rejected key
 *              back verbatim. Restored from the module upstream deleted.
 *
 * Volume is the third defence and it is the one that handles document text.
 * A prompt or an extracted document does not match any pattern; it is simply
 * long. Every string is therefore truncated, and objects are never spread
 * into a log line field by field.
 *
 * Nothing here throws. A redaction helper that can throw is a redaction
 * helper that gets wrapped in a try/catch which logs the raw value instead.
 */

/**
 * Longest string that reaches a log. Enough to identify a failure, short
 * enough that an echoed prompt or an extracted page arrives in fragments
 * rather than whole.
 */
export const MAX_LOGGED_STRING = 500;

/** Stack frames kept. The frames below say little the top ones do not. */
const MAX_STACK_FRAMES = 12;

/** Guards against walking a deeply nested provider error forever. */
const MAX_DEPTH = 4;
const MAX_KEYS = 24;
const MAX_ARRAY_ITEMS = 10;

/**
 * An env var this short cannot be a meaningful secret, and redacting a short
 * common value ("dev", "true", a port) would blank unrelated text.
 */
const MIN_SECRET_VALUE_LENGTH = 8;

/** Names whose values must never appear in a log line. */
const SECRET_ENV_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSPHRASE|CREDENTIALS?|DSN)$/;

/**
 * Secrets the process environment does not hold, matched by form: a caller's
 * own provider key, a session JWT, an Authorization header echoed back by an
 * SDK. Ordered so the more specific pattern runs first.
 */
const SECRET_SHAPES: ReadonlyArray<readonly [RegExp, string]> = [
    // JSON Web Tokens: session cookies, Supabase access tokens, handoff codes.
    [/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]+/g, "[redacted:jwt]"],
    // Authorization headers, however they were spelled.
    [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]"],
    // Provider key prefixes. sk- covers OpenAI and Anthropic (sk-ant-...).
    [/\b(sk|pk|rk|xoxb|xoxp|ghp|gho|ghu|ghs|ghr|github_pat)[-_][A-Za-z0-9_-]{8,}/g, "[redacted:api-key]"],
    // Google and Vercel style keys.
    [/\bAIza[A-Za-z0-9_-]{16,}/g, "[redacted:api-key]"],
    // AWS and R2 access key ids.
    [/\b(AKIA|ASIA)[A-Z0-9]{12,}/g, "[redacted:access-key-id]"],
    // This service's own signed download tokens: base64url payload, a dot,
    // then a base64url sha256 HMAC, which is always 43 characters. The
    // payload is not encrypted — it decodes to the storage path and the
    // client's filename — so this leaks more than access if it is logged.
    // Runs after the JWT rule so a three-part JWT is consumed first.
    [/\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{43}\b/g, "[redacted:signed-token]"],
];

/**
 * Secrets recognised by the words AROUND them rather than by their own shape.
 *
 * These come from the `safeError.ts` upstream used to have. Upstream deleted
 * it as collateral in commit 1d92cba, a workflow-catalogue refactor that also
 * dropped a 13,000-line module; the instruction to use these helpers survived
 * in AGENTS.md long after the helpers did. They are restored here because
 * they cover a case neither of the other defences can: a secret of arbitrary
 * shape, held by nobody's environment, that a provider echoed back next to a
 * label. OpenAI's "Incorrect API key provided: …" is the canonical example.
 *
 * Each pattern is exactly (prefix)(secret), so the replacement keeps the
 * label — which is diagnostic — and drops only the value.
 */
const SECRET_CONTEXTS: ReadonlyArray<RegExp> = [
    /(Incorrect API key provided:\s*)([^.\s]+)/gi,
    /((?:api[_ -]?key|apikey|x-api-key|token|secret|password|authorization|bearer)\s*(?:provided\s*)?(?:is|:|=)\s*["']?)([A-Za-z0-9._~+/=-]{6,})/gi,
];

/** A uuid is an identifier, not a credential, and stays readable in logs. */
const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A path segment at least this long, and made only of token characters, is
 * opaque: nobody types it, so it is far more likely to be a credential than
 * a name worth reading.
 */
const OPAQUE_SEGMENT_LENGTH = 32;
const TOKEN_CHARS = /^[A-Za-z0-9_.~-]+$/;

/**
 * Snapshot of the secret values currently in the environment, longest first
 * so a key that contains a shorter one is masked before its substring is.
 *
 * Recomputed on each call rather than cached at import: tests set and unset
 * env vars, and a cached empty list would silently stop redacting.
 */
function secretEnvValues(): Array<[string, string]> {
    const found: Array<[string, string]> = [];
    for (const [name, value] of Object.entries(process.env)) {
        if (typeof value !== "string") continue;
        if (value.length < MIN_SECRET_VALUE_LENGTH) continue;
        if (!SECRET_ENV_NAME.test(name)) continue;
        found.push([name, value]);
    }
    return found.sort((a, b) => b[1].length - a[1].length);
}

function escapeForRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Masks secrets in a string. Exported so a caller with its own text to log
 * can redact it without constructing an Error first.
 */
export function redactSecrets(text: string): string {
    let out = text;
    for (const [name, value] of secretEnvValues()) {
        if (!out.includes(value)) continue;
        out = out.split(value).join(`[redacted:${name}]`);
    }
    for (const pattern of SECRET_CONTEXTS) {
        out = out.replace(pattern, "$1[redacted]");
    }
    for (const [pattern, replacement] of SECRET_SHAPES) {
        out = out.replace(pattern, replacement);
    }
    return out;
}

/** Redacts, then truncates. Every string in a log line goes through this. */
export function safeLogString(text: string, limit = MAX_LOGGED_STRING): string {
    const redacted = redactSecrets(text);
    if (redacted.length <= limit) return redacted;
    return `${redacted.slice(0, limit)}… [truncated ${redacted.length - limit} chars]`;
}

export interface SafeError {
    name: string;
    message: string;
    stack?: string;
    /** Present when the thrown value carried a status, as provider SDKs do. */
    status?: number;
    code?: string;
    cause?: SafeError;
}

function safeStack(stack: unknown): string | undefined {
    if (typeof stack !== "string") return undefined;
    const frames = stack.split("\n").slice(0, MAX_STACK_FRAMES).join("\n");
    // The first line of a stack repeats the message, so it needs redacting
    // too — a stack is not automatically safe just because it is structural.
    return safeLogString(frames, MAX_LOGGED_STRING * 2);
}

function readNumber(source: Record<string, unknown>, key: string): number | undefined {
    const value = source[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readShortString(source: Record<string, unknown>, key: string): string | undefined {
    const value = source[key];
    return typeof value === "string" ? safeLogString(value, 80) : undefined;
}

/**
 * Reduces any thrown value to a bounded, redacted shape.
 *
 * Note what this deliberately does NOT do: copy the thrown object's own
 * properties. A provider error routinely carries the full request body on
 * `error.request` or the raw response on `error.response`, and that body is
 * the prompt — which is the client's document. Only the named fields below
 * are read.
 */
export function safeErrorForLog(error: unknown, depth = 0): SafeError {
    if (depth > MAX_DEPTH) return { name: "Error", message: "[nested too deeply]" };

    if (typeof error === "string") {
        return { name: "Error", message: safeLogString(error) };
    }
    if (error === null || error === undefined) {
        return { name: "Error", message: `[${String(error)} thrown]` };
    }
    if (typeof error !== "object") {
        return { name: typeof error, message: safeLogString(String(error)) };
    }

    const source = error as Record<string, unknown>;
    const name = typeof source.name === "string" ? safeLogString(source.name, 80) : "Error";
    const message =
        typeof source.message === "string"
            ? safeLogString(source.message)
            : safeLogString(String(error));

    const safe: SafeError = { name, message };
    const stack = safeStack(source.stack);
    if (stack) safe.stack = stack;
    const status = readNumber(source, "status") ?? readNumber(source, "statusCode");
    if (status !== undefined) safe.status = status;
    const code = readShortString(source, "code");
    if (code !== undefined) safe.code = code;
    if (source.cause !== undefined && source.cause !== null) {
        safe.cause = safeErrorForLog(source.cause, depth + 1);
    }
    return safe;
}

/**
 * A request path safe to log: no query string, no credential segment.
 *
 * A query string carries filenames and search terms. A path SEGMENT can be
 * the credential itself — /download/:token is a signed token whose payload
 * decodes to the storage path and the filename — and an opaque token has no
 * shape that pattern matching reliably catches, so any segment that is long
 * and unpronounceable is masked on principle. Uuids are exempt: they are how
 * a support question names a document, and they are not secrets.
 */
export function safePathForLog(url: unknown, limit = MAX_LOGGED_STRING): string {
    if (typeof url !== "string" || url.length === 0) return "";
    const withoutQuery = url.split("?")[0];
    const masked = withoutQuery
        .split("/")
        .map((segment) => {
            if (segment.length < OPAQUE_SEGMENT_LENGTH) return segment;
            if (UUID.test(segment)) return segment;
            if (!TOKEN_CHARS.test(segment)) return segment;
            return "[redacted:opaque]";
        })
        .join("/");
    return safeLogString(masked, limit);
}

/**
 * Describes a value without printing it.
 *
 * For a value that is client content by hypothesis, redaction is not enough:
 * a prompt short enough to survive truncation and containing no secret
 * pattern passes through `safeLogValue` intact. The sanitised-5xx guard is
 * exactly that case — it fires precisely BECAUSE a handler put something
 * unexpected in a response body, so the last thing to do is print it.
 *
 * What an operator needs there is which handler misbehaved and roughly how,
 * and the request id already ties the line to a reproducible request. So this
 * reports type, size and key names, and never a string's contents.
 */
export function describeForLog(value: unknown): unknown {
    if (typeof value === "string") return `string(${value.length} chars)`;
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (value === null || value === undefined) return value;
    if (value instanceof Error) {
        // A thrown Error's message is developer text far more often than
        // client content, and it is the whole diagnostic value here.
        return { name: value.name, message: safeLogString(value.message) };
    }
    if (Array.isArray(value)) return `array(${value.length} items)`;
    if (typeof value === "object") {
        return { keys: Object.keys(value as object).slice(0, MAX_KEYS) };
    }
    return `${typeof value}`;
}

/**
 * Bounded redaction for a value that is not an error — a response body a
 * handler produced, for instance. Strings are redacted and truncated, objects
 * are walked to a fixed depth and width, and anything past those limits is
 * replaced by a marker rather than dropped silently.
 */
export function safeLogValue(value: unknown, depth = 0): unknown {
    if (typeof value === "string") return safeLogString(value);
    if (typeof value === "number" || typeof value === "boolean" || value === null) {
        return value;
    }
    if (value === undefined) return undefined;
    if (typeof value === "bigint" || typeof value === "symbol") return String(value);
    if (typeof value === "function") return "[function]";
    if (value instanceof Error) return safeErrorForLog(value, depth);
    if (depth >= MAX_DEPTH) return "[nested too deeply]";

    if (Array.isArray(value)) {
        const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => safeLogValue(item, depth + 1));
        if (value.length > MAX_ARRAY_ITEMS) {
            items.push(`[${value.length - MAX_ARRAY_ITEMS} more items]`);
        }
        return items;
    }

    const out: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>);
    for (const [key, item] of entries.slice(0, MAX_KEYS)) {
        // A key that names a secret is dropped whatever its value looks like:
        // an encrypted blob and a plaintext key are indistinguishable here.
        out[key] = SECRET_ENV_NAME.test(key.toUpperCase())
            ? "[redacted]"
            : safeLogValue(item, depth + 1);
    }
    if (entries.length > MAX_KEYS) out["…"] = `[${entries.length - MAX_KEYS} more keys]`;
    return out;
}
