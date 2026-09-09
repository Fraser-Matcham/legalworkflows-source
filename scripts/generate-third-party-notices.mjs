#!/usr/bin/env node
// Regenerate THIRD-PARTY-NOTICES.md from the workspaces that ship.
//
// WHY THIS EXISTS: the frontend bundle reaches browsers and the backend image
// ships to a host, so third-party components are distributed, not merely used.
// Apache-2.0 section 4(a) then requires recipients get a copy of the licence,
// and the AGPL's Corresponding Source obligation is easier to meet when the
// attributions are already assembled.
//
// WHY IT IS NOT A CI GATE: every dependency bump changes the output. Gating CI
// on it would red every Dependabot pull request until someone regenerated the
// file, which trades a real weekly cost for a compliance artefact that only has
// to be correct at release. Regenerate with `npm run notices` when dependencies
// change; the diff is reviewable.
//
// Usage: node scripts/generate-third-party-notices.mjs [--check]

import { readFileSync, existsSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = join(repoRoot, "THIRD-PARTY-NOTICES.md");

/** Workspaces whose production dependencies are distributed to someone. */
const WORKSPACES = ["frontend", "backend"];

/**
 * Licence elections for dual-licensed packages. SPDX "OR" means the recipient
 * chooses; the choice has to be recorded somewhere or it has not been made.
 * Each entry says which arm this project takes and why it matters.
 */
const ELECTIONS = {
  jszip: {
    elect: "MIT",
    from: "(MIT OR GPL-3.0-or-later)",
    why: "Electing MIT keeps GPL-3.0 out of the tree entirely. Present in both frontend and backend.",
  },
  dompurify: {
    elect: "Apache-2.0",
    from: "(MPL-2.0 OR Apache-2.0)",
    why: "Apache-2.0 avoids MPL-2.0's file-level copyleft and is already compatible with AGPL-3.0 via section 7.",
  },
  "json-schema": {
    elect: "BSD-3-Clause",
    from: "(AFL-2.1 OR BSD-3-Clause)",
    why: "BSD-3-Clause is the plainly permissive arm; AFL-2.1 carries extra termination conditions for no benefit here.",
  },
  wrangler: { elect: "MIT", from: "MIT OR Apache-2.0", why: "Either is permissive; MIT is the simpler obligation." },
  "@cloudflare/kv-asset-handler": { elect: "MIT", from: "MIT OR Apache-2.0", why: "As wrangler." },
  "@cloudflare/unenv-preset": { elect: "MIT", from: "MIT OR Apache-2.0", why: "As wrangler." },
};

const LICENCE_FILENAMES = [
  "LICENSE", "LICENCE", "LICENSE.md", "LICENCE.md", "LICENSE.txt",
  "LICENCE.txt", "COPYING", "COPYING.md", "LICENSE-MIT", "LICENSE-APACHE",
];

function licenceTextFor(pkgDir) {
  if (!existsSync(pkgDir)) return null;
  let entries;
  try {
    entries = readdirSync(pkgDir);
  } catch {
    return null;
  }
  for (const name of LICENCE_FILENAMES) {
    const hit = entries.find((e) => e.toLowerCase() === name.toLowerCase());
    if (hit) {
      try {
        return readFileSync(join(pkgDir, hit), "utf8").trim();
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Pull copyright lines out of a licence text, so attribution survives even
 *  when we only print one shared copy of a common licence. */
function copyrightLines(text) {
  if (!text) return [];
  return [
    ...new Set(
      text
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => /^copyright\b/i.test(l) && l.length < 200),
    ),
  ];
}

/**
 * The lockfile's `license` field is empty for packages using npm's deprecated
 * `licenses: [{ type }]` array form. Falling back to the installed manifest
 * recovers those rather than reporting a licence as unknown when it is merely
 * recorded in an old shape.
 */
function declaredLicenceFor(pkgDir, fromLock) {
  if (fromLock) return fromLock;
  const manifest = join(pkgDir, "package.json");
  if (!existsSync(manifest)) return "";
  try {
    const json = JSON.parse(readFileSync(manifest, "utf8"));
    if (typeof json.license === "string") return json.license;
    if (json.license?.type) return json.license.type;
    if (Array.isArray(json.licenses)) {
      return [...new Set(json.licenses.map((l) => l?.type).filter(Boolean))].join(" OR ");
    }
  } catch {
    /* unreadable manifest falls through to unknown */
  }
  return "";
}

function normaliseLicence(name, declared) {
  const election = ELECTIONS[name];
  if (election) return election.elect;
  if (declared === "MIT/X11") return "MIT";
  return declared || "UNKNOWN";
}

function collect() {
  const packages = new Map(); // "name@version" -> record
  const dependents = new Map(); // name -> Set(dependent names)
  for (const workspace of WORKSPACES) {
    const lockPath = join(repoRoot, workspace, "package-lock.json");
    if (!existsSync(lockPath)) {
      throw new Error(`missing ${lockPath} — run npm install in ${workspace} first`);
    }
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    for (const [path, meta] of Object.entries(lock.packages ?? {})) {
      for (const field of ["dependencies", "optionalDependencies"]) {
        for (const dep of Object.keys(meta[field] ?? {})) {
          const owner = path.startsWith("node_modules/")
            ? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length)
            : `${workspace} (direct)`;
          if (!dependents.has(dep)) dependents.set(dep, new Set());
          dependents.get(dep).add(owner);
        }
      }
    }
    for (const [path, meta] of Object.entries(lock.packages ?? {})) {
      if (!path.startsWith("node_modules/") || meta.dev) continue;
      const marker = path.lastIndexOf("node_modules/");
      const installed = path.slice(marker + "node_modules/".length);
      const parts = installed.split("/");
      const name = meta.name ?? (parts[0].startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]);
      if (!name || !meta.version) continue;
      const dir = join(repoRoot, workspace, path);
      const fromLock = typeof meta.license === "string"
        ? meta.license
        : Array.isArray(meta.license) ? meta.license.join(" OR ") : "";
      const declared = declaredLicenceFor(dir, fromLock);
      const key = `${name}@${meta.version}`;
      const existing = packages.get(key);
      const text = licenceTextFor(dir);
      if (existing) {
        existing.workspaces.add(workspace);
        if (!existing.text && text) {
          existing.text = text;
          existing.copyrights = copyrightLines(text);
        }
        continue;
      }
      packages.set(key, {
        name,
        version: meta.version,
        declared,
        licence: normaliseLicence(name, declared),
        workspaces: new Set([workspace]),
        text,
        copyrights: copyrightLines(text),
      });
    }
  }
  for (const record of packages.values()) {
    const direct = dependents.get(record.name);
    if (direct) record.chain = [...direct].sort().join(", ");
  }
  return [...packages.values()].sort((a, b) =>
    a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

function render(records) {
  const byLicence = new Map();
  for (const r of records) {
    if (!byLicence.has(r.licence)) byLicence.set(r.licence, []);
    byLicence.get(r.licence).push(r);
  }
  const licences = [...byLicence.keys()].sort();

  const out = [];
  out.push("# Third-party notices");
  out.push("");
  out.push("This file is generated. Run `npm run notices` to regenerate it after");
  out.push("changing dependencies; do not edit it by hand.");
  out.push("");
  out.push("legalworkflows distributes the components listed below: the frontend bundle is");
  out.push("served to browsers and the backend image ships to a host. Apache-2.0 section");
  out.push("4(a) requires that recipients of those components receive a copy of the licence,");
  out.push("and the attributions here also form part of the Corresponding Source that");
  out.push("AGPL-3.0 section 13 obliges the operator to offer.");
  out.push("");
  out.push("Development-only dependencies are excluded: they are not distributed.");
  out.push("");
  out.push(`Generated from ${WORKSPACES.map((w) => `\`${w}/package-lock.json\``).join(" and ")}.`);
  out.push(`${records.length} distributed packages across ${licences.length} distinct licences.`);
  out.push("");

  out.push("## Licence elections");
  out.push("");
  out.push('An SPDX expression using `OR` leaves the choice to the recipient. A choice that');
  out.push("is not written down has not been made, so this project's elections are recorded");
  out.push("here and applied throughout this file.");
  out.push("");
  out.push("| Package | Declared | Elected | Why |");
  out.push("| --- | --- | --- | --- |");
  for (const [name, e] of Object.entries(ELECTIONS).sort()) {
    out.push(`| \`${name}\` | ${e.from} | **${e.elect}** | ${e.why} |`);
  }
  out.push("");

  const undetermined = records.filter((r) => r.licence === "UNKNOWN");
  if (undetermined.length > 0) {
    out.push("## Undetermined licences");
    out.push("");
    out.push("These packages declare no licence in their manifest and ship no licence");
    out.push("file. A package with no grant is not permissively licensed by default, so");
    out.push("each one is a question to resolve rather than a gap to ignore.");
    out.push("");
    for (const r of undetermined) {
      out.push(`- \`${r.name}@${r.version}\` — ${[...r.workspaces].sort().join(", ")}`);
      if (r.chain) out.push(`  - reached via: ${r.chain}`);
    }
    out.push("");
  }

  out.push("## Packages by licence");
  out.push("");
  for (const licence of licences) {
    const group = byLicence.get(licence);
    out.push(`### ${licence} (${group.length})`);
    out.push("");
    for (const r of group) {
      const ws = [...r.workspaces].sort().join(", ");
      out.push(`- \`${r.name}@${r.version}\` — ${ws}`);
      for (const c of r.copyrights.slice(0, 4)) out.push(`  - ${c}`);
    }
    out.push("");
  }

  out.push("## Licence texts");
  out.push("");
  out.push("One representative copy of each distinct licence found in the distributed tree.");
  out.push("");
  for (const licence of licences) {
    const withText = byLicence.get(licence).find((r) => r.text);
    if (!withText) continue;
    out.push(`### ${licence}`);
    out.push("");
    out.push(`As distributed with \`${withText.name}@${withText.version}\`:`);
    out.push("");
    out.push("```");
    out.push(withText.text);
    out.push("```");
    out.push("");
  }
  // Trailing whitespace inside the licence texts above is deliberate: they are
  // reproduced exactly as distributed, and editing a licence text is not ours
  // to do. Only our own trailing blank lines are trimmed.
  return out.join("\n").replace(/\n+$/, "") + "\n";
}

const rendered = render(collect());
const check = process.argv.includes("--check");
if (check) {
  const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, "utf8") : "";
  if (current !== rendered) {
    console.error("THIRD-PARTY-NOTICES.md is out of date. Run: npm run notices");
    process.exit(1);
  }
  console.log("THIRD-PARTY-NOTICES.md is up to date.");
} else {
  writeFileSync(OUTPUT, rendered);
  console.log(`Wrote ${OUTPUT}`);
}
