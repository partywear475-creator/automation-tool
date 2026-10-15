import { env } from "./env";
import { httpJson } from "./http";

/**
 * Minimal Square client for the CocoGrove Daily Sales Report.
 * Uses the Orders Search API to pull completed orders for a date range.
 */

function base(): string {
  return env.squareEnv() === "sandbox"
    ? "https://connect.squareupsandbox.com"
    : "https://connect.squareup.com";
}

function headers(): Record<string, string> {
  const t = env.squareToken();
  if (!t) throw new Error("SQUARE_ACCESS_TOKEN not set");
  return {
    Authorization: `Bearer ${t}`,
    "Content-Type": "application/json",
    "Square-Version": "2024-10-17",
  };
}

export interface SquareOrder {
  id: string;
  created_at: string;
  total_money?: { amount: number; currency: string };
  line_items?: Array<{ name?: string; quantity?: string; gross_sales_money?: { amount: number } }>;
  customer_id?: string;
  state?: string;
}

/** Search completed orders for a location between two ISO timestamps. */
export async function searchOrders(args: {
  locationId?: string;
  startAt: string;
  endAt: string;
}): Promise<SquareOrder[]> {
  const locationId = args.locationId ?? env.squareLocationId();
  if (!locationId) throw new Error("SQUARE_LOCATION_ID not set");

  const orders: SquareOrder[] = [];
  let cursor: string | undefined;
  do {
    const body = await httpJson<{ orders?: SquareOrder[]; cursor?: string }>(`${base()}/v2/orders/search`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        location_ids: [locationId],
        cursor,
        query: {
          filter: {
            date_time_filter: { created_at: { start_at: args.startAt, end_at: args.endAt } },
            state_filter: { states: ["COMPLETED"] },
          },
          sort: { sort_field: "CREATED_AT", sort_order: "ASC" },
        },
      }),
    });
    orders.push(...(body.orders ?? []));
    cursor = body.cursor;
  } while (cursor);

  return orders;
}

/** Roll a list of orders into the totals the report needs. */
export function summariseOrders(orders: SquareOrder[]) {
  let gross = 0;
  const itemQty = new Map<string, number>();
  const customers = new Set<string>();
  for (const o of orders) {
    gross += o.total_money?.amount ?? 0;
    if (o.customer_id) customers.add(o.customer_id);
    for (const li of o.line_items ?? []) {
      const q = Number(li.quantity ?? "1");
      itemQty.set(li.name ?? "Unknown", (itemQty.get(li.name ?? "Unknown") ?? 0) + q);
    }
  }
  const topItems = [...itemQty.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  return {
    orderCount: orders.length,
    grossMinor: gross, // minor units (pence)
    uniqueCustomers: customers.size,
    topItems,
  };
}
