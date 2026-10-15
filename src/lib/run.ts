import { openRun, closeRun } from "./logger";
import type { Workflow, WorkflowResult } from "@/workflows/types";

/**
 * Execute a workflow with full run logging. This is the single entry point
 * used by the cron route, the manual-trigger route, and the local CLI.
 */
export async function runWorkflow(
  wf: Workflow,
  opts: { trigger: "cron" | "manual" | "api"; input?: Record<string, unknown> },
): Promise<{ runId: string; status: "success" | "error"; result?: WorkflowResult; error?: string }> {
  const startedAt = Date.now();
  const handle = await openRun(wf.id, opts.trigger);
  await handle.log("workflow:start", { name: wf.name, n8nId: wf.n8nId, trigger: opts.trigger });

  try {
    const result = await wf.run({
      runId: handle.id,
      log: handle.log,
      trigger: opts.trigger,
      input: opts.input,
    });
    await handle.log("workflow:success", { summary: result.summary });
    await closeRun(handle, { status: "success", output: result, startedAt });
    return { runId: handle.id, status: "success", result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await handle.log("workflow:error", { message });
    await closeRun(handle, { status: "error", error: message, startedAt });
    return { runId: handle.id, status: "error", error: message };
  }
}
