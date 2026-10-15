import { supabaseService } from "./supabase";

/**
 * Run logging — this is your n8n "Executions" view, backed by Supabase.
 * A run is opened when a workflow starts, each step is appended as it happens,
 * and the run is closed on success or error.
 */

export interface StepLog {
  step: string;
  at: string;
  data?: unknown;
}

export interface RunHandle {
  id: string;
  workflowId: string;
  steps: StepLog[];
  log(step: string, data?: unknown): Promise<void>;
}

export async function openRun(
  workflowId: string,
  trigger: "cron" | "manual" | "api",
): Promise<RunHandle> {
  const sb = supabaseService();
  const { data, error } = await sb
    .from("workflow_runs")
    .insert({ workflow_id: workflowId, trigger, status: "running" })
    .select("id")
    .single();

  if (error || !data) {
    // Don't let a logging failure block the actual work — fall back to a local id.
    console.error(`[logger] could not open run for ${workflowId}:`, error?.message);
    return makeHandle(crypto.randomUUID(), workflowId, false);
  }
  return makeHandle(data.id, workflowId, true);
}

function makeHandle(id: string, workflowId: string, persisted: boolean): RunHandle {
  const steps: StepLog[] = [];
  return {
    id,
    workflowId,
    steps,
    async log(step: string, data?: unknown) {
      const entry: StepLog = { step, at: new Date().toISOString(), data };
      steps.push(entry);
      console.log(`[${workflowId}] ${step}`, data ?? "");
      if (!persisted) return;
      await supabaseService()
        .from("workflow_runs")
        .update({ steps })
        .eq("id", id);
    },
  };
}

export async function closeRun(
  handle: RunHandle,
  result: { status: "success" | "error"; output?: unknown; error?: string; startedAt: number },
): Promise<void> {
  const durationMs = Date.now() - result.startedAt;
  await supabaseService()
    .from("workflow_runs")
    .update({
      status: result.status,
      output: result.output ?? null,
      error: result.error ?? null,
      steps: handle.steps,
      finished_at: new Date().toISOString(),
      duration_ms: durationMs,
    })
    .eq("id", handle.id);
}

/** Small key/value memory between runs — replaces n8n static data. */
export async function getState<T = unknown>(workflowId: string, key: string): Promise<T | null> {
  const { data } = await supabaseService()
    .from("workflow_state")
    .select("value")
    .eq("workflow_id", workflowId)
    .eq("key", key)
    .maybeSingle();
  return (data?.value as T) ?? null;
}

export async function setState(workflowId: string, key: string, value: unknown): Promise<void> {
  await supabaseService()
    .from("workflow_state")
    .upsert({ workflow_id: workflowId, key, value, updated_at: new Date().toISOString() });
}
