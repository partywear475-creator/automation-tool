import { defineWorkflow } from "../types";
import { env } from "@/lib/env";
import { searchOrders, type SquareOrder } from "@/lib/square";
import { sendEmail } from "@/lib/email";

/**
 * Faithful port of n8n "CocoGrove Daily Sales Report" (cz9B1NwEDee7MmCC).
 *
 * Daily 08:00 (Europe/London) -> fetch the last 8 days of COMPLETED Square
 * orders -> bucket by Europe/London calendar date -> report yesterday's totals,
 * day-over-day and week-over-week revenue change, top sellers (by qty) and top
 * earners (by revenue), repeat vs new customers and busiest hour -> email it.
 *
 * NOTE: summariseOrders() is not used here — the n8n code node needs per-date
 * bucketing (DoD / WoW), per-item revenue, top-by-revenue, repeat-vs-new and
 * busiest-hour, none of which summariseOrders() produces. The full code-node
 * computation is ported verbatim instead.
 *
 * NOTE: the original n8n workflow was inactive (active:false) — it was never
 * switched on. This module is `enabled:true` to match the ported report
 * workflows; flip to false if it should stay dormant.
 */

// n8n Gmail recipient for this workflow.
const REPORT_RECIPIENT = env.reportTo() || "partywear475@gmail.com";

/** Europe/London calendar date (YYYY-MM-DD) for an ISO timestamp. */
function toLocalDate(isoString: string): string {
  const d = new Date(isoString);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Shift a YYYY-MM-DD date string by whole days (noon-anchored, as in n8n). */
function shiftDateStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** UTC ISO instant for Europe/London start-of-day of a given London date. */
function londonStartOfDayUtcIso(londonDateStr: string): string {
  const utcMidnight = new Date(`${londonDateStr}T00:00:00Z`);
  const hourStr = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    hour12: false,
  }).format(utcMidnight);
  const offsetHours = Number(hourStr) % 24; // London is UTC+0 or +1
  return new Date(utcMidnight.getTime() - offsetHours * 3600_000).toISOString();
}

export default defineWorkflow({
  id: "cocogrove-daily-sales-report",
  name: "CocoGrove Daily Sales Report",
  n8nId: "cz9B1NwEDee7MmCC",
  brand: "cocogrove",
  description:
    "Daily 8am email: yesterday's Square sales totals, day-over-day and week-over-week change, top-selling items, and repeat vs new customer counts.",
  trigger: "schedule",
  schedule: "0 7 * * *", // Daily 08:00 Europe/London (BST = UTC+1)
  enabled: true,

  async run(ctx) {
    // --- Date anchors (Europe/London), as in the code node ---
    const today = new Date();
    const londonTodayStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(today);
    const yesterdayStr = shiftDateStr(londonTodayStr, -1);
    const dayBeforeStr = shiftDateStr(londonTodayStr, -2);
    const lastWeekStr = shiftDateStr(londonTodayStr, -8);

    // --- Fetch Square Orders (8 days): startOf(day) 8 days ago -> now ---
    const startAt = londonStartOfDayUtcIso(lastWeekStr);
    const endAt = today.toISOString();
    const orders = (await searchOrders({ startAt, endAt })) as SquareOrder[];
    await ctx.log("square:fetched", { orderCount: orders.length, startAt, endAt });

    // --- Analyze Sales & Trends (faithful port of the code node) ---
    type LineItem = { name?: string; quantity?: string; total_money?: { amount?: number } };
    type DayBucket = { revenue: number; orderCount: number; items: Record<string, { qty: number; revenue: number }> };

    const byDate: Record<string, DayBucket> = {};
    const customersByDate: Record<string, Set<string>> = {};

    for (const order of orders) {
      const dateStr = toLocalDate(order.created_at);
      if (!byDate[dateStr]) {
        byDate[dateStr] = { revenue: 0, orderCount: 0, items: {} };
      }
      const totalMoney = order.total_money && order.total_money.amount ? order.total_money.amount : 0;
      byDate[dateStr].revenue += totalMoney;
      byDate[dateStr].orderCount += 1;

      if (order.line_items) {
        for (const li of order.line_items as LineItem[]) {
          const name = li.name || "Unknown Item";
          const qty = parseFloat(li.quantity ?? "") || 0;
          const itemRevenue = li.total_money && li.total_money.amount ? li.total_money.amount : 0;
          if (!byDate[dateStr].items[name]) {
            byDate[dateStr].items[name] = { qty: 0, revenue: 0 };
          }
          byDate[dateStr].items[name].qty += qty;
          byDate[dateStr].items[name].revenue += itemRevenue;
        }
      }

      if (order.customer_id) {
        if (!customersByDate[dateStr]) customersByDate[dateStr] = new Set();
        customersByDate[dateStr].add(order.customer_id);
      }
    }

    function dayStats(dateStr: string): DayBucket {
      return byDate[dateStr] || { revenue: 0, orderCount: 0, items: {} };
    }

    const yStats = dayStats(yesterdayStr);
    const dbStats = dayStats(dayBeforeStr);
    const lwStats = dayStats(lastWeekStr);

    function pctChange(current: number, previous: number): number | null {
      if (!previous) return null;
      return ((current - previous) / previous) * 100;
    }

    const revenueChangeDoD = pctChange(yStats.revenue, dbStats.revenue);
    const revenueChangeWoW = pctChange(yStats.revenue, lwStats.revenue);

    const itemsArray = Object.keys(yStats.items).map((name) => ({
      name,
      qty: yStats.items[name].qty,
      revenue: yStats.items[name].revenue,
    }));
    itemsArray.sort((a, b) => b.qty - a.qty);
    const topByQty = itemsArray.slice(0, 5);
    const revSorted = itemsArray.slice().sort((a, b) => b.revenue - a.revenue);
    const topByRevenue = revSorted.slice(0, 3);

    const priorCustomerIds = new Set<string>();
    for (const dateStr of Object.keys(customersByDate)) {
      if (dateStr !== yesterdayStr) {
        for (const cid of customersByDate[dateStr]) priorCustomerIds.add(cid);
      }
    }
    const yesterdayCustomers = customersByDate[yesterdayStr] || new Set<string>();
    let repeatCount = 0;
    for (const cid of yesterdayCustomers) {
      if (priorCustomerIds.has(cid)) repeatCount += 1;
    }
    const uniqueCustomerCount = yesterdayCustomers.size;
    const newCustomerCount = uniqueCustomerCount - repeatCount;

    const hourCounts: Record<string, number> = {};
    for (const order of orders) {
      const dateStr = toLocalDate(order.created_at);
      if (dateStr !== yesterdayStr) continue;
      const hourStr = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/London",
        hour: "2-digit",
        hour12: false,
      }).format(new Date(order.created_at));
      hourCounts[hourStr] = (hourCounts[hourStr] || 0) + 1;
    }
    let busiestHour: string | null = null;
    let busiestCount = 0;
    for (const h of Object.keys(hourCounts)) {
      if (hourCounts[h] > busiestCount) {
        busiestCount = hourCounts[h];
        busiestHour = h;
      }
    }

    function money(pence: number): string {
      return "£" + (pence / 100).toFixed(2);
    }

    function fmtChange(pct: number | null): string {
      if (pct === null) return "n/a (no data)";
      const sign = pct >= 0 ? "+" : "";
      return sign + pct.toFixed(1) + "%";
    }

    const avgOrderValue = yStats.orderCount > 0 ? yStats.revenue / yStats.orderCount : 0;

    const topByQtyRows = topByQty
      .map(
        (i) =>
          '<tr><td style="padding:4px 8px;">' +
          i.name +
          '</td><td style="padding:4px 8px;text-align:right;">' +
          i.qty +
          "</td></tr>",
      )
      .join("");
    const topByRevenueRows = topByRevenue
      .map(
        (i) =>
          '<tr><td style="padding:4px 8px;">' +
          i.name +
          '</td><td style="padding:4px 8px;text-align:right;">' +
          money(i.revenue) +
          "</td></tr>",
      )
      .join("");

    const emailHtml =
      '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">' +
      '<h2 style="color:#0a5c36;">CocoGrove Daily Sales Report</h2>' +
      '<p style="color:#555;">For ' +
      yesterdayStr +
      "</p>" +
      '<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">' +
      '<tr><td style="padding:6px 8px;font-weight:bold;">Total Sales</td><td style="padding:6px 8px;text-align:right;">' +
      money(yStats.revenue) +
      "</td></tr>" +
      '<tr><td style="padding:6px 8px;font-weight:bold;">Orders</td><td style="padding:6px 8px;text-align:right;">' +
      yStats.orderCount +
      "</td></tr>" +
      '<tr><td style="padding:6px 8px;font-weight:bold;">Average Order Value</td><td style="padding:6px 8px;text-align:right;">' +
      money(avgOrderValue) +
      "</td></tr>" +
      '<tr><td style="padding:6px 8px;font-weight:bold;">Vs Day Before</td><td style="padding:6px 8px;text-align:right;">' +
      fmtChange(revenueChangeDoD) +
      "</td></tr>" +
      '<tr><td style="padding:6px 8px;font-weight:bold;">Vs Same Day Last Week</td><td style="padding:6px 8px;text-align:right;">' +
      fmtChange(revenueChangeWoW) +
      "</td></tr>" +
      "</table>" +
      '<h3 style="color:#0a5c36;">Top Sellers (by quantity)</h3>' +
      '<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">' +
      topByQtyRows +
      "</table>" +
      '<h3 style="color:#0a5c36;">Top Earners (by revenue)</h3>' +
      '<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">' +
      topByRevenueRows +
      "</table>" +
      '<h3 style="color:#0a5c36;">Customer Interest</h3>' +
      "<p>" +
      uniqueCustomerCount +
      " unique customers yesterday (" +
      repeatCount +
      " repeat, " +
      newCustomerCount +
      " new). Busiest hour: " +
      (busiestHour ? busiestHour + ":00" : "n/a") +
      ".</p>" +
      "</div>";

    await ctx.log("analysis:done", {
      reportDate: yesterdayStr,
      totalSales: yStats.revenue,
      orders: yStats.orderCount,
      revenueChangeDoD,
      revenueChangeWoW,
      uniqueCustomerCount,
      repeatCount,
      newCustomerCount,
      busiestHour,
    });

    // --- Send Daily Report Email ---
    const subject = `CocoGrove Daily Sales Report – ${yesterdayStr}`;
    await sendEmail({ to: REPORT_RECIPIENT, subject, html: emailHtml });
    await ctx.log("email:sent", { to: REPORT_RECIPIENT });

    return {
      summary: `CocoGrove daily sales report sent for ${yesterdayStr} — ${money(yStats.revenue)} across ${yStats.orderCount} orders`,
      data: { reportDate: yesterdayStr },
    };
  },
});
