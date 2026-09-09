#!/usr/bin/env node
/**
 * Fails when anything in this repository reaches across the boundary to the
 * Juralio repository by any means other than HTTP.
 *
 * Why this is a build-breaking check rather than a review convention: this
 * repository is AGPL-3.0. AGPL section 5(c) applies its terms to the combined
 * work once the parts are linked, and that combination cannot be undone
 * afterwards. Juralio is Apache-2.0 and must stay Apache-2.0. A single import
 * that survives review relicenses Juralio's entire tree, and reverting the
 * commit does not undo the grant already made to anyone who received it.
 *
 * See "1. The boundary to Juralio is HTTP, and only HTTP" in AGENTS.md.
 *
 * Scope and limits. This runs inside one repository, so it can only see this
 * side of the boundary. It detects the ways this tree can reach across:
 * import/require specifiers, submodules, filesystem-protocol dependencies,
 * tsconfig path aliases and CI steps that check out another repository. It
 * cannot detect a file copied from Juralio into this tree by content hash —
 * that comparison needs both trees, so it belongs in a job that has checked
 * out both, not here. Nor does it police the Juralio side; that repository
 * needs its own copy of this check.
 *
 * Usage:
 *   node scripts/check-repo-boundary.mjs            scan this repository
 *   node scripts/check-repo-boundary.mjs --root DIR scan DIR instead
 *   node scripts/check-repo-boundary.mjs --self-test prove the checks fire
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

/** Names that identify the other side of the boundary. */
const FOREIGN = /juralio/i;

/** Dependency protocols that resolve to a path on disk rather than a registry. */
const LOCAL_PROTOCOL = /^(file|link|portal):/;

const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);
const SKIP_DIRS = new Set([
    "node_modules", ".git", "dist", "build", ".next", "coverage", "playwright-report", "test-results",
]);

function listFiles(root) {
    try {
        // --others --exclude-standard includes files that are not yet staged:
        // without them a brand-new file carrying a cross-repo import passes
        // locally and only fails once it is committed, which is the wrong way
        // round for a check meant to stop the import being written at all.
        const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
            cwd: root,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        });
        const tracked = out.split("\0").filter(Boolean);
        if (tracked.length) return tracked;
    } catch {
        /* not a git tree (or git unavailable): fall through to a walk */
    }
    const found = [];
    const walk = (dir) => {
        for (const entry of readdirSync(dir)) {
            if (SKIP_DIRS.has(entry)) continue;
            const abs = join(dir, entry);
            if (statSync(abs).isDirectory()) walk(abs);
            else found.push(relative(root, abs).split(sep).join("/"));
        }
    };
    walk(root);
    return found;
}

/** Import/require/dynamic-import specifiers, with their 1-based line numbers. */
function* specifiers(source) {
    const patterns = [
        /\bfrom\s+["']([^"']+)["']/g,
        /\brequire\(\s*["']([^"']+)["']\s*\)/g,
        /\bimport\(\s*["']([^"']+)["']\s*\)/g,
        /^\s*import\s+["']([^"']+)["']/gm,
    ];
    for (const re of patterns) {
        for (const m of source.matchAll(re)) {
            const line = source.slice(0, m.index).split("\n").length;
            yield { specifier: m[1], line };
        }
    }
}

export function scanRepo(root) {
    const violations = [];
    const add = (file, line, detail) => violations.push({ file, line, detail });

    // 1. A submodule is a second repository grafted into this working tree.
    if (existsSync(join(root, ".gitmodules"))) {
        add(".gitmodules", 1, "git submodule: a second repository inside this tree");
    }

    for (const file of listFiles(root)) {
        const abs = join(root, file);
        if (!existsSync(abs)) continue;
        let text;
        try {
            text = readFileSync(abs, "utf8");
        } catch {
            continue; // binary or unreadable
        }

        // 2. Import specifiers naming the other repository.
        const ext = file.slice(file.lastIndexOf("."));
        if (SOURCE_EXT.has(ext)) {
            for (const { specifier, line } of specifiers(text)) {
                if (FOREIGN.test(specifier)) {
                    add(file, line, `imports "${specifier}" across the repository boundary`);
                }
            }
        }

        // 3. Dependencies resolved from disk, or named for the other repository.
        if (file === "package.json" || file.endsWith("/package.json")) {
            let pkg;
            try {
                pkg = JSON.parse(text);
            } catch {
                continue;
            }
            for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
                for (const [name, range] of Object.entries(pkg[field] ?? {})) {
                    if (typeof range === "string" && LOCAL_PROTOCOL.test(range)) {
                        add(file, 1, `${field}."${name}" resolves from disk ("${range}") instead of a registry`);
                    } else if (FOREIGN.test(name)) {
                        add(file, 1, `${field} includes "${name}" from across the boundary`);
                    }
                }
            }
        }

        // 4. tsconfig path aliases pointing at the other repository.
        if (file === "tsconfig.json" || file.endsWith("/tsconfig.json")) {
            // tsconfig allows comments, so a parse failure here is not fatal:
            // fall back to matching the raw text.
            const paths = text.match(/"paths"\s*:\s*\{[\s\S]*?\n\s*\}/);
            if (paths && FOREIGN.test(paths[0])) {
                add(file, 1, "tsconfig path alias resolves across the repository boundary");
            }
        }

        // 5. A CI step that checks out a second repository builds the two
        //    together even when no source file imports the other.
        if (/^\.github\/workflows\/.+\.ya?ml$/.test(file)) {
            for (const m of text.matchAll(/^\s*repository:\s*["']?([^"'\s#]+)/gm)) {
                if (FOREIGN.test(m[1])) {
                    const line = text.slice(0, m.index).split("\n").length;
                    add(file, line, `workflow checks out "${m[1]}" alongside this repository`);
                }
            }
        }
    }

    return violations;
}

function report(violations) {
    if (!violations.length) return true;
    console.error("\nRepository boundary violation\n");
    for (const v of violations) {
        console.error(`  ${v.file}:${v.line}`);
        console.error(`    ${v.detail}\n`);
    }
    console.error(
        [
            "Juralio reaches this service over HTTP and by no other means.",
            "",
            "This repository is AGPL-3.0. Section 5(c) applies its terms to the",
            "combined work once the parts are linked, and that cannot be undone",
            "afterwards: Juralio is Apache-2.0 and a single link relicenses it.",
            "Reverting the commit does not withdraw the grant already made.",
            "",
            "Re-declare the shared types on each side and call the service over",
            "HTTP. A duplicated interface is the cost of the boundary, not a smell.",
            "",
            'See "1. The boundary to Juralio is HTTP, and only HTTP" in AGENTS.md.',
        ].join("\n"),
    );
    return false;
}

/** Build a tree containing one of each violation and prove each is caught. */
function selfTest() {
    const dir = mkdtempSync(join(tmpdir(), "boundary-selftest-"));
    const write = (rel, body) => {
        const abs = join(dir, rel);
        mkdirSync(join(abs, ".."), { recursive: true });
        writeFileSync(abs, body);
    };

    // The fixtures below must contain the foreign name without this file
    // itself carrying a literal match — otherwise the checker permanently
    // reports itself and can never go green. Assembling the token at runtime
    // keeps this script in scope of its own scan rather than exempting it,
    // which would leave a file a real import could hide in.
    const NAME = ["jur", "alio"].join("");

    const expected = [
        ["import specifier", "src/bad.ts"],
        ["submodule", ".gitmodules"],
        ["file: dependency", "package.json"],
        ["tsconfig alias", "tsconfig.json"],
        ["workflow checkout", ".github/workflows/bad.yml"],
    ];

    write("src/bad.ts", `import { Matter } from "@${NAME}/types";\nexport const x = Matter;\n`);
    write(".gitmodules", `[submodule "${NAME}"]\n\tpath = vendor/${NAME}\n`);
    write("package.json", JSON.stringify({ dependencies: { shared: `file:../${NAME}/shared` } }, null, 2));
    write(
        "tsconfig.json",
        JSON.stringify({ compilerOptions: { paths: { [`@${NAME}/*`]: [`../${NAME}/src/*`] } } }, null, 2),
    );
    write(
        ".github/workflows/bad.yml",
        `jobs:\n  x:\n    steps:\n      - uses: actions/checkout@v7\n        with:\n          repository: acme/${NAME}\n`,
    );

    const found = scanRepo(dir);
    let ok = true;
    for (const [label, file] of expected) {
        const hit = found.some((v) => v.file === file);
        console.log(`  ${hit ? "caught" : "MISSED"}  ${label} (${file})`);
        if (!hit) ok = false;
    }

    // A clean tree must not report anything, or the check is useless noise.
    const clean = mkdtempSync(join(tmpdir(), "boundary-clean-"));
    writeFileSync(join(clean, "ok.ts"), 'import { z } from "zod";\n');
    const falsePositives = scanRepo(clean);
    if (falsePositives.length) {
        console.log(`  MISSED  clean tree reported ${falsePositives.length} false positive(s)`);
        ok = false;
    } else {
        console.log("  caught  clean tree reports nothing");
    }

    console.log(ok ? "\nself-test passed\n" : "\nself-test FAILED\n");
    return ok;
}

const args = process.argv.slice(2);
if (args.includes("--self-test")) {
    process.exit(selfTest() ? 0 : 1);
}
const rootIdx = args.indexOf("--root");
const root = rootIdx >= 0 ? args[rootIdx + 1] : process.cwd();
const violations = scanRepo(root);
if (report(violations)) {
    console.log("Repository boundary: clean (no cross-repo imports, submodules, path dependencies, aliases or shared checkouts).");
}
process.exit(violations.length ? 1 : 0);
