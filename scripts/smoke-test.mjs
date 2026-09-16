#!/usr/bin/env node
/**
 * Cutover smoke test: proves a deployed stack is actually serving, from
 * outside it. Plan row 4.13.
 *
 * Everything the delivery plan claims about the running system up to this
 * point is claimed from Terraform and CI, not from the deployment. That is
 * the gap this closes. `docs/security-review.md` says so in as many words:
 * the origin header gate refusing a direct load balancer request is asserted
 * from the configuration and never observed. Check 5 observes it.
 *
 * Read-only by construction. Every request is a GET or HEAD to a public
 * surface; nothing here authenticates, writes a row, or spends a provider
 * token. It is safe against production, which is the point — it runs at
 * cutover, against the real thing.
 *
 * A check that could not run reports NOT CHECKED and fails the run. It never
 * reports success. A smoke test that goes green because it skipped the work
 * is worse than no smoke test, because someone believes it.
 *
 * Usage:
 *   node scripts/smoke-test.mjs --app-url https://legalworkflows.co.uk \
 *                               --alb-host mike-alb-123.eu-west-2.elb.amazonaws.com \
 *                               --bucket mike-documents
 *   node scripts/smoke-test.mjs --self-test    prove the checks fire
 *
 * --app-url defaults to $APP_URL. --alb-host and --bucket have no default:
 * without them their checks report NOT CHECKED and the run fails, unless
 * --allow-skipped says the operator meant it.
 */

import { createServer } from "node:http";

const TIMEOUT_MS = 15_000;

function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

/** A check returns {ok, detail} or throws; a throw is a failure, not a crash. */
async function get(url, { method = "GET", redirect = "follow", headers = {} } = {}) {
    const response = await fetch(url, {
        method,
        redirect,
        headers: { "user-agent": "legalworkflows-smoke-test", ...headers },
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response;
}

function checks({ appUrl, albHost, bucket, albUrl, bucketUrl }) {
    const origin = appUrl.replace(/\/+$/, "");
    const insecure = origin.replace(/^https:/, "http:");
    // Built here, injectable by the self-test: a check nothing can exercise
    // is a check nobody should trust.
    const albTarget = albUrl ?? (albHost ? `https://${albHost}/api/ready` : null);
    const bucketTarget = bucketUrl ?? (bucket ? `https://${bucket}.s3.amazonaws.com/` : null);

    return [
        {
            name: "http is redirected to https",
            why: "CloudFront is configured redirect-to-https; a plain-http answer means traffic reached something else.",
            async run() {
                const res = await get(insecure, { redirect: "manual" });
                const location = res.headers.get("location") ?? "";
                const ok = res.status >= 300 && res.status < 400 && location.startsWith("https://");
                return { ok, detail: `${res.status} → ${location || "(no location)"}` };
            },
        },
        {
            name: "the application is served",
            why: "The frontend origin is reachable through the edge and returns HTML, not an error page.",
            async run() {
                const res = await get(origin);
                const type = res.headers.get("content-type") ?? "";
                return {
                    ok: res.status === 200 && type.includes("text/html"),
                    detail: `${res.status} ${type || "(no content-type)"}`,
                };
            },
        },
        {
            name: "the backend is ready through the edge",
            why: "/api/* routes to the backend origin. This proves the whole path — edge, load balancer, task — not just that the task is up.",
            async run() {
                const res = await get(`${origin}/api/ready`);
                return { ok: res.status === 200, detail: `/api/ready → ${res.status}` };
            },
        },
        {
            name: "the Corresponding Source is offered",
            why: "AGPL-3.0 section 13 obliges the running service to offer its source to anyone who interacts with it over a network. If /legal does not carry a link, the obligation is unmet the moment the first user arrives.",
            async run() {
                const res = await get(`${origin}/legal`);
                if (res.status !== 200) return { ok: false, detail: `/legal → ${res.status}` };
                const body = await res.text();
                const link = body.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+[^"'<\s]*/);
                return {
                    ok: Boolean(link),
                    detail: link ? `offers ${link[0]}` : "no source link in the page",
                };
            },
        },
        {
            name: "the load balancer refuses a request that did not come through CloudFront",
            why: "Two gates protect the origin: the CloudFront prefix list and a secret X-Origin-Verify header. The prefix list admits every CloudFront distribution in the world, so the header is the one that matters — and it has never been observed doing its job.",
            skip: albTarget ? null : "no --alb-host given",
            async run() {
                const res = await get(albTarget, { redirect: "manual" });
                // The listener's default action with no matching rule. Anything
                // 2xx means the header gate is not gating.
                return {
                    ok: res.status === 403,
                    detail: `direct to origin → ${res.status}${res.status === 403 ? "" : " (expected 403)"}`,
                };
            },
        },
        {
            name: "the document bucket is not readable by the public",
            why: "It holds client documents. A public-read bucket is the single worst outcome available to this deployment.",
            skip: bucketTarget ? null : "no --bucket given",
            async run() {
                const res = await get(bucketTarget, { redirect: "manual" });
                return {
                    ok: res.status === 403,
                    detail: `anonymous list → ${res.status}${res.status === 403 ? "" : " (expected 403)"}`,
                };
            },
        },
    ];
}

async function run(config) {
    const results = [];
    for (const check of checks(config)) {
        if (check.skip) {
            results.push({ ...check, state: "SKIP", detail: check.skip });
            continue;
        }
        try {
            const { ok, detail } = await check.run();
            results.push({ ...check, state: ok ? "PASS" : "FAIL", detail });
        } catch (error) {
            results.push({ ...check, state: "FAIL", detail: `request failed: ${error.message}` });
        }
    }
    return results;
}

function report(results, { allowSkipped }) {
    const mark = { PASS: "  ok  ", FAIL: " FAIL ", SKIP: " ---- " };
    console.log("");
    for (const r of results) {
        console.log(`${mark[r.state]} ${r.name}`);
        console.log(`        ${r.detail}`);
        if (r.state !== "PASS") console.log(`        why it matters: ${r.why}`);
    }

    const failed = results.filter((r) => r.state === "FAIL");
    const skipped = results.filter((r) => r.state === "SKIP");
    console.log("");
    console.log(
        `${results.length - failed.length - skipped.length} passed, ${failed.length} failed, ${skipped.length} not checked`,
    );

    if (skipped.length) {
        console.log("\nNOT CHECKED — these prove nothing either way:");
        for (const r of skipped) console.log(`  ${r.name} (${r.detail})`);
        if (!allowSkipped) {
            console.log("\nPass --allow-skipped if running without them is deliberate.");
        }
    }
    return failed.length === 0 && (allowSkipped || skipped.length === 0);
}

async function selfTest() {
    // A stub that answers the way a correctly configured stack does, so the
    // checks are exercised for real rather than asserted about.
    const server = createServer((req, res) => {
        const url = req.url ?? "/";
        // Two shapes of a wrongly-exposed stack, so the checks that exist to
        // catch them are actually made to catch them.
        if (url === "/refuses") {
            res.writeHead(403).end("Forbidden");
        } else if (url === "/wide-open") {
            res.writeHead(200, { "content-type": "application/xml" }).end("<ListBucketResult/>");
        } else if (url === "/api/ready") {
            res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
        } else if (url === "/legal") {
            res.writeHead(200, { "content-type": "text/html" })
                .end('<a href="https://github.com/owner/repo/tree/abc123">Source</a>');
        } else {
            res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<html></html>");
        }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    // The stub speaks http, so the https-redirect check cannot pass against
    // it. That check is verified by its failure here, which is the honest
    // thing a self-test can say about it.
    const results = await run({ appUrl: base, albHost: null, bucket: null });
    const byName = (fragment) => results.find((r) => r.name.includes(fragment));

    // The two security checks against a stack that is locked down...
    const locked = await run({
        appUrl: base,
        albUrl: `${base}/refuses`,
        bucketUrl: `${base}/refuses`,
    });
    // ...and against one that is not. A check that only ever sees the good
    // case has not been tested, it has been watched.
    const exposed = await run({
        appUrl: base,
        albUrl: `${base}/wide-open`,
        bucketUrl: `${base}/wide-open`,
    });
    const state = (rs, fragment) => rs.find((r) => r.name.includes(fragment)).state;

    const cases = [
        ["the application check passes against a serving stub", byName("application is served").state === "PASS"],
        ["the readiness check passes against a ready stub", byName("backend is ready").state === "PASS"],
        ["the source offer is found when the page carries a link", byName("Corresponding Source").state === "PASS"],
        ["a missing --alb-host is NOT CHECKED, never a pass", byName("load balancer refuses").state === "SKIP"],
        ["a missing --bucket is NOT CHECKED, never a pass", byName("document bucket").state === "SKIP"],
        ["an http-only stub fails the https-redirect check", byName("redirected to https").state === "FAIL"],
        ["not-checked alone fails the run", report(results, { allowSkipped: false }) === false],
        ["an origin that refuses a direct request passes", state(locked, "load balancer refuses") === "PASS"],
        ["an origin that ANSWERS a direct request fails", state(exposed, "load balancer refuses") === "FAIL"],
        ["a bucket that refuses an anonymous list passes", state(locked, "document bucket") === "PASS"],
        ["a bucket that SERVES an anonymous list fails", state(exposed, "document bucket") === "FAIL"],
    ];

    server.close();
    console.log("");
    for (const [label, ok] of cases) console.log(`  ${ok ? "caught" : "MISSED"}  ${label}`);
    const ok = cases.every(([, passed]) => passed);
    console.log(ok ? "\nself-test passed\n" : "\nself-test FAILED\n");
    return ok;
}

if (flag("self-test")) {
    process.exit((await selfTest()) ? 0 : 1);
}

const appUrl = arg("app-url", process.env.APP_URL);
if (!appUrl) {
    console.error("Give --app-url (or set APP_URL). See the header of this file.");
    process.exit(2);
}

console.log(`Smoke test against ${appUrl}`);
const results = await run({
    appUrl,
    albHost: arg("alb-host", null),
    bucket: arg("bucket", null),
});
process.exit(report(results, { allowSkipped: flag("allow-skipped") }) ? 0 : 1);
