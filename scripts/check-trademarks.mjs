#!/usr/bin/env node
/**
 * Fails the build when an upstream trademark reaches a user-visible surface.
 *
 * Neither licence grants the upstream marks. AGPL section 7(e) and Apache
 * section 2.0 section 6 both reserve them, so the name, wordmark and domain
 * must not appear anywhere a person or a link preview can see them.
 *
 * The nuance that makes this check subtle, and the reason it has an allowlist
 * rather than a blanket ban: AGPL section 5(a) and 5(b) REQUIRE naming the
 * original work. The /legal page must say this service is a modified version
 * of Mike by Open Legal Products, and frontend/src/app/lib/legalNotice.ts
 * holds those strings. That is nominative use — attribution, not branding —
 * and stripping it to satisfy a trademark sweep would breach the licence. A
 * future cleanup that "finishes the debranding" by deleting those constants
 * would be a licence violation, so they are allowlisted with that written
 * reason rather than left to look like an oversight.
 *
 * Scope. Only surfaces a user can see: rendered copy, page titles, metadata,
 * the add-in manifest. Comments are stripped from TypeScript before matching,
 * because fork rule 2 keeps internal identifiers deliberately (mikeApi.ts,
 * mike_workflows, MIKE_WORKFLOWS_*) and a find-and-replace across this
 * repository is always wrong.
 *
 * Signatures are file + mark + occurrence count, never line numbers: a line
 * number goes stale the moment anything above it moves, and a bare file+mark
 * pair would silently cover a NEW occurrence added to an already-allowlisted
 * file. The count closes that gap.
 *
 * Usage:
 *   node scripts/check-trademarks.mjs             sweep the shipped surfaces
 *   node scripts/check-trademarks.mjs --self-test prove the check fires
 */

import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const ALLOWLIST_PATH = join(here, "trademark-allowlist.json");

/** Surfaces a user or a link preview can see. */
const SURFACES = [
    "frontend/src",
    "word-addin/src",
    "word-addin/manifest.xml",
];

const SKIP_DIRS = new Set([
    "node_modules", ".next", "coverage", "dist", "build", "__tests__",
]);
const TEXT_EXT = new Set([".ts", ".tsx", ".html", ".xml", ".css", ".json"]);

/** How to recognise a comment in each surface, so comments can be dropped. */
const COMMENT_SYNTAX = {
    ".ts": ["block", "line"],
    ".tsx": ["block", "line"],
    ".css": ["block"],
    ".html": ["markup"],
    ".xml": ["markup"],
};

/** The upstream marks: name, wordmark and domain. */
const MARKS = [
    { name: "Mike", re: /\bMike(OSS)?\b/g },
    { name: "mikeoss.com", re: /mikeoss\.com/g },
    { name: "Open Legal Products", re: /Open[- ]Legal[- ]Products/gi },
];

/**
 * Comments are internal. Fork rule 2 keeps inherited identifiers on purpose,
 * and a comment explaining one is not a user-visible surface. A CSS or markup
 * comment is as invisible as a TypeScript one, so each surface is stripped
 * with its own syntax rather than only the JavaScript pair.
 */
function stripComments(source, ext) {
    const kinds = COMMENT_SYNTAX[ext] ?? [];
    let text = source;
    if (kinds.includes("block")) text = text.replace(/\/\*[\s\S]*?\*\//g, "");
    if (kinds.includes("line")) text = text.replace(/(^|[^:])\/\/.*$/gm, "$1");
    if (kinds.includes("markup")) text = text.replace(/<!--[\s\S]*?-->/g, "");
    return text;
}

function walk(target, out = []) {
    if (!existsSync(target)) return out;
    if (statSync(target).isFile()) {
        out.push(target);
        return out;
    }
    for (const entry of readdirSync(target)) {
        if (SKIP_DIRS.has(entry)) continue;
        walk(join(target, entry), out);
    }
    return out;
}

export function sweep(root, surfaces = SURFACES) {
    const findings = new Map();
    for (const surface of surfaces) {
        for (const file of walk(join(root, surface))) {
            const ext = extname(file);
            if (!TEXT_EXT.has(ext)) continue;
            const text = stripComments(readFileSync(file, "utf8"), ext);
            const rel = relative(root, file).split(sep).join("/");
            for (const mark of MARKS) {
                const count = (text.match(mark.re) ?? []).length;
                if (!count) continue;
                findings.set(`${rel}  ${mark.name}  x${count}`, {
                    file: rel,
                    mark: mark.name,
                    count,
                });
            }
        }
    }
    return findings;
}

function loadAllowlist() {
    const raw = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
    const byKey = new Map();
    for (const entry of raw) {
        if (!entry.surface || !entry.reason) {
            console.error(`Allowlist entry missing surface or reason: ${JSON.stringify(entry)}`);
            process.exit(1);
        }
        byKey.set(entry.surface, entry);
    }
    return byKey;
}

function selfTest() {
    const dir = mkdtempSync(join(tmpdir(), "trademark-selftest-"));
    const write = (rel, body) => {
        const abs = join(dir, rel);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, body);
    };

    // Assembled at runtime so this file does not trip its own sweep.
    const NAME = ["Mi", "ke"].join("");
    write("frontend/src/visible.tsx", `export const Banner = () => <p>Powered by ${NAME}</p>;\n`);
    write("frontend/src/comment.tsx", `// a note about ${NAME}\nexport const X = 1;\n`);
    write("frontend/src/block.tsx", `/* ${NAME} lives here */\nexport const Z = 3;\n`);
    write("frontend/src/styles.css", `/* the ${NAME} palette */\n.a { color: red; }\n`);
    write("frontend/src/page.html", `<!-- ${NAME} -->\n<title>${NAME}</title>\n`);
    write("frontend/src/twice.tsx", `export const A = <p>${NAME}</p>, B = <p>${NAME}</p>;\n`);
    write("frontend/src/clean.tsx", "export const Y = 2;\n");

    const byFile = new Map();
    for (const [key, f] of sweep(dir, ["frontend/src"])) byFile.set(f.file, key);
    const has = (name) => [...byFile.keys()].some((f) => f.endsWith(name));

    const checks = [
        ["a mark in rendered copy", has("visible.tsx")],
        ["a mark in a line comment is ignored", !has("comment.tsx")],
        ["a mark in a block comment is ignored", !has("block.tsx")],
        ["a mark in a CSS comment is ignored", !has("styles.css")],
        ["a mark in a markup comment is ignored, but the title is not",
            has("page.html")
            && [...byFile.values()].some((k) => k.endsWith("page.html  Mi" + "ke  x1"))],
        ["the signature counts occurrences, so a second one is new",
            [...byFile.values()].some((k) => k.endsWith("twice.tsx  Mi" + "ke  x2"))],
        ["a clean file reports nothing", !has("clean.tsx")],
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
const findings = sweep(ROOT);
const unexplained = [...findings.keys()].filter((k) => !allowlist.has(k));
const explained = [...findings.keys()].filter((k) => allowlist.has(k));

if (explained.length) {
    console.log("Allowlisted upstream references on user-visible surfaces:\n");
    for (const key of explained) {
        const entry = allowlist.get(key);
        const label = entry.status === "deferred" ? "DEFERRED" : "permitted";
        console.log(`  [${label}] ${key}`);
        console.log(`    ${entry.reason}\n`);
    }
}

const stale = [...allowlist.keys()].filter((k) => !findings.has(k));
if (stale.length) {
    console.error("Stale allowlist entries — the surface changed or the count moved:\n");
    for (const key of stale) console.error(`  ${key}`);
    console.error("\nRe-check the surface and update scripts/trademark-allowlist.json.");
    process.exit(1);
}

if (unexplained.length) {
    console.error("\nUpstream trademarks on user-visible surfaces:\n");
    for (const key of unexplained) console.error(`  ${key}`);
    console.error(
        [
            "",
            "Neither licence grants the upstream marks: AGPL section 7(e) and",
            "Apache 2.0 section 6 both reserve them.",
            "",
            "Rename the user-visible copy, or — if this is attribution the",
            "licence REQUIRES (AGPL 5(a)/5(b) name the original work) — add it",
            "to scripts/trademark-allowlist.json with that reason.",
        ].join("\n"),
    );
    process.exit(1);
}

const deferred = explained.filter((k) => allowlist.get(k).status === "deferred");
console.log(
    `Trademarks: ${explained.length} allowlisted (${deferred.length} deferred), `
        + "no unexplained surfaces.",
);
