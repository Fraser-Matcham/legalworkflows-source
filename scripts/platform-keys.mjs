#!/usr/bin/env node
/**
 * The platform's API keys: mint them from the JWT secret, and verify one
 * before it is written anywhere. Plan row 5.7, tickets 2120 and 2121.
 *
 * On Supabase the `anon` and `service_role` keys are JWTs signed with the
 * project's JWT secret. Self-hosting PostgREST and GoTrue means we hold that
 * secret (infra/modules/keys) and mint the same two tokens ourselves. That
 * retires the class of failure that stopped deploys 12 to 14: a credential
 * nobody could verify, rotate or reason about without leaving the account.
 *
 * This script is pure: it reads no AWS credential and opens no connection
 * unless `--against` asks it to. The runbook (docs/runbooks/api-keys.md)
 * composes it with the AWS CLI, so the secret is only ever in a pipe.
 *
 * Usage:
 *   node scripts/platform-keys.mjs mint   --secret-stdin [--expires-years 10]
 *       Reads the JWT secret from stdin; prints JSON {ANON_KEY, SERVICE_ROLE_KEY,
 *       ISSUED_AT, EXPIRES_AT} ready for `aws secretsmanager put-secret-value`.
 *
 *   node scripts/platform-keys.mjs verify --key <jwt> [--role anon|service_role]
 *                                         [--secret-stdin] [--against <url>]
 *       Fails loudly on anything that is not a well-formed, unexpired key with
 *       the expected role. With --secret-stdin it also checks the signature;
 *       with --against it also asks the live PostgREST and GoTrue whether
 *       they accept it (a request to /rest/v1/ and /auth/v1/settings).
 *
 *   node scripts/platform-keys.mjs --self-test
 *       Mints with a known secret, verifies, and proves a tampered key, a
 *       wrong-secret key, an expired key and a wrong-role key are all refused.
 *
 * Exit codes: 0 verified or minted; 1 a check failed; 2 bad usage.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

const TIMEOUT_MS = 15_000;

function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    return i !== -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

// --- JWT, HS256, no dependencies ------------------------------------------------

const b64url = (input) => Buffer.from(input).toString("base64url");
const fromB64url = (input) => Buffer.from(input, "base64url");

function sign(payload, secret) {
    const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const body = b64url(JSON.stringify(payload));
    const mac = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
    return `${header}.${body}.${mac}`;
}

/** Splits and parses a token without trusting it. Throws on anything malformed. */
function decode(token) {
    const parts = token.trim().split(".");
    if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
        throw new Error("not a JWT: expected three dot-separated base64url parts");
    }
    let header;
    let payload;
    try {
        header = JSON.parse(fromB64url(parts[0]).toString("utf8"));
        payload = JSON.parse(fromB64url(parts[1]).toString("utf8"));
    } catch {
        throw new Error("not a JWT: header or payload is not base64url JSON");
    }
    return { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature: parts[2] };
}

function signatureMatches(decoded, secret) {
    const expected = createHmac("sha256", secret).update(decoded.signingInput).digest();
    const actual = fromB64url(decoded.signature);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// --- the keys themselves ---------------------------------------------------------

/**
 * The claims Supabase's legacy keys carry, minus the project ref, which has no
 * meaning for a platform we run. PostgREST reads `role` and switches to it;
 * GoTrue's admin endpoints accept `service_role` because it is listed in
 * GOTRUE_JWT_ADMIN_ROLES. `iss: supabase` is what supabase-js expects to see.
 */
export function mintKeys(secret, { now = Date.now(), expiresYears = 10 } = {}) {
    if (typeof secret !== "string" || secret.length < 32) {
        throw new Error("the JWT secret must be at least 32 characters (PostgREST refuses shorter ones)");
    }
    const iat = Math.floor(now / 1000);
    const exp = iat + Math.round(expiresYears * 365.25 * 24 * 3600);
    const key = (role) => sign({ iss: "supabase", role, iat, exp }, secret);
    return {
        ANON_KEY: key("anon"),
        SERVICE_ROLE_KEY: key("service_role"),
        ISSUED_AT: new Date(iat * 1000).toISOString(),
        EXPIRES_AT: new Date(exp * 1000).toISOString(),
    };
}

/**
 * Every offline reason a key would be refused, as a list. Empty means the key
 * is well formed, unexpired, carries the expected role, and — when a secret
 * is given — was signed with it.
 */
export function offlineProblems(token, { role, secret, now = Date.now() } = {}) {
    const problems = [];
    let decoded;
    try {
        decoded = decode(token);
    } catch (error) {
        return [error.message];
    }
    if (decoded.header.alg !== "HS256") problems.push(`alg is ${decoded.header.alg ?? "missing"}, expected HS256`);
    if (decoded.payload.iss !== "supabase") problems.push(`iss is ${JSON.stringify(decoded.payload.iss)}, expected "supabase"`);
    if (!["anon", "service_role"].includes(decoded.payload.role)) {
        problems.push(`role is ${JSON.stringify(decoded.payload.role)}, expected anon or service_role`);
    } else if (role && decoded.payload.role !== role) {
        problems.push(`role is ${decoded.payload.role}, expected ${role}`);
    }
    if (typeof decoded.payload.exp !== "number") {
        problems.push("no exp claim");
    } else if (decoded.payload.exp * 1000 <= now) {
        problems.push(`expired at ${new Date(decoded.payload.exp * 1000).toISOString()}`);
    } else if (decoded.payload.exp * 1000 - now < 90 * 24 * 3600 * 1000) {
        problems.push(`expires within 90 days (${new Date(decoded.payload.exp * 1000).toISOString()}); rotate first`);
    }
    if (secret !== undefined && !signatureMatches(decoded, secret)) {
        problems.push("signature does not match the secret: this key was signed with a different JWT secret");
    }
    return problems;
}

/**
 * Ask the running platform. PostgREST answers /rest/v1/ with 200 for any key
 * it accepts and 401 for one it does not; GoTrue answers /auth/v1/settings
 * the same way. Both are read-only, unauthenticated-to-the-user probes.
 */
export async function onlineProblems(token, baseUrl, { fetchImpl = fetch } = {}) {
    const origin = baseUrl.replace(/\/+$/, "");
    const problems = [];
    const probes = [
        { name: "PostgREST", url: `${origin}/rest/v1/` },
        { name: "GoTrue", url: `${origin}/auth/v1/settings` },
    ];
    for (const probe of probes) {
        let res;
        try {
            res = await fetchImpl(probe.url, {
                headers: { apikey: token, authorization: `Bearer ${token}` },
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
        } catch (error) {
            problems.push(`${probe.name}: ${probe.url} unreachable (${error.message})`);
            continue;
        }
        if (res.status === 401 || res.status === 403) {
            problems.push(`${probe.name} refused the key (${res.status})`);
        } else if (res.status >= 500) {
            problems.push(`${probe.name} answered ${res.status}; the service is not healthy, so the key was not tested`);
        } else if (!res.ok) {
            problems.push(`${probe.name} answered ${res.status}, expected 200`);
        }
    }
    return problems;
}

// --- commands -----------------------------------------------------------------------

function readSecretFromStdin() {
    const raw = readFileSync(0, "utf8").trim();
    if (!raw) {
        console.error("no secret on stdin");
        process.exit(2);
    }
    return raw;
}

async function main() {
    const command = process.argv[2];

    if (flag("self-test")) {
        process.exit((await selfTest()) ? 0 : 1);
    }

    if (command === "mint") {
        if (!flag("secret-stdin")) {
            console.error("mint reads the JWT secret from stdin: pass --secret-stdin and pipe it in");
            process.exit(2);
        }
        const secret = readSecretFromStdin();
        const keys = mintKeys(secret, { expiresYears: Number(arg("expires-years", "10")) });
        for (const [name, token] of [["ANON_KEY", keys.ANON_KEY], ["SERVICE_ROLE_KEY", keys.SERVICE_ROLE_KEY]]) {
            const problems = offlineProblems(token, { secret });
            if (problems.length) {
                console.error(`refusing to print ${name}: ${problems.join("; ")}`);
                process.exit(1);
            }
        }
        process.stdout.write(`${JSON.stringify(keys, null, 2)}\n`);
        return;
    }

    if (command === "verify") {
        const token = arg("key");
        if (!token) {
            console.error("verify needs --key <jwt>");
            process.exit(2);
        }
        const role = arg("role");
        const secret = flag("secret-stdin") ? readSecretFromStdin() : undefined;
        const problems = offlineProblems(token, { role, secret });
        const against = arg("against");
        if (problems.length === 0 && against) {
            problems.push(...(await onlineProblems(token, against)));
        }
        const decoded = problems[0]?.startsWith("not a JWT") ? null : decode(token);
        const summary = decoded
            ? `role=${decoded.payload.role} issued=${new Date(decoded.payload.iat * 1000).toISOString()} expires=${new Date(decoded.payload.exp * 1000).toISOString()}`
            : "(undecodable)";
        if (problems.length) {
            console.error(`REFUSED ${summary}`);
            for (const p of problems) console.error(`  - ${p}`);
            console.error(secret === undefined ? "  (signature not checked: no --secret-stdin)" : "  (signature checked)");
            console.error(against ? "  (live services checked)" : "  (live services not checked: no --against)");
            process.exit(1);
        }
        console.log(`VERIFIED ${summary}`);
        console.log(secret === undefined ? "  signature: not checked (no --secret-stdin)" : "  signature: matches the secret");
        console.log(against ? `  live: PostgREST and GoTrue at ${against} accept it` : "  live: not checked (no --against)");
        return;
    }

    console.error("usage: platform-keys.mjs mint --secret-stdin | verify --key <jwt> [--role r] [--secret-stdin] [--against url] | --self-test");
    process.exit(2);
}

// --- self-test ------------------------------------------------------------------------

async function selfTest() {
    const secret = "self-test-secret-that-is-at-least-thirty-two-characters-long";
    const other = "another-secret-that-is-also-at-least-thirty-two-characters";
    const failures = [];
    const expect = (name, condition) => {
        console.log(`${condition ? "ok  " : "FAIL"} ${name}`);
        if (!condition) failures.push(name);
    };

    const keys = mintKeys(secret, { now: Date.parse("2026-09-17T00:00:00Z") });
    expect("mints two keys with the right roles",
        offlineProblems(keys.ANON_KEY, { role: "anon", secret, now: Date.parse("2026-09-17T00:00:00Z") }).length === 0
        && offlineProblems(keys.SERVICE_ROLE_KEY, { role: "service_role", secret, now: Date.parse("2026-09-17T00:00:00Z") }).length === 0);
    expect("expiry defaults to ten years", keys.EXPIRES_AT.startsWith("2036-09-1"));
    expect("refuses a secret under 32 characters", (() => { try { mintKeys("short"); return false; } catch { return true; } })());
    expect("refuses the wrong role", offlineProblems(keys.ANON_KEY, { role: "service_role" }).some((p) => p.includes("expected service_role")));
    expect("refuses a key signed with another secret", offlineProblems(keys.ANON_KEY, { secret: other }).some((p) => p.includes("different JWT secret")));
    const [h, p, s] = keys.ANON_KEY.split(".");
    const tamperedPayload = b64url(JSON.stringify({ ...JSON.parse(fromB64url(p).toString()), role: "service_role" }));
    expect("refuses a tampered payload", offlineProblems(`${h}.${tamperedPayload}.${s}`, { secret }).some((p) => p.includes("different JWT secret")));
    expect("refuses an expired key", offlineProblems(keys.ANON_KEY, { now: Date.parse("2040-01-01T00:00:00Z") }).some((p) => p.startsWith("expired")));
    expect("warns inside 90 days of expiry", offlineProblems(keys.ANON_KEY, { now: Date.parse("2036-08-01T00:00:00Z") }).some((p) => p.includes("within 90 days")));
    expect("refuses something that is not a JWT", offlineProblems("sb_secret_abc123")[0].startsWith("not a JWT"));
    expect("refuses an unsubstituted placeholder", offlineProblems("<paste the key here>")[0].startsWith("not a JWT"));
    expect("refuses a key without an iss claim",
        offlineProblems(sign({ role: "anon", iat: 1, exp: 4102444800 }, secret), { secret }).some((p) => p.includes("iss")));

    const accepting = async () => new Response("{}", { status: 200 });
    const refusing = async () => new Response("{}", { status: 401 });
    const down = async () => new Response("", { status: 503 });
    expect("live check passes when both services accept", (await onlineProblems(keys.ANON_KEY, "https://example.test", { fetchImpl: accepting })).length === 0);
    expect("live check fails when a service refuses", (await onlineProblems(keys.ANON_KEY, "https://example.test", { fetchImpl: refusing })).length === 2);
    expect("live check does not pass a key against a service that is down", (await onlineProblems(keys.ANON_KEY, "https://example.test", { fetchImpl: down })).some((p) => p.includes("not healthy")));

    console.log(failures.length ? `\n${failures.length} self-test check(s) failed` : "\nself-test passed");
    return failures.length === 0;
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
