#!/usr/bin/env node
/**
 * Fails the build when the frontend imports from the backend's sources.
 *
 * Until this check existed, `frontend/src/app/components/shared/types.ts`
 * pulled nine types straight out of `backend/src`. Two `import type`
 * statements — erased at compile time, invisible in the bundle, and the reason
 * the frontend could not be built on its own. `frontend/Dockerfile` had to
 * take the repository ROOT as its build context and copy the backend's source
 * tree into the image just so `next build` could typecheck. A frontend that
 * cannot be built from its own directory cannot be deployed as a component,
 * which is the whole shape of the architecture.
 *
 * The fix is the same one AGENTS.md fork rule 1 already prescribes for the
 * Juralio boundary: re-declare the types on each side. They live in
 * `frontend/src/app/components/shared/apiTypes.ts` now.
 *
 * This is deliberately narrow. It does not care about comments — five
 * frontend files reference backend paths in prose, as deliberate "mirror of
 * the server" notes, and those are documentation, not coupling. It looks only
 * for an import or require specifier that resolves into the backend.
 *
 * Usage:
 *   node scripts/check-frontend-boundary.mjs             check the tree
 *   node scripts/check-frontend-boundary.mjs --self-test prove the check fires
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");

/** Specifiers that reach the backend, however they are spelled. */
const CROSSINGS = [
    // A relative climb into backend/: "../../../../backend/src/..."
    /from\s+["'][^"']*\/backend\/src\/[^"']*["']/,
    /require\(\s*["'][^"']*\/backend\/src\/[^"']*["']\s*\)/,
    /import\(\s*["'][^"']*\/backend\/src\/[^"']*["']\s*\)/,
    // A path alias someone might add later.
    /from\s+["']@backend\/[^"']*["']/,
    /from\s+["']backend\/src\/[^"']*["']/,
];

/**
 * Strips comments before matching. A comment naming a backend file is a
 * deliberate cross-reference, not an import, and there are five of them.
 */
function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function sourceFiles(root) {
    // --cached --others --exclude-standard: tracked AND new-but-not-ignored,
    // so a file added in this very commit is checked too. A checker blind to
    // new files is the one thing it must not be.
    const out = execFileSync(
        "git",
        [
            "-C",
            root,
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
            "frontend/src",
        ],
        { encoding: "utf8" },
    );
    return out
        .split("\0")
        .filter((p) => /\.(ts|tsx|mts|cts|js|jsx|mjs)$/.test(p))
        .map((p) => join(root, p));
}

export function scan(root) {
    const findings = [];
    for (const file of sourceFiles(root)) {
        let text;
        try {
            text = stripComments(readFileSync(file, "utf8"));
        } catch {
            continue;
        }
        for (const pattern of CROSSINGS) {
            const hit = text.match(pattern);
            if (hit) {
                findings.push({
                    file: relative(root, file).split(sep).join("/"),
                    specifier: hit[0].trim(),
                });
                break;
            }
        }
    }
    return findings;
}

function selfTest() {
    const dir = mkdtempSync(join(tmpdir(), "frontend-boundary-"));
    execFileSync("git", ["-C", dir, "init", "-q"]);
    const write = (rel, body) => {
        const abs = join(dir, rel);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, body);
    };

    // Assembled so this file does not trip its own scan.
    const CROSS = ["../../../", "backend", "/src/lib/chat/types"].join("");

    write("frontend/src/clean.ts", 'import { a } from "./local";\n');
    write("frontend/src/comment.ts", `// mirrors ${CROSS}\nexport const x = 1;\n`);
    write("frontend/src/crossing.ts", `import type { T } from "${CROSS}";\n`);
    write("frontend/src/aliased.ts", 'import type { T } from "@backend/lib/x";\n');

    const found = scan(dir).map((f) => f.file);
    const has = (name) => found.some((f) => f.endsWith(name));

    const checks = [
        ["a relative climb into the backend fails", has("crossing.ts")],
        ["a path alias into the backend fails", has("aliased.ts")],
        ["a comment naming a backend file is ignored", !has("comment.ts")],
        ["a clean file reports nothing", !has("clean.ts")],
        ["an untracked new file is still scanned", has("crossing.ts")],
    ];

    for (const [label, ok] of checks) {
        console.log(`  ${ok ? "caught" : "MISSED"}  ${label}`);
    }
    const ok = checks.every(([, passed]) => passed);
    console.log(ok ? "\nself-test passed\n" : "\nself-test FAILED\n");
    return ok;
}

if (process.argv.includes("--self-test")) {
    process.exit(selfTest() ? 0 : 1);
}

const findings = scan(ROOT);
if (findings.length) {
    console.error("\nThe frontend imports from the backend's sources:\n");
    for (const { file, specifier } of findings) {
        console.error(`  ${file}\n    ${specifier}\n`);
    }
    console.error(
        [
            "This makes the frontend unbuildable on its own: its Docker build",
            "context has to become the repository root, and the backend's",
            "sources have to be copied into the image to typecheck.",
            "",
            "Re-declare the type instead, in",
            "  frontend/src/app/components/shared/apiTypes.ts",
            "",
            "That file is the HTTP contract. Duplicating a type across the",
            "boundary is the cost of the boundary, not a smell — the same",
            "rule AGENTS.md applies to the Juralio boundary.",
        ].join("\n"),
    );
    process.exit(1);
}

console.log("Frontend boundary: clean (no imports from backend/src).");
