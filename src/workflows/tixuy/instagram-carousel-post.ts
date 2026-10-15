import { defineWorkflow } from "../types";
import { env } from "@/lib/env";
import {
  resolvePageToken,
  assertAccount,
  createCarouselItem,
  createCarouselContainer,
  waitForContainer,
  publishContainer,
} from "@/lib/instagram";
import { cloudinaryJpeg } from "@/lib/cloudinary";
import { generateImage, generateJson } from "@/lib/openai";
import { sendEmail } from "@/lib/email";
import { appendRow } from "@/lib/sheets";
import { sleep } from "@/lib/http";

/**
 * Faithful port of n8n "Tixuy Instagram Carousel Post" (pWpa8Pw5NlMM6q36).
 *
 * Manual, high-reach 5-slide carousel for @tix_uy. Flow:
 *   Manual -> GET /me/accounts -> select Page "Tixuy"
 *   -> AI agent (gpt-5-mini) writes topic/caption/hashtags + 5 slides
 *      (headline + imagePrompt), structured output
 *   -> per slide: gpt-image-1 generate (1024x1024, medium) -> Cloudinary JPEG
 *      -> create carousel-item container
 *   -> aggregate item ids -> create CAROUSEL container -> Wait 10s
 *   -> check status -> if FINISHED publish, log to sheet, email success;
 *      else email failure.
 */

const TIXUY_IG_USER_ID = "17841472867696210";
const CONTENT_LOG_SHEET_ID = "1o3m_aSPGJ3-f-GjIO7dtKM8anJvvCGb63fVTAlBMy3E";
const CONTENT_LOG_TAB = "Posts";
const NOTIFY_EMAIL = "partywear475@gmail.com";

// Generate Carousel Content — AI Agent system message (verbatim from n8n).
const SYSTEM_MESSAGE =
  "You are the social media growth strategist for Tixuy, a full-service IT & digital agency (websites, AI solutions, branding, digital marketing, social media management, SaaS development) for small and growing businesses. Your voice is relatable, witty, approachable tech/agency humor - never stiff or corporate. Your task: design ONE Instagram CAROUSEL post engineered for maximum reach, saves and shares, because Instagram's algorithm rewards swipe-through completion, saves and shares far more than likes. Use the proven high-performing format: exactly 5 slides - Slide 1 is a scroll-stopping HOOK that states a relatable pain point or surprising claim (not a giveaway of the full answer, so people swipe); Slides 2-4 are punchy, standalone VALUE points (tips, mistakes to avoid, or signs of a problem) related to the hook, each with a short bold headline (under 8 words) that alone conveys value even without reading the caption; Slide 5 is a strong CTA slide (e.g. 'Save this for later', 'DM us AUDIT for a free check', or similar) that also invites saves/shares. Pick a topic small business owners genuinely care about (e.g. website mistakes, branding red flags, social media myths, conversion killers, AI tools for small biz) and make it specific and a little provocative, not generic. For each slide, write BOTH the exact short headline text AND a detailed, vivid square (1:1) image prompt for an AI image generator - the image prompt MUST explicitly instruct that the slide's headline text be rendered clearly and boldly on the image itself (since these are text-forward infographic-style carousel slides), and MUST specify a consistent visual style across all 5 slides (same color palette: Tixuy teal, coral and navy accents; same illustration/photo style; same layout logic e.g. bold headline top or center, supporting visual below) so the carousel feels like one cohesive branded set, not five unrelated images. Also write: a scroll-stopping caption (2-4 sentences, conversational, 1-2 emoji max) that does NOT repeat the slide text verbatim, ends with an explicit prompt to save, share, or comment (this drives the reach-boosting signals), and 15-20 hashtags mixing broad reach tags with specific niche/local tags. Return ONLY the structured JSON with fields topic, caption, hashtags, and slides (exactly 5 objects, each with headline and imagePrompt).";

const USER_PROMPT = "Create a high-reach Instagram carousel post for Tixuy right now.";

// Structured-output shape expected by the n8n output parser (Carousel Format).
const JSON_SCHEMA_EXAMPLE =
  '{ "topic": "5 signs your website is losing you customers", "caption": "Scroll-stopping 2-4 sentence caption ending with a save/share/comment prompt", "hashtags": "15-20 space separated hashtags mixing broad and niche tags", "slides": [ { "headline": "Short bold hook headline for slide 1 (under 8 words)", "imagePrompt": "Detailed square image prompt including the exact headline text rendered boldly on the image, consistent teal/coral/navy Tixuy brand style, photorealistic-flat blend" }, { "headline": "Point 1 headline", "imagePrompt": "..." }, { "headline": "Point 2 headline", "imagePrompt": "..." }, { "headline": "Point 3 headline", "imagePrompt": "..." }, { "headline": "Strong CTA headline for final slide", "imagePrompt": "..." } ] }';

interface CarouselSlide {
  headline: string;
  imagePrompt: string;
}
interface CarouselContent {
  topic: string;
  caption: string;
  hashtags: string | string[];
  slides: CarouselSlide[];
}

export default defineWorkflow({
  id: "tixuy-instagram-carousel-post",
  name: "Tixuy Instagram Carousel Post",
  n8nId: "pWpa8Pw5NlMM6q36",
  brand: "tixuy",
  description:
    "Manual 5-slide reach-optimized carousel for @tix_uy: gpt-5-mini writes the copy + per-slide image prompts, gpt-image-1 renders each slide, Cloudinary-JPEG, publish, log to the Instagram Content Log sheet and email success/failure.",
  trigger: "manual",
  enabled: true,

  async run(ctx) {
    const igUserId = env.igAccountOptional("tixuy") || TIXUY_IG_USER_ID;

    // Get My Facebook Page -> Select Tixuy Page.
    const page = await resolvePageToken("Tixuy");
    await ctx.log("page:resolved", { pageId: page.id, name: page.name });

    // Account guard.
    await assertAccount(igUserId, TIXUY_IG_USER_ID, page.access_token);

    // Generate Carousel Content (gpt-5-mini, structured output: topic/caption/hashtags/5 slides).
    const content = await generateJson<CarouselContent>({
      system: SYSTEM_MESSAGE + "\n\nReturn ONLY JSON matching this shape:\n" + JSON_SCHEMA_EXAMPLE,
      prompt: USER_PROMPT,
      model: "gpt-5-mini",
    });
    const slides = content.slides ?? [];
    if (slides.length !== 5) {
      throw new Error(`Expected exactly 5 slides from the generator, got ${slides.length}`);
    }
    const hashtags = Array.isArray(content.hashtags) ? content.hashtags.join(" ") : content.hashtags;
    await ctx.log("content:generated", { topic: content.topic, slides: slides.length });

    // Per slide: generate image -> Cloudinary JPEG -> create carousel-item container.
    const containerIds: string[] = [];
    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const buffer = await generateImage({
        prompt: slide.imagePrompt,
        size: "1024x1024",
        quality: "medium",
      });
      const imageUrl = await cloudinaryJpeg(buffer);
      const itemId = await createCarouselItem(igUserId, imageUrl, page.access_token);
      containerIds.push(itemId);
      await ctx.log("slide:item-created", { index: i + 1, itemId, imageUrl });
    }

    const fullCaption = content.caption + "\n\n" + hashtags;

    // Wait For Items Processing (10s) -> Aggregate -> Create Carousel Container.
    await sleep(10_000);
    const carouselId = await createCarouselContainer(igUserId, containerIds, fullCaption, page.access_token);
    await ctx.log("carousel:container-created", { carouselId, children: containerIds });

    // Wait For Carousel Processing (10s) -> Check Carousel Status -> Carousel Ready?
    await sleep(10_000);
    try {
      await waitForContainer(carouselId, { intervalMs: 1, maxAttempts: 1 }, page.access_token);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      await sendEmail({
        to: NOTIFY_EMAIL,
        subject: "Instagram carousel post failed — media container not ready",
        html: `<p>The Instagram carousel container did not finish processing in time.</p><p><strong>Status:</strong> ${reason}</p><p><strong>Container ID:</strong> ${carouselId}</p><p>Open the Meta Graph API Explorer to check manually, or re-run this workflow — you may need to increase the Wait node delay.</p>`,
      });
      return {
        summary: "Tixuy carousel failed — container not ready in time",
        data: { carouselId, reason },
      };
    }

    // Publish Carousel.
    const postId = await publishContainer(igUserId, carouselId, page.access_token);
    await ctx.log("carousel:published", { postId });

    // Log Published Carousel. Header: Date, Topic, Caption, Hashtags, ImagePrompt, ImageURL, PostID, Status
    await appendRow(CONTENT_LOG_SHEET_ID, CONTENT_LOG_TAB, [
      new Date().toISOString(),
      content.topic,
      content.caption,
      hashtags,
      "5-slide carousel: " + slides.map((s) => s.headline).join(" | "),
      containerIds.join(", "),
      postId,
      "Published (Carousel)",
    ]);
    await ctx.log("sheet:logged", {});

    // Send Success Email.
    await sendEmail({
      to: NOTIFY_EMAIL,
      subject: "✅ Instagram carousel published: " + content.topic,
      html: `<h3>Instagram carousel published 🎉</h3><p><strong>Topic:</strong> ${content.topic}</p><p><strong>Caption:</strong><br>${content.caption}</p><p><strong>Hashtags:</strong><br>${hashtags}</p><p><strong>Slides:</strong> ${slides.length}</p><p><strong>Post ID:</strong> ${postId}</p>`,
    });

    return {
      summary: `Published Tixuy 5-slide carousel to @tix_uy (${postId})`,
      data: { postId, topic: content.topic, containerIds },
    };
  },
});
