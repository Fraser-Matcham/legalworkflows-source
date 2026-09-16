/**
 * Whether this deployment has a workflow catalogue at all.
 *
 * The release pipeline runs the catalogue sync from the new image and treats
 * its exit code as the verdict, which is right when there is a catalogue to
 * sync and wrong when there is not. Those were indistinguishable: a
 * deployment that never set one up failed its releases in the same way as one
 * whose token had expired, and the infrastructure called the catalogue
 * optional throughout — `backend_extra_secret_keys` defaults to `[]`, the
 * token is commented out in `terraform.tfvars.example`, and the first-apply
 * runbook says to add it "if you have them". An operator could follow the
 * setup exactly as written and have every release die here.
 *
 * So the job now answers two different questions with two different exit
 * codes, and the pipeline reads them differently: 78 means "there is no
 * catalogue here", which is a skip; anything else non-zero means "there is
 * one and it did not sync", which is a failed release.
 *
 * **Opting out is explicit.** An unset `MIKE_WORKFLOWS_REPOSITORY` falls back
 * to the upstream default in `workflowCatalogSource.ts` — that is still a
 * catalogue, just not one this deployment necessarily owns or can read, so it
 * stays a hard failure. Only an empty value means there is none. Skipping
 * because somebody forgot to configure it would be the quiet no-op this
 * change exists to remove.
 */

/** sysexits.h EX_CONFIG: "something was unconfigured or misconfigured". */
export const EX_CATALOGUE_NOT_CONFIGURED = 78;

export function catalogueIsConfigured(
    env: NodeJS.ProcessEnv = process.env,
): boolean {
    const repository = env.MIKE_WORKFLOWS_REPOSITORY;
    if (repository === undefined) return true;
    return repository.trim() !== "";
}

/**
 * Said on the skip path. It names the lever, because the operator reading it
 * in a release log is the person who either meant to opt out or did not.
 */
export const CATALOGUE_NOT_CONFIGURED_MESSAGE = [
    "[workflow-catalogue] MIKE_WORKFLOWS_REPOSITORY is empty, so this deployment has no workflow catalogue.",
    "[workflow-catalogue] Nothing was synced and nothing failed — the release continues without one.",
    "[workflow-catalogue] To have a catalogue, set `workflows_repository` in infra/terraform.tfvars to a",
    "[workflow-catalogue] repository this deployment can read, and if it is private write",
    "[workflow-catalogue] MIKE_WORKFLOWS_GITHUB_TOKEN into the operator secret and list it in",
    "[workflow-catalogue] backend_extra_secret_keys. See docs/deployment.md.",
].join("\n");
