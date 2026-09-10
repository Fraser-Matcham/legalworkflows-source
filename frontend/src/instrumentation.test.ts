import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "./instrumentation";

/**
 * The contract itself is tested in `app/lib/env.test.ts`. What is worth
 * pinning here is the one thing that is easy to get wrong and silent when it
 * is: a fatal misconfiguration must *exit the process*, not merely throw.
 *
 * Next catches a throw from this hook, logs an unhandledRejection and carries
 * on serving 500s. Verified against the standalone server: the process stayed
 * alive and answered every request, which a TCP health check passes — so a
 * broken deploy would look healthy and never roll back.
 */
afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

const arrange = () => {
    const exit = vi
        .spyOn(process, "exit")
        // Real `process.exit` never returns; the spy does, so `register`
        // falls through to its edge-runtime throw. Both are asserted below.
        .mockImplementation(() => undefined as never);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    return { exit, error, warn };
};

describe("register", () => {
    it("exits the process when production configuration is fatal", () => {
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("API_BASE_URL", "");
        const { exit, error } = arrange();

        expect(() => register()).toThrow(/not usable/);

        expect(exit).toHaveBeenCalledWith(1);
        expect(error.mock.calls[0]?.[0]).toContain("API_BASE_URL");
    });

    it("starts with a warning when only non-fatal values are missing", () => {
        // This is the e2e suite's configuration: a production build served
        // without NEXT_PUBLIC_APP_URL. It must not be fatal.
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("API_BASE_URL", "http://localhost:3001");
        vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
        const { exit, warn } = arrange();

        expect(() => register()).not.toThrow();

        expect(exit).not.toHaveBeenCalled();
        expect(warn.mock.calls[0]?.[0]).toContain("NEXT_PUBLIC_APP_URL");
    });

    it("says nothing when the environment is complete", () => {
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("API_BASE_URL", "http://localhost:3001");
        vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.com");
        vi.stubEnv("NEXT_PUBLIC_WORKFLOW_CONTRIBUTIONS_ENABLED", "false");
        const { exit, error, warn } = arrange();

        register();

        expect(exit).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
    });

    it("never exits outside production", () => {
        vi.stubEnv("NODE_ENV", "development");
        vi.stubEnv("API_BASE_URL", "");
        const { exit, warn } = arrange();

        expect(() => register()).not.toThrow();

        expect(exit).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalled();
    });
});
