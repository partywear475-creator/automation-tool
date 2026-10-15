import { defineWorkflow } from "../types";
import { env } from "@/lib/env";
import { resolvePageToken, assertAccount, publishSingleImage } from "@/lib/instagram";
import { cloudinaryJpeg } from "@/lib/cloudinary";

/**
 * Faithful port of n8n "Tixuy — Publish csraoul Posts to Instagram" (efe1lRM0obXwOp5c).
 *
 * Original flow: Manual trigger -> GET /me/accounts -> select Page "Tixuy"
 * -> for each of 6 posts: download image -> Cloudinary upload (JPEG) ->
 * create IG container -> Wait 15s -> media_publish.
 *
 * Posts are one-per-batch and sequential, exactly as the n8n splitInBatches loop ran.
 */

const TIXUY_IG_USER_ID = "17841472867696210";

const POSTS: Array<{ image_url: string; caption: string }> = [
  {
    image_url:
      "https://d8j0ntlcm91z4.cloudfront.net/user_32ZgfZc2L6tfBGBRTWykhhaFcP4/hf_20260912_103814_016ec1fd-d8e3-44be-af32-a5b89bcc5038.png",
    caption:
      "Every designer just felt this. Tag your design bestie. We turn make the logo bigger into real brand strategy. #webdesign #brandingtips #agencylife #tixuy",
  },
  {
    image_url:
      "https://d8j0ntlcm91z4.cloudfront.net/user_32ZgfZc2L6tfBGBRTWykhhaFcP4/hf_20260912_103813_ae4e523f-93cd-4acf-92d3-f5b66340f707.png",
    caption:
      "Same business. Premium presence. That is the difference good branding makes. DM us PREMIUM to see yours. #branding #rebrand #smallbusinessuk #tixuy",
  },
  {
    image_url:
      "https://d8j0ntlcm91z4.cloudfront.net/user_32ZgfZc2L6tfBGBRTWykhhaFcP4/hf_20260912_103813_b6315753-e1ec-46a4-b5d6-8506b92d0da5.png",
    caption:
      "Slow, outdated, confusing means people leave in 3 seconds. Save this if your site needs a rescue. #webdesign #smallbusinesstips #digitalmarketing #tixuy",
  },
  {
    image_url:
      "https://d8j0ntlcm91z4.cloudfront.net/user_32ZgfZc2L6tfBGBRTWykhhaFcP4/hf_20260912_103814_d1a1a86d-afdd-4d56-913d-ef68cc4ab742.png",
    caption:
      "Posting once a month is not a strategy. Tag the business owner who needs to hear this. #socialmediamarketing #smallbusiness #tixuy",
  },
  {
    image_url:
      "https://d8j0ntlcm91z4.cloudfront.net/user_32ZgfZc2L6tfBGBRTWykhhaFcP4/hf_20260912_103813_f28f796c-7eae-4983-87e0-7ba4cf582370.png",
    caption:
      "One free growth tip. Save it, test it, watch your reach. Comment PLAYBOOK for the full guide. #instagramgrowth #marketingtips #tixuy",
  },
  {
    image_url:
      "https://d8j0ntlcm91z4.cloudfront.net/user_32ZgfZc2L6tfBGBRTWykhhaFcP4/hf_20260912_103813_cedf613a-e483-4186-8089-eb63004fc9ed.png",
    caption:
      "Strategy plus consistency equals growth. Your account could be next. #socialmediagrowth #smallbusinessuk #tixuy",
  },
];

export default defineWorkflow({
  id: "tixuy-publish-csraoul",
  name: "Tixuy — Publish csraoul Posts to Instagram",
  n8nId: "efe1lRM0obXwOp5c",
  brand: "tixuy",
  description:
    "Publishes the 6 csraoul images to @tix_uy: resolve Tixuy Page token, then per image Cloudinary-upload as JPEG, create IG container, wait, publish.",
  trigger: "manual",
  enabled: true,

  async run(ctx) {
    const igUserId = env.igAccountOptional("tixuy") || TIXUY_IG_USER_ID;

    // Resolve the Page access token from /me/accounts (Page named "Tixuy").
    const page = await resolvePageToken("Tixuy");
    await ctx.log("page:resolved", { pageId: page.id, name: page.name });

    // Account guard — don't post to the wrong IG account.
    await assertAccount(igUserId, TIXUY_IG_USER_ID, page.access_token);

    const published: string[] = [];
    for (let i = 0; i < POSTS.length; i++) {
      const post = POSTS[i];
      await ctx.log("post:begin", { index: i + 1, of: POSTS.length });

      const jpegUrl = await cloudinaryJpeg(post.image_url);
      await ctx.log("post:cloudinary", { index: i + 1, jpegUrl });

      const { mediaId } = await publishSingleImage({
        igUserId,
        imageUrl: jpegUrl,
        caption: post.caption,
        waitMs: 15_000,
        accessToken: page.access_token,
      });
      published.push(mediaId);
      await ctx.log("post:published", { index: i + 1, mediaId });
    }

    return {
      summary: `Published ${published.length} csraoul posts to @tix_uy`,
      data: { mediaIds: published },
    };
  },
});
