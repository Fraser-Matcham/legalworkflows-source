#!/usr/bin/env node
/**
 * Fails the build when docs/api-contract.md stops describing what
 * backend/src/app.ts actually mounts.
 *
 * The contract exists because the frontend, the Word add-in and (later)
 * Juralio call this service over HTTP, and Juralio may not import anything
 * from this repository at all — AGENTS.md fork rule 1. A written contract is
 * the only thing that crosses that boundary, which makes a stale one worse
 * than none: a consumer builds against a promise nobody is keeping.
 *
 * So this is deliberately narrow. It does not validate request or response
 * shapes — that would need a schema the routes do not carry, and a checker
 * that lies about how much it verifies is its own hazard. It checks the one
 * thing that is both mechanical and load-bearing: **every router mounted in
 * app.ts appears in the contract's mount table, and nothing in that table has
 * stopped being mounted.**
 *
 * Usage:
 *   node scripts/check-api-contract.mjs             check the tree
 *   node scripts/check-api-contract.mjs --self-test prove the check fires
 */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");

const APP = "backend/src/app.ts";
const DOC = "docs/api-contract.md";

/**
 * Router mounts, and only router mounts.
 *
 * `app.use("/auth", authRouter)` is a mount. `app.use(generalLimiter)` and
 * `app.post("/auth/login", authLoginIpLimiter)` are not — the second is a rate
 * limiter attached to a path, and counting it as an endpoint would put
 * `/auth/login` in the contract as though it were a mount of its own. The
 * `Router` suffix on the second argument is what separates them.
 */
function mountedPrefixes(source) {
    const mounts = new Set();
    const re = /app\.use\(\s*"([^"]+)"\s*,\s*([A-Za-z0-9_]+)\s*\)/g;
    for (const [, path, handler] of source.matchAll(re)) {
        if (/Router$/.test(handler)) mounts.add(path);
    }
    return mounts;
}

/**
 * Standalone endpoints: app.get("/x", <handler>) rather than a router.
 * Matched separately because they are documented in their own table — they
 * have no router and no sub-paths.
 *
 * The handler takes two shapes, and the distinction from a rate limiter is
 * the whole difficulty:
 *
 *   app.get("/health", (_req, res) => …)          an inline handler
 *   app.get("/metrics", metricsHandler(registry)) a handler from a factory
 *   app.get("/user/export", exportLimiter)        NOT an endpoint — a limiter
 *                                                 attached to a path that a
 *                                                 router serves
 *
 * So the rule is: an inline function or a **call expression** is the handler;
 * a bare identifier is middleware. That keeps the limiter lines out, as the
 * note on mountedPrefixes requires, while closing the gap that a factory-built
 * handler used to slip through — an endpoint the gate could not see is exactly
 * the stale contract this script exists to prevent.
 */
function standaloneEndpoints(source) {
    const found = new Set();
    const re =
        /app\.get\(\s*"([^"]+)"\s*,\s*(?:(?:async\s*)?\(|[A-Za-z_$][\w$]*\s*\()/g;
    for (const [, path] of source.matchAll(re)) found.add(path);
    return found;
}

/** Every `/path` in a markdown table cell of the contract. */
function documentedPaths(doc) {
    const found = new Set();
    for (const line of doc.split("\n")) {
        if (!line.startsWith("|")) continue;
        const first = line.split("|")[1] ?? "";
        for (const [, path] of first.matchAll(/`(?:GET\s+)?(\/[^`]*)`/g)) {
            found.add(path);
        }
    }
    return found;
}

export function scan(root) {
    const source = readFileSync(join(root, APP), "utf8");
    const doc = readFileSync(join(root, DOC), "utf8");

    const mounts = mountedPrefixes(source);
    const standalone = standaloneEndpoints(source);
    const expected = new Set([...mounts, ...standalone]);
    const documented = documentedPaths(doc);

    return {
        undocumented: [...expected].filter((p) => !documented.has(p)).sort(),
        stale: [...documented]
            .filter((p) => !expected.has(p) && p.startsWith("/"))
            .sort(),
        counted: expected.size,
    };
}

function selfTest() {
    const dir = mkdtempSync(join(tmpdir(), "api-contract-"));
    const write = (rel, body) => {
        const abs = join(dir, rel);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, body);
    };

    const app = (extra = "") => `
app.use(generalLimiter);
app.post("/auth/login", authLoginIpLimiter);
app.use("/auth", authRouter);
app.use("/chat", chatRouter);
${extra}
app.get("/health", (_req, res) => res.json({ ok: true }));
`;
    const doc = (extra = "") => `
| Prefix | What |
| --- | --- |
| \`/auth\` | Sign-in |
| \`/chat\` | Assistant |
${extra}
| \`GET /health\` | Liveness |
`;

    const cases = [];

    write(APP, app());
    write(DOC, doc());
    let r = scan(dir);
    cases.push([
        "a matching tree reports nothing",
        r.undocumented.length === 0 && r.stale.length === 0,
    ]);
    cases.push([
        "a rate limiter on a path is not mistaken for a mount",
        !r.undocumented.includes("/auth/login") &&
            !r.stale.includes("/auth/login"),
    ]);

    write(
        APP,
        app('app.get("/metrics", metricsHandler(registry));'),
    );
    write(DOC, doc());
    r = scan(dir);
    cases.push([
        "an endpoint whose handler comes from a factory is seen",
        r.undocumented.includes("/metrics"),
    ]);

    write(APP, app('app.get("/user/export", exportLimiter);'));
    write(DOC, doc());
    r = scan(dir);
    cases.push([
        "a bare-identifier limiter on a path is still not an endpoint",
        !r.undocumented.includes("/user/export"),
    ]);

    write(APP, app('app.use("/orgs", orgsRouter);'));
    write(DOC, doc());
    r = scan(dir);
    cases.push([
        "a newly mounted router that is not documented fails",
        r.undocumented.includes("/orgs"),
    ]);

    write(APP, app());
    write(DOC, doc("| `/gone` | Removed |"));
    r = scan(dir);
    cases.push([
        "a documented prefix that is no longer mounted fails",
        r.stale.includes("/gone"),
    ]);

    for (const [label, ok] of cases) {
        console.log(`  ${ok ? "caught" : "MISSED"}  ${label}`);
    }
    const ok = cases.every(([, passed]) => passed);
    console.log(ok ? "\nself-test passed\n" : "\nself-test FAILED\n");
    return ok;
}

if (process.argv.includes("--self-test")) {
    process.exit(selfTest() ? 0 : 1);
}

const { undocumented, stale, counted } = scan(ROOT);

if (undocumented.length || stale.length) {
    console.error(`\n${DOC} no longer matches ${APP}:\n`);
    for (const path of undocumented) {
        console.error(`  mounted but not documented:  ${path}`);
    }
    for (const path of stale) {
        console.error(`  documented but not mounted:  ${path}`);
    }
    console.error(
        [
            "",
            "The frontend, the Word add-in and Juralio build against this",
            "document. Juralio may not import anything from this repository",
            "(AGENTS.md fork rule 1), so the written contract is the only",
            "thing that crosses the boundary — a stale one is worse than none.",
            "",
            `Update the mount table in ${DOC}.`,
        ].join("\n"),
    );
    process.exit(1);
}

console.log(`API contract: clean (${counted} mounts and endpoints documented).`);
