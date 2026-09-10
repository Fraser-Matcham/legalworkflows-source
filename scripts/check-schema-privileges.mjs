#!/usr/bin/env node
/**
 * Fails the build when a table in the fresh-install schema is left reachable
 * by the `anon` or `authenticated` roles.
 *
 * The security model this service runs on: the backend connects as the
 * Supabase service role and is the ONLY thing that reads client data. Every
 * table is taken away from `anon` and `authenticated` so that PostgREST — the
 * REST API Supabase exposes on the same database, reachable by anyone holding
 * the publishable key — cannot serve a row at all. Row-level security is a
 * second layer on top of that on some tables, never a substitute: with the
 * privilege granted and no policy, a table is deny-all; with the privilege
 * granted and RLS never enabled, it is world-readable to any signed-in user.
 *
 * Why this check exists rather than trusting review: `revoke` statements sit
 * hundreds of lines away from the `create table` they protect, in a block of
 * fifty near-identical lines. Adding a table and forgetting its line changes
 * nothing that any test can observe — the backend uses the service role, so
 * every test passes either way. That is exactly how quick_actions and
 * default_workflow_installations came to be missing theirs.
 *
 * The schema-drift workflow cannot cover this, for a subtler reason than it
 * first appears. It does run against a real Supabase database, and it does
 * grant the roles usage on `public` — but it starts each path with
 * `drop schema public cascade; create schema public;`, and dropping a schema
 * takes its `pg_default_acl` entries with it. Supabase's default privileges,
 * the thing that would actually hand a new table to `anon` and
 * `authenticated`, are gone by the time either path creates a table. So a
 * missing `revoke` is a no-op on BOTH sides, the fingerprints agree, and the
 * check passes while a real project — where those default privileges are
 * still in force — would be exposed. This check reads the file instead.
 *
 * Usage:
 *   node scripts/check-schema-privileges.mjs             check schema.sql
 *   node scripts/check-schema-privileges.mjs --self-test prove the check fires
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const SCHEMA_PATH = join(ROOT, "backend/schema.sql");
const ALLOWLIST_PATH = join(here, "schema-privileges-allowlist.json");

const CREATE_TABLE = /^create table (?:if not exists )?public\.(\w+)/gm;
const REVOKE = /^revoke all on public\.(\w+) from anon, authenticated;/gm;
const ENABLE_RLS = /^alter table (?:only )?public\.(\w+) enable row level security;/gm;

function names(source, pattern) {
    return new Set([...source.matchAll(pattern)].map((m) => m[1]));
}

/**
 * Returns the tables that no `revoke` protects, with whether RLS covers them,
 * so the report can distinguish "unprotected" from "protected only by RLS".
 */
export function audit(schemaSql) {
    const tables = names(schemaSql, CREATE_TABLE);
    const revoked = names(schemaSql, REVOKE);
    const rls = names(schemaSql, ENABLE_RLS);
    const missing = [...tables]
        .filter((t) => !revoked.has(t))
        .sort()
        .map((table) => ({ table, rls: rls.has(table) }));
    return { total: tables.size, revoked: revoked.size, missing };
}

function loadAllowlist() {
    let raw;
    try {
        raw = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
    } catch (err) {
        if (err.code === "ENOENT") return new Map();
        throw err;
    }
    const byTable = new Map();
    for (const entry of raw) {
        if (!entry.table || !entry.reason) {
            console.error(
                `Allowlist entry needs a table and a reason: ${JSON.stringify(entry)}`,
            );
            process.exit(1);
        }
        byTable.set(entry.table, entry);
    }
    return byTable;
}

function selfTest() {
    const clean = [
        "create table if not exists public.widgets (id uuid);",
        "revoke all on public.widgets from anon, authenticated;",
    ].join("\n");
    const naked = "create table if not exists public.widgets (id uuid);";
    const rlsOnly = [
        "create table if not exists public.widgets (id uuid);",
        "alter table public.widgets enable row level security;",
    ].join("\n");

    const checks = [
        ["a revoked table passes", audit(clean).missing.length === 0],
        ["a table with no revoke fails", audit(naked).missing.length === 1],
        [
            "RLS alone is still reported, and reported as RLS-only",
            audit(rlsOnly).missing.length === 1 && audit(rlsOnly).missing[0].rls === true,
        ],
        [
            "the real schema is the shape this check assumes",
            audit(readFileSync(SCHEMA_PATH, "utf8")).total > 40,
        ],
    ];

    for (const [label, ok] of checks) console.log(`  ${ok ? "caught" : "MISSED"}  ${label}`);
    const ok = checks.every(([, passed]) => passed);
    console.log(ok ? "\nself-test passed\n" : "\nself-test FAILED\n");
    return ok;
}

if (process.argv.includes("--self-test")) {
    process.exit(selfTest() ? 0 : 1);
}

const allowlist = loadAllowlist();
const { total, revoked, missing } = audit(readFileSync(SCHEMA_PATH, "utf8"));
const explained = missing.filter((m) => allowlist.has(m.table));
const unexplained = missing.filter((m) => !allowlist.has(m.table));

if (explained.length) {
    console.log("Tables deliberately left reachable:\n");
    for (const { table } of explained) {
        console.log(`  ${table}\n    ${allowlist.get(table).reason}\n`);
    }
}

const stale = [...allowlist.keys()].filter(
    (table) => !missing.some((m) => m.table === table),
);
if (stale.length) {
    console.error("Stale allowlist entries — these tables are revoked now:\n");
    for (const table of stale) console.error(`  ${table}`);
    console.error("\nRemove them from scripts/schema-privileges-allowlist.json.");
    process.exit(1);
}

if (unexplained.length) {
    console.error("\nTables reachable by anon/authenticated in backend/schema.sql:\n");
    for (const { table, rls } of unexplained) {
        console.error(`  ${table}${rls ? "  (RLS enabled, but no revoke)" : "  (no RLS, no revoke)"}`);
    }
    console.error(
        [
            "",
            "The backend reads client data as the service role. Anything left",
            "granted to anon or authenticated is also served by PostgREST to",
            "anyone holding the publishable key, bypassing every check in",
            "backend/src/routes entirely.",
            "",
            "Add to backend/schema.sql, beside the other revokes:",
            "",
            ...unexplained.map(
                ({ table }) => `  revoke all on public.${table} from anon, authenticated;`,
            ),
            "",
            "Existing deployments need a migration too — schema.sql is only the",
            "fresh-install path. See the Database Migrations section of AGENTS.md.",
        ].join("\n"),
    );
    process.exit(1);
}

console.log(
    `Schema privileges: ${revoked}/${total} tables revoked from anon and authenticated`
        + `${explained.length ? `, ${explained.length} allowlisted` : ""}.`,
);
