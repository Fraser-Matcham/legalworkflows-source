import { describe, expect, it } from "vitest";
import {
    Counter,
    Gauge,
    Histogram,
    MAX_SERIES_PER_METRIC,
    Registry,
} from "./registry";

describe("Counter", () => {
    it("accumulates per label combination", () => {
        const counter = new Counter("c_total", "help", ["a"]);

        counter.inc(["x"]);
        counter.inc(["x"]);
        counter.inc(["y"], 5);

        expect(counter.get(["x"])).toBe(2);
        expect(counter.get(["y"])).toBe(5);
        expect(counter.get(["never"])).toBe(0);
    });

    it("renders the exposition header and one line per series", () => {
        const counter = new Counter("c_total", "Some help.", ["route"]);
        counter.inc(["/a"], 3);

        expect(counter.render()).toBe(
            [
                "# HELP c_total Some help.",
                "# TYPE c_total counter",
                'c_total{route="/a"} 3',
            ].join("\n"),
        );
    });

    it("escapes a label value that would otherwise forge a sample line", () => {
        // A value carrying a newline and a quote could close the label set and
        // append a line of the attacker's choosing to the exposition.
        const counter = new Counter("c_total", "help", ["route"]);
        counter.inc(['/a"\nc_total{route="forged"} 999']);

        const rendered = counter.render();
        expect(rendered.split("\n")).toHaveLength(3);
        expect(rendered).toContain('\\"');
        expect(rendered).toContain("\\n");
    });

    it("folds into an overflow series once the cardinality cap is reached", () => {
        // Unmatched request paths are attacker-controlled. Without this cap,
        // a scanner would mint a retained series per request.
        const counter = new Counter("c_total", "help", ["route"]);
        for (let i = 0; i < MAX_SERIES_PER_METRIC + 50; i += 1) {
            counter.inc([`/path-${i}`]);
        }

        expect(counter.seriesCount).toBe(MAX_SERIES_PER_METRIC + 1);
        expect(counter.get(["overflow"])).toBe(50);
    });

    it("keeps counting an existing series after the cap is reached", () => {
        const counter = new Counter("c_total", "help", ["route"]);
        for (let i = 0; i < MAX_SERIES_PER_METRIC; i += 1) {
            counter.inc([`/path-${i}`]);
        }

        counter.inc(["/path-0"]);

        expect(counter.get(["/path-0"])).toBe(2);
        expect(counter.get(["overflow"])).toBe(0);
    });
});

describe("Histogram", () => {
    it("counts observations into cumulative buckets with a sum", () => {
        const histogram = new Histogram("h_seconds", "help", [], [1, 10]);

        histogram.observe(0.5);
        histogram.observe(5);
        histogram.observe(50);

        const rendered = histogram.render();
        expect(rendered).toContain('h_seconds_bucket{le="1"} 1');
        expect(rendered).toContain('h_seconds_bucket{le="10"} 2');
        expect(rendered).toContain('h_seconds_bucket{le="+Inf"} 3');
        expect(rendered).toContain("h_seconds_sum 55.5");
        expect(rendered).toContain("h_seconds_count 3");
    });

    it("keeps buckets non-decreasing, as the format requires", () => {
        const histogram = new Histogram("h_seconds", "help", [], [1, 2, 3]);
        histogram.observe(0.1);

        const counts = [...histogram.render().matchAll(/_bucket\{le="[^"]+"\} (\d+)/g)].map(
            (match) => Number(match[1]),
        );
        for (let i = 1; i < counts.length; i += 1) {
            expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
        }
    });

    it("ignores a non-finite observation rather than poisoning the sum", () => {
        // A NaN sum cannot be recovered for the life of the process.
        const histogram = new Histogram("h_seconds", "help", [], [1]);

        histogram.observe(Number.NaN);
        histogram.observe(Number.POSITIVE_INFINITY);
        histogram.observe(2);

        expect(histogram.count()).toBe(1);
        expect(histogram.render()).toContain("h_seconds_sum 2");
    });

    it("folds into an overflow series once the cardinality cap is reached", () => {
        const histogram = new Histogram("h_seconds", "help", ["route"], [1]);
        for (let i = 0; i < MAX_SERIES_PER_METRIC + 10; i += 1) {
            histogram.observe(0.1, [`/path-${i}`]);
        }

        expect(histogram.count(["overflow"])).toBe(10);
    });
});

describe("Gauge", () => {
    it("reads its value at collection time", async () => {
        let backlog = 3;
        const gauge = new Gauge("g", "help", ["status"], async () => [
            { labels: ["pending"], value: backlog },
        ]);

        expect(await gauge.collect()).toContain('g{status="pending"} 3');
        backlog = 9;
        expect(await gauge.collect()).toContain('g{status="pending"} 9');
    });

    it("renders its header but no samples when the read fails", async () => {
        // A database that cannot be reached must not fail the whole scrape:
        // the counters beside it still answer "is this service up".
        const gauge = new Gauge("g", "help", ["status"], async () => {
            throw new Error("database unreachable");
        });

        const collected = await gauge.collect();
        expect(collected).toContain("# TYPE g gauge");
        expect(collected.split("\n")).toHaveLength(2);
    });

    it("drops a non-finite sample", async () => {
        const gauge = new Gauge("g", "help", ["status"], async () => [
            { labels: ["pending"], value: Number.NaN },
        ]);

        expect(await gauge.collect()).not.toContain("NaN");
    });
});

describe("Registry", () => {
    it("exposes every metric, separated, ending in a newline", async () => {
        const registry = new Registry();
        registry.register(new Counter("a_total", "A.", [])).inc();
        registry.register(
            new Gauge("b", "B.", [], async () => [{ labels: [], value: 1 }]),
        );

        const body = await registry.expose();

        expect(body).toContain("# TYPE a_total counter");
        expect(body).toContain("# TYPE b gauge");
        expect(body).toContain("\n\n");
        expect(body.endsWith("\n")).toBe(true);
    });
});
