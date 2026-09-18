#!/usr/bin/env node
/**
 * Decides whether an ECR image scan result should stop a release.
 *
 * The rule is ticket 2050's: refuse a high or critical finding that someone
 * could act on. "Could act on" is the whole difficulty, and the first real run
 * of this gate is what taught us where the previous answer broke.
 *
 * Amazon Inspector's `fixAvailable: YES` means the package's maintainer has
 * published a fixed version. It does not mean we can obtain it. Fifteen of the
 * twenty-five findings on the first gated image were OpenSSL, statically
 * linked inside the Node binary, with the fix in OpenSSL 4.0.2 — a version no
 * Node 22 image ships. Filtering on `fixAvailable` alone therefore produced a
 * gate that could never pass, which is exactly the fault the `fixAvailable`
 * filter had been introduced to cure, arriving by a different route.
 *
 * So the gate now separates two kinds of finding:
 *
 *   - Ours. A package we install, or one we can replace by changing the
 *     Dockerfile. Blocking, always, no exceptions.
 *   - Vendored into the base image's own binaries, where the only fix is the
 *     base image vendor shipping one. Blocking too, unless an entry in
 *     scripts/image-scan-allowlist.json says otherwise, with a written reason
 *     and an expiry date.
 *
 * The allowlist is the trademarks allowlist's design, for the same reason:
 * a decision to accept a finding should be visible on every run and should
 * expire, rather than quietly becoming permanent. Every entry prints. An
 * expired entry fails the build. An entry matching nothing on the image being
 * judged prints as stale.
 *
 * Stale is a note, not a failure, because one allowlist serves two images that
 * do not carry the same packages: the backend keeps npm and so reports npm's
 * bundled dependencies, while the frontend deletes it and reports none of them.
 * An entry is only genuinely dead once no image reports it.
 *
 * It also closes the hole that hid all of this. The gate reads
 * `enhancedFindings`, which only exists under ENHANCED registry scanning.
 * While the registry was BASIC that array was absent, the filter matched
 * nothing, and the step reported every image clean — including one carrying 5
 * critical and 24 high. A scan result with no `enhancedFindings` array but a
 * populated basic `findings` array is now a hard failure rather than a pass.
 *
 * Usage:
 *   node scripts/check-image-scan.mjs --scan <file> --image <repo:tag>
 *   node scripts/check-image-scan.mjs --self-test
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWLIST = join(ROOT, "scripts", "image-scan-allowlist.json");

const BLOCKING_SEVERITIES = new Set(["CRITICAL", "HIGH"]);

/** Package names from a finding, across every vulnerable package it names. */
export function packagesOf(finding) {
    const details = finding.packageVulnerabilityDetails ?? {};
    const names = (details.vulnerablePackages ?? []).map((p) => p.name).filter(Boolean);
    return [...new Set(names)];
}

export function vulnerabilityIdOf(finding) {
    return finding.packageVulnerabilityDetails?.vulnerabilityId ?? finding.title ?? "(unidentified)";
}

/**
 * A scan result that cannot be judged at all is worse than a dirty one,
 * because it looks clean. Enhanced findings live in their own array; basic
 * scanning populates a different one and carries no fixAvailable field.
 */
/**
 * Inspector reports a severity tally alongside the findings. It is the only
 * thing in the response that says how many findings there are supposed to be,
 * so it is the only way to tell a clean image from a truncated read.
 *
 * This matters because the failure is silent in the dangerous direction: a
 * short read looks like a cleaner image, and the gate passes it. The same
 * shape of fault — findings that were never there to be judged — already let
 * an image with 5 critical and 24 high through this gate once.
 *
 * Returns null when the tally is absent, which is not itself a failure.
 */
export function expectedFindingCount(scan) {
    const counts = scan?.imageScanFindings?.findingSeverityCounts;
    if (!counts || typeof counts !== "object") return null;
    const values = Object.values(counts);
    if (values.length === 0) return 0;
    if (!values.every((v) => Number.isInteger(v) && v >= 0)) return null;
    return values.reduce((a, b) => a + b, 0);
}

export function detectScanMode(scan) {
    const findings = scan?.imageScanFindings ?? {};
    const enhanced = findings.enhancedFindings;
    const basic = findings.findings;
    if (Array.isArray(enhanced)) return { mode: "enhanced", findings: enhanced };
    if (Array.isArray(basic) && basic.length > 0) return { mode: "basic", findings: [] };
    return { mode: "empty", findings: [] };
}

/**
 * Split the blocking-severity findings into what stops the release and what an
 * allowlist entry excuses. `today` is injected so the self-test can cross an
 * expiry date without waiting for one.
 */
export function classify(scan, allowlist, today) {
    const { mode, findings } = detectScanMode(scan);

    const relevant = findings.filter(
        (f) => BLOCKING_SEVERITIES.has(f.severity) && f.fixAvailable === "YES",
    );

    const used = new Set();
    const blocking = [];
    const excused = [];
    const expired = [];

    for (const finding of relevant) {
        const cve = vulnerabilityIdOf(finding);
        const pkgs = packagesOf(finding);
        const index = allowlist.findIndex(
            (entry) => entry.cve === cve && pkgs.includes(entry.package),
        );
        const entry = index === -1 ? null : allowlist[index];

        if (!entry) {
            blocking.push({ cve, severity: finding.severity, packages: pkgs, reason: "not allowlisted" });
            continue;
        }

        used.add(index);
        if (entry.expires && entry.expires < today) {
            expired.push({ cve, severity: finding.severity, packages: pkgs, entry });
            blocking.push({
                cve,
                severity: finding.severity,
                packages: pkgs,
                reason: `allowlist entry expired on ${entry.expires}`,
            });
        } else {
            excused.push({ cve, severity: finding.severity, packages: pkgs, entry });
        }
    }

    const stale = allowlist.filter((_, i) => !used.has(i));

    const expected = expectedFindingCount(scan);
    const truncated =
        mode === "enhanced" && expected !== null && findings.length < expected
            ? { read: findings.length, expected }
            : null;

    return { mode, relevant, blocking, excused, expired, stale, truncated };
}

function loadAllowlist(path = ALLOWLIST) {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed.entries ?? [];
}

function today() {
    return new Date().toISOString().slice(0, 10);
}

function report(image, result) {
    const { mode, relevant, blocking, excused, expired, stale, truncated } = result;

    if (truncated) {
        console.error(
            [
                `::error::${image}: only ${truncated.read} of ${truncated.expected} findings were read.`,
                "",
                "findingSeverityCounts says this scan has more findings than the",
                "result carries, so the ones missing were never judged. A short",
                "read looks like a cleaner image, which is the direction that",
                "passes something it should not.",
                "",
                "The usual cause is a paginated read that stopped at the first",
                "page. The scan step must let the CLI page through the findings",
                "in full — it is only the status poll that uses --no-paginate.",
            ].join("\n"),
        );
        return 1;
    }

    if (mode === "basic") {
        console.error(
            [
                `::error::${image} was scanned by BASIC registry scanning, not Inspector.`,
                "",
                "Basic findings carry no `fixAvailable`, so this gate cannot tell an",
                "actionable finding from one nobody can act on — and, reading the array",
                "enhanced scanning populates, it would find nothing and pass the image.",
                "That is not hypothetical: it passed an image with 5 critical and 24 high.",
                "",
                "Set the registry to ENHANCED (infra/scanning.tf) and re-run.",
            ].join("\n"),
        );
        return 1;
    }

    console.log(`image: ${image}`);
    console.log(`scan mode: ${mode}`);
    console.log(`high or critical with a fix available: ${relevant.length}`);

    for (const item of excused) {
        const until = item.entry.expires ? `expires ${item.entry.expires}` : "no expiry";
        console.log(`  [ALLOWLISTED] ${item.severity} ${item.cve} (${item.packages.join(", ")}) — ${until}`);
        console.log(`                ${item.entry.reason}`);
    }

    for (const item of stale) {
        console.log(`  [STALE] ${item.cve} (${item.package}) is allowlisted but not reported on this image`);
    }

    for (const item of expired) {
        console.log(`  [EXPIRED] ${item.cve} (${item.packages.join(", ")}) — entry lapsed on ${item.entry.expires}`);
    }

    if (blocking.length === 0) {
        console.log("no blocking findings");
        return 0;
    }

    console.error("");
    for (const item of blocking) {
        console.error(`  BLOCKING ${item.severity} ${item.cve} in ${item.packages.join(", ")} — ${item.reason}`);
    }
    console.error(
        [
            "",
            `::error::${blocking.length} blocking high or critical findings in ${image}.`,
            "",
            "Each has a fix published upstream. If the package is one this",
            "repository installs, bump it. If it is vendored inside the base",
            "image's own binaries and only its vendor can ship the fix, add an",
            "entry to scripts/image-scan-allowlist.json with a reason and an",
            "expiry — and say in the reason why it cannot be fixed here.",
            "",
            "An expired entry is not a failure to route around. It is the date",
            "someone said they would look again.",
        ].join("\n"),
    );
    return 1;
}

function selfTest() {
    const scan = (findings) => ({ imageScanFindings: { enhancedFindings: findings } });
    const finding = (cve, pkg, severity = "HIGH", fixAvailable = "YES") => ({
        severity,
        fixAvailable,
        packageVulnerabilityDetails: { vulnerabilityId: cve, vulnerablePackages: [{ name: pkg }] },
    });

    const counted = (findings, findingSeverityCounts) => ({
        imageScanFindings: { enhancedFindings: findings, findingSeverityCounts },
    });

    const entry = { cve: "CVE-1", package: "openssl/openssl", reason: "vendored", expires: "2026-12-17" };

    const checks = [
        [
            "a fixable high finding blocks",
            classify(scan([finding("CVE-9", "tar")]), [], "2026-09-18").blocking.length === 1,
        ],
        [
            "a finding with no fix does not block",
            classify(scan([finding("CVE-9", "tar", "HIGH", "NO")]), [], "2026-09-18").blocking.length === 0,
        ],
        [
            "a medium finding does not block",
            classify(scan([finding("CVE-9", "tar", "MEDIUM")]), [], "2026-09-18").blocking.length === 0,
        ],
        [
            "an allowlisted finding is excused",
            classify(scan([finding("CVE-1", "openssl/openssl")]), [entry], "2026-09-18").blocking.length === 0,
        ],
        [
            "and is reported as allowlisted rather than hidden",
            classify(scan([finding("CVE-1", "openssl/openssl")]), [entry], "2026-09-18").excused.length === 1,
        ],
        [
            "an expired entry stops excusing it",
            classify(scan([finding("CVE-1", "openssl/openssl")]), [entry], "2026-12-18").blocking.length === 1,
        ],
        [
            "an allowlist entry matching nothing is reported stale",
            classify(scan([]), [entry], "2026-09-18").stale.length === 1,
        ],
        [
            "an entry for the right CVE but the wrong package does not excuse",
            classify(scan([finding("CVE-1", "tar")]), [entry], "2026-09-18").blocking.length === 1,
        ],
        [
            "a BASIC scan result is a failure, not a pass",
            detectScanMode({ imageScanFindings: { findings: [{ severity: "CRITICAL" }] } }).mode === "basic",
        ],
        [
            "an enhanced scan with no findings is not mistaken for BASIC",
            detectScanMode({ imageScanFindings: { enhancedFindings: [] } }).mode === "enhanced",
        ],
        [
            "a findings list short of the severity tally is refused",
            classify(counted([finding("CVE-9", "tar")], { HIGH: 40 }), [], "2026-09-18").truncated !== null,
        ],
        [
            "and says how many of how many it read",
            (() => {
                const t = classify(counted([finding("CVE-9", "tar")], { HIGH: 40 }), [], "2026-09-18").truncated;
                return t.read === 1 && t.expected === 40;
            })(),
        ],
        [
            "a complete findings list is not called truncated",
            classify(counted([finding("CVE-9", "tar")], { HIGH: 1 }), [], "2026-09-18").truncated === null,
        ],
        [
            "a genuinely clean image is not called truncated",
            classify(counted([], {}), [], "2026-09-18").truncated === null,
        ],
        [
            "a scan with no severity tally at all is not called truncated",
            classify(scan([finding("CVE-9", "tar")]), [], "2026-09-18").truncated === null,
        ],
        [
            "more findings than the tally is not treated as truncation",
            classify(counted([finding("CVE-9", "tar")], { HIGH: 0 }), [], "2026-09-18").truncated === null,
        ],
    ];

    for (const [label, passed] of checks) console.log(`${passed ? "ok  " : "FAIL"}  ${label}`);
    const ok = checks.every(([, passed]) => passed);
    console.log(ok ? "\nself-test passed\n" : "\nself-test FAILED\n");
    return ok;
}

const isMain =
    process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (!isMain) {
    // Importable without side effects.
} else if (process.argv.includes("--self-test")) {
    process.exit(selfTest() ? 0 : 1);
} else {
    const arg = (name) => {
        const i = process.argv.indexOf(name);
        return i === -1 ? undefined : process.argv[i + 1];
    };
    const scanPath = arg("--scan");
    const image = arg("--image") ?? "(unnamed image)";
    if (!scanPath) {
        console.error("usage: check-image-scan.mjs --scan <file> --image <repo:tag>");
        process.exit(2);
    }
    const scan = JSON.parse(readFileSync(scanPath, "utf8"));
    process.exit(report(image, classify(scan, loadAllowlist(), today())));
}
