import "dotenv/config";
import { createServerSupabase } from "../lib/supabase";
import { syncWorkflowCatalog } from "../lib/workflowCatalogSync";
import {
  CATALOGUE_NOT_CONFIGURED_MESSAGE,
  EX_CATALOGUE_NOT_CONFIGURED,
  catalogueIsConfigured,
} from "../lib/workflowCatalogueConfig";

async function main() {
  // A deployment with no catalogue is not a failed release. See
  // ../lib/workflowCatalogueConfig.
  if (!catalogueIsConfigured()) {
    console.log(CATALOGUE_NOT_CONFIGURED_MESSAGE);
    process.exit(EX_CATALOGUE_NOT_CONFIGURED);
  }

  const result = await syncWorkflowCatalog(createServerSupabase());
  console.log(
    `Synced ${result.workflows} Mike workflows and ${result.assets} assets from ${result.sourceCommit}`,
  );
}

void main().catch((error) => {
  console.error("Mike workflow sync failed", error);
  process.exit(1);
});
