import { NextRequest, NextResponse } from "next/server";
import { getWorkflow } from "@/workflows/registry";
import { runWorkflow } from "@/lib/run";
import { env } from "@/lib/env";

// Allow long-running image/video work (Vercel Pro: up to 300s).
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Cron entrypoint. Vercel Cron calls GET /api/cron/<workflow> on schedule and
 * sends `Authorization: Bearer $CRON_SECRET`. We reject anything else.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ workflow: string }> }) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${env.cronSecret()}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { workflow: id } = await params;
  const wf = getWorkflow(id);
  if (!wf) {
    return NextResponse.json({ error: `unknown workflow: ${id}` }, { status: 404 });
  }

  const outcome = await runWorkflow(wf, { trigger: "cron" });
  const status = outcome.status === "success" ? 200 : 500;
  return NextResponse.json(outcome, { status });
}
