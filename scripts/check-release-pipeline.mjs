#!/usr/bin/env node
/**
 * Fails the build when a deliberately skipped job silently disables the jobs
 * downstream of it.
 *
 * GitHub skips a job whose `needs` contains a skipped job. That is the
 * default, and usually right. The trouble starts when one job opts out of it:
 *
 *     build-dbtools:
 *       if: vars.PLATFORM_ENABLED == 'true'   # skipped until stage 5
 *     migrate:
 *       needs: [gate, build, build-dbtools]
 *       if: ${{ !cancelled() && ... }}        # runs anyway — correct
 *     backend:
 *       needs: [config, gate, migrate]        # no `if` — SKIPPED
 *
 * `migrate` survives the skipped dependency because it says so. `backend`
 * says nothing, so it inherits the implicit `success()`, which is false once
 * anything upstream in the graph was skipped — even though every job it
 * directly needs succeeded. It skips. So does everything after it.
 *
 * That is not a hypothetical. Adding `build-dbtools` in the stage-5 work
 * turned "Deploy the backend", "Deploy the frontend" and "Record the release"
 * into no-ops on every push to main. The workflow reported success each time,
 * because skipped jobs are not failures, so three consecutive deploys were
 * green while nothing was deployed. The running service stayed on a task
 * definition that could not start, and the site served 503 behind a wall of
 * green check marks. A red build is a bad day; a green build that deploys
 * nothing is a bad week.
 *
 * The rule enforced here is narrow, and is the exact shape of that bug: if a
 * job opts out of skip propagation — `always()`, `cancelled()` or
 * `!cancelled()` in its `if` — then every job that needs it must carry its own
 * job-level `if`, and so decide for itself rather than inheriting an answer
 * from a job it never mentions.
 *
 * It does not ask what the condition says. A job that has thought about it is
 * the whole requirement; propagating the skip on purpose is a legitimate
 * choice this check will not second-guess.
 *
 * Usage:
 *   node scripts/check-release-pipeline.mjs             check the workflows
 *   node scripts/check-release-pipeline.mjs --self-test prove the check fires
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW_DIR = join(ROOT, ".github", "workflows");

/** `if` expressions that mean "run me even though something upstream did not". */
const ESCAPE_HATCH = /(^|[^a-z_])(always|cancelled)\s*\(/;

/**
 * Parse the `jobs:` mapping of a workflow far enough to answer three
 * questions per job: what is its name, what does it need, and does it carry a
 * job-level `if`.
 *
 * Deliberately not a YAML parser. It reads the two indentation levels that
 * matter (a job key at two spaces, its properties at four) and skips block
 * scalars wholesale, so a `run: |` body containing a shell `if` cannot be
 * mistaken for a job condition.
 */
export function parseJobs(source) {
    const lines = source.split("\n");
    const jobs = new Map();

    let inJobs = false;
    let current = null;
    let blockIndent = null;
    let pendingNeeds = false;

    for (const raw of lines) {
        if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
        const indent = raw.length - raw.trimStart().length;

        // Inside a block scalar: everything more indented than the key belongs
        // to it, whatever it looks like.
        if (blockIndent !== null) {
            if (indent > blockIndent) continue;
            blockIndent = null;
        }

        const line = raw.trimEnd();

        if (indent === 0) {
            inJobs = line.startsWith("jobs:");
            current = null;
            pendingNeeds = false;
            continue;
        }
        if (!inJobs) continue;

        // A block scalar opens with `key: |` or `key: >` and optional chomping.
        if (/^[^#\s][^:]*:\s*[|>][-+0-9]*$/.test(line.trimStart())) {
            blockIndent = indent;
            pendingNeeds = false;
            continue;
        }

        if (indent === 2) {
            const match = /^ {2}([A-Za-z0-9_.-]+):\s*$/.exec(line);
            current = match ? match[1] : null;
            pendingNeeds = false;
            if (current) jobs.set(current, { name: current, needs: [], hasIf: false, if: "" });
            continue;
        }

        if (!current) continue;

        // Continuation of a block-sequence `needs:`.
        if (pendingNeeds && indent >= 6) {
            const item = /^-\s*(.+?)\s*$/.exec(line.trimStart());
            if (item) {
                jobs.get(current).needs.push(stripQuotes(item[1]));
                continue;
            }
        }
        pendingNeeds = false;

        if (indent !== 4) continue;

        const needs = /^ {4}needs:\s*(.*)$/.exec(line);
        if (needs) {
            const value = needs[1].trim();
            if (value === "") pendingNeeds = true;
            else jobs.get(current).needs.push(...parseNeedsValue(value));
            continue;
        }

        const cond = /^ {4}if:\s*(.*)$/.exec(line);
        if (cond) {
            jobs.get(current).hasIf = true;
            jobs.get(current).if = cond[1].trim();
        }
    }

    return jobs;
}

function stripQuotes(value) {
    return value.replace(/^["']|["']$/g, "").trim();
}

function parseNeedsValue(value) {
    if (value.startsWith("[")) {
        return value
            .replace(/^\[|\]$/g, "")
            .split(",")
            .map(stripQuotes)
            .filter(Boolean);
    }
    return [stripQuotes(value)].filter(Boolean);
}

/**
 * Every job that needs an escape-hatch job but has no `if` of its own.
 */
export function findInheritedSkips(source) {
    const jobs = parseJobs(source);
    const dependents = new Map();
    for (const job of jobs.values()) {
        for (const need of job.needs) {
            if (!dependents.has(need)) dependents.set(need, []);
            dependents.get(need).push(job.name);
        }
    }

    const findings = [];
    for (const job of jobs.values()) {
        if (!job.hasIf || !ESCAPE_HATCH.test(job.if)) continue;
        for (const name of dependents.get(job.name) ?? []) {
            const dependent = jobs.get(name);
            if (dependent && !dependent.hasIf) {
                findings.push({ job: name, because: job.name });
            }
        }
    }
    return findings;
}

function selfTest() {
    const broken = [
        "jobs:",
        "  optional:",
        "    if: vars.THING == 'true'",
        "  middle:",
        "    needs: [optional, other]",
        "    if: ${{ !cancelled() && needs.other.result == 'success' }}",
        "  after:",
        "    needs: [middle]",
        "    steps:",
        "      - run: |",
        "          if [ -n \"$X\" ]; then echo hi; fi",
    ].join("\n");

    const fixed = broken.replace(
        "    needs: [middle]",
        "    needs: [middle]\n    if: ${{ !cancelled() && needs.middle.result == 'success' }}",
    );

    const blockSequence = [
        "jobs:",
        "  middle:",
        "    if: always()",
        "  after:",
        "    needs:",
        "      - middle",
    ].join("\n");

    const unrelated = [
        "jobs:",
        "  plain:",
        "    if: github.ref == 'refs/heads/main'",
        "  after:",
        "    needs: [plain]",
    ].join("\n");

    const checks = [
        ["a job inheriting a skip is reported", findInheritedSkips(broken).length === 1],
        ["naming the job it inherits from", findInheritedSkips(broken)[0]?.because === "middle"],
        ["a shell `if` in a run block is not a job condition", findInheritedSkips(broken)[0]?.job === "after"],
        ["adding an `if` clears it", findInheritedSkips(fixed).length === 0],
        ["a block-sequence `needs:` is read", findInheritedSkips(blockSequence).length === 1],
        ["an ordinary condition is not an escape hatch", findInheritedSkips(unrelated).length === 0],
    ];

    for (const [label, passed] of checks) {
        console.log(`${passed ? "ok  " : "FAIL"}  ${label}`);
    }
    const ok = checks.every(([, passed]) => passed);
    console.log(ok ? "\nself-test passed\n" : "\nself-test FAILED\n");
    return ok;
}

// Only when run as a command. The two functions above are importable — the
// checks below scan the tree and exit, which is not something an import should
// do to its caller.
const isMain =
    process.argv[1] !== undefined &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (!isMain) {
    // Nothing to do on import.
} else if (process.argv.includes("--self-test")) {
    process.exit(selfTest() ? 0 : 1);
} else {
    run();
}

function run() {
const findings = [];
for (const file of readdirSync(WORKFLOW_DIR).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    const source = readFileSync(join(WORKFLOW_DIR, file), "utf8");
    for (const finding of findInheritedSkips(source)) {
        findings.push({ file, ...finding });
    }
}

if (findings.length) {
    console.error("\nThese jobs inherit a skip they never asked for:\n");
    for (const { file, job, because } of findings) {
        console.error(`  .github/workflows/${file}`);
        console.error(`    ${job} needs ${because}, which runs past a skipped dependency,`);
        console.error(`    but ${job} has no \`if\` of its own — so it skips instead.\n`);
    }
    console.error(
        [
            "GitHub's implicit condition for a job is `success()`, and that is",
            "false once anything upstream in the graph was skipped — even when",
            "every job it directly needs succeeded. The job skips, everything",
            "after it skips, and the run still reports success, because a",
            "skipped job is not a failed one.",
            "",
            "Give the job an explicit condition naming what it actually",
            "requires:",
            "",
            "    if: ${{ !cancelled() && needs.<job>.result == 'success' }}",
            "",
            "If the skip should propagate, say so with a condition that does",
            "that; this check asks the job to decide, not to decide either way.",
        ].join("\n"),
    );
    process.exit(1);
}

console.log("Release pipeline: clean (no job inherits a skip from an optional one).");
}
