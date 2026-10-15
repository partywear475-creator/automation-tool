/**
 * Local workflow runner — test a workflow without deploying.
 *
 *   npm run run:workflow -- tixuy-publish-csraoul
 *   npm run run:workflow -- tixuy-publish-csraoul '{"dryRun":true}'
 *
 * Loads .env.local, runs the workflow through the same path as cron/manual.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { getWorkflow, listWorkflows } from "../src/workflows/registry";
import { runWorkflow } from "../src/lib/run";

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.log("Usage: npm run run:workflow -- <workflow-id> [json-input]\n");
    console.log("Available workflows:");
    for (const w of listWorkflows()) console.log(`  ${w.id.padEnd(40)} ${w.name}`);
    process.exit(1);
  }

  const wf = getWorkflow(id);
  if (!wf) {
    console.error(`Unknown workflow: ${id}`);
    process.exit(1);
  }

  const input = process.argv[3] ? JSON.parse(process.argv[3]) : undefined;
  console.log(`Running "${wf.name}" (${wf.id})...\n`);
  const outcome = await runWorkflow(wf, { trigger: "manual", input });
  console.log("\nResult:", JSON.stringify(outcome, null, 2));
  process.exit(outcome.status === "success" ? 0 : 1);
}

main();
