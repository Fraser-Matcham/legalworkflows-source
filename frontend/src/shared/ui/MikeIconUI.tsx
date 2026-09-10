"use client";

/**
 * The application mark, re-exported under its inherited name.
 *
 * The artwork itself lives in BrandMarkUI.tsx. This file keeps the old export
 * so the twelve call sites across the web app and the Word add-in do not have
 * to change, and so a future upstream merge that touches them still applies:
 * the rename would have been churn against every one of those files for no
 * user-visible benefit (AGENTS.md, fork rule 3).
 *
 * The old artwork — a twelve-blade glass rosette — was upstream's mark and is
 * not ours to ship. See ticket 2032.
 */

export { BrandMark, BrandMark as MikeIcon } from "./BrandMarkUI";
