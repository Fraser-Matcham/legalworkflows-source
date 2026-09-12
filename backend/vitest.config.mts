import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        include: ["src/**/*.test.ts"],
        exclude: ["dist/**", "node_modules/**"],
        // Generous timeouts so cold-start module transform/import latency
        // can't cause spurious timeout failures on a cold CI runner. Warm
        // tests finish in ~1s; this only guards the pathological cold case —
        // it does not mask hangs.
        testTimeout: 20000,
        hookTimeout: 20000,
        coverage: {
            provider: "v8",
            reporter: ["text", "lcov"],
            include: ["src/lib/**"],
            // No-regression RATCHET floor, not a target.
            //
            // Scope is src/lib/** only, so src/routes/** is not measured at
            // all: a route-level test PR can legitimately move these numbers
            // by 0.00. The spread across src/lib/** is wide — many libs sit at
            // or near 100%, while lib/mcp (7%), lib/tabular (36%) and
            // lib/chat/tools (55%) hold the global figure down.
            //
            // Measured on this tree: 65.00% statements, 55.58% branches,
            // 67.81% functions, 67.30% lines. The floors below are those
            // rounded down to whole percents, so CI fails on a *drop*.
            // Statements now has the least headroom, 0.00 points, because the
            // figure landed exactly on a whole percent — if a drop
            // below it came from an upstream merge rather than your own
            // change, see the upstream-merge note in docs/testing-coverage.md
            // before touching these numbers.
            //
            // Floors only go up: when you add tests, raise them in the same
            // PR. Backlog + per-area status: docs/testing-coverage.md.
            thresholds: {
                statements: 65,
                branches: 55,
                functions: 67,
                lines: 67,
            },
        },
    },
});
