import { describe, expect, it } from "vitest";
import {
    assertProductionConfiguration,
    checkProductionConfig,
    formatConfigIssues,
} from "./productionConfig";
import { configuredAllowedOrigins, requestOriginIsTrusted } from "./origins";
import { validateRuntimeConfiguration } from "./runtimeConfig";

const SOUND = {
    NODE_ENV: "production",
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SECRET_KEY: "k",
    SUPABASE_PUBLISHABLE_KEY: "p",
    FRONTEND_URL: "https://legalworkflows.co.uk",
    API_PUBLIC_URL: "https://legalworkflows.co.uk",
};

const PROD = (extra: Record<string, string> = {}) =>
    ({ ...SOUND, ...extra }) as NodeJS.ProcessEnv;

const names = (env: NodeJS.ProcessEnv) =>
    checkProductionConfig(env).map((issue) => issue.name);

describe("the gap this covers", () => {
    it("shows ALLOWED_ORIGINS reaching the allowlist unchecked", () => {
        // Not a test of the guard — a test of why it exists. This environment
        // passes validateRuntimeConfiguration completely, and still trusts a
        // plain-HTTP origin for credentialed cross-origin requests.
        const env = PROD({ ALLOWED_ORIGINS: "http://evil.example.com" });

        expect(() => validateRuntimeConfiguration(env)).not.toThrow();
        expect([...configuredAllowedOrigins(env)]).toContain(
            "http://evil.example.com",
        );
        expect(requestOriginIsTrusted("http://evil.example.com", env)).toBe(
            true,
        );

        // Which is what this module is for.
        expect(checkProductionConfig(env)).toHaveLength(1);
    });

    it("shows requireHttps being satisfied by a loopback origin", () => {
        // https://localhost:3000 passes every existing check.
        const env = PROD({ FRONTEND_URL: "https://localhost:3000" });

        expect(() => validateRuntimeConfiguration(env)).not.toThrow();
        expect(names(env)).toEqual(["FRONTEND_URL"]);
    });
});

describe("checkProductionConfig", () => {
    it("passes a correctly configured deployment", () => {
        expect(
            checkProductionConfig(
                PROD({
                    WORD_ADDIN_URL: "https://addin.legalworkflows.co.uk",
                    ALLOWED_ORIGINS: "https://partner.example.com",
                }),
            ),
        ).toEqual([]);
    });

    it("checks nothing outside production", () => {
        // Local development legitimately serves over plain HTTP on localhost.
        expect(
            checkProductionConfig({
                NODE_ENV: "development",
                FRONTEND_URL: "http://localhost:3000",
                ALLOWED_ORIGINS: "http://localhost:5173",
            } as NodeJS.ProcessEnv),
        ).toEqual([]);
    });

    it("does not duplicate the required-ness check", () => {
        // A missing FRONTEND_URL is validateRuntimeConfiguration's to report,
        // and reporting it twice would send an operator looking for two faults.
        const env = PROD();
        delete (env as Record<string, unknown>).FRONTEND_URL;

        expect(checkProductionConfig(env)).toEqual([]);
    });

    it("does not duplicate the HTTPS check on FRONTEND_URL", () => {
        // http:// on FRONTEND_URL is already fatal in runtimeConfig.
        const env = PROD({ FRONTEND_URL: "http://legalworkflows.co.uk" });

        expect(() => validateRuntimeConfiguration(env)).toThrow(/FRONTEND_URL/);
        expect(checkProductionConfig(env)).toEqual([]);
    });

    it("rejects a non-HTTPS ALLOWED_ORIGINS entry", () => {
        const issues = checkProductionConfig(
            PROD({ ALLOWED_ORIGINS: "http://partner.example.com" }),
        );

        expect(issues).toHaveLength(1);
        expect(issues[0].problem).toContain("not HTTPS");
    });

    it("rejects an unparseable ALLOWED_ORIGINS entry", () => {
        const issues = checkProductionConfig(
            PROD({ ALLOWED_ORIGINS: "partner.example.com" }),
        );

        expect(issues[0].problem).toContain("not an absolute URL");
    });

    it.each(["https://localhost:3000", "https://127.0.0.1", "https://[::1]"])(
        "rejects the loopback origin %s",
        (origin) => {
            const issues = checkProductionConfig(
                PROD({ ALLOWED_ORIGINS: origin }),
            );

            expect(issues.some((i) => i.problem.includes("own machine"))).toBe(
                true,
            );
        },
    );

    it("checks every entry, not just the first", () => {
        const issues = checkProductionConfig(
            PROD({
                ALLOWED_ORIGINS:
                    "https://good.example.com, http://bad.example.com ,https://localhost:9000",
            }),
        );

        expect(issues).toHaveLength(2);
        expect(issues[0].name).toContain("bad.example.com");
        expect(issues[1].name).toContain("localhost");
    });

    it("tolerates empty entries from a trailing comma", () => {
        expect(
            checkProductionConfig(
                PROD({ ALLOWED_ORIGINS: "https://a.example.com,," }),
            ),
        ).toEqual([]);
    });

    it("accepts a trailing slash rather than calling it malformed", () => {
        expect(
            checkProductionConfig(
                PROD({ ALLOWED_ORIGINS: "https://a.example.com/" }),
            ),
        ).toEqual([]);
    });

    it("reports a loopback WORD_ADDIN_URL", () => {
        expect(names(PROD({ WORD_ADDIN_URL: "https://localhost:3200" }))).toEqual(
            ["WORD_ADDIN_URL"],
        );
    });
});

describe("assertProductionConfiguration", () => {
    it("throws on an unsafe origin, so the process can exit", () => {
        expect(() =>
            assertProductionConfiguration(
                PROD({ ALLOWED_ORIGINS: "http://evil.example.com" }),
            ),
        ).toThrow(/widen the CORS allowlist/);
    });

    it("returns quietly when the configuration is sound", () => {
        expect(() => assertProductionConfiguration(PROD())).not.toThrow();
    });

    it("returns quietly outside production", () => {
        expect(() =>
            assertProductionConfiguration({
                NODE_ENV: "test",
                ALLOWED_ORIGINS: "http://localhost:5173",
            } as NodeJS.ProcessEnv),
        ).not.toThrow();
    });
});

describe("formatConfigIssues", () => {
    it("names the entry and points at the runbook", () => {
        const report = formatConfigIssues(
            checkProductionConfig(
                PROD({ ALLOWED_ORIGINS: "http://evil.example.com" }),
            ),
        );

        expect(report).toContain("evil.example.com");
        expect(report).toContain("docs/deployment.md");
    });
});
