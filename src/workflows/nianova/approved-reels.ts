import { defineWorkflow } from "../types";
import { env } from "@/lib/env";
import { httpJson } from "@/lib/http";
import { assertAccount, publishReel, publishCarousel } from "@/lib/instagram";

/**
 * Faithful port of n8n "Nia Nova - Approved Facebook and Instagram Reels"
 * (DkITYpHDJ475cEU9).
 *
 * Manual publisher. All publishing is approval-gated and verifies Nia's
 * Facebook Page id AND connected Instagram user id before posting (Graph API
 * v25.0, credential "Nia Nova Instagram").
 *
 * This workflow has three live branches that all fan out from the manual Start:
 *   1. Meta permission check  — GET /me/permissions (read-only)
 *   2. Reel publisher         — Reel Settings -> Read Connected Accounts ->
 *      approval+account gate -> Facebook branch (gated) and Instagram branch.
 *   3. Carousel publisher     — Nia Carousel Settings -> account gate ->
 *      5 carousel items -> CAROUSEL container -> publish.
 *
 * NOT PORTED (disabled draft nodes in n8n — AI generation that would PRODUCE the
 * reel video_url before publishing; they are text-to-video renders run on an
 * external Google key and were disabled):
 *   - "Generate Script & Caption (Gemini)" model models/gemini-3-flash-preview
 *   - "Generate Reel Video (Gemini/Veo)" / "Veo: Start Render" model
 *     veo-3.1-lite-generate-preview -> Drive upload -> Public Video URL.
 * The final video_url is accepted from ctx.input (falling back to the baked-in
 * Reel Settings value). See // TODO below.
 *
 * Facebook Reel upload (rupload.facebook.com two-phase upload with templated
 * custom-auth credential) is NOT ported — it is gated off by default
 * (publish_facebook=false, facebook_upload_configured=false) and the custom
 * upload credential is not available in the shared libs. See // TODO.
 */

// Verified identifiers, verbatim from the n8n "Reel Settings" / account nodes.
const EXPECTED_FB_PAGE_ID = env.fbPageId("nianova") || "1244182618788962";
const EXPECTED_IG_USER_ID = env.igAccountOptional("nianova") || "17841423897325080";
const GRAPH_VERSION = "v25.0";

// --- Reel Settings (baked-in defaults, overridable via ctx.input) ----------
const REEL_TITLE = "Meet Nia Nova ✨";
const REEL_CAPTION =
  "Plot twist… I’m AI. 👀✨\n\nMeet Nia Nova — affordable fashion, glow-ups & confidence with a digital twist.\n\nWhat should I transform first?\n👗 OUTFIT or 💄 MAKEUP?\n\nNia Nova is a virtual AI creator.\n\n#NiaNova #AICreator #VirtualCreator #FashionTok #BeautyTok #AffordableFashion #GlowUp #OutfitIdeas #DigitalCreator";
// TODO: in n8n this comes from the (disabled) Higgsfield/Veo render. Supply a
// fresh public HTTPS MP4 via ctx.input.video_url for a real run.
const REEL_VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_32ZgfZc2L6tfBGBRTWykhhaFcP4/hf_20261004_091819_c443160f-bda0-47ac-b944-ab4c3e01a68f.mp4";

// --- Nia Carousel Settings (five-slide studio behind-the-scenes post) ------
const CAROUSEL_CAPTION =
  "Behind the scenes, where the vision becomes the work. 🎥✨\n\nFrom the first frame to the final review, every detail matters — lighting, angles, styling, and the team behind the camera.\n\nSwipe through a day in Nia Nova’s studio. Which frame is your favourite: 1, 2, 3, 4, or 5?\n\n#NiaNova #AICreator #BehindTheScenes #ContentCreator #StudioShoot";
const CAROUSEL_IMAGE_URLS = [
  "https://d2ol7oe51mr4n9.cloudfront.net/user_32ZgfZc2L6tfBGBRTWykhhaFcP4/c34c8b16-eda6-4183-a386-4f20155bd103.png",
  "https://d2ol7oe51mr4n9.cloudfront.net/user_32ZgfZc2L6tfBGBRTWykhhaFcP4/458ddbbe-666b-4fda-a16f-fd225ba88a44.png",
  "https://d2ol7oe51mr4n9.cloudfront.net/user_32ZgfZc2L6tfBGBRTWykhhaFcP4/642d5f42-e2dc-4691-8162-eb6154cc1b1b.png",
  "https://d2ol7oe51mr4n9.cloudfront.net/user_32ZgfZc2L6tfBGBRTWykhhaFcP4/26c75674-3df3-4414-abf8-c2fab7aa0e21.png",
  "https://d2ol7oe51mr4n9.cloudfront.net/user_32ZgfZc2L6tfBGBRTWykhhaFcP4/c14ac96c-ade5-4b88-a78b-80d38f6af3a0.png",
];

interface ConnectedAccounts {
  id: string;
  name: string;
  instagram_business_account?: { id: string; username?: string };
}

export default defineWorkflow({
  id: "nianova-approved-reels",
  name: "Nia Nova - Approved Facebook and Instagram Reels",
  n8nId: "DkITYpHDJ475cEU9",
  brand: "nianova",
  description:
    "Manual, approval-gated Nia Nova publisher: verifies the Facebook Page + connected Instagram user id, then publishes an Instagram Reel and/or the 5-slide behind-the-scenes carousel. Facebook Reel upload is gated off.",
  trigger: "manual",
  enabled: true,

  async run(ctx) {
    const token = env.igAccessToken();
    const graph = `https://graph.facebook.com/${GRAPH_VERSION}`;
    const data: Record<string, unknown> = {};

    // Resolve settings (baked-in defaults, overridable per manual run).
    const mode = String(ctx.input?.mode ?? "PUBLISH");
    const approved = ctx.input?.approved ?? true;
    const videoUrl = String(ctx.input?.video_url ?? REEL_VIDEO_URL);
    const title = String(ctx.input?.title ?? REEL_TITLE);
    const caption = String(ctx.input?.caption ?? REEL_CAPTION);
    const publishInstagram = ctx.input?.publish_instagram ?? true;
    const publishFacebook = ctx.input?.publish_facebook ?? false;
    const facebookUploadConfigured = ctx.input?.facebook_upload_configured ?? false;
    const carouselApproved = ctx.input?.carousel_approved ?? false; // n8n default: false

    // === 1. Nia Meta Permission Check — GET /me/permissions (read only) ====
    const perms = await httpJson<{ data?: Array<{ permission: string; status: string }> }>(
      `${graph}/me/permissions?fields=permission,status&access_token=${token}`,
    );
    await ctx.log("meta:permissions", { permissions: perms.data ?? [] });
    data.permissions = perms.data ?? [];

    // === 2. Read Connected Accounts (the Nia Nova Page + its IG account) ====
    const account = await httpJson<ConnectedAccounts>(
      `${graph}/${EXPECTED_FB_PAGE_ID}?fields=${encodeURIComponent(
        "id,name,instagram_business_account{id,username}",
      )}&access_token=${token}`,
    );
    const igUserId = account.instagram_business_account?.id ?? "";
    await ctx.log("account:read", {
      pageId: account.id,
      pageName: account.name,
      igUserId,
      igUsername: account.instagram_business_account?.username,
    });

    // === Reel approval + verified-accounts gate ============================
    // Mirrors "Approved Reel and Verified Accounts?" exactly.
    const reelGate =
      mode === "PUBLISH" &&
      approved === true &&
      /^https:\/\/[^\s]+$/.test(videoUrl) &&
      caption.length > 0 &&
      caption.length <= 2200 &&
      !!igUserId &&
      account.id === EXPECTED_FB_PAGE_ID &&
      igUserId === EXPECTED_IG_USER_ID;

    if (!reelGate) {
      // "Account Check - No Publishing" branch.
      await ctx.log("reel:gate-blocked", {
        result: "CHECK_ONLY_OR_APPROVAL_MISSING",
        facebook_page_id: account.id,
        facebook_page_name: account.name,
        instagram_user_id: igUserId,
        instagram_username: account.instagram_business_account?.username ?? "",
      });
      data.reel = { status: "CHECK_ONLY_OR_APPROVAL_MISSING" };
    } else {
      // Account guard before any publish.
      await assertAccount(igUserId, EXPECTED_IG_USER_ID, token);

      // --- Facebook branch: only if enabled AND upload credential ready ---
      if (publishFacebook === true && facebookUploadConfigured === true) {
        // TODO: Facebook Reel upload uses rupload.facebook.com (start/upload/
        // finish) with a templated custom-auth OAuth credential that is not in
        // the shared libs. Not ported.
        await ctx.log("facebook:not-ported", {
          status: "NOT_PORTED_RUPLOAD_CUSTOM_AUTH",
        });
        data.facebook = { status: "NOT_PORTED_RUPLOAD_CUSTOM_AUTH" };
      } else {
        await ctx.log("facebook:skipped", {
          status: "SKIPPED_NOT_ENABLED_OR_UPLOAD_CREDENTIAL_MISSING",
        });
        data.facebook = { status: "SKIPPED_NOT_ENABLED_OR_UPLOAD_CREDENTIAL_MISSING" };
      }

      // --- Instagram branch: Create REELS container -> poll -> publish ----
      if (publishInstagram === true) {
        await ctx.log("instagram:reel-begin", { igUserId });
        const { mediaId, creationId } = await publishReel({
          igUserId,
          videoUrl,
          caption,
          shareToFeed: true,
          accessToken: token,
        });
        // Read Instagram Permalink.
        const permalinkRes = await httpJson<{ id: string; permalink?: string }>(
          `${graph}/${mediaId}?fields=id,permalink&access_token=${token}`,
        );
        await ctx.log("instagram:published", {
          creationId,
          mediaId,
          permalink: permalinkRes.permalink,
        });
        data.instagram = {
          status: "PUBLISHED",
          media_id: mediaId,
          permalink: permalinkRes.permalink,
        };
      } else {
        await ctx.log("instagram:skipped", { status: "SKIPPED_NOT_ENABLED" });
        data.instagram = { status: "SKIPPED_NOT_ENABLED" };
      }
    }

    // === 3. Nia Carousel branch (own approval + account gate) ==============
    const carouselGate =
      carouselApproved === true &&
      !!account.instagram_business_account?.id &&
      account.instagram_business_account.id === EXPECTED_IG_USER_ID;

    if (!carouselGate) {
      await ctx.log("carousel:blocked", {
        status: "BLOCKED_APPROVAL_OR_ACCOUNT_MISMATCH",
        instagram_user_id: account.instagram_business_account?.id ?? "",
        instagram_username: account.instagram_business_account?.username ?? "",
      });
      data.carousel = { status: "BLOCKED_APPROVAL_OR_ACCOUNT_MISMATCH" };
    } else {
      // Nia Carousel Collect Children enforces exactly 5 items.
      if (CAROUSEL_IMAGE_URLS.length !== 5) {
        throw new Error(
          `Expected 5 carousel item IDs, received ${CAROUSEL_IMAGE_URLS.length}`,
        );
      }
      await ctx.log("carousel:begin", { images: CAROUSEL_IMAGE_URLS.length });
      const { mediaId, creationId } = await publishCarousel({
        igUserId: account.instagram_business_account!.id,
        imageUrls: CAROUSEL_IMAGE_URLS,
        caption: CAROUSEL_CAPTION,
        accessToken: token,
      });
      const permalinkRes = await httpJson<{ id: string; permalink?: string }>(
        `${graph}/${mediaId}?fields=id,permalink&access_token=${token}`,
      );
      await ctx.log("carousel:published", {
        creationId,
        mediaId,
        permalink: permalinkRes.permalink,
      });
      data.carousel = {
        platform: "instagram_carousel",
        status: "PUBLISHED",
        media_id: mediaId,
        permalink: permalinkRes.permalink,
      };
    }

    return {
      summary: "Nia Nova approved publisher run complete (reel + carousel branches evaluated)",
      data,
    };
  },
});
