import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PrivacyPage from "./page";
import {
    OPERATOR_NAME,
    PRIVACY_EMAIL,
    SUB_PROCESSORS,
} from "@/app/lib/operatorDetails";

/**
 * These assertions are the parts UK GDPR requires to be told to a data
 * subject, plus the two disclosures this service makes that a generic policy
 * would not. If a redesign drops one, this fails rather than quietly putting
 * the service out of compliance — the same reasoning as the AGPL notices test
 * beside it.
 */
describe("Privacy Policy", () => {
    it("identifies the controller and gives a means of contact (Art. 13(1)(a)-(b))", () => {
        render(<PrivacyPage />);

        expect(screen.getAllByText(new RegExp(OPERATOR_NAME)).length).toBeGreaterThan(0);
        expect(
            screen.getAllByRole("link", { name: PRIVACY_EMAIL }).length,
        ).toBeGreaterThan(0);
    });

    it("distinguishes controller from processor, which is the point for a law firm", () => {
        // For uploaded client documents the customer is the controller and we
        // are their processor. Losing this paragraph would misstate the
        // relationship to every firm that reads it.
        render(<PrivacyPage />);

        const body = document.body.textContent ?? "";
        expect(body).toMatch(/we are the\s+controller/i);
        expect(body).toMatch(/you are the controller and we are/i);
        expect(body).toMatch(/processor/i);
    });

    it("states a lawful basis for each purpose (Art. 13(1)(c))", () => {
        render(<PrivacyPage />);
        const body = document.body.textContent ?? "";

        expect(body).toMatch(/performance of our contract/i);
        expect(body).toMatch(/legitimate interests/i);
        expect(body).toMatch(/legal obligation/i);
    });

    it("names every sub-processor and where it processes (Art. 13(1)(e)-(f))", () => {
        render(<PrivacyPage />);

        for (const processor of SUB_PROCESSORS) {
            expect(screen.getByText(processor.name)).toBeInTheDocument();
        }
        expect(document.body.textContent).toMatch(
            /International Data Transfer Agreement|Standard Contractual Clauses/,
        );
    });

    it("is honest that content has no automatic expiry (Art. 13(2)(a))", () => {
        // The service enforces no retention period. Quoting one we do not
        // honour would be worse than saying so.
        render(<PrivacyPage />);

        expect(document.body.textContent).toMatch(
            /nothing you upload expires automatically/i,
        );
    });

    it("discloses that audit records carry a prompt excerpt and filenames", () => {
        // audit_events stores the first 120 characters of an unnamed chat's
        // first message, plus document filenames. A policy that omitted that
        // would be inaccurate about this service specifically.
        render(<PrivacyPage />);
        const body = document.body.textContent ?? "";

        expect(body).toMatch(/first 120 characters/i);
        expect(body).toMatch(/filenames/i);
    });

    it("states that content is not used to train models", () => {
        render(<PrivacyPage />);
        expect(document.body.textContent).toMatch(
            /not used to train AI models/i,
        );
    });

    it("tells the reader they may complain to the ICO (Art. 13(2)(d))", () => {
        render(<PrivacyPage />);

        const link = screen.getByRole("link", { name: /ico\.org\.uk/i });
        expect(link).toHaveAttribute("href", expect.stringContaining("ico.org.uk"));
    });

    it("lists the data subject rights (Art. 13(2)(b))", () => {
        render(<PrivacyPage />);
        const body = document.body.textContent ?? "";

        for (const right of [
            /copy of your personal data/i,
            /correct it/i,
            /delete it/i,
            /restrict or object/i,
            /portable/i,
        ]) {
            expect(body).toMatch(right);
        }
    });

    it("does not display an empty address or registration line when unset", () => {
        // Both are optional and render only when set, so the page never shows
        // a placeholder where a real address belongs.
        render(<PrivacyPage />);

        expect(document.body.textContent).not.toMatch(/ICO registration\s*$/m);
        expect(document.body.textContent).not.toMatch(/\[.*address.*\]/i);
    });
});
