/**
 * A small metrics registry, and why it is not `prom-client`.
 *
 * What this service needs is a handful of counters and histograms with fixed
 * label sets, rendered in a text format about thirty lines of code long. What
 * `prom-client` brings with it is a default registry of process and GC
 * collectors registered by side effect, a global singleton that fights with a
 * test runner, and another dependency on a build whose audit gate is one of
 * its own CI checks. That trade is worth making when you want the ecosystem's
 * exporters; it is not worth making for this.
 *
 * The exposition format is Prometheus text (version 0.0.4), which a CloudWatch
 * agent, an ADOT collector, a Grafana Agent and a plain Prometheus all read.
 * Nothing here is Prometheus-specific beyond that rendering.
 *
 * ## Cardinality is a safety property, not a performance note
 *
 * Every distinct combination of label values is a series held in memory for
 * the life of the process. A label whose values come from the outside world is
 * therefore a memory-exhaustion primitive that anyone with a socket can pull:
 * a scanner walking /a, /b, /c… would mint a series per request.
 *
 * That risk is specific and present here. `buildRequestLogLine` deliberately
 * falls back to the *raw request path* when Express matched no route, because
 * seeing what was probed is the whole value of logging an unmatched request.
 * That is the right call for a log line, which is written once and forgotten,
 * and exactly the wrong one for a metric label, which is retained forever.
 *
 * So this registry does not trust its callers. `MAX_SERIES_PER_METRIC` caps
 * each metric, and past the cap a sample is folded into an `overflow` series
 * rather than dropped — an operator sees that the cap was hit instead of
 * quietly reading short numbers.
 */

/** Fixed, ordered label names for a metric. Values arrive in this order. */
export type LabelNames = readonly string[];

/**
 * Ceiling on distinct label combinations per metric.
 *
 * Sized for the real shape of this service: about 100 route patterns times
 * four methods times the handful of status codes actually returned. A figure
 * far above that means labels are coming from somewhere they should not be.
 */
export const MAX_SERIES_PER_METRIC = 2_000;

/** The `overflow` bucket's label value, used once the cap is reached. */
const OVERFLOW = "overflow";

function seriesKey(values: readonly string[]): string {
    return JSON.stringify(values);
}

/**
 * Label values are rendered into a quoted string, so backslashes, quotes and
 * newlines must be escaped or the exposition is malformed — and a value that
 * can inject a newline can forge an entire sample line.
 */
function escapeLabelValue(value: string): string {
    return value
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n");
}

function renderLabels(names: LabelNames, values: readonly string[]): string {
    if (names.length === 0) return "";
    const pairs = names.map(
        (name, index) => `${name}="${escapeLabelValue(values[index] ?? "")}"`,
    );
    return `{${pairs.join(",")}}`;
}

abstract class Metric {
    constructor(
        readonly name: string,
        readonly help: string,
        readonly labelNames: LabelNames,
    ) {}

    /** True when a NEW series would exceed the cap, so callers fold instead. */
    protected atCapacity(size: number, has: boolean): boolean {
        return !has && size >= MAX_SERIES_PER_METRIC;
    }

    protected overflowValues(): string[] {
        return this.labelNames.map(() => OVERFLOW);
    }

    abstract render(): string;
}

export class Counter extends Metric {
    private readonly values = new Map<string, { labels: string[]; count: number }>();

    inc(labels: readonly string[] = [], by = 1): void {
        let key = seriesKey(labels);
        let use: readonly string[] = labels;
        if (this.atCapacity(this.values.size, this.values.has(key))) {
            use = this.overflowValues();
            key = seriesKey(use);
        }
        const existing = this.values.get(key);
        if (existing) {
            existing.count += by;
            return;
        }
        this.values.set(key, { labels: [...use], count: by });
    }

    /** Test seam. Returns 0 for a series that has never been incremented. */
    get(labels: readonly string[] = []): number {
        return this.values.get(seriesKey(labels))?.count ?? 0;
    }

    /** Test seam: how many distinct series this metric is holding. */
    get seriesCount(): number {
        return this.values.size;
    }

    render(): string {
        const lines = [
            `# HELP ${this.name} ${this.help}`,
            `# TYPE ${this.name} counter`,
        ];
        for (const { labels, count } of this.values.values()) {
            lines.push(
                `${this.name}${renderLabels(this.labelNames, labels)} ${count}`,
            );
        }
        return lines.join("\n");
    }
}

/**
 * A cumulative histogram.
 *
 * Buckets are explicit rather than derived, because the useful resolution
 * differs by an order of magnitude between the things measured here: an HTTP
 * request is interesting in milliseconds, a conversion job in seconds, and a
 * model call somewhere between.
 */
export class Histogram extends Metric {
    private readonly series = new Map<
        string,
        { labels: string[]; counts: number[]; sum: number; count: number }
    >();

    constructor(
        name: string,
        help: string,
        labelNames: LabelNames,
        readonly buckets: readonly number[],
    ) {
        super(name, help, labelNames);
    }

    observe(value: number, labels: readonly string[] = []): void {
        // NaN would poison the sum irrecoverably for the life of the process.
        if (!Number.isFinite(value)) return;

        let key = seriesKey(labels);
        let use: readonly string[] = labels;
        if (this.atCapacity(this.series.size, this.series.has(key))) {
            use = this.overflowValues();
            key = seriesKey(use);
        }

        let entry = this.series.get(key);
        if (!entry) {
            entry = {
                labels: [...use],
                counts: new Array(this.buckets.length).fill(0),
                sum: 0,
                count: 0,
            };
            this.series.set(key, entry);
        }
        entry.sum += value;
        entry.count += 1;
        for (let i = 0; i < this.buckets.length; i += 1) {
            if (value <= this.buckets[i]) entry.counts[i] += 1;
        }
    }

    /** Test seam: total observations for a series. */
    count(labels: readonly string[] = []): number {
        return this.series.get(seriesKey(labels))?.count ?? 0;
    }

    render(): string {
        const lines = [
            `# HELP ${this.name} ${this.help}`,
            `# TYPE ${this.name} histogram`,
        ];
        for (const entry of this.series.values()) {
            for (let i = 0; i < this.buckets.length; i += 1) {
                const labels = renderLabels(
                    [...this.labelNames, "le"],
                    [...entry.labels, String(this.buckets[i])],
                );
                lines.push(`${this.name}_bucket${labels} ${entry.counts[i]}`);
            }
            const infLabels = renderLabels(
                [...this.labelNames, "le"],
                [...entry.labels, "+Inf"],
            );
            lines.push(`${this.name}_bucket${infLabels} ${entry.count}`);
            lines.push(
                `${this.name}_sum${renderLabels(this.labelNames, entry.labels)} ${entry.sum}`,
            );
            lines.push(
                `${this.name}_count${renderLabels(this.labelNames, entry.labels)} ${entry.count}`,
            );
        }
        return lines.join("\n");
    }
}

/**
 * A value read at scrape time rather than accumulated.
 *
 * Queue depth is the reason this exists: it is a property of a database table,
 * not of this process, and two API tasks each accumulating it would double the
 * real figure. Reading it on scrape keeps one source of truth.
 */
export class Gauge extends Metric {
    constructor(
        name: string,
        help: string,
        labelNames: LabelNames,
        private readonly read: () => Promise<
            Array<{ labels: string[]; value: number }>
        >,
    ) {
        super(name, help, labelNames);
    }

    async collect(): Promise<string> {
        const lines = [
            `# HELP ${this.name} ${this.help}`,
            `# TYPE ${this.name} gauge`,
        ];
        // A gauge that cannot be read must not fail the whole scrape: the
        // counters beside it are still the answer to "is this service up".
        let samples: Array<{ labels: string[]; value: number }> = [];
        try {
            samples = await this.read();
        } catch {
            return lines.join("\n");
        }
        for (const { labels, value } of samples.slice(0, MAX_SERIES_PER_METRIC)) {
            if (!Number.isFinite(value)) continue;
            lines.push(
                `${this.name}${renderLabels(this.labelNames, labels)} ${value}`,
            );
        }
        return lines.join("\n");
    }

    render(): string {
        // Gauges are collected asynchronously; render() exists only to satisfy
        // the base type and is never the path the registry takes.
        return "";
    }
}

export class Registry {
    private readonly metrics: Metric[] = [];
    private readonly gauges: Gauge[] = [];

    register<T extends Metric>(metric: T): T {
        if (metric instanceof Gauge) {
            this.gauges.push(metric);
        } else {
            this.metrics.push(metric);
        }
        return metric;
    }

    /** The exposition body. Always ends in a newline, as the format requires. */
    async expose(): Promise<string> {
        const blocks = this.metrics.map((metric) => metric.render());
        for (const gauge of this.gauges) {
            blocks.push(await gauge.collect());
        }
        return `${blocks.join("\n\n")}\n`;
    }
}

export const CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";
