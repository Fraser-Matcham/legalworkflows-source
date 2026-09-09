import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LegalNoticesPage from "./page";
import {
    COPYRIGHT_HOLDER,
    LICENCE_URL,
    MODIFICATION_DATE,
} from "@/app/lib/legalNotice";

/**
 * Section 5(d) of the AGPL names four things the interactive UI has to display.
 * Each assertion below is one of them: if a redesign drops one, this fails
 * rather than quietly putting the service out of compliance.
 */
describe("Legal notices page", () => {
    it("displays a copyright notice naming the holder", () => {
        render(<LegalNoticesPage />);
        expect(screen.getByTestId("copyright-notice")).toHaveTextContent(
            COPYRIGHT_HOLDER,
        );
        expect(screen.getByTestId("copyright-notice")).toHaveTextContent("©");
    });

    it("states that there is no warranty", () => {
        render(<LegalNoticesPage />);
        expect(screen.getByTestId("warranty-notice")).toHaveTextContent(
            /WITHOUT ANY WARRANTY/,
        );
    });

    it("states that licensees may convey the work under the licence", () => {
        render(<LegalNoticesPage />);
        expect(screen.getByTestId("licence-notice")).toHaveTextContent(
            /may convey the work under this licence/i,
        );
    });

    it("says how to view a copy of the licence", () => {
        render(<LegalNoticesPage />);
        const link = screen.getByRole("link", { name: LICENCE_URL });
        expect(link).toHaveAttribute("href", LICENCE_URL);
        expect(screen.getByTestId("licence-link")).toHaveTextContent("LICENSE");
    });

    it("carries the section 5(a) modification notice with its date", () => {
        render(<LegalNoticesPage />);
        expect(screen.getByText(/modified version of/i)).toBeInTheDocument();
        expect(
            screen.getByText(new RegExp(MODIFICATION_DATE)),
        ).toBeInTheDocument();
    });
});
