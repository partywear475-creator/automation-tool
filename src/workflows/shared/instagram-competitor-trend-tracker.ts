import { defineWorkflow } from "../types";
import { env } from "@/lib/env";
import { businessDiscovery } from "@/lib/instagram";
import { appendRow } from "@/lib/sheets";
import { generateText } from "@/lib/openai";
import { sendEmail } from "@/lib/email";

/**
 * Faithful port of n8n "Instagram Competitor & Trend Tracker" (NInolCmDZ8sG1APr).
 *
 * Weekly Wednesday 08:00 (Europe/London) -> for each tracked competitor username
 * run Business Discovery (followers_count, media_count, username, last 10 media)
 * -> compute avg engagement / top-5 hashtags / top post -> append a row per
 * competitor to the "Snapshots" tab -> build an HTML digest -> ask the AI for 3
 * content ideas -> email the competitor & trend digest.
 */

const SHARED_IG_USER_ID = "17841472867696210";

// Tracked competitor usernames (public Business/Creator accounts).
const COMPETITORS: string[] = process.env.IG_COMPETITOR_USERNAMES
  ? process.env.IG_COMPETITOR_USERNAMES.split(",").map((s: string) => s.trim()).filter(Boolean)
  : ["tahir.dsgn", "growfast.co.id", "360influencemedia", "digitalmarketingagency.online"];

// "Instagram Competitor Tracker" spreadsheet, tab "Snapshots".
const SHEET_ID =
  process.env.IG_COMPETITOR_SHEET_ID ?? "1DmRXcKs4t-joRgscgDVMjTtI8LsjmD1DCaoAW81djAQ";
const SHEET_TAB = "Snapshots";

// n8n Gmail recipient for this workflow.
const REPORT_RECIPIENT = env.reportTo() || "partywear475@gmail.com";

interface CompetitorRow {
  competitor: string;
  followersCount: number;
  mediaCount: number;
  postsAnalyzed: number;
  avgEngagement: number;
  topHashtags: string;
  topPostCaption: string;
  topPostEngagement: number;
  topPostLink: string;
}

export default defineWorkflow({
  id: "shared-instagram-competitor-trend-tracker",
  name: "Instagram Competitor & Trend Tracker",
  n8nId: "NInolCmDZ8sG1APr",
  brand: "shared",
  description:
    "Weekly tracker that pulls competitor Instagram stats via Business Discovery, logs them to Sheets, and emails an AI-generated content-idea digest.",
  trigger: "schedule",
  schedule: "0 7 * * 3", // Weekly Wednesday 08:00 Europe/London (BST = UTC+1)
  enabled: true,

  async run(ctx) {
    const igUserId = env.igAccountOptional("shared") || SHARED_IG_USER_ID;
    await ctx.log("competitors:list", { competitors: COMPETITORS });

    // --- Per competitor: Business Discovery -> Analyze -> Log Snapshot ---
    const analyzed: CompetitorRow[] = [];
    for (const competitor of COMPETITORS) {
      const bd = await businessDiscovery(igUserId, competitor);
      // n8n requested media.limit(10); businessDiscovery() fetches the 12 most
      // recent, so slice to the first 10 (most recent) to match faithfully.
      const media = (bd.recentMedia || []).slice(0, 10);
      await ctx.log("competitor:fetched", { competitor, posts: media.length });

      const withEngagement = media.map((m) =>
        Object.assign({}, m, { engagement: (m.like_count || 0) + (m.comments_count || 0) }),
      );
      const totalEngagement = withEngagement.reduce((s, m) => s + m.engagement, 0);
      const avgEngagement = withEngagement.length
        ? Math.round((totalEngagement / withEngagement.length) * 10) / 10
        : 0;

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
          .slice(0, 5)
          .map((e) => e[0])
          .join(", ");

      const topPost = withEngagement.slice().sort((a, b) => b.engagement - a.engagement)[0] as
        | (typeof withEngagement)[number]
        | undefined;

      const row: CompetitorRow = {
        competitor: bd.username || "unknown",
        followersCount: bd.followers_count || 0,
        mediaCount: bd.media_count || 0,
        postsAnalyzed: withEngagement.length,
        avgEngagement,
        topHashtags: topHashtags || "not enough data",
        topPostCaption: topPost ? (topPost.caption || "").slice(0, 150) : "",
        topPostEngagement: topPost ? topPost.engagement : 0,
        // TODO: businessDiscovery() does not return permalink; topPostLink falls
        // back to empty, matching n8n behaviour when permalink is absent.
        topPostLink: topPost ? (topPost as { permalink?: string }).permalink || "" : "",
      };
      analyzed.push(row);

      // --- Log Competitor Snapshot (append row; exact column order) ---
      await appendRow(SHEET_ID, SHEET_TAB, [
        new Date().toISOString(), // Date ($now.toISO())
        row.competitor, // Competitor
        row.followersCount, // FollowersCount
        row.mediaCount, // MediaCount
        row.postsAnalyzed, // PostsAnalyzed
        row.avgEngagement, // AvgEngagement
        row.topHashtags, // TopHashtags
        row.topPostCaption, // TopPostCaption
        row.topPostEngagement, // TopPostEngagement
        row.topPostLink, // TopPostLink
      ]);
      await ctx.log("snapshot:appended", { competitor: row.competitor });
    }

    // --- Build Digest Summary (faithful port of the code node) ---
    let digestHtml = "";
    analyzed.forEach((c) => {
      digestHtml += "<h4>" + c.competitor + "</h4>";
      digestHtml +=
        "<p>Followers: " +
        c.followersCount +
        " | Avg engagement: " +
        c.avgEngagement +
        " | Posts analyzed: " +
        c.postsAnalyzed +
        "</p>";
      digestHtml += "<p>Top hashtags: " + c.topHashtags + "</p>";
      digestHtml +=
        '<p>Top post: ' +
        c.topPostCaption +
        " (" +
        c.topPostEngagement +
        ' engagement) — <a href="' +
        c.topPostLink +
        '">view</a></p><hr>';
    });
    await ctx.log("digest:built", { competitorCount: analyzed.length });

    // --- Generate Content Ideas (OpenAI gpt-5-mini; prompt copied verbatim) ---
    const aiOutput = await generateText({
      model: "gpt-5-mini",
      system: "You are a social media growth strategist. Be concise, concrete and actionable.",
      prompt:
        "Based on this competitor analysis, suggest 3 concrete, specific Instagram content ideas our brand should try this week to grow engagement. One short sentence each, no fluff.\n\n" +
        digestHtml,
    });
    await ctx.log("ai:ideas", { length: aiOutput.length });

    // --- Send Competitor Digest ---
    const subject = "Instagram Competitor & Trend Digest";
    const html =
      `<h2>Competitor & Trend Digest</h2>${digestHtml}` +
      `<h3>Content ideas for this week</h3><p>${aiOutput}</p>` +
      `<p style="color:#888;font-size:12px;">Full history is logged in your Instagram Competitor Tracker Google Sheet.</p>`;
    await sendEmail({ to: REPORT_RECIPIENT, subject, html });
    await ctx.log("email:sent", { to: REPORT_RECIPIENT });

    return {
      summary: `Competitor digest sent — ${analyzed.length} competitors tracked`,
      data: { competitors: analyzed.map((c) => c.competitor), competitorCount: analyzed.length },
    };
  },
});
