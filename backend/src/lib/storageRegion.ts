/**
 * The region the S3 client signs requests for.
 *
 * `storage.ts` was written for Cloudflare R2, which accepts — and documents —
 * the pseudo-region `"auto"`. Real S3 does not: a SigV4 signature scoped to
 * `auto` fails verification, so the same client cannot reach an S3 bucket
 * unless the region in the signature is the bucket's. `R2_REGION` makes that
 * configurable without renaming the `R2_*` variables the rest of the
 * configuration uses, and keeps R2's value as the default so nothing changes
 * for a deployment that does not set it.
 *
 * A separate module rather than an edit inside `storage.ts`, which is
 * inherited from upstream: the two call sites there change one token each,
 * and the reasoning and the tests live here (AGENTS.md, fork rule 3).
 *
 * Copyright 2026 Fraser Matcham. Licensed under the GNU Affero General Public
 * License v3.0.
 */

/** What R2 expects, and what every deployment used before `R2_REGION` existed. */
export const DEFAULT_STORAGE_REGION = "auto";

const REGION_PATTERN = /^[a-z0-9-]+$/i;

/**
 * Resolves the signing region from `R2_REGION`, falling back to `"auto"`.
 *
 * Whitespace is trimmed; an empty or blank value is the same as unset. Any
 * other value must look like a region identifier (`eu-west-2`, `us-east-1`,
 * `auto`), because a typo here fails every storage request with an opaque
 * signature error — better to fail once, at start-up, naming the variable.
 */
export function storageRegion(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.R2_REGION?.trim();
  if (!configured) {
    return DEFAULT_STORAGE_REGION;
  }
  if (!REGION_PATTERN.test(configured)) {
    throw new Error(
      "R2_REGION must be a region identifier such as eu-west-2, or unset for R2's \"auto\"",
    );
  }
  return configured;
}
