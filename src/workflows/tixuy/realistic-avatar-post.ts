import { defineWorkflow } from "../types";
import { env } from "@/lib/env";
import {
  resolvePageToken,
  assertAccount,
  createImageContainer,
  waitForContainer,
  publishContainer,
} from "@/lib/instagram";
import { cloudinaryJpeg } from "@/lib/cloudinary";
import { generateImage } from "@/lib/openai";
import { sendEmail } from "@/lib/email";
import { appendRow } from "@/lib/sheets";
import { sleep } from "@/lib/http";

/**
 * Faithful port of n8n "Tixuy Realistic Avatar Post" (4GiwRSStByEzDrDQ).
 *
 * Manual one-off: introduces an ultra-realistic AI-generated avatar as a new
 * realistic "face" for Tixuy. Flow:
 *   Manual -> GET /me/accounts -> select Page "Tixuy" -> prepare copy
 *   -> gpt-image-1 generate (1024x1024, high) -> Cloudinary JPEG
 *   -> create IG media container -> Wait 10s -> check status
 *   -> if FINISHED publish, log to sheet, email success; else email failure.
 */

const TIXUY_IG_USER_ID = "17841472867696210";
const CONTENT_LOG_SHEET_ID = "1o3m_aSPGJ3-f-GjIO7dtKM8anJvvCGb63fVTAlBMy3E";
const CONTENT_LOG_TAB = "Posts";
const NOTIFY_EMAIL = "partywear475@gmail.com";

// Prepare Post Content (verbatim from the n8n Set node).
const TOPIC = "Meet the realistic face of Tixuy";
const CAPTION =
  'Meet the newest addition to the Tixuy universe 👋 Behind every AI-powered website, brand or campaign we ship, there\'s a real strategy (and a lot of very patient AI) making it happen. This is what that looks like on a good day. Curious what AI + a great team could build for your business? Drop a comment or DM us "AI" and let\'s talk.';
const HASHTAGS =
  "#AI #DigitalAgency #WebDesign #Branding #SmallBusinessMarketing #TechAgency #AIforBusiness #CreativeTechnology #DigitalMarketing #StartupTools #SaaS #AIAutomation #AgencyLife #FutureOfWork #TixuyAI";
const IMAGE_PROMPT =
  "Ultra-realistic professional photograph of a confident young digital creative technologist sitting at a sleek minimalist desk in a modern tech studio, warm late-afternoon key light mixed with cool teal ambient rim lighting, dual monitors glowing with abstract UI and code interfaces in indigo-violet and teal tones, a soft coral accent light glowing in the background, shallow depth of field, shot on a professional camera with natural skin texture, realistic pores and fabric detail, true photographic realism, editorial commercial photography style, no text overlay, no illustration or cartoon style, square 1:1 composition";

export default defineWorkflow({
  id: "tixuy-realistic-avatar-post",
  name: "Tixuy Realistic Avatar Post",
  n8nId: "4GiwRSStByEzDrDQ",
  brand: "tixuy",
  description:
    "Manual one-off: generate an ultra-realistic Tixuy avatar with gpt-image-1, Cloudinary-JPEG it, publish to @tix_uy, log to the Instagram Content Log sheet and email success/failure.",
  trigger: "manual",
  enabled: true,

  async run(ctx) {
    const igUserId = env.igAccountOptional("tixuy") || TIXUY_IG_USER_ID;

    // Get My Facebook Page -> Select Tixuy Page.
    const page = await resolvePageToken("Tixuy");
    await ctx.log("page:resolved", { pageId: page.id, name: page.name });

    // Account guard.
    await assertAccount(igUserId, TIXUY_IG_USER_ID, page.access_token);

    // Generate Avatar Image (gpt-image-1, quality high, 1024x1024).
    const imageBuffer = await generateImage({
      prompt: IMAGE_PROMPT,
      size: "1024x1024",
      quality: "high",
    });
    await ctx.log("image:generated", { bytes: imageBuffer.length });

    // Upload to Cloudinary -> Extract Image URL (f_jpg,q_auto JPEG).
    const imageUrl = await cloudinaryJpeg(imageBuffer);
    await ctx.log("cloudinary:uploaded", { imageUrl });

    const fullCaption = CAPTION + "\n\n" + HASHTAGS;

    // Create Media Container.
    const creationId = await createImageContainer(igUserId, imageUrl, fullCaption, page.access_token);
    await ctx.log("container:created", { creationId });

    // Wait For Container Processing (10s) -> Check Container Status -> Container Ready?
    await sleep(10_000);
    try {
      await waitForContainer(creationId, { intervalMs: 1, maxAttempts: 1 }, page.access_token);
    } catch (e) {
      // Container Ready? == false -> Send Failure Alert.
      const reason = e instanceof Error ? e.message : String(e);
      await ctx.log("container:not-ready", { creationId, reason });
      await sendEmail({
        to: NOTIFY_EMAIL,
        subject: "Tixuy avatar post failed — media container not ready",
        html: `<p>The media container did not finish processing in time.</p><p><strong>Status:</strong> ${reason}</p><p><strong>Container ID:</strong> ${creationId}</p>`,
      });
      return {
        summary: "Tixuy avatar post failed — container not ready in time",
        data: { creationId, reason },
      };
    }

    // Publish Media.
    const postId = await publishContainer(igUserId, creationId, page.access_token);
    await ctx.log("post:published", { postId });

    // Log Published Post (Instagram Content Log -> Posts).
    // Header order: Date, Topic, Caption, Hashtags, ImagePrompt, ImageURL, PostID, Status
    await appendRow(CONTENT_LOG_SHEET_ID, CONTENT_LOG_TAB, [
      new Date().toISOString(),
      TOPIC,
      CAPTION,
      HASHTAGS,
      IMAGE_PROMPT,
      imageUrl,
      postId,
      "Published",
    ]);
    await ctx.log("sheet:logged", {});

    // Send Success Email.
    await sendEmail({
      to: NOTIFY_EMAIL,
      subject: "✅ Tixuy realistic avatar post published",
      html: `<h3>Tixuy realistic avatar post published 🎉</h3><p><strong>Caption:</strong><br>${CAPTION}</p><p><strong>Hashtags:</strong><br>${HASHTAGS}</p><p><strong>Post ID:</strong> ${postId}</p>`,
    });

    return {
      summary: `Published Tixuy realistic avatar post to @tix_uy (${postId})`,
      data: { postId, imageUrl },
    };
  },
});
