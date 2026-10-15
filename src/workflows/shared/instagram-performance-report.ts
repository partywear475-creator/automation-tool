import { defineWorkflow } from "../types";
import { env } from "@/lib/env";
import { getAccount, getRecentMedia } from "@/lib/instagram";
import { appendRow } from "@/lib/sheets";
import { sendEmail } from "@/lib/email";

/**
 * Faithful port of n8n "Instagram Performance Report & Growth Insights" (rfh4r5q2LxwBriAN).
 *
 * Weekly Monday 08:00 (Europe/London) -> GET account overview -> GET last 30
 * media -> compute engagement, best-time-to-post (UTC hour bucketing) and top
 * hashtags -> append a snapshot row to "Weekly Snapshots" -> email the report.
 *
 * Same analysis as the CocoGrove report but on the shared account / log / inbox.
 */

const SHARED_IG_USER_ID = "17841472867696210";

// "Instagram Performance Log" spreadsheet, tab "Weekly Snapshots".
const SHEET_ID =
  process.env.SHARED_IG_PERF_SHEET_ID ?? "1UncVWdnVD-IVdhFVk4GSuWe684oaSJOeY--PV3bJOwQ";
const SHEET_TAB = "Weekly Snapshots";

// n8n Gmail recipient for this workflow.
const REPORT_RECIPIENT = env.reportTo() || "partywear475@gmail.com";

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
  id: "shared-instagram-performance-report",
  name: "Instagram Performance Report & Growth Insights",
  n8nId: "rfh4r5q2LxwBriAN",
  brand: "shared",
  description:
    "Weekly Instagram analytics: follower count, engagement, best time to post and top hashtags, logged to Sheets and emailed as a report.",
  trigger: "schedule",
  schedule: "0 7 * * 1", // Weekly Monday 08:00 Europe/London (BST = UTC+1)
  enabled: true,

  async run(ctx) {
    const igUserId = env.igAccountOptional("shared") || SHARED_IG_USER_ID;

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
    const subject = `📊 Instagram Weekly Report — ${analysis.followersCount} followers`;
    const html =
      `<h2>Instagram Weekly Performance Report</h2>` +
      `<p><strong>Followers:</strong> ${analysis.followersCount}</p>` +
      `<p><strong>Total posts:</strong> ${analysis.mediaCountTotal} (analyzed last ${analysis.postsAnalyzed})</p>` +
      `<p><strong>Average engagement per post:</strong> ${analysis.avgEngagement} (likes + comments)</p>` +
      `<h3>Growth recommendations</h3>` +
      `<p><strong>Best time to post:</strong> around ${analysis.bestHourUTC} (based on your top-performing recent posts)</p>` +
      `<p><strong>Hashtags that are working for you:</strong> ${analysis.topHashtags}</p>` +
      `<h3>Top post this period</h3>` +
      `<p>${analysis.topPostCaption}</p>` +
      `<p><strong>Engagement:</strong> ${analysis.topPostEngagement} — <a href="${analysis.topPostLink}">view post</a></p>` +
      `<p style="color:#888;font-size:12px;">Full history is logged in your Instagram Performance Log Google Sheet.</p>`;
    await sendEmail({ to: REPORT_RECIPIENT, subject, html });
    await ctx.log("email:sent", { to: REPORT_RECIPIENT });

    return {
      summary: `IG weekly report sent — ${analysis.followersCount} followers, ${analysis.postsAnalyzed} posts analyzed`,
      data: analysis,
    };
  },
});
