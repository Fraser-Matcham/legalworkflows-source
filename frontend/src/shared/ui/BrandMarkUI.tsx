"use client";

/**
 * The legalworkflows brand mark.
 *
 * Four arc segments of decreasing length, progressing clockwise from the top:
 * workflow steps around a cycle. It replaces the inherited twelve-blade
 * rosette, which was upstream's mark and is not ours to ship (ticket 2032).
 *
 * Why arcs rather than blades. The mark's binding constraint is the sidebar,
 * where it renders at 22px. Filled shapes with gradients turn to mush at that
 * size; a round-capped stroke stays crisp because the browser is drawing a
 * line, not resolving a gradient across a few pixels. It also spins honestly
 * — the shape is already a progression, so rotation reads as progress rather
 * than as a logo being spun.
 *
 * The component keeps MikeIconUI's exact prop signature so the twelve call
 * sites across the web app and the add-in need no change: MikeIconUI now
 * re-exports this. `mike` is accepted and ignored, as it was there.
 *
 * Copyright 2026 Fraser Matcham. Licensed under the GNU Affero General Public
 * License v3.0, as the work it is distributed with.
 */

import React from "react";

/** Segment geometry: [start angle in degrees, sweep]. 0° points right. */
const SEGMENTS: ReadonlyArray<readonly [number, number]> = [
    [-95, 104],
    [34.5, 76],
    [136, 50],
    [211.5, 28],
];

const RADIUS = 105;
const STROKE = 36;
const CENTRE = 250;

/** Colour of the mark in each state. Inherited from the surrounding text. */
const DONE_COLOUR = "#16a34a";
const ERROR_COLOUR = "#dc2626";

function polar(radius: number, degrees: number): [number, number] {
    const radians = (degrees * Math.PI) / 180;
    return [
        CENTRE + radius * Math.cos(radians),
        CENTRE + radius * Math.sin(radians),
    ];
}

function arcPath(start: number, sweep: number): string {
    const [x0, y0] = polar(RADIUS, start);
    const [x1, y1] = polar(RADIUS, start + sweep);
    const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
    return `M ${x0.toFixed(2)},${y0.toFixed(2)} A ${RADIUS},${RADIUS} 0 ${largeArc} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

const PATHS = SEGMENTS.map(([start, sweep]) => arcPath(start, sweep));

export function BrandMark({
    spin = false,
    done = false,
    error = false,
    mike = false,
    size = 24,
    style,
}: {
    spin?: boolean;
    done?: boolean;
    error?: boolean;
    /** Accepted for signature compatibility with the mark this replaces. */
    mike?: boolean;
    size?: number;
    style?: React.CSSProperties;
}) {
    void mike;

    // `currentColor` in the default state is what makes the mark theme-aware
    // without a MutationObserver: it inherits the text colour of whatever it
    // sits in, so the light and dark palettes in globals.css already reach it.
    const colour = error ? ERROR_COLOUR : done ? DONE_COLOUR : "currentColor";

    return (
        <span
            className="shrink-0 inline-block animate-[spin_3s_linear_infinite]"
            style={{
                animationPlayState: spin ? "running" : "paused",
                ...style,
            }}
        >
            <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="100 100 300 300"
                width={size}
                height={size}
                style={{ display: "block" }}
                role="presentation"
                aria-hidden="true"
            >
                {PATHS.map((d) => (
                    <path
                        key={d}
                        d={d}
                        fill="none"
                        stroke={colour}
                        strokeWidth={STROKE}
                        strokeLinecap="round"
                        style={{ transition: "stroke 220ms ease" }}
                    />
                ))}
            </svg>
        </span>
    );
}
