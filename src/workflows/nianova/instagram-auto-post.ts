import { defineWorkflow } from "../types";
import { env } from "@/lib/env";
import { httpJson } from "@/lib/http";
import { publishSingleImage } from "@/lib/instagram";

/**
 * Faithful port of n8n "Nia Nova - Instagram Auto-Post" (qMK2IAiZx0NWGOTP).
 *
 * Original flow (Graph API v21.0, credential "Nia Nova Instagram"):
 *   Form Trigger "New Nia Post" (imageUrl, caption)
 *     -> Get Nia IG Account   GET /me?fields=instagram_business_account
 *     -> Create Instagram Media  POST /{ig-user-id}/media  (image_url, caption)
 *     -> Publish to Instagram    POST /{ig-user-id}/media_publish  (creation_id)
 *
 * The IG account is resolved automatically from the connected credential — no ID
 * to enter. There is NO Wait node in the original (container is published
 * immediately after creation), so we pass waitMs: 0 to stay faithful.
 */

const GRAPH_VERSION = "v21.0";

export default defineWorkflow({
  id: "nianova-instagram-auto-post",
  name: "Nia Nova - Instagram Auto-Post",
  n8nId: "qMK2IAiZx0NWGOTP",
  brand: "nianova",
  description:
    "Form-triggered single-image publisher for Nia Nova: resolve the IG account from /me, create the media container from the supplied Higgsfield image URL + caption, then publish immediately.",
  trigger: "form",
  enabled: true,

  async run(ctx) {
    const imageUrl = String(ctx.input?.imageUrl ?? "");
    const caption = String(ctx.input?.caption ?? "");
    if (!imageUrl) throw new Error("Missing required form field: imageUrl");
    if (!caption) throw new Error("Missing required form field: caption");
    await ctx.log("form:received", { imageUrl, captionLength: caption.length });

    const token = env.igAccessToken();

    // Get Nia IG Account: GET /me?fields=instagram_business_account
    const me = await httpJson<{ instagram_business_account?: { id: string } }>(
      `https://graph.facebook.com/${GRAPH_VERSION}/me?fields=instagram_business_account&access_token=${token}`,
    );
    const igUserId = me.instagram_business_account?.id;
    if (!igUserId) throw new Error("No instagram_business_account on the connected credential");
    await ctx.log("account:resolved", { igUserId });

    // Create Instagram Media -> (no wait) -> Publish to Instagram.
    const { mediaId, creationId } = await publishSingleImage({
      igUserId,
      imageUrl,
      caption,
      waitMs: 0,
      accessToken: token,
    });
    await ctx.log("published", { creationId, mediaId });

    return {
      summary: `Published Nia Nova image to Instagram (media ${mediaId})`,
      data: { igUserId, creationId, mediaId },
    };
  },
});
