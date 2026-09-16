#!/usr/bin/env node
/**
 * Fails the build if the root LICENCE has moved.
 *
 * AGENTS.md fork rule 4: the file at the repository root is the GNU Affero
 * General Public License v3.0 and it stays exactly as it is. It is the only
 * one of the ten items in docs/licence-compliance.md with no gate, and the
 * doc says why that matters — removing or altering it does not change the
 * obligations, it only removes the evidence that they were met. The doc also
 * says the check "would be four lines; it has not been written because fork
 * rule 4 has held so far, which is not the same as it being enforced". This
 * is that check.
 *
 * What the hash does and does not prove. This environment cannot reach
 * gnu.org, so the pin below is the SHA-256 of the file as it stands in this
 * repository, reviewed by eye against the AGPL-3.0 text: 661 lines, the
 * title, the version line, all eighteen sections and the closing terms. It
 * pins "unchanged since it was checked", not "byte-identical to the FSF's
 * copy". The structural assertions are there for the same reason — they fail
 * with something a person can act on, rather than a hash mismatch that could
 * mean a typo or a wholesale replacement. If you ever verify the file against
 * gnu.org directly, say so here.
 *
 * Usage:
 *   node scripts/check-licence.mjs             check the tree
 *   node scripts/check-licence.mjs --self-test prove the check fires
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");

const EXPECTED_SHA256 = "0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0";
const EXPECTED_LINES = 661;

/** Enough of the text that a replacement cannot pass by being the right size. */
const MUST_CONTAIN = [
    "GNU AFFERO GENERAL PUBLIC LICENSE",
    "Version 3, 19 November 2007",
    "13. Remote Network Interaction; Use with the GNU General Public License.",
    "END OF TERMS AND CONDITIONS",
];

/**
 * A second licence file at the root contradicts the first, whichever one a
 * reader happens to open. NOTICE is not one: Apache-2.0 section 4(d) requires
 * it, and it attributes rather than licences. See items 6 and 7.
 */
const ALLOWED_AT_ROOT = new Set(["LICENSE", "NOTICE"]);
const LICENCE_FILE = /^(licen[cs]e|copying)([-.].*)?$/i;

export function scan(root) {
    const findings = [];
    const licence = join(root, "LICENSE");

    if (!existsSync(licence)) {
        findings.push({
            what: "LICENSE is missing from the repository root",
            detail: "Fork rule 4: it is never deleted. Restore it from git history.",
        });
    } else {
        const text = readFileSync(licence, "utf8");
        const sha = createHash("sha256").update(text).digest("hex");
        if (sha !== EXPECTED_SHA256) {
            const missing = MUST_CONTAIN.filter((needle) => !text.includes(needle));
            const lines = text.split("\n").length;
            findings.push({
                what: "LICENSE has been modified",
                detail: missing.length
                    ? `it no longer contains: ${missing.join("; ")}`
                    : `the text still looks like the AGPL (${lines} lines, expected ${EXPECTED_LINES}), but it is not byte-for-byte what was pinned — sha256 ${sha}`,
            });
        }
    }

    for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        if (ALLOWED_AT_ROOT.has(entry.name)) continue;
        if (LICENCE_FILE.test(entry.name)) {
            findings.push({
                what: `a second licence file at the root: ${entry.name}`,
                detail: "Fork rule 4: no root file that contradicts LICENSE. Per-directory or per-dependency licences are fine; this is about the repository's own terms.",
            });
        }
    }

    return findings;
}

function selfTest() {
    const dir = mkdtempSync(join(tmpdir(), "licence-check-"));
    const good = readFileSync(join(ROOT, "LICENSE"), "utf8");
    const write = (rel, body) => {
        mkdirSync(dirname(join(dir, rel)), { recursive: true });
        writeFileSync(join(dir, rel), body);
    };

    const cases = [];
    const only = (findings, fragment) => findings.some((f) => f.what.includes(fragment));

    write("LICENSE", good);
    cases.push(["the real LICENSE passes", scan(dir).length === 0]);

    write("NOTICE", "Apache attribution\n");
    cases.push(["a NOTICE file beside it is not a second licence", scan(dir).length === 0]);

    write("LICENSE", good.replace("END OF TERMS AND CONDITIONS", "END OF TERMS"));
    cases.push([
        "an edit that removes text is caught, and names what went",
        only(scan(dir), "modified") &&
            scan(dir).some((f) => f.detail.includes("END OF TERMS AND CONDITIONS")),
    ]);

    write("LICENSE", `${good} `);
    const trailing = scan(dir);
    cases.push([
        "a one-character edit is caught",
        only(trailing, "modified"),
    ]);
    cases.push([
        "...and says the text still looks right, so the reader knows it is subtle",
        trailing.some((f) => f.detail.includes("still looks like the AGPL")),
    ]);

    write("LICENSE", good);
    write("LICENSE.md", "MIT\n");
    cases.push(["a second licence file at the root is caught", only(scan(dir), "LICENSE.md")]);
    rmSync(join(dir, "LICENSE.md"));

    write("COPYING", "GPL-2.0\n");
    cases.push(["so is COPYING", only(scan(dir), "COPYING")]);
    rmSync(join(dir, "COPYING"));

    rmSync(join(dir, "LICENSE"));
    cases.push(["a deleted LICENSE is caught", only(scan(dir), "missing")]);

    rmSync(dir, { recursive: true, force: true });

    console.log("");
    for (const [label, ok] of cases) console.log(`  ${ok ? "caught" : "MISSED"}  ${label}`);
    const ok = cases.every(([, passed]) => passed);
    console.log(ok ? "\nself-test passed\n" : "\nself-test FAILED\n");
    return ok;
}

if (process.argv.includes("--self-test")) {
    process.exit(selfTest() ? 0 : 1);
}

const findings = scan(ROOT);
if (findings.length) {
    console.error("\nThe repository's own licence has moved:\n");
    for (const { what, detail } of findings) {
        console.error(`  ${what}`);
        console.error(`    ${detail}\n`);
    }
    console.error(
        [
            "AGPL-3.0 section 13 obliges this service to offer its Corresponding",
            "Source to anyone who interacts with it over a network. Removing or",
            "altering LICENSE does not change that obligation. It removes the",
            "evidence that it was met.",
            "",
            "See AGENTS.md fork rule 4 and docs/licence-compliance.md item 1.",
        ].join("\n"),
    );
    process.exit(1);
}
console.log("Licence: LICENSE is intact, and nothing at the root contradicts it.");
