import { NextResponse } from "next/server";
import { listWorkflows } from "@/workflows/registry";

export const dynamic = "force-dynamic";

/** List all registered workflows (for the dashboard + tooling). */
export async function GET() {
  const workflows = listWorkflows().map((w) => ({
    id: w.id,
    name: w.name,
    brand: w.brand,
    n8nId: w.n8nId,
    trigger: w.trigger,
    schedule: w.schedule ?? null,
    enabled: w.enabled,
    description: w.description,
  }));
  return NextResponse.json({ workflows });
}
