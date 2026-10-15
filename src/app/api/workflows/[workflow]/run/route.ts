import { NextRequest, NextResponse } from "next/server";
import { getWorkflow } from "@/workflows/registry";
import { runWorkflow } from "@/lib/run";
import { env } from "@/lib/env";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Manual trigger. POST /api/workflows/<workflow>/run with
 * `Authorization: Bearer $CRON_SECRET` and an optional JSON body (passed to the
 * workflow as `input`). This is how you run on-demand / form-triggered jobs.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ workflow: string }> }) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${env.cronSecret()}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { workflow: id } = await params;
  const wf = getWorkflow(id);
  if (!wf) return NextResponse.json({ error: `unknown workflow: ${id}` }, { status: 404 });

  let input: Record<string, unknown> | undefined;
  try {
    const text = await req.text();
    input = text ? JSON.parse(text) : undefined;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const outcome = await runWorkflow(wf, { trigger: "manual", input });
  const status = outcome.status === "success" ? 200 : 500;
  return NextResponse.json(outcome, { status });
}
