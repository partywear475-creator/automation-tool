import { listWorkflows } from "@/workflows/registry";
import { supabaseAnon } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface Run {
  id: string;
  workflow_id: string;
  status: string;
  trigger: string;
  started_at: string;
  duration_ms: number | null;
  error: string | null;
}

async function recentRuns(): Promise<Run[]> {
  try {
    const { data } = await supabaseAnon()
      .from("workflow_runs")
      .select("id,workflow_id,status,trigger,started_at,duration_ms,error")
      .order("started_at", { ascending: false })
      .limit(40);
    return (data as Run[]) ?? [];
  } catch {
    return [];
  }
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", hour12: false });
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default async function Dashboard() {
  const workflows = listWorkflows();
  const runs = await recentRuns();

  const scheduled = workflows.filter((w) => w.trigger === "schedule");
  const onDemand = workflows.filter((w) => w.trigger !== "schedule");

  return (
    <div className="wrap">
      <h1>Automation Tool</h1>
      <p className="sub">
        {workflows.length} workflows migrated from n8n · {scheduled.length} scheduled · {onDemand.length} on-demand
        {" · "}
        <a href="/trigger">Run a workflow →</a>
      </p>

      <h2>Recent runs</h2>
      <div className="card">
        {runs.length === 0 ? (
          <div className="empty">No runs yet. Trigger a workflow or wait for the next cron.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Workflow</th>
                <th>Status</th>
                <th>Trigger</th>
                <th>Started</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.workflow_id}</td>
                  <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                  <td className="muted">{r.trigger}</td>
                  <td className="muted">{fmtTime(r.started_at)}</td>
                  <td className="mono">{fmtDuration(r.duration_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2>Workflows</h2>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Brand</th>
              <th>Trigger</th>
              <th>Schedule</th>
            </tr>
          </thead>
          <tbody>
            {workflows.map((w) => (
              <tr key={w.id}>
                <td>
                  <div>{w.name}</div>
                  <div className="mono muted" style={{ fontSize: 11 }}>{w.id}</div>
                </td>
                <td><span className="badge brand">{w.brand}</span></td>
                <td className="muted">{w.trigger}{w.enabled ? "" : " (off)"}</td>
                <td className="mono muted">{w.schedule ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
