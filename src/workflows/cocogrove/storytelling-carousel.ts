import sharp from "sharp";
import { defineWorkflow } from "../types";
import { env } from "@/lib/env";
import { httpJson, sleep } from "@/lib/http";
import {
  createCarouselItem,
  createCarouselContainer,
  publishContainer,
} from "@/lib/instagram";
import { cloudinaryJpeg } from "@/lib/cloudinary";
import { generateImage, generateJson } from "@/lib/openai";
import { sendEmail } from "@/lib/email";

/**
 * Faithful port of n8n "CocoGrove Storytelling Carousel" (9Pdt1dsLYfaAWmVu).
 *
 * Schedule: "Daily 09:00 Trigger" at 09:00 Europe/London (also has a manual
 * Start). Oct = BST = UTC+1 -> 08:00 UTC -> cron "0 8 * * *".
 *
 * Flow: Get /me/accounts -> Select CocoGrove Page (name includes "cocogrove",
 * else first) -> Generate Story Content (LangChain agent, gpt-5-mini, 5-slide
 * JSON) -> Prepare Story Content -> for each slide: Generate Slide Image
 * (gpt-image-1) -> Add Nostalgic Text Overlay (translucent lower-third band +
 * caption text, NO logo) -> Upload to Cloudinary (JPEG) -> Create Carousel Item
 * container -> Wait 10s -> Aggregate ids -> Create Carousel Container (caption +
 * hashtags) -> Wait 10s -> Check status -> FINISHED ? Publish + permalink +
 * success email : failure alert email.
 *
 * NOTE (prompt): the live agent node runs the top-level generic "Kerala roots ->
 * Eastbourne" system message + static "...right now." user text (what n8n's
 * agent node actually reads, and what the sticky note describes). A newer,
 * un-wired "weekly specials" system+user variant is nested under an extra
 * `parameters.parameters` key the node does not read; it is NOT reproduced here.
 * See the migration report for that variant.
 *
 * NOTE (watermark): per the owner's 2026-09-15 change the CocoGrove logo /
 * coconut-leaf mark is NO LONGER composited. The only overlay is the n8n
 * "Edit Image" nostalgic caption band: a translucent black lower-third
 * rectangle (#00000099), a thin #F2A65A accent bar, and the slide caption in
 * #F6E7C1 with a dark #1F1108 outline (the n8n node faked the outline with 9
 * offset dark copies + 1 light copy; reproduced here with an SVG stroke).
 * ImageMagick's default font was used in n8n (unspecified); a serif is used here.
 */

// CocoGrove IG Business Account ID (from the Facebook Graph nodes).
const COCOGROVE_IG_USER_ID = "17841461430625142";

// n8n Gmail recipient for this workflow (Send Success Email / Send Failure Alert).
const REPORT_RECIPIENT = env.reportTo() || "shibile504@gmail.com";

const GRAPH = () => `https://graph.facebook.com/${env.graphVersion()}`;

const STORY_SYSTEM_MESSAGE =
  "You are the storyteller for CocoGrove Kerala Kitchen, an authentic Kerala/South Indian restaurant at 146 Seaside Road, Eastbourne (trading as FoodOasis Ltd). Your voice is warm, authentic, family-run and proud but never salesy - like sharing your own family's story with a neighbour, with genuine Eastbourne local charm.\n\nYour task: write ONE Instagram STORYTELLING carousel of exactly 5 slides that tells the emotional journey of CocoGrove - from its Kerala roots to its home today on the Eastbourne seafront - as a photo-essay, not a listicle or sales pitch. Slide 1 opens the story with a warm, specific hook rooted in Kerala (a kitchen, a family recipe, a spice market, a memory) - something that makes someone stop scrolling in the first half-second. Slides 2-4 continue the journey in order (for example: the recipes and traditions carried forward, the move from Kerala to Eastbourne, what makes the food special today) - each slide should feel like the next page of a short, heartfelt story, never a separate disconnected tip. Slide 5 closes the story with a warm, inviting call to visit or taste it for themselves - never pushy or salesy.\n\nFor each slide write exactly two things:\n1) SLIDE CAPTION (the on-image overlay text): a short, MEMORABLE and deeply NOSTALGIC phrase, 3-6 words, evocative like a subtitle in a documentary (for example 'Kerala, where it began'). This exact phrase is overlaid directly on the photo in a translucent lower-third caption band, so keep it punchy, universally resonant, and free of hashtags/emoji/heavy punctuation - it should read like a single memorable line someone would want to screenshot or quote.\n2) IMAGE PROMPT: a detailed prompt for an ULTRA-REALISTIC photograph. This must NOT look like typical AI-generated 'plastic'/CGI/airbrushed imagery, and it must NOT look like a flat, static, generic stock-photo of 'food plated on a table'. Explicitly write the prompt as real documentary/editorial food photography with a bold, trending-on-Instagram-right-now visual energy: name a realistic camera and lens (e.g. 'shot on a Sony A7IV with a 35mm f/1.4 lens' or similar full-frame documentary look), natural warm golden-hour light, shallow depth of field, visible authentic food and skin texture, natural film grain, slightly imperfect/candid framing - and explicitly instruct 'avoid CGI, avoid glossy/plastic/airbrushed AI look, avoid overly smooth or synthetic skin and surfaces, avoid illustration or cartoon style'. Make each of the 5 images visually distinct and scroll-stopping: use dynamic, editorial moments and angles rather than a static plated dish on a plain table - for example steam or smoke curling off the food, a mid-pour or mid-scoop action shot, hands caught mid-gesture, a dramatic high-angle flat-lay with bold negative space, or an extreme macro close-up on texture (spice grains, banana leaf, crisped edges, glistening curry). Vary the composition style across all 5 slides so the carousel feels curated and cinematic rather than repetitive. Still compose the photo with a relatively uncluttered lower third (not extremely busy/detailed down there) so the caption band can be legibly overlaid there afterward. Keep a consistent warm, golden-hour visual mood and color grading across all 5 images so they read as one cohesive photo essay. Never depict a specific named real person; if a person is needed use generic, non-identifiable descriptions such as 'a home cook's hands', or a person shown from behind or with their face not the focus. Do NOT describe any on-image text, logo, or brand mark in the image prompt itself - no logo is composited onto these images, and the caption text is layered on separately after the photo is generated.\n\nAlso write:\n- A warm Instagram CAPTION (the post's written caption, separate from the on-image slide captions) structured for reach and engagement: open with a strong, scroll-stopping first line/hook, follow with 2-4 heartfelt sentences of story (don't just repeat the slide captions verbatim), and close with a genuine, warm call-to-action that invites comments, saves, shares or tags (for example asking people to tag someone who'd love this, share which slide resonated most, or save it for their next visit) - Instagram's algorithm rewards saves, shares, comments and re-watches, so earn those naturally through genuine emotional resonance, never spammy engagement-bait phrasing.\n- 12-18 hashtags mixing broad food-community tags, Eastbourne-local tags (like #EastbourneEats, #EastbourneFood), and Kerala/South Indian cuisine tags (like #KeralaFood, #SouthIndianFood, #KeralaCuisine) to maximise discoverability.\n\nReturn ONLY the structured JSON with fields topic, caption, hashtags, and slides (exactly 5 objects, each with caption and imagePrompt).";

const STORY_USER_TEXT =
  "Write a heartfelt Instagram storytelling carousel for CocoGrove right now.";

interface Slide {
  caption: string;
  imagePrompt: string;
}
interface StoryOutput {
  topic: string;
  caption: string;
  hashtags: string | string[];
  slides: Slide[];
}

interface FacebookPage {
  id: string;
  name: string;
  access_token: string;
}

/** Faithful "Select CocoGrove Page": name includes "cocogrove", else first page. */
async function selectCocogrovePage(): Promise<FacebookPage> {
  const url = `${GRAPH()}/me/accounts?fields=id,name,access_token&access_token=${env.igAccessToken()}`;
  const body = await httpJson<{ data: FacebookPage[] }>(url);
  const items = body.data || [];
  if (!items.length) {
    throw new Error("No Facebook Pages found on this CocoGrove Facebook Graph credential.");
  }
  const match = items.find((p) => (p.name || "").toLowerCase().includes("cocogrove"));
  return match || items[0];
}

// --- Nostalgic caption overlay (faithful to the "Edit Image" node) -----------

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Word-wrap to ~18 chars/line, matching the n8n text op's lineLength: 18. */
function wrapCaption(text: string, max = 18): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && cur.length + 1 + w.length > max) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Composite the translucent lower-third band + accent bar + caption text,
 * reproducing the n8n editImage multiStep op. Output JPEG q90, 1024x1024.
 */
async function addNostalgicTextOverlay(image: Buffer, caption: string): Promise<Buffer> {
  const W = 1024;
  const H = 1024;
  const fontSize = 62;
  const lineHeight = 74;
  const startY = 830; // positionY of the caption text in the n8n node
  const lines = wrapCaption(caption, 18);

  const textSvg = lines
    .map(
      (ln, i) =>
        `<text x="60" y="${startY + i * lineHeight}" ` +
        `font-family="Georgia, 'Times New Roman', serif" font-size="${fontSize}" ` +
        `font-weight="700" fill="#F6E7C1" stroke="#1F1108" stroke-width="6" ` +
        `paint-order="stroke" text-anchor="start">${escapeXml(ln)}</text>`,
    )
    .join("");

  const svg =
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">` +
    // translucent black lower-third band (#00000099 ~= opacity 0.6)
    `<rect x="0" y="740" width="1024" height="284" fill="#000000" fill-opacity="0.6"/>` +
    // thin accent bar on top of the band
    `<rect x="0" y="734" width="1024" height="6" fill="#F2A65A"/>` +
    textSvg +
    `</svg>`;

  return sharp(image)
    .resize(W, H, { fit: "cover" })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function checkContainerStatus(containerId: string, pageToken: string): Promise<string> {
  const url = `${GRAPH()}/${containerId}?fields=status_code,id&access_token=${pageToken}`;
  const body = await httpJson<{ status_code?: string; id?: string }>(url);
  return body.status_code ?? "";
}

async function getPermalink(mediaId: string, pageToken: string): Promise<string> {
  const url = `${GRAPH()}/${mediaId}?fields=permalink,id&access_token=${pageToken}`;
  const body = await httpJson<{ permalink?: string }>(url);
  return body.permalink ?? "";
}

export default defineWorkflow({
  id: "cocogrove-storytelling-carousel",
  name: "CocoGrove Storytelling Carousel",
  n8nId: "9Pdt1dsLYfaAWmVu",
  brand: "cocogrove",
  description:
    "Daily 09:00 London storytelling carousel for CocoGrove's Instagram: gpt-5-mini writes a 5-slide photo-essay, gpt-image-1 renders each slide, a nostalgic caption band is composited on, then Cloudinary-upload + CAROUSEL publish, with success/failure alert emails.",
  trigger: "schedule",
  schedule: "0 8 * * *", // Daily 09:00 Europe/London (BST = UTC+1)
  enabled: true,

  async run(ctx) {
    const igUserId = env.igAccountOptional("cocogrove") || COCOGROVE_IG_USER_ID;

    // --- Get My Facebook Page -> Select CocoGrove Page ---
    const page = await selectCocogrovePage();
    const pageToken = page.access_token;
    await ctx.log("page:selected", { pageId: page.id, name: page.name });

    // --- Generate Story Content (agent, gpt-5-mini, structured JSON) ---
    const output = await generateJson<StoryOutput>({
      system: STORY_SYSTEM_MESSAGE,
      prompt: STORY_USER_TEXT,
      model: "gpt-5-mini",
    });

    // --- Prepare Story Content ---
    const topic = output.topic;
    const caption = output.caption;
    const hashtags = Array.isArray(output.hashtags)
      ? output.hashtags.join(" ")
      : output.hashtags;
    const slides = output.slides || [];
    await ctx.log("story:prepared", { topic, slideCount: slides.length });

    // --- Per slide: image -> overlay -> cloudinary -> carousel item container ---
    const containerIds: string[] = [];
    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      await ctx.log("slide:begin", { index: i + 1, of: slides.length, caption: slide.caption });

      // Generate Slide Image (gpt-image-1, high quality, 1024x1024)
      const png = await generateImage({
        prompt: slide.imagePrompt,
        size: "1024x1024",
        quality: "high",
      });

      // Add Nostalgic Text Overlay (translucent band + caption text, no logo)
      const overlaid = await addNostalgicTextOverlay(png, slide.caption);

      // Upload Slide to Cloudinary -> f_jpg,q_auto URL
      const imageUrl = await cloudinaryJpeg(overlaid);
      await ctx.log("slide:cloudinary", { index: i + 1, imageUrl });

      // Create Carousel Item Container
      const id = await createCarouselItem(igUserId, imageUrl, pageToken);
      containerIds.push(id);
      await ctx.log("slide:container", { index: i + 1, containerId: id });
    }

    // Wait For Items Processing (10s)
    await sleep(10_000);

    // --- Create Carousel Container (caption + "\n\n" + hashtags) ---
    const carouselCaption = `${caption}\n\n${hashtags}`;
    const carouselId = await createCarouselContainer(igUserId, containerIds, carouselCaption, pageToken);
    await ctx.log("carousel:created", { carouselId, children: containerIds.length });

    // Wait For Carousel Processing (10s) -> Check Carousel Status
    await sleep(10_000);
    const statusCode = await checkContainerStatus(carouselId, pageToken);
    await ctx.log("carousel:status", { statusCode });

    // --- Carousel Ready? (status_code === "FINISHED") ---
    if (statusCode !== "FINISHED") {
      // Send Failure Alert
      await sendEmail({
        to: REPORT_RECIPIENT,
        subject: "CocoGrove storytelling carousel failed — media container not ready",
        html:
          `<p>The CocoGrove Instagram carousel container did not finish processing in time.</p>` +
          `<p><strong>Status:</strong> ${statusCode}</p>` +
          `<p><strong>Container ID:</strong> ${carouselId}</p>` +
          `<p>Open the Meta Graph API Explorer to check manually, or re-run this workflow — you may need to increase the Wait node delay.</p>`,
      });
      await ctx.log("carousel:failure-alert", { to: REPORT_RECIPIENT, statusCode });
      return {
        summary: `CocoGrove storytelling carousel NOT published — container status ${statusCode}`,
        data: { topic, carouselId, statusCode, published: false },
      };
    }

    // --- Publish Carousel -> Get Post Permalink ---
    const mediaId = await publishContainer(igUserId, carouselId, pageToken);
    const permalink = await getPermalink(mediaId, pageToken);
    await ctx.log("carousel:published", { mediaId, permalink });

    // --- Send Success Email ---
    await sendEmail({
      to: REPORT_RECIPIENT,
      subject: `✅ CocoGrove storytelling carousel published: ${topic}`,
      html:
        `<h3>CocoGrove Instagram storytelling carousel published</h3>` +
        `<p><strong>Topic:</strong> ${topic}</p>` +
        `<p><strong>Caption:</strong><br>${caption}</p>` +
        `<p><strong>Hashtags:</strong><br>${hashtags}</p>` +
        `<p><strong>Slides:</strong> ${slides.length}</p>` +
        `<p><strong>Post:</strong> <a href="${permalink}">${permalink}</a></p>`,
    });
    await ctx.log("email:sent", { to: REPORT_RECIPIENT });

    return {
      summary: `Published CocoGrove storytelling carousel (${slides.length} slides): ${topic}`,
      data: { topic, mediaId, permalink, slides: slides.length, published: true },
    };
  },
});
