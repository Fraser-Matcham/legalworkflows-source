import { describe, expect, it } from "vitest";
import {
    DEV_API_BASE_URL,
    DEV_APP_URL,
    type EnvIssue,
    checkFrontendEnv,
    formatEnvIssues,
    resolveApiBaseUrl,
} from "./env";

const PROD = { production: true };
const DEV = { production: false };

/** A configuration with nothing wrong with it, to vary one field at a time. */
const VALID = {
    API_BASE_URL: "http://backend:3001",
    NEXT_PUBLIC_APP_URL: "https://example.com",
    NEXT_PUBLIC_WORKFLOW_CONTRIBUTIONS_ENABLED: "false",
    NEXT_PUBLIC_SOURCE_URL: "https://github.com/example/source/tree/abc1234",
};

const named = (issues: EnvIssue[], name: string) =>
    issues.filter((issue) => issue.name === name);

describe("resolveApiBaseUrl", () => {
    it("throws in production when nothing is configured", () => {
        expect(() => resolveApiBaseUrl(undefined, PROD)).toThrow(
            "API_BASE_URL is required at runtime.",
        );
    });

    it("treats a whitespace-only value as unset", () => {
        expect(() => resolveApiBaseUrl("   ", PROD)).toThrow(
            "API_BASE_URL is required at runtime.",
        );
    });

    it("falls back to the local backend outside production", () => {
        expect(resolveApiBaseUrl(undefined, DEV)).toBe(DEV_API_BASE_URL);
    });

    it("strips a trailing slash so paths are not double-slashed", () => {
        expect(resolveApiBaseUrl("http://backend:3001/", PROD)).toBe(
            "http://backend:3001",
        );
    });

    it("accepts https and trims surrounding whitespace", () => {
        expect(resolveApiBaseUrl("  https://api.example.com  ", PROD)).toBe(
            "https://api.example.com",
        );
    });

    it("rejects a value that parses but is not http or https", () => {
        // `new URL()` accepts this happily; the protocol check is the point.
        expect(() => resolveApiBaseUrl("ftp://backend:3001", PROD)).toThrow(
            "API_BASE_URL must use http or https.",
        );
    });

    it("rejects a value with no scheme at all", () => {
        expect(() => resolveApiBaseUrl("backend:3001", DEV)).toThrow(
            "API_BASE_URL must use http or https.",
        );
    });
});

describe("checkFrontendEnv", () => {
    it("reports nothing when the contract is satisfied", () => {
        expect(checkFrontendEnv(VALID, PROD)).toEqual([]);
    });

    it("is fatal when API_BASE_URL is missing in production", () => {
        const issues = named(
            checkFrontendEnv({ ...VALID, API_BASE_URL: undefined }, PROD),
            "API_BASE_URL",
        );

        expect(issues).toHaveLength(1);
        expect(issues[0].severity).toBe("fatal");
    });

    it("is fatal when API_BASE_URL is present but whitespace", () => {
        const issues = named(
            checkFrontendEnv({ ...VALID, API_BASE_URL: "  " }, PROD),
            "API_BASE_URL",
        );

        expect(issues[0].severity).toBe("fatal");
        expect(issues[0].problem).toContain("is not set");
    });

    it("is fatal when API_BASE_URL has no scheme", () => {
        const issues = named(
            checkFrontendEnv({ ...VALID, API_BASE_URL: "backend:3001" }, PROD),
            "API_BASE_URL",
        );

        expect(issues[0].severity).toBe("fatal");
        expect(issues[0].problem).toContain("absolute http or https URL");
    });

    it("downgrades everything to a warning outside production", () => {
        // A dev server that refuses to boot over configuration it does not
        // need is a worse tool than one that says something.
        const issues = checkFrontendEnv(
            { API_BASE_URL: undefined, NEXT_PUBLIC_APP_URL: "nonsense" },
            DEV,
        );

        expect(issues).not.toHaveLength(0);
        expect(issues.every((issue) => issue.severity === "warning")).toBe(
            true,
        );
    });

    it("warns rather than dies when NEXT_PUBLIC_APP_URL is unset in production", () => {
        // Never fatal: the e2e suite serves a production build without it.
        const issues = named(
            checkFrontendEnv({ ...VALID, NEXT_PUBLIC_APP_URL: undefined }, PROD),
            "NEXT_PUBLIC_APP_URL",
        );

        expect(issues).toHaveLength(1);
        expect(issues[0].severity).toBe("warning");
        expect(issues[0].problem).toContain(DEV_APP_URL);
    });

    it("treats a whitespace-only NEXT_PUBLIC_APP_URL as unset", () => {
        const issues = named(
            checkFrontendEnv({ ...VALID, NEXT_PUBLIC_APP_URL: " " }, PROD),
            "NEXT_PUBLIC_APP_URL",
        );

        expect(issues[0].problem).toContain("is not set");
    });

    it("is fatal when NEXT_PUBLIC_APP_URL is set but malformed", () => {
        // Absence is defensible; a broken value is always a mistake.
        const issues = named(
            checkFrontendEnv(
                { ...VALID, NEXT_PUBLIC_APP_URL: "example.com" },
                PROD,
            ),
            "NEXT_PUBLIC_APP_URL",
        );

        expect(issues[0].severity).toBe("fatal");
    });

    it("is fatal when NEXT_PUBLIC_APP_URL parses but is not http", () => {
        const issues = named(
            checkFrontendEnv(
                { ...VALID, NEXT_PUBLIC_APP_URL: "ftp://example.com" },
                PROD,
            ),
            "NEXT_PUBLIC_APP_URL",
        );

        expect(issues[0].severity).toBe("fatal");
    });

    it("warns about a trailing slash on NEXT_PUBLIC_APP_URL", () => {
        const issues = named(
            checkFrontendEnv(
                { ...VALID, NEXT_PUBLIC_APP_URL: "https://example.com/" },
                PROD,
            ),
            "NEXT_PUBLIC_APP_URL",
        );

        expect(issues).toHaveLength(1);
        expect(issues[0].severity).toBe("warning");
        expect(issues[0].problem).toContain("double-slashed");
    });

    it("accepts a path-bearing app URL without a trailing slash", () => {
        expect(
            named(
                checkFrontendEnv(
                    { ...VALID, NEXT_PUBLIC_APP_URL: "https://example.com/app" },
                    PROD,
                ),
                "NEXT_PUBLIC_APP_URL",
            ),
        ).toEqual([]);
    });

    it.each(["true", "false", "", undefined])(
        "accepts %o for the contributions flag",
        (value) => {
            expect(
                named(
                    checkFrontendEnv(
                        {
                            ...VALID,
                            NEXT_PUBLIC_WORKFLOW_CONTRIBUTIONS_ENABLED: value,
                        },
                        PROD,
                    ),
                    "NEXT_PUBLIC_WORKFLOW_CONTRIBUTIONS_ENABLED",
                ),
            ).toEqual([]);
        },
    );

    it.each(["TRUE", "1", "yes"])(
        "warns that %o silently disables the contribution flow",
        (value) => {
            // Read with `=== "true"`, so any other spelling disables the
            // feature with nothing visible in the UI to say so.
            const issues = named(
                checkFrontendEnv(
                    {
                        ...VALID,
                        NEXT_PUBLIC_WORKFLOW_CONTRIBUTIONS_ENABLED: value,
                    },
                    PROD,
                ),
                "NEXT_PUBLIC_WORKFLOW_CONTRIBUTIONS_ENABLED",
            );

            expect(issues).toHaveLength(1);
            expect(issues[0].severity).toBe("warning");
        },
    );

    it("reports every problem at once rather than the first", () => {
        // An operator bringing up a new environment should see the whole list
        // once, not discover the next mistake after each restart.
        const issues = checkFrontendEnv(
            {
                API_BASE_URL: undefined,
                NEXT_PUBLIC_APP_URL: undefined,
                NEXT_PUBLIC_WORKFLOW_CONTRIBUTIONS_ENABLED: "TRUE",
            },
            PROD,
        );

        expect(issues.map((issue) => issue.name)).toEqual([
            "API_BASE_URL",
            "NEXT_PUBLIC_APP_URL",
            "NEXT_PUBLIC_SOURCE_URL",
            "NEXT_PUBLIC_WORKFLOW_CONTRIBUTIONS_ENABLED",
        ]);
    });
});

describe("formatEnvIssues", () => {
    it("leads with the fatal heading and lists fatal issues first", () => {
        const report = formatEnvIssues([
            {
                name: "SECOND",
                severity: "warning",
                problem: "is questionable.",
                hint: "Consider it.",
            },
            {
                name: "FIRST",
                severity: "fatal",
                problem: "is broken.",
                hint: "Fix it.",
            },
        ]);

        expect(report).toContain("Frontend environment is not usable:");
        expect(report.indexOf("FIRST")).toBeLessThan(report.indexOf("SECOND"));
        expect(report).toContain("Fix it.");
        expect(report).toContain("frontend/.env.example");
    });

    it("uses the warning heading when nothing is fatal", () => {
        const report = formatEnvIssues([
            {
                name: "ONLY",
                severity: "warning",
                problem: "is questionable.",
                hint: "Consider it.",
            },
        ]);

        expect(report).toContain("Frontend environment warnings:");
        expect(report).not.toContain("not usable");
    });
});

describe("checkFrontendEnv: NEXT_PUBLIC_SOURCE_URL", () => {
    it("warns, never dies, when the source offer URL is unset in production", () => {
        // A build without a mirror (e2e, local) must still boot; the page
        // falls back to the upstream repository and the log says so.
        const issues = named(
            checkFrontendEnv({ ...VALID, NEXT_PUBLIC_SOURCE_URL: undefined }, PROD),
            "NEXT_PUBLIC_SOURCE_URL",
        );

        expect(issues).toHaveLength(1);
        expect(issues[0].severity).toBe("warning");
        expect(issues[0].problem).toContain("upstream repository");
    });

    it("is fatal in production when the source offer URL is malformed", () => {
        // Nobody sets a broken URL on purpose, and a broken offer is worse
        // than the fallback.
        const issues = named(
            checkFrontendEnv({ ...VALID, NEXT_PUBLIC_SOURCE_URL: "github.com/x" }, PROD),
            "NEXT_PUBLIC_SOURCE_URL",
        );

        expect(issues).toHaveLength(1);
        expect(issues[0].severity).toBe("fatal");
    });

    it("accepts a well-formed source offer URL", () => {
        expect(
            named(checkFrontendEnv(VALID, PROD), "NEXT_PUBLIC_SOURCE_URL"),
        ).toHaveLength(0);
    });
});
