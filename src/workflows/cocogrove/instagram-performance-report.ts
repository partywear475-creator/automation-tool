import { defineWorkflow } from "../types";
import { env } from "@/lib/env";
import { getAccount, getRecentMedia } from "@/lib/instagram";
import { appendRow } from "@/lib/sheets";
import { sendEmail } from "@/lib/email";

/**
 * Faithful port of n8n "CocoGrove Instagram Performance Report" (DaGlIP6gzIXuBqem).
 *
 * Weekly Monday 08:00 (Europe/London) -> GET account overview (username,
 * followers_count, media_count) -> GET last 30 media (id, caption, timestamp,
 * like_count, comments_count, media_type, permalink) -> compute engagement,
 * best-time-to-post (UTC hour bucketing) and top hashtags -> append a snapshot
 * row to the "Weekly Snapshots" tab -> email the weekly report.
 *
 * The analysis deliberately avoids the /insights endpoint and computes
 * engagement/timing/hashtags directly from recent posts (matches the n8n note).
 */

// CocoGrove IG Business Account ID (from both Facebook Graph API nodes).
const COCOGROVE_IG_USER_ID = "17841461430625142";

// "CocoGrove Instagram Performance Log" spreadsheet, tab "Weekly Snapshots".
const SHEET_ID =
  process.env.COCOGROVE_IG_PERF_SHEET_ID ?? "135uhPSNzAPZxY8lq3iu3T4dwXb0JXgXYs76pL-aQNaE";
const SHEET_TAB = "Weekly Snapshots";

// n8n Gmail recipient for this workflow.
const REPORT_RECIPIENT = env.reportTo() || "shibile504@gmail.com";

interface MediaItem {
  id?: string;
  caption?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
  media_type?: string;
  permalink?: string;
}

export default defineWorkflow({
  id: "cocogrove-instagram-performance-report",
  name: "CocoGrove Instagram Performance Report",
  n8nId: "DaGlIP6gzIXuBqem",
  brand: "cocogrove",
  description:
    "Weekly CocoGrove Instagram analytics: follower count, engagement, best time to post and top hashtags, logged to Sheets and emailed as a report.",
  trigger: "schedule",
  schedule: "0 7 * * 1", // Weekly Monday 08:00 Europe/London (BST = UTC+1)
  enabled: true,

  async run(ctx) {
    const igUserId = env.igAccountOptional("cocogrove") || COCOGROVE_IG_USER_ID;

    // --- Get Account Overview ---
    const account = await getAccount(igUserId);
    await ctx.log("account:overview", {
      username: account.username,
      followers_count: account.followers_count,
      media_count: account.media_count,
    });

    // --- Get Recent Media (limit 30) ---
    const media = (await getRecentMedia(igUserId, 30)) as MediaItem[];
    await ctx.log("media:fetched", { count: media.length });

    // --- Analyze Engagement & Timing (faithful port of the code node) ---
    const withEngagement = media.map((m) =>
      Object.assign({}, m, { engagement: (m.like_count || 0) + (m.comments_count || 0) }),
    );
    const totalEngagement = withEngagement.reduce((sum, m) => sum + m.engagement, 0);
    const avgEngagement = withEngagement.length
      ? Math.round((totalEngagement / withEngagement.length) * 10) / 10
      : 0;
    const topPosts = withEngagement.slice().sort((a, b) => b.engagement - a.engagement).slice(0, 3);

    const hourBuckets: Record<string, { total: number; count: number }> = {};
    withEngagement.forEach((m) => {
      if (!m.timestamp) return;
      const hour = new Date(m.timestamp).getUTCHours();
      if (!hourBuckets[hour]) hourBuckets[hour] = { total: 0, count: 0 };
      hourBuckets[hour].total += m.engagement;
      hourBuckets[hour].count += 1;
    });
    let bestHour: string | null = null;
    let bestAvg = -1;
    for (const hour in hourBuckets) {
      const avg = hourBuckets[hour].total / hourBuckets[hour].count;
      if (avg > bestAvg) {
        bestAvg = avg;
        bestHour = hour;
      }
    }

    const hashtagCounts: Record<string, number> = {};
    withEngagement.forEach((m) => {
      const tags = (m.caption || "").match(/#[a-zA-Z0-9_]+/g) || [];
      tags.forEach((t) => {
        const key = t.toLowerCase();
        hashtagCounts[key] = (hashtagCounts[key] || 0) + 1;
      });
    });
    const topHashtags =
      Object.entries(hashtagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map((e) => e[0])
        .join(", ");

    const analysis = {
      username: account.username || "",
      followersCount: account.followers_count || 0,
      mediaCountTotal: account.media_count || 0,
      postsAnalyzed: withEngagement.length,
      avgEngagement,
      bestHourUTC: bestHour !== null ? bestHour + ":00 UTC" : "not enough data",
      topHashtags: topHashtags || "not enough data",
      topPostCaption: topPosts[0] ? (topPosts[0].caption || "").slice(0, 150) : "",
      topPostEngagement: topPosts[0] ? topPosts[0].engagement : 0,
      // TODO: getRecentMedia() does not return permalink; topPostLink falls back
      // to empty, matching the n8n behaviour when permalink is absent.
      topPostLink: topPosts[0] ? topPosts[0].permalink || "" : "",
    };
    await ctx.log("analysis:done", analysis);

    // --- Log Weekly Snapshot (append row; exact column order) ---
    await appendRow(SHEET_ID, SHEET_TAB, [
      new Date().toISOString(), // Date ($now.toISO())
      analysis.username, // Username
      analysis.followersCount, // FollowersCount
      analysis.mediaCountTotal, // MediaCountTotal
      analysis.postsAnalyzed, // PostsAnalyzed
      analysis.avgEngagement, // AvgEngagement
      analysis.bestHourUTC, // BestHourUTC
      analysis.topHashtags, // TopHashtags
      analysis.topPostCaption, // TopPostCaption
      analysis.topPostEngagement, // TopPostEngagement
      analysis.topPostLink, // TopPostLink
    ]);
    await ctx.log("sheet:appended", { sheet: SHEET_ID, tab: SHEET_TAB });

    // --- Send Weekly Report ---
    const subject = `CocoGrove Instagram Weekly Report — ${analysis.followersCount} followers`;
    const html =
      `<h2>CocoGrove Instagram Weekly Performance Report</h2>` +
      `<p><strong>Followers:</strong> ${analysis.followersCount}</p>` +
      `<p><strong>Total posts:</strong> ${analysis.mediaCountTotal} (analyzed last ${analysis.postsAnalyzed})</p>` +
      `<p><strong>Average engagement per post:</strong> ${analysis.avgEngagement} (likes + comments)</p>` +
      `<h3>Growth recommendations</h3>` +
      `<p><strong>Best time to post:</strong> around ${analysis.bestHourUTC} (based on top-performing recent posts)</p>` +
      `<p><strong>Hashtags that are working:</strong> ${analysis.topHashtags}</p>` +
      `<h3>Top post this period</h3>` +
      `<p>${analysis.topPostCaption}</p>` +
      `<p><strong>Engagement:</strong> ${analysis.topPostEngagement} — <a href="${analysis.topPostLink}">view post</a></p>` +
      `<p style="color:#888;font-size:12px;">Full history is logged in the CocoGrove Instagram Performance Log Google Sheet.</p>`;
    await sendEmail({ to: REPORT_RECIPIENT, subject, html });
    await ctx.log("email:sent", { to: REPORT_RECIPIENT });

    return {
      summary: `CocoGrove IG weekly report sent — ${analysis.followersCount} followers, ${analysis.postsAnalyzed} posts analyzed`,
      data: analysis,
    };
  },
});
