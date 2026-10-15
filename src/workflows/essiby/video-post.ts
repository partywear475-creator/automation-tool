import { defineWorkflow } from "../types";
import { env } from "@/lib/env";
import { httpJson, sleep } from "@/lib/http";
import { createReelContainer, publishContainer } from "@/lib/instagram";
import { sendEmail } from "@/lib/email";

/**
 * Faithful port of n8n "essiby Video Post - Instagram and Facebook"
 * (zAy6GS8NApAHWTPC).
 *
 * Manual trigger. Publishes an existing MP4 as an Instagram Reel cross-posted
 * to the linked Facebook Page feed (share_to_feed=true).
 *
 * Flow: Get /me/accounts -> Select Essiby Page (name includes "essiby", else
 * throw) -> Get Instagram Business Account (via page token) -> Prepare Post
 * Content (igAccountId, videoUrl, caption, hashtags) -> Create Media Container
 * (REELS) -> poll the container up to 3 times with escalating waits
 * (20s / 30s / 40s), publishing as soon as status_code === FINISHED ->
 * Get Post Permalink -> Send Success Email. If never FINISHED after 3 checks,
 * Send Failure Alert.
 */

// n8n Gmail recipient (Send Success Email / Send Failure Alert).
const ALERT_RECIPIENT = env.reportTo() || "partywear475@gmail.com";

const GRAPH = () => `https://graph.facebook.com/${env.graphVersion()}`;

// Prepare Post Content (verbatim defaults; videoUrl may be overridden via input).
const DEFAULT_VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_32ZgfZc2L6tfBGBRTWykhhaFcP4/hf_20260911_152939_c92e7f1f-63d9-4a9e-886c-1593f4444827.mp4";
const CAPTION =
  "Boiled 6 eggs perfectly in under 10 minutes - no more babysitting a pot on the stove. This little egg boiler has genuinely become a morning routine staple - fill it, press one button, walk away. Grab yours from essiby, link in bio";
const HASHTAGS =
  "#kitchengadgets #eggboiler #kitchenhacks #essiby #kitchenmusthaves #breakfasthacks #foodprep #smallkitchenappliances #mealprep #cookinggadgets";

// Escalating container-processing waits (seconds), matching the 3 Wait nodes.
const POLL_WAITS_MS = [20_000, 30_000, 40_000];

interface FacebookPage {
  id: string;
  name: string;
  access_token: string;
}

/** Faithful "Select Essiby Page": name includes "essiby", else throw. */
async function selectEssibyPage(): Promise<{ pageId: string; pageName: string; pageAccessToken: string }> {
  const url = `${GRAPH()}/me/accounts?fields=id,name,access_token&access_token=${env.igAccessToken()}`;
  const body = await httpJson<{ data: FacebookPage[] }>(url);
  const pages = body.data || [];
  const selected = pages.find((p) => (p.name || "").toLowerCase().indexOf("essiby") !== -1);
  if (!selected) {
    throw new Error(
      `No Facebook Page found matching "essiby". Available pages: ${pages.map((p) => p.name).join(", ")}`,
    );
  }
  return { pageId: selected.id, pageName: selected.name, pageAccessToken: selected.access_token };
}

async function checkContainerStatus(containerId: string, pageToken: string): Promise<string> {
  const url = `${GRAPH()}/${containerId}?fields=status_code,id&access_token=${pageToken}`;
  const body = await httpJson<{ status_code?: string }>(url);
  return body.status_code ?? "";
}

export default defineWorkflow({
  id: "essiby-video-post",
  name: "essiby Video Post - Instagram and Facebook",
  n8nId: "zAy6GS8NApAHWTPC",
  brand: "essiby",
  description:
    "Publishes an existing MP4 as an Instagram Reel cross-posted to the linked Facebook Page feed for essiby, polling the Graph API media container until it finishes processing before publishing.",
  trigger: "manual",
  enabled: true,

  async run(ctx) {
    const input = (ctx.input ?? {}) as Record<string, unknown>;

    // --- Get My Facebook Page -> Select Essiby Page ---
    const page = await selectEssibyPage();
    const pageToken = page.pageAccessToken;
    await ctx.log("page:selected", { pageId: page.pageId, name: page.pageName });

    // --- Get Instagram Business Account (via page token) ---
    const igAccUrl = `${GRAPH()}/${page.pageId}?fields=instagram_business_account&access_token=${pageToken}`;
    const igAccBody = await httpJson<{ instagram_business_account?: { id: string } }>(igAccUrl);
    const igAccountId =
      env.igAccountOptional("essiby") || igAccBody.instagram_business_account?.id;
    if (!igAccountId) {
      throw new Error(`Page ${page.pageId} has no linked instagram_business_account for essiby.`);
    }
    await ctx.log("ig:resolved", { igAccountId });

    // --- Prepare Post Content ---
    const videoUrl = String(input.videoUrl ?? input.mediaUrl ?? DEFAULT_VIDEO_URL);
    const caption = String(input.caption ?? CAPTION);
    const hashtags = String(input.hashtags ?? HASHTAGS);

    // --- Create Media Container (REELS, share_to_feed=true) ---
    const creationId = await createReelContainer(
      igAccountId,
      videoUrl,
      `${caption}\n\n${hashtags}`,
      { shareToFeed: true },
      pageToken,
    );
    await ctx.log("container:created", { creationId });

    // --- Poll up to 3 times with escalating waits; publish when FINISHED ---
    let finished = false;
    let lastStatus = "";
    for (let attempt = 0; attempt < POLL_WAITS_MS.length; attempt++) {
      await sleep(POLL_WAITS_MS[attempt]);
      lastStatus = await checkContainerStatus(creationId, pageToken);
      await ctx.log("container:status", { attempt: attempt + 1, status_code: lastStatus });
      if (lastStatus === "FINISHED") {
        finished = true;
        break;
      }
    }

    if (!finished) {
      // --- Send Failure Alert ---
      await sendEmail({
        to: ALERT_RECIPIENT,
        subject: "essiby Reel publish FAILED - container never finished processing",
        html:
          `Container status check timed out after 3 attempts for essiby's egg boiler Reel.<br>` +
          `Check the workflow execution in n8n and retry manually.<br>` +
          `Container ID: ${creationId}`,
      });
      await ctx.log("failure-alert", { to: ALERT_RECIPIENT, lastStatus });
      return {
        summary: `essiby Reel NOT published — container never FINISHED (last status: ${lastStatus})`,
        data: { creationId, lastStatus, published: false },
      };
    }

    // --- Publish Media -> Get Post Permalink ---
    const mediaId = await publishContainer(igAccountId, creationId, pageToken);
    const permaUrl = `${GRAPH()}/${mediaId}?fields=permalink,id&access_token=${pageToken}`;
    const perma = await httpJson<{ permalink?: string; id?: string }>(permaUrl);
    const permalink = perma.permalink ?? "";
    await ctx.log("published", { mediaId, permalink });

    // --- Send Success Email ---
    await sendEmail({
      to: ALERT_RECIPIENT,
      subject: "essiby Reel published to Instagram and Facebook",
      html:
        `Your essiby egg boiler video is live.<br><br>` +
        `Permalink: https://www.instagram.com${permalink}<br>` +
        `Post ID: ${mediaId}`,
    });
    await ctx.log("email:sent", { to: ALERT_RECIPIENT });

    return {
      summary: `Published essiby Reel to @essiby (IG + FB feed) — post ${mediaId}`,
      data: { igAccountId, creationId, mediaId, permalink, published: true },
    };
  },
});
