import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LegalNoticesPage from "./page";
import {
    COPYRIGHT_HOLDER,
    LICENCE_URL,
    MODIFICATION_DATE,
    UPSTREAM_URL,
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

/**
 * Section 13: a prominent offer of the Corresponding Source of the version
 * being served. The release pipeline sets NEXT_PUBLIC_SOURCE_URL to the
 * public mirror at the deployed commit; without it the page must still show
 * a working offer rather than a broken link.
 */
describe("Corresponding Source offer", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("links to the source of this build when the release set it", () => {
        const url =
            "https://github.com/example/legalworkflows-source/tree/0123456789abcdef0123456789abcdef01234567";
        vi.stubEnv("NEXT_PUBLIC_SOURCE_URL", url);
        render(<LegalNoticesPage />);
        const offer = screen.getByTestId("source-offer");
        expect(offer).toHaveTextContent(/Corresponding Source/);
        expect(offer).toHaveTextContent(/no charge/);
        expect(screen.getByRole("link", { name: url })).toHaveAttribute(
            "href",
            url,
        );
    });

    it("falls back to the upstream repository when nothing was set", () => {
        vi.stubEnv("NEXT_PUBLIC_SOURCE_URL", "");
        render(<LegalNoticesPage />);
        const offer = screen.getByTestId("source-offer");
        expect(offer.querySelector("a")).toHaveAttribute("href", UPSTREAM_URL);
    });
});
