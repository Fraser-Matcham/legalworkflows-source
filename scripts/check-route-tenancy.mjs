#!/usr/bin/env node
/**
 * Flags route handlers that query the database without ever using the
 * caller's identity.
 *
 * The architecture invites one particular mistake. Every query runs through
 * createServerSupabase(), which holds the service role key and therefore
 * bypasses row-level security completely: RLS is deny-all and the API is
 * trusted to scope every read and write itself. A handler that forgets is not
 * caught by the database, does not throw, and returns another tenant's rows
 * looking exactly like a working feature.
 *
 * What this checks, and why it is shaped this way. An earlier version matched
 * a list of known access helpers (ensureDocAccess, checkProjectAccess, and so
 * on) and flagged 35 of 190 handlers — almost all of them false, because
 * handlers routinely guard through their own local helpers. wordChat's
 * GET /:chatId, for instance, scopes through getWordDocumentRowId and
 * getAccessibleWordChat, neither of which a hardcoded list would know. A list
 * of helper names is unmaintainable and the noise would get the check
 * disabled.
 *
 * So the rule is weaker but far more robust: a handler that queries the
 * database and never mentions `userId` or `userEmail` beyond their own
 * declaration cannot be scoping to the caller, whatever helpers it uses. That
 * flags 3 of 190 — few enough that every one can carry a written reason.
 *
 * It is a smell detector, not a proof. It cannot tell whether an identity that
 * IS mentioned is applied to the right query, which is what the cross-tenant
 * denial tests in src/__tests__/integration/*.crossTenant.test.ts are for.
 * The two are complements: this one is cheap and catches the whole-handler
 * omission; those are expensive and catch the per-query one.
 *
 * Usage:
 *   node scripts/check-route-tenancy.mjs             scan backend/src/routes
 *   node scripts/check-route-tenancy.mjs --self-test prove the check fires
 */

import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROUTES_DIR = join(here, "..", "backend", "src", "routes");
const ALLOWLIST_PATH = join(here, "route-tenancy-allowlist.json");

/** A database read or write. */
const QUERY = /\.from\(|\.rpc\(/;
/** One route registration; handlers run from here to the next one. */
const HANDLER = /^\s*\w+Router\.(get|post|put|patch|delete)\(/gm;

function identityMentions(body) {
    return (
        (body.match(/\buserId\b/g) ?? []).length +
        (body.match(/\buserEmail\b/g) ?? []).length
    );
}

export function scanRoutes(dir) {
    const findings = [];
    if (!existsSync(dir)) return findings;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
        const src = readFileSync(join(dir, file), "utf8");
        const starts = [...src.matchAll(HANDLER)].map((m) => m.index);
        for (let i = 0; i < starts.length; i++) {
            const body = src.slice(starts[i], starts[i + 1] ?? src.length);
            if (!QUERY.test(body)) continue;
            // Two mentions is the floor: the declaration plus one use. A
            // handler that declares the identity and never uses it is exactly
            // the case worth flagging.
            if (identityMentions(body) >= 2) continue;
            // Signature is method + path, NOT a line number: adding a
            // handler above an allowlisted one would shift every line and
            // mark valid entries stale, failing the build with advice that is
            // wrong. That is how a check earns its way into being disabled.
            const method = /Router\.(get|post|put|patch|delete)\(/
                .exec(body)?.[1]
                .toUpperCase();
            const path = /["'`]([^"'`]*)["'`]/.exec(body.slice(0, 300))?.[1];
            const line = src.slice(0, starts[i]).split("\n").length;
            findings.push({
                signature: `${file} ${method} ${path ?? "?"}`,
                line,
            });
        }
    }
    return findings;
}

function loadAllowlist() {
    const raw = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
    const byHandler = new Map();
    for (const entry of raw) {
        if (!entry.handler || !entry.reason) {
            console.error(
                `Allowlist entry missing handler or reason: ${JSON.stringify(entry)}`,
            );
            process.exit(1);
        }
        byHandler.set(entry.handler, entry.reason);
    }
    return byHandler;
}

/** Prove the check fires, using a fixture rather than the real tree. */
function selfTest() {
    const dir = mkdtempSync(join(tmpdir(), "tenancy-selftest-"));
    mkdirSync(dir, { recursive: true });

    writeFileSync(
        join(dir, "unguarded.ts"),
        `thingRouter.get("/:id", requireAuth, async (req, res) => {
  const db = createServerSupabase();
  const { data } = await db.from("things").select("*").eq("id", req.params.id);
  res.json(data);
});
`,
    );
    writeFileSync(
        join(dir, "guarded.ts"),
        `thingRouter.get("/:id", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const db = createServerSupabase();
  const { data } = await db.from("things").select("*").eq("user_id", userId);
  res.json(data);
});
`,
    );

    const found = scanRoutes(dir).map((f) => f.signature);
    const caught = found.some((s) => s.startsWith("unguarded.ts"));
    const quiet = !found.some((s) => s.startsWith("guarded.ts"));
    console.log(`  ${caught ? "caught" : "MISSED"}  a query with no identity use`);
    console.log(`  ${quiet ? "caught" : "MISSED"}  a scoped query reports nothing`);
    const ok = caught && quiet;
    console.log(ok ? "\nself-test passed\n" : "\nself-test FAILED\n");
    return ok;
}

if (process.argv.includes("--self-test")) {
    process.exit(selfTest() ? 0 : 1);
}

const allowlist = loadAllowlist();
const findings = scanRoutes(ROUTES_DIR);
const unexplained = findings.filter((f) => !allowlist.has(f.signature));
const explained = findings.filter((f) => allowlist.has(f.signature));

// Print the allowlisted ones on every run so they stay visible rather than
// becoming permanent furniture, exactly as the npm advisory gate does.
if (explained.length) {
    console.log("Allowlisted handlers (query the database without using the caller's identity):\n");
    for (const f of explained) {
        console.log(`  ${f.signature}  (${f.line})`);
        console.log(`    ${allowlist.get(f.signature)}\n`);
    }
}

// An allowlist entry whose handler has moved or been fixed is stale: it would
// silently cover whatever later lands on that line.
const stale = [...allowlist.keys()].filter(
    (sig) => !findings.some((f) => f.signature === sig),
);
if (stale.length) {
    console.error("Stale allowlist entries — the handler moved or is now scoped:\n");
    for (const sig of stale) console.error(`  ${sig}`);
    console.error("\nRemove them from scripts/route-tenancy-allowlist.json.");
    process.exit(1);
}

if (unexplained.length) {
    console.error("\nRoute handlers query the database without using the caller's identity:\n");
    for (const f of unexplained) {
        console.error(`  ${f.signature}  (line ${f.line})`);
    }
    console.error("");
    console.error(
        [
            "createServerSupabase() uses the service role key, so row-level",
            "security does not apply: the handler is the only thing scoping the",
            "query. A handler that never uses userId or userEmail cannot be",
            "scoping to the caller.",
            "",
            "Either scope the query, or add the handler to",
            "scripts/route-tenancy-allowlist.json with a reason saying why the",
            "data is not tenant-scoped.",
        ].join("\n"),
    );
    process.exit(1);
}

console.log(
    `Route tenancy: clean (${findings.length} allowlisted, no unexplained handlers).`,
);
