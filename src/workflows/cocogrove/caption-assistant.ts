import { defineWorkflow } from "../types";
import { env } from "@/lib/env";
import { generateJson } from "@/lib/openai";
import { sendEmail } from "@/lib/email";

/**
 * Faithful port of n8n "CocoGrove Caption Assistant" (MKsFybxzjq1qGpjR).
 *
 * Form trigger ("New Caption Request") -> Draft Caption (LangChain agent,
 * gpt-5-mini, structured JSON: caption / hashtags / postingTip) -> Send Caption
 * for Review (Gmail, HTML). This workflow does NOT post to Instagram; it emails
 * a draft for a human to post manually with a real food photo.
 *
 * Form fields (read from ctx.input): dishName (required), context,
 * occasionOrOffer, postType (dropdown: New dish / Daily special / Regular post /
 * Event or offer / Behind the scenes).
 */

// n8n Gmail recipient (Send Caption for Review -> shibile504@gmail.com).
const REVIEW_RECIPIENT = env.reportTo() || "shibile504@gmail.com";

const CAPTION_SYSTEM_MESSAGE =
  "You are the social media caption writer for CocoGrove, a Kerala/South Indian restaurant in Eastbourne (trading as FoodOasis Ltd, 146 Seaside Road, Eastbourne). Your voice is warm, authentic and proud of real South Indian home-style cooking - like a family-run kitchen sharing food made with love, not a generic restaurant chain. Write like you're inviting a neighbour in Eastbourne to try something delicious, with genuine warmth and local charm. Avoid generic restaurant marketing cliches such as 'mouth-watering' or 'to die for', and don't oversell - let the authenticity and craft speak for itself. Given a dish/topic and optional context from staff, produce: 1) a warm, inviting Instagram caption (2-4 sentences) that shares a small story or detail about the dish (its Kerala/South Indian roots, how it's made, what makes it special) and ends with a soft, natural call-to-action such as inviting people to visit or order, 2) 8-15 relevant hashtags mixing broad food/restaurant tags with specific and local ones (for example #KeralaFood, #SouthIndianFood, #EastbourneEats, #EastbourneFood, #KeralaCuisine), 3) one short practical posting tip for whoever posts this, such as a photo angle/lighting suggestion for this dish or the best time to post. Return ONLY the structured JSON.";

interface CaptionDraft {
  caption: string;
  hashtags: string;
  postingTip: string;
}

export default defineWorkflow({
  id: "cocogrove-caption-assistant",
  name: "CocoGrove Caption Assistant",
  n8nId: "MKsFybxzjq1qGpjR",
  brand: "cocogrove",
  description:
    "Staff submit a dish/post topic via a form; gpt-5-mini drafts an Instagram caption + hashtags + a posting tip in CocoGrove's brand voice; the draft is emailed for review and manual posting. Does not post automatically.",
  trigger: "form",
  enabled: true,

  async run(ctx) {
    const input = (ctx.input ?? {}) as Record<string, unknown>;
    const dishName = String(input.dishName ?? "");
    const context = String(input.context ?? "");
    const occasionOrOffer = String(input.occasionOrOffer ?? "");
    const postType = String(input.postType ?? "");
    await ctx.log("form:received", { dishName, postType });

    // --- Draft Caption ---
    const userText =
      `Dish or post topic: ${dishName}\n` +
      `Context/details: ${context}\n` +
      `Occasion, offer or CTA: ${occasionOrOffer}\n` +
      `Post type: ${postType}`;

    const draft = await generateJson<CaptionDraft>({
      system: CAPTION_SYSTEM_MESSAGE,
      prompt: userText,
      model: "gpt-5-mini",
    });
    await ctx.log("caption:drafted", { dishName });

    // --- Send Caption for Review (HTML email) ---
    const subject = `New CocoGrove caption draft: ${dishName}`;
    const html =
      `<h2>CocoGrove Instagram Caption Draft</h2>` +
      `<p><strong>Topic:</strong> ${dishName}</p>` +
      `<p><strong>Post type:</strong> ${postType}</p><hr/>` +
      `<p style="white-space:pre-wrap;">${draft.caption}</p>` +
      `<p><strong>Hashtags:</strong><br/>${draft.hashtags}</p>` +
      `<h3>Posting tip</h3><p>${draft.postingTip}</p>` +
      `<p style="color:#888;font-size:12px;">Review this draft, then post it manually to Instagram with a real photo of the dish. This workflow does not post automatically.</p>`;
    await sendEmail({ to: REVIEW_RECIPIENT, subject, html });
    await ctx.log("email:sent", { to: REVIEW_RECIPIENT });

    return {
      summary: `Drafted + emailed CocoGrove caption for "${dishName}"`,
      data: { dishName, postType, ...draft },
    };
  },
});
