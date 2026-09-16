import { describe, it, expect } from "vitest";
import {
    CATALOGUE_NOT_CONFIGURED_MESSAGE,
    EX_CATALOGUE_NOT_CONFIGURED,
    catalogueIsConfigured,
} from "../workflowCatalogueConfig";

describe("catalogueIsConfigured", () => {
    it("treats an empty value as no catalogue", () => {
        expect(catalogueIsConfigured({ MIKE_WORKFLOWS_REPOSITORY: "" })).toBe(false);
    });

    it("treats whitespace as no catalogue, since a tfvars typo looks like this", () => {
        expect(catalogueIsConfigured({ MIKE_WORKFLOWS_REPOSITORY: "   " })).toBe(false);
    });

    it("treats a repository as configured", () => {
        expect(
            catalogueIsConfigured({ MIKE_WORKFLOWS_REPOSITORY: "owner/catalogue" }),
        ).toBe(true);
    });

    it("treats UNSET as configured, because it falls back to the upstream default", () => {
        // This is the case most likely to be got wrong. Unset does not mean
        // "no catalogue" — workflowCatalogSource.ts falls back to
        // Open-Legal-Products/mike-workflows, which is a real catalogue this
        // deployment may or may not be able to read. Skipping there would hide
        // a misconfiguration behind a green release, which is the failure this
        // whole change exists to remove.
        expect(catalogueIsConfigured({})).toBe(true);
    });

    it("uses an exit code the release pipeline can tell apart from a failure", () => {
        expect(EX_CATALOGUE_NOT_CONFIGURED).toBe(78);
        expect(EX_CATALOGUE_NOT_CONFIGURED).not.toBe(0);
        expect(EX_CATALOGUE_NOT_CONFIGURED).not.toBe(1);
    });

    it("says how to get a catalogue, not just that there isn't one", () => {
        expect(CATALOGUE_NOT_CONFIGURED_MESSAGE).toContain("workflows_repository");
        expect(CATALOGUE_NOT_CONFIGURED_MESSAGE).toContain("MIKE_WORKFLOWS_GITHUB_TOKEN");
        expect(CATALOGUE_NOT_CONFIGURED_MESSAGE).toContain("nothing failed");
    });
});
