import type { RunHandle } from "@/lib/logger";

export type TriggerKind = "schedule" | "manual" | "form";

export interface WorkflowContext {
  runId: string;
  /** Append a step to the run log (shows up in the dashboard + Supabase). */
  log: RunHandle["log"];
  /** How this run was started. */
  trigger: "cron" | "manual" | "api";
  /** Form/manual input, e.g. the body posted to the manual-run endpoint. */
  input?: Record<string, unknown>;
}

export interface WorkflowResult {
  summary: string;
  data?: Record<string, unknown>;
}

export interface Workflow {
  /** URL-safe slug. Matches /api/cron/<id> and the registry key. */
  id: string;
  /** Human name, carried over from n8n. */
  name: string;
  /** Original n8n workflow id, for traceability back to the source. */
  n8nId: string;
  /** Which brand this belongs to (cocogrove | tixuy | nianova | sorrelpip | essiby | emberwolf | shared). */
  brand: string;
  description: string;
  trigger: TriggerKind;
  /** Cron expression for scheduled workflows (UTC). Omit for manual/form. */
  schedule?: string;
  /** Whether a cron entry should be emitted for this workflow. */
  enabled: boolean;
  run(ctx: WorkflowContext): Promise<WorkflowResult>;
}

/** Helper for defining a workflow with good type inference. */
export function defineWorkflow(wf: Workflow): Workflow {
  return wf;
}
