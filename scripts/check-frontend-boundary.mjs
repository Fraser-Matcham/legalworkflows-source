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
 * It happened again through the other neighbour. Three parity tests under
 * `frontend/src/wordAddin/` import `../../../word-addin/src/...`, which this
 * check did not look for because it only knew the word "backend". `next build`
 * type-checks everything in tsconfig's include, the Docker context is
 * `frontend/` alone, and the release died on TS2307 — the identical failure,
 * two directories over. So the crossings below name every neighbour, and
 * anything excluded from the Next build is listed once, in tsconfig, and read
 * from there rather than repeated here.
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
    // The same climb into word-addin/: "../../../word-addin/src/..."
    /from\s+["'][^"']*\/word-addin\/src\/[^"']*["']/,
    /require\(\s*["'][^"']*\/word-addin\/src\/[^"']*["']\s*\)/,
    /import\(\s*["'][^"']*\/word-addin\/src\/[^"']*["']\s*\)/,
    // A path alias someone might add later.
    /from\s+["']@backend\/[^"']*["']/,
    /from\s+["']backend\/src\/[^"']*["']/,
    /from\s+["']@word-addin\/[^"']*["']/,
    /from\s+["']word-addin\/src\/[^"']*["']/,
];

/**
 * Paths `next build` does not type-check, read from frontend/tsconfig.json's
 * own `exclude` rather than repeated here — two lists that must agree are one
 * list that will not. A file outside the build's scope may reach into a
 * sibling app, because nothing tries to compile it from `frontend/` alone.
 *
 * Vitest still runs those files from a full checkout, so the import has to
 * resolve for the test to pass; what is given up is static checking, not the
 * parity guarantee itself.
 */
function excludedFromNextBuild(root) {
    const raw = readFileSync(join(root, "frontend", "tsconfig.json"), "utf8");
    const { exclude = [] } = JSON.parse(stripJsonComments(raw));
    return exclude
        .filter((pattern) => pattern.endsWith("/**"))
        .map((pattern) => `frontend/${pattern.slice(0, -"/**".length)}/`);
}

/**
 * Comment-stripping for tsconfig, which is JSON with comments.
 *
 * `stripComments` above cannot do this: it is written for TypeScript source
 * and works by regex, so the path alias `"@/*"` reads to it as the start of a
 * block comment and it deletes the rest of the file. That produced a config
 * that still parsed as far as a `catch`, which then quietly excluded nothing —
 * a check that had stopped doing its job while reporting success.
 *
 * So: a scanner that knows it is inside a string literal.
 */
function stripJsonComments(text) {
    let out = "";
    let inString = false;
    let escaped = false;
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (inString) {
            out += ch;
            if (escaped) escaped = false;
            else if (ch === "\\") escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') {
            inString = true;
            out += ch;
            continue;
        }
        if (ch === "/" && text[i + 1] === "/") {
            while (i < text.length && text[i] !== "\n") i += 1;
            out += "\n";
            continue;
        }
        if (ch === "/" && text[i + 1] === "*") {
            i += 2;
            while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
            i += 1;
            continue;
        }
        out += ch;
    }
    return out;
}

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
    let excluded = [];
    try {
        excluded = excludedFromNextBuild(root);
    } catch (error) {
        // A missing tsconfig is the self-test's fixture: nothing is excluded,
        // every file is in scope, and the check is stricter rather than
        // weaker. A tsconfig that is present but unreadable is different —
        // that is this check silently losing a rule it thinks it has, which
        // is how it stopped working the first time. Say so.
        if (error?.code !== "ENOENT") {
            throw new Error(
                `frontend/tsconfig.json could not be read for its exclude list: ${error.message}`,
            );
        }
    }
    for (const file of sourceFiles(root)) {
        const rel = relative(root, file).split(sep).join("/");
        if (excluded.some((prefix) => rel.startsWith(prefix))) continue;
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
    const ADDIN = ["../../../", "word-addin", "/src/taskpane/lib/modelCatalog"].join("");

    write("frontend/src/clean.ts", 'import { a } from "./local";\n');
    write("frontend/src/comment.ts", `// mirrors ${CROSS}\nexport const x = 1;\n`);
    write("frontend/src/crossing.ts", `import type { T } from "${CROSS}";\n`);
    write("frontend/src/aliased.ts", 'import type { T } from "@backend/lib/x";\n');
    write("frontend/src/addin.ts", `import { c } from "${ADDIN}";\n`);
    write("frontend/src/excluded/parity.test.ts", `import { c } from "${ADDIN}";\n`);

    // The real tsconfig carries a "@/*" path alias, which the regex-based
    // stripComments above reads as the start of a block comment and deletes
    // the rest of the file for. That silently produced an empty exclude list.
    // The fixture carries the same alias so the self-test would catch it.
    write(
        "frontend/tsconfig.json",
        [
            "{",
            '  "compilerOptions": {',
            '    "paths": { "@/*": ["./src/*"] }',
            "  },",
            '  // a comment, because tsconfig is JSON with comments',
            '  "exclude": ["node_modules", "src/excluded/**"]',
            "}",
            "",
        ].join("\n"),
    );

    const found = scan(dir).map((f) => f.file);
    const has = (name) => found.some((f) => f.endsWith(name));

    const checks = [
        ["a relative climb into the backend fails", has("crossing.ts")],
        ["a path alias into the backend fails", has("aliased.ts")],
        ["a relative climb into the word add-in fails", has("addin.ts")],
        ["a comment naming a backend file is ignored", !has("comment.ts")],
        ["a clean file reports nothing", !has("clean.ts")],
        ["an untracked new file is still scanned", has("crossing.ts")],
        [
            "a file tsconfig excludes from the build is not flagged",
            !has("parity.test.ts"),
        ],
        [
            "the exclude list survives a \"@/*\" path alias in tsconfig",
            excludedFromNextBuild(dir).some((p) => p.endsWith("src/excluded/")),
        ],
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
    console.error("\nThe frontend imports from a sibling app's sources:\n");
    for (const { file, specifier } of findings) {
        console.error(`  ${file}\n    ${specifier}\n`);
    }
    console.error(
        [
            "This makes the frontend unbuildable on its own. `next build`",
            "type-checks everything tsconfig includes, and the Docker build",
            "context is `frontend/` alone — so the sibling's sources are not",
            "there and the build dies on TS2307, taking the release with it.",
            "",
            "For a type: re-declare it, in",
            "  frontend/src/app/components/shared/apiTypes.ts",
            "That file is the HTTP contract. Duplicating a type across the",
            "boundary is the cost of the boundary, not a smell — the same",
            "rule AGENTS.md applies to the Juralio boundary.",
            "",
            "For a test that genuinely needs both sides, like the catalogue",
            "parity tests: add it to `exclude` in frontend/tsconfig.json, with",
            "a comment saying why. `next build` then leaves it alone, Vitest",
            "still runs it from a full checkout, and this check reads that",
            "same exclude list so the two cannot disagree.",
        ].join("\n"),
    );
    process.exit(1);
}

console.log("Frontend boundary: clean (nothing in the Next build reaches outside frontend/).");
