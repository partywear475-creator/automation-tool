import { defineWorkflow } from "../types";
import { env } from "@/lib/env";
import {
  resolvePageToken,
  assertAccount,
  createReelContainer,
  waitForContainer,
  publishContainer,
} from "@/lib/instagram";
import { sendEmail } from "@/lib/email";
import { appendRow } from "@/lib/sheets";
import { sleep } from "@/lib/http";

/**
 * Faithful port of n8n "Tixuy Reel — Trending Music" (h3zwpQQBNZGOPykE).
 *
 * Manual one-off Reel continuing the "meet the real face of Tixuy" avatar, now
 * in motion, scored with a royalty-free track (Cheery Monday by Kevin MacLeod,
 * CC BY 4.0 — attribution baked into the caption). Flow:
 *   Manual -> GET /me/accounts -> select Page "Tixuy" -> prepare copy
 *   -> create REELS container (share_to_feed true) -> escalating waits
 *      (20s / 30s / 40s) each followed by a status check -> if FINISHED
 *      publish, log to sheet, email success; else email failure.
 *
 * NOTE: the Reel video is a pre-generated external asset (CloudFront URL baked
 * into the n8n Set node — no generation API). The URL is kept verbatim as the
 * default and can be overridden via ctx.input.videoUrl.
 *
 * This workflow was inactive (active:false) in n8n; it is a manual trigger so
 * no cron is emitted.
 */

const TIXUY_IG_USER_ID = "17841472867696210";
const CONTENT_LOG_SHEET_ID = "1o3m_aSPGJ3-f-GjIO7dtKM8anJvvCGb63fVTAlBMy3E";
const CONTENT_LOG_TAB = "Posts";
const NOTIFY_EMAIL = "partywear475@gmail.com";

// Prepare Post Content (verbatim from the n8n Set node).
const TOPIC = "Meet Tixuy in motion — first Reel";
const CAPTION =
  "The realistic face of Tixuy — now in motion 🎬 Same studio, same energy, just saying hello properly this time. We build websites, brands and AI-powered campaigns for small businesses who are ready to stop looking stuck online. This is our first Reel — tell us what you want to see behind the scenes next 👇\n\n🎵 Cheery Monday by Kevin MacLeod (incompetech.com) — Licensed under Creative Commons: By Attribution 4.0 (creativecommons.org/licenses/by/4.0/)";
const HASHTAGS =
  "#AI #DigitalAgency #WebDesign #Branding #ReelsInstagram #TixuyAI #SmallBusinessMarketing #TechAgency #AIforBusiness #CreativeTechnology #DigitalMarketing #StartupTools #SaaS #AIAutomation #AgencyLife";
const VIDEO_PROMPT =
  "Ultra-realistic 1080p vertical video: a confident young digital creative technologist at a sleek desk in a modern tech studio, warm/teal lighting, dual monitors glowing with abstract UI, looks up and smiles warmly at camera with a small welcoming nod. Scored with an upbeat, feel-good royalty-free instrumental (Cheery Monday by Kevin MacLeod) matching this week's celebratory trending Reels mood.";
// TODO: externally pre-generated video asset (no generation API). Override via ctx.input.videoUrl.
const VIDEO_URL =
  "https://d2ol7oe51mr4n9.cloudfront.net/user_32ZgfZc2L6tfBGBRTWykhhaFcP4/db41b962-e708-49d9-a398-5f7a205287db.mp4";

export default defineWorkflow({
  id: "tixuy-reel-trending-music",
  name: "Tixuy Reel — Trending Music",
  n8nId: "h3zwpQQBNZGOPykE",
  brand: "tixuy",
  description:
    "Manual one-off Reel for @tix_uy from a pre-generated video, royalty-free track credited in caption, published to feed; logs to the Instagram Content Log sheet and emails success/failure.",
  trigger: "manual",
  enabled: true,

  async run(ctx) {
    const igUserId = env.igAccountOptional("tixuy") || TIXUY_IG_USER_ID;
    const videoUrl = (ctx.input?.videoUrl as string | undefined) || VIDEO_URL;

    // Get My Facebook Page -> Select Tixuy Page.
    const page = await resolvePageToken("Tixuy");
    await ctx.log("page:resolved", { pageId: page.id, name: page.name });

    // Account guard.
    await assertAccount(igUserId, TIXUY_IG_USER_ID, page.access_token);

    const fullCaption = CAPTION + "\n\n" + HASHTAGS;

    // Create Media Container (REELS, share_to_feed true).
    const creationId = await createReelContainer(
      igUserId,
      videoUrl,
      fullCaption,
      { shareToFeed: true },
      page.access_token,
    );
    await ctx.log("container:created", { creationId });

    // Wait For Container Processing 1/2/3 (20s / 30s / 40s) each followed by a status check.
    const waits = [20_000, 30_000, 40_000];
    let finished = false;
    let lastReason = "";
    for (let i = 0; i < waits.length; i++) {
      await sleep(waits[i]);
      try {
        await waitForContainer(creationId, { intervalMs: 1, maxAttempts: 1 }, page.access_token);
        finished = true;
        break;
      } catch (e) {
        lastReason = e instanceof Error ? e.message : String(e);
        await ctx.log("container:check", { attempt: i + 1, finished: false, reason: lastReason });
      }
    }

    if (!finished) {
      // Container Ready? 3 == false -> Send Failure Alert.
      await sendEmail({
        to: NOTIFY_EMAIL,
        subject: "Tixuy Reel publish failed — media container not ready",
        html: `<p>The Instagram Reel media container did not finish processing in time (3 checks, ~90s).</p><p><strong>Status:</strong> ${lastReason}</p><p><strong>Container ID:</strong> ${creationId}</p><p>Check the Meta Graph API Explorer, or re-run this workflow later — the container may just need more time.</p>`,
      });
      return {
        summary: "Tixuy Reel failed — container not ready after ~90s",
        data: { creationId, reason: lastReason },
      };
    }

    // Publish Media.
    const postId = await publishContainer(igUserId, creationId, page.access_token);
    await ctx.log("post:published", { postId });

    // Log Published Post. Header: Date, Topic, Caption, Hashtags, ImagePrompt, ImageURL, PostID, Status
    await appendRow(CONTENT_LOG_SHEET_ID, CONTENT_LOG_TAB, [
      new Date().toISOString(),
      TOPIC,
      CAPTION,
      HASHTAGS,
      VIDEO_PROMPT,
      videoUrl,
      postId,
      "Published (Reel)",
    ]);
    await ctx.log("sheet:logged", {});

    // Send Success Email.
    await sendEmail({
      to: NOTIFY_EMAIL,
      subject: `✅ Tixuy Reel published: ${TOPIC}`,
      html: `<h3>Tixuy Reel published 🎬</h3><p><strong>Topic:</strong> ${TOPIC}</p><p><strong>Caption:</strong><br>${CAPTION}</p><p><strong>Video URL:</strong> ${videoUrl}</p><p><strong>Post ID:</strong> ${postId}</p>`,
    });

    return {
      summary: `Published Tixuy Reel to @tix_uy (${postId})`,
      data: { postId, videoUrl },
    };
  },
});
