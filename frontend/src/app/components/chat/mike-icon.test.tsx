import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MikeIcon } from "./mike-icon";

/**
 * These pin the mark's contract, not its artwork.
 *
 * The previous mark carried four hand-built gradient palettes and a
 * MutationObserver that watched the document's theme class, so the tests here
 * read gradient stop colours. The mark it replaced them with is a stroked
 * shape that uses `currentColor`, so the theme handling is CSS's job again and
 * there are no gradient stops to read.
 *
 * What actually has to hold is unchanged, and is what these assert: the mark
 * inherits its colour in the default state (which is what makes it correct in
 * both themes, and while the theme changes under it), and the done and error
 * states override that with their own colour so a finished or failed state is
 * never washed out by the surrounding text colour.
 */

function strokes(container: HTMLElement): string[] {
    return Array.from(container.querySelectorAll("path")).map(
        (p) => p.getAttribute("stroke") ?? "",
    );
}

describe("the application mark", () => {
    it("inherits the surrounding text colour by default, in either theme", () => {
        const { container } = render(<MikeIcon />);

        const drawn = strokes(container);
        expect(drawn.length).toBeGreaterThan(0);
        expect(new Set(drawn)).toEqual(new Set(["currentColor"]));
    });

    it("keeps inheriting when the document switches to dark mid-life", () => {
        const { container } = render(<MikeIcon />);
        document.documentElement.classList.add("dark");
        try {
            // No re-render needed: currentColor resolves at paint, which is
            // the whole reason the observer could go.
            expect(new Set(strokes(container))).toEqual(
                new Set(["currentColor"]),
            );
        } finally {
            document.documentElement.classList.remove("dark");
        }
    });

    it("overrides the inherited colour for the done state", () => {
        const { container } = render(<MikeIcon done />);

        expect(new Set(strokes(container))).toEqual(new Set(["#16a34a"]));
    });

    it("overrides the inherited colour for the error state", () => {
        const { container } = render(<MikeIcon error />);

        expect(new Set(strokes(container))).toEqual(new Set(["#dc2626"]));
    });

    it("prefers error over done when a caller passes both", () => {
        const { container } = render(<MikeIcon done error />);

        expect(new Set(strokes(container))).toEqual(new Set(["#dc2626"]));
    });

    it("runs the spin animation only when asked", () => {
        const { container: still } = render(<MikeIcon />);
        const { container: spinning } = render(<MikeIcon spin />);

        expect(
            (still.firstChild as HTMLElement).style.animationPlayState,
        ).toBe("paused");
        expect(
            (spinning.firstChild as HTMLElement).style.animationPlayState,
        ).toBe("running");
    });

    it("honours the requested size and stays decorative", () => {
        const { container } = render(<MikeIcon size={48} />);
        const svg = container.querySelector("svg");

        expect(svg?.getAttribute("width")).toBe("48");
        expect(svg?.getAttribute("height")).toBe("48");
        // It always sits beside a text label, so it must not be announced.
        expect(svg?.getAttribute("aria-hidden")).toBe("true");
    });
});
