#!/usr/bin/env node
/**
 * Regenerates every brand asset from the mark's geometry.
 *
 * Five surfaces carried the inherited twelve-blade rosette or nothing at all:
 * the browser tab, the iOS home-screen icon (referenced by `layout.tsx` and
 * absent from the tree, so a 404 on every iPhone that looked for it), the
 * link-preview image, and the Word ribbon's three icons. Hand-made binaries
 * would drift from `BrandMarkUI.tsx` the first time the mark is adjusted, and
 * nobody would notice until a customer saw the old one — so they are generated,
 * and `--check` fails the build when the geometry here stops matching the
 * component.
 *
 * Rasterising uses the headless Chromium the repository already has for
 * Playwright, so this adds no dependency. It is not run in CI: generated
 * binaries are committed, and `--check` guards them.
 *
 * Usage:
 *   node scripts/generate-brand-assets.mjs          regenerate every asset
 *   node scripts/generate-brand-assets.mjs --check  geometry matches the component
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");

const COMPONENT = "frontend/src/shared/ui/BrandMarkUI.tsx";

// ---------------------------------------------------------------------------
// Geometry — deliberately duplicated from the component, and checked against it
// ---------------------------------------------------------------------------

/** [start angle in degrees, sweep]. 0° points right. */
const SEGMENTS = [
    [-95, 104],
    [34.5, 76],
    [136, 50],
    [211.5, 28],
];
const RADIUS = 105;
const STROKE = 36;
const CENTRE = 250;

/** The palette the assets are baked with, where they cannot inherit a colour. */
const INK = "#0f172a";
const PAPER = "#ffffff";
const DARK_GROUND = "#0b1120";
const DARK_INK = "#e2e8f0";

function polar(radius, degrees) {
    const radians = (degrees * Math.PI) / 180;
    return [
        CENTRE + radius * Math.cos(radians),
        CENTRE + radius * Math.sin(radians),
    ];
}

function arcPath(start, sweep) {
    const [x0, y0] = polar(RADIUS, start);
    const [x1, y1] = polar(RADIUS, start + sweep);
    const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
    return `M ${x0.toFixed(2)},${y0.toFixed(2)} A ${RADIUS},${RADIUS} 0 ${largeArc} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

const PATHS = SEGMENTS.map(([start, sweep]) => arcPath(start, sweep));

/** The mark as a standalone SVG document. */
function markSvg({ colour, size, padding = 0, ground = null }) {
    const view = 300 - padding * 2;
    const min = 100 + padding;
    const dims = size ? ` width="${size}" height="${size}"` : "";
    return [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${min} ${min} ${view} ${view}"${dims}>`,
        ground ? `<rect x="${min}" y="${min}" width="${view}" height="${view}" fill="${ground}"/>` : "",
        ...PATHS.map(
            (d) =>
                `<path d="${d}" fill="none" stroke="${colour}" stroke-width="${STROKE}" stroke-linecap="round"/>`,
        ),
        "</svg>",
    ].join("");
}

// ---------------------------------------------------------------------------
// Drift check
// ---------------------------------------------------------------------------

/**
 * Reads the geometry back out of the component and compares it.
 *
 * Regex rather than a parser because the shape being matched is four literal
 * number pairs and three constants — if that stops being true, this check
 * should fail loudly and be rewritten, which is the behaviour we want anyway.
 */
function checkGeometryMatchesComponent() {
    const source = readFileSync(join(ROOT, COMPONENT), "utf8");
    const problems = [];

    const block = source.match(/const SEGMENTS[^=]*=\s*\[([\s\S]*?)\];/);
    if (!block) {
        problems.push("could not find the SEGMENTS array in the component");
    } else {
        const pairs = [...block[1].matchAll(/\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/g)].map(
            (m) => [Number(m[1]), Number(m[2])],
        );
        if (JSON.stringify(pairs) !== JSON.stringify(SEGMENTS)) {
            problems.push(
                `SEGMENTS differ:\n    component ${JSON.stringify(pairs)}\n    this script ${JSON.stringify(SEGMENTS)}`,
            );
        }
    }

    for (const [name, expected] of [
        ["RADIUS", RADIUS],
        ["STROKE", STROKE],
        ["CENTRE", CENTRE],
    ]) {
        const found = source.match(new RegExp(`const ${name} = (-?[\\d.]+)`));
        if (!found) problems.push(`could not find ${name} in the component`);
        else if (Number(found[1]) !== expected) {
            problems.push(
                `${name} differs: component ${found[1]}, this script ${expected}`,
            );
        }
    }

    return problems;
}

// ---------------------------------------------------------------------------
// Rasterising, through the Chromium already present for Playwright
// ---------------------------------------------------------------------------

function chromiumPath() {
    const candidates = execFileSync("bash", [
        "-lc",
        "ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null | sort -V | tail -1",
    ])
        .toString()
        .trim();
    if (!candidates) {
        throw new Error(
            "No Chromium found under /opt/pw-browsers. This script rasterises through the browser Playwright already installs.",
        );
    }
    return candidates;
}

function playwrightModule() {
    return join(ROOT, "word-addin", "node_modules", "playwright-core");
}

/**
 * Renders a list of {html, width, height, out, type} jobs in one browser.
 * One browser for all of them: launching Chromium per asset is most of the
 * runtime.
 */
function renderAll(jobs) {
    const script = `
const { chromium } = require(${JSON.stringify(playwrightModule())});
const jobs = ${JSON.stringify(jobs)};
(async () => {
  const browser = await chromium.launch({ executablePath: ${JSON.stringify(chromiumPath())} });
  for (const job of jobs) {
    const page = await browser.newPage({
      viewport: { width: job.width, height: job.height },
      deviceScaleFactor: 1,
    });
    await page.setContent(job.html, { waitUntil: "load" });
    await page.screenshot({
      path: job.out,
      type: job.type ?? "png",
      ...(job.type === "jpeg" ? { quality: 92 } : { omitBackground: !!job.transparent }),
    });
    await page.close();
  }
  await browser.close();
})().catch((err) => { console.error(err.message); process.exit(1); });
`;
    const tmp = join(ROOT, ".brand-render.cjs");
    writeFileSync(tmp, script);
    try {
        execFileSync("node", [tmp], { stdio: "inherit" });
    } finally {
        execFileSync("rm", ["-f", tmp]);
    }
}

/**
 * A page whose body is exactly the mark at `size`, with no margin.
 *
 * The ground is drawn as an element rather than set on `body`, and every
 * capture uses `omitBackground`. That combination is what keeps an alpha
 * channel in the PNG: Next.js parses `favicon.ico` at build time and rejects
 * members that are not RGBA — "The PNG is not in RGBA format!" — which an
 * opaque body background produces. The pixels still come out solid where the
 * ground element covers them.
 */
function markPage(size, colour, { ground = null, padding = 0 } = {}) {
    const cover = ground
        ? `<div style="position:fixed;inset:0;background:${ground}"></div>`
        : "";
    return `<style>html,body{margin:0;padding:0;background:transparent}
svg{position:relative}</style>${cover}${markSvg({ colour, size, padding })}`;
}

// ---------------------------------------------------------------------------
// ICO container: PNGs wrapped in an icon directory (Vista and later)
// ---------------------------------------------------------------------------

function buildIco(pngPaths) {
    const images = pngPaths.map(({ size, path }) => ({
        size,
        data: readFileSync(path),
    }));
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0); // reserved
    header.writeUInt16LE(1, 2); // type 1 = icon
    header.writeUInt16LE(images.length, 4);

    const entries = [];
    let offset = 6 + images.length * 16;
    for (const image of images) {
        const entry = Buffer.alloc(16);
        // 256 is written as 0 — the field is one byte.
        entry.writeUInt8(image.size >= 256 ? 0 : image.size, 0);
        entry.writeUInt8(image.size >= 256 ? 0 : image.size, 1);
        entry.writeUInt8(0, 2); // palette
        entry.writeUInt8(0, 3); // reserved
        entry.writeUInt16LE(1, 4); // colour planes
        entry.writeUInt16LE(32, 6); // bits per pixel
        entry.writeUInt32LE(image.data.length, 8);
        entry.writeUInt32LE(offset, 12);
        offset += image.data.length;
        entries.push(entry);
    }
    return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

// ---------------------------------------------------------------------------

function generate() {
    const tmp = join(ROOT, ".brand-tmp");
    mkdirSync(tmp, { recursive: true });

    // 1. The tab icon, as SVG. This is the one asset that can adapt: the media
    //    query inside it mirrors the component's `currentColor`, so the tab
    //    icon follows the browser's theme rather than being baked one way.
    const iconSvg = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="118 118 264 264">',
        "<style>",
        `  path { stroke: ${INK}; }`,
        `  @media (prefers-color-scheme: dark) { path { stroke: ${DARK_INK}; } }`,
        "</style>",
        ...PATHS.map(
            (d) =>
                `<path d="${d}" fill="none" stroke-width="${STROKE}" stroke-linecap="round"/>`,
        ),
        "</svg>",
    ].join("\n");
    writeFileSync(join(ROOT, "frontend/src/app/icon.svg"), `${iconSvg}\n`);

    // 2. Raster sizes. The ICO members and the Word ribbon icons are drawn on
    //    white rather than transparent: Word composites the ribbon on a light
    //    chrome and a transparent dark mark disappears on some themes.
    //    Transparent, except the Apple touch icon. Two reasons, and they
    //    coincide: it is the convention for both favicons and Office ribbon
    //    icons, which composite onto chrome whose colour they cannot know; and
    //    Chromium drops the alpha channel when every pixel is opaque, which
    //    makes Next.js reject the .ico at build time with "The PNG is not in
    //    RGBA format!". iOS is the exception — it composites the touch icon
    //    onto the home screen and renders a transparent one black, so that one
    //    keeps a solid ground and may be RGB.
    const jobs = [
        { name: "ico-16", size: 16, colour: INK },
        { name: "ico-32", size: 32, colour: INK },
        { name: "ico-48", size: 48, colour: INK },
        { name: "addin-16", size: 16, colour: INK },
        { name: "addin-32", size: 32, colour: INK },
        { name: "addin-80", size: 80, colour: INK },
        { name: "apple-180", size: 180, colour: PAPER, ground: INK },
    ].map((job) => ({
        html: markPage(job.size, job.colour, { ground: job.ground }),
        width: job.size,
        height: job.size,
        out: join(tmp, `${job.name}.png`),
        transparent: true,
    }));

    // 3. The link-preview card, 1200x630 — the size every platform crops to.
    //    The existing image was text-only; the mark belongs on it now.
    jobs.push({
        html: `<style>
html,body{margin:0;height:630px;width:1200px;background:${DARK_GROUND};color:${DARK_INK};
  font:400 15px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  display:flex;align-items:center;justify-content:center}
.card{display:flex;flex-direction:column;align-items:center;gap:30px}
.row{display:flex;align-items:center;gap:26px}
.name{font-size:74px;font-weight:600;letter-spacing:-.025em}
.rule{width:150px;height:1px;background:${DARK_INK};opacity:.22}
.sub{font-size:26px;opacity:.62;letter-spacing:.01em}
</style>
<div class="card">
  <div class="row">${markSvg({ colour: DARK_INK, size: 88 })}<div class="name">legalworkflows</div></div>
  <div class="rule"></div>
  <div class="sub">AI legal document analysis and contract review</div>
</div>`,
        width: 1200,
        height: 630,
        out: join(tmp, "link-image.jpg"),
        type: "jpeg",
    });

    renderAll(jobs);

    // 4. Place them.
    const copy = (from, to) =>
        writeFileSync(join(ROOT, to), readFileSync(join(tmp, from)));

    copy("addin-16.png", "word-addin/assets/icon-16.png");
    copy("addin-32.png", "word-addin/assets/icon-32.png");
    copy("addin-80.png", "word-addin/assets/icon-80.png");
    copy("apple-180.png", "frontend/public/apple-touch-icon.png");
    copy("link-image.jpg", "frontend/public/link-image.jpg");

    writeFileSync(
        join(ROOT, "frontend/src/app/favicon.ico"),
        buildIco([
            { size: 16, path: join(tmp, "ico-16.png") },
            { size: 32, path: join(tmp, "ico-32.png") },
            { size: 48, path: join(tmp, "ico-48.png") },
        ]),
    );

    execFileSync("rm", ["-rf", tmp]);

    console.log("Brand assets regenerated:");
    for (const path of [
        "frontend/src/app/icon.svg",
        "frontend/src/app/favicon.ico",
        "frontend/public/apple-touch-icon.png",
        "frontend/public/link-image.jpg",
        "word-addin/assets/icon-16.png",
        "word-addin/assets/icon-32.png",
        "word-addin/assets/icon-80.png",
    ]) {
        console.log(`  ${path}`);
    }
}

if (process.argv.includes("--check")) {
    const problems = checkGeometryMatchesComponent();
    if (problems.length) {
        console.error(
            `\nThe brand assets no longer match ${COMPONENT}:\n`,
        );
        for (const problem of problems) console.error(`  ${problem}`);
        console.error(
            [
                "",
                "The committed favicon, link-preview image and Word ribbon icons are",
                "generated from this geometry. If the mark changed, regenerate them:",
                "",
                "  node scripts/generate-brand-assets.mjs",
                "",
                "Otherwise the tab icon and the ribbon would keep showing the old mark,",
                "and nobody would notice until a customer did.",
            ].join("\n"),
        );
        process.exit(1);
    }
    console.log("Brand assets: geometry matches the component.");
} else {
    generate();
}
