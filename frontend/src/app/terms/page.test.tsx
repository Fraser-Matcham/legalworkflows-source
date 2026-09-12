import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import TermsPage from "./page";
import {
    CONTACT_EMAIL,
    GOVERNING_LAW,
    OPERATOR_NAME,
} from "@/app/lib/operatorDetails";

/**
 * The clauses asserted here are the ones whose absence would change the
 * agreement rather than merely reword it: who you contract with, that output
 * must be checked, that content stays the customer's, the liability position,
 * and the governing law. A redesign that drops one should fail here.
 */
describe("Terms of Use", () => {
    it("names who the agreement is with", () => {
        render(<TermsPage />);

        expect(document.body.textContent).toMatch(
            new RegExp(OPERATOR_NAME),
        );
        expect(
            screen.getAllByRole("link", { name: CONTACT_EMAIL }).length,
        ).toBeGreaterThan(0);
    });

    it("says the service does not give legal advice and creates no retainer", () => {
        // The single most important sentence in the document for a product
        // sold to solicitors.
        render(<TermsPage />);
        const body = document.body.textContent ?? "";

        expect(body).toMatch(/does not produce legal advice/i);
        expect(body).toMatch(/solicitor–client relationship/i);
    });

    it("requires AI output to be reviewed before it is relied on", () => {
        render(<TermsPage />);
        const body = document.body.textContent ?? "";

        expect(body).toMatch(/reviewed by a suitably qualified person/i);
        expect(body).toMatch(/citations and quotations must be checked/i);
    });

    it("leaves ownership of uploaded content with the customer", () => {
        render(<TermsPage />);
        const body = document.body.textContent ?? "";

        expect(body).toMatch(/you keep all rights/i);
        expect(body).toMatch(/we claim no ownership/i);
        expect(body).toMatch(/do not train AI models on your content/i);
    });

    it("preserves the liabilities that cannot lawfully be excluded", () => {
        // Excluding these would be unenforceable and would taint the clause.
        render(<TermsPage />);
        const body = document.body.textContent ?? "";

        expect(body).toMatch(/death or personal injury/i);
        expect(body).toMatch(/fraud/i);
        expect(body).toMatch(/cannot lawfully be limited/i);
    });

    it("states a liability cap", () => {
        render(<TermsPage />);
        expect(document.body.textContent).toMatch(/total liability/i);
        expect(document.body.textContent).toMatch(/£100/);
    });

    it("tells the customer the service is not a backup", () => {
        render(<TermsPage />);
        expect(document.body.textContent).toMatch(
            /not a system of record and is not a backup/i,
        );
    });

    it("names the governing law and jurisdiction", () => {
        render(<TermsPage />);
        const body = document.body.textContent ?? "";

        expect(body).toMatch(new RegExp(`governed by the law of ${GOVERNING_LAW}`, "i"));
        expect(body).toMatch(/exclusive jurisdiction/i);
    });

    it("links to the privacy policy and the licence notices", () => {
        render(<TermsPage />);

        expect(
            screen.getAllByRole("link", { name: /privacy policy/i }).length,
        ).toBeGreaterThan(0);
        expect(
            screen.getAllByRole("link", { name: /licence notices/i }).length,
        ).toBeGreaterThan(0);
    });
});
