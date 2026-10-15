import { defineWorkflow } from "../types";
import { generateJson } from "@/lib/openai";
import { sendEmail } from "@/lib/email";
import { getState, setState } from "@/lib/logger";

/**
 * Faithful port of n8n "Nia Nova - Daily TikTok Content Brief" (MrMYNyT1swfeUqkA).
 *
 * Daily 9am (Europe/London) schedule -> builds the canonical Nia Nova identity
 * registry -> AI Agent (OpenAI GPT-4o, temp 0.9, structured output parser)
 * generates one on-brand brief -> emails it AND prepares a generation request
 * (reference-media params) -> dedupes on content_key -> saves to the content
 * queue -> quotes generation cost on Higgsfield (MCP).
 *
 * Schedule: n8n cron "0 9 * * *" in Europe/London. October = BST (UTC+1), so
 * 09:00 London = 08:00 UTC -> "0 8 * * *".
 *
 * NOT PORTED: "Higgsfield - Quote Only" (MCP estimate_video_cost against
 * https://mcp.higgsfield.ai/mcp) — external MCP server, no shared-lib client.
 * Current quote noted in n8n: 10s / 720p / 9:16 / Omni Flash 1.1 = 30 credits.
 * See // TODO. Recurring spending is NOT authorized.
 */

const WORKFLOW_ID = "nianova-daily-tiktok-brief";
const EMAIL_TO = "partywear475@gmail.com";

// === Nia Nova Identity References — canonical registry, verbatim ===========
const NIA_IDENTITY = {
  version: "nia-nova-2026-10-04",
  name: "Nia Nova",
  purpose: "Identity references only; do not publish these source portraits as daily posts.",
  primary_reference_media_id: "87944f99-2ab0-48a2-a351-c16529719158",
  reference_images: [
    {
      filename: "ChatGPT Image Sep 27, 2026, 12_23_17 PM-2(1).png",
      library_file_id: "libfile_31a7def61250819184af65dd55ee62e8",
      higgsfield_media_id: "b1e83ee6-0ac7-4bf7-89da-3338b8d722ad",
      role: "three-quarter portrait",
    },
    {
      filename: "ChatGPT Image Sep 27, 2026, 12_23_17 PM-1(1).png",
      library_file_id: "libfile_0b5c8ed9bdbc819181f983ef78daf549",
      higgsfield_media_id: "87944f99-2ab0-48a2-a351-c16529719158",
      role: "primary frontal portrait",
    },
    {
      filename: "ChatGPT Image Sep 27, 2026, 12_23_18 PM-4.png",
      library_file_id: "libfile_36bdeaca228481919b97e4997b38f518",
      higgsfield_media_id: "fdafec01-923a-4d3b-bc4c-93a057e50065",
      role: "left-facing profile",
    },
    {
      filename: "ChatGPT Image Sep 27, 2026, 12_23_21 PM-9(1).png",
      library_file_id: "libfile_7cc4eae619cc8191a676fc5741950674",
      higgsfield_media_id: "55440d78-252f-4741-9460-2bb7a82cc640",
      role: "right-facing profile",
    },
    {
      filename: "ChatGPT Image Sep 27, 2026, 12_23_19 PM-6(1).png",
      library_file_id: "libfile_c8712bf696b88191919286ed7bf24d75",
      higgsfield_media_id: "bddbbaa3-9625-4b56-9b80-09d9464db978",
      role: "smiling frontal portrait",
    },
    {
      filename: "ChatGPT Image Sep 27, 2026, 12_23_18 PM-3(1).png",
      library_file_id: "libfile_b004dee79c1c81918cab248a3909f93c",
      higgsfield_media_id: "6bf8d8b0-74c7-486a-b11b-d0d5e27b5cc0",
      role: "three-quarter portrait alternate",
    },
    {
      filename: "ChatGPT Image Sep 27, 2026, 12_23_19 PM-5.png",
      library_file_id: "libfile_8d980c9b20bc819194dd7e7b6488a115",
      higgsfield_media_id: "c76ff577-2506-4382-a60b-681eaa40f9ef",
      role: "indoor upper-body proportions",
    },
    {
      filename: "ChatGPT Image Sep 27, 2026, 12_23_20 PM-7(1).png",
      library_file_id: "libfile_595e8edbeb1081918e7bd633639a9fd7",
      higgsfield_media_id: "e1228f86-43d9-41eb-a30c-905def9f857e",
      role: "outdoor upper-body proportions",
    },
  ],
  appearance:
    "Adult virtual female creator. Preserve the approved face: warm medium tan complexion and natural skin texture; brown almond-shaped eyes; thick dark eyebrows; original nose, full lips, cheekbones and jaw proportions; long centre-parted dark-brown wavy hair with caramel highlights. Preserve apparent age and body proportions. Reference pixels take precedence over this text.",
  rules: [
    "Attach actual approved image inputs to every image or video generation; mentioning the name or media IDs in prompt text is not sufficient.",
    "Use the frontal portrait as the primary identity anchor and relevant profile/smile/body reference within the model's supported image limit.",
    "Never replace the reference set with generated outputs without owner approval; this prevents accumulated identity drift.",
    "Wardrobe, location, pose, lighting and expression may vary; facial identity, complexion and hair colour remain consistent.",
    "Before publishing, compare face, hair, complexion and proportions with the references. Hold uncertain or inconsistent media for review.",
    "If reference inputs cannot be resolved, stop before paid generation; do not fall back to text-only generation.",
    "Disclose Nia Nova as a virtual AI creator.",
  ],
  generation_preference: {
    model: "Gemini Omni Flash 1.1",
    resolution: "720p",
    duration_seconds: 10,
    aspect_ratio: "9:16",
    verify_current_model_support: true,
  },
  cost_policy: {
    exact_cost_approval_required: true,
    automatic_spend_authorized: false,
  },
  instagram: {
    username: "nianova186",
    user_id: "17841423897325080",
    publisher_workflow_id: "DkITYpHDJ475cEU9",
    excluded_username: "just_viral2",
  },
  status: "References uploaded and registered. Generation-to-publishing connection is not yet implemented.",
} as const;

// === Brief Generator — system message, verbatim ============================
const SYSTEM_MESSAGE =
  'You are Nia Nova\'s creative director and content strategist. Nia is an openly AI-generated adult female creator, confident, warm, playful and slightly mischievous, for an adult audience. Create concepts across relatable POVs, challenges, transformations, reactions and visual reveals; do not restrict her to beauty.\n\nCreate one 10-second, 720p, 9:16 vertical concept with a strong opening within 1-2 seconds, one clear payoff and concise dialogue. Preferred generation model is Gemini Omni Flash 1.1, subject to verifying support and exact cost before generation. Use at most five relevant hashtags. State "Nia Nova is a virtual AI creator." Do not claim actual product use, visits or life experiences. Do not claim a topic is trending without current evidence. No research or generation tools are attached to this planning agent; do not pretend to research, see reference pixels, generate media or publish.\n\nIDENTITY: The incoming nia_identity registry is the authoritative eight-image reference set from 4 October 2026. Preserve facial proportions, warm medium tan skin, brown eyes, thick dark brows and long centre-parted dark-brown hair with caramel highlights. Every image_prompt and video_prompt must require the actual reference images as generation inputs, with primary frontal anchor and relevant supplemental views within model limits. Never use only a text description to establish identity. Do not publish reference images themselves. Do not replace reference images with newly generated outputs. Hold identity mismatches for review.\n\nAUTOMATION BOUNDARY: This workflow produces a brief only. A future generation step must resolve actual reference media, obtain explicit approval of exact model/resolution/duration/credit cost, generate one version, compare output to references, and pass approved final media to the verified @nianova186 publisher. Never set publishing or cost approval based on model output. Keep the existing output schema: title, content_pillar, concept, hook, voiceover_script, shot_list, image_prompt, video_prompt, caption, hashtags, call_to_action, ai_disclosure, safety_check. safety_check describes only this brief\'s content compliance; it is not visual identity approval or publish authorization. Return only structured output.';

// Structured output parser — jsonSchemaExample (shape the agent must return).
const OUTPUT_SCHEMA_EXAMPLE = `{
  "title": "Sunset gold to midnight silver",
  "content_pillar": "outfit choices and transformations",
  "concept": "One-tap outfit swap from a warm daytime look to a bold evening look",
  "hook": "Which Nia would you actually wear out tonight?",
  "voiceover_script": "Okay so I could not decide... daytime soft girl or after-dark it girl? Watch this. Left is comfy warm tones, right is cold-glam. Be honest, which one is going out tonight?",
  "shot_list": [
    { "timing": "0-2s", "visual": "Nia mid-frame, warm daytime outfit, quick head turn", "on_screen_text": "pick one" },
    { "timing": "2-5s", "visual": "Snap transition to midnight silver evening look", "on_screen_text": "or this?" }
  ],
  "image_prompt": "9:16 vertical portrait of Nia Nova, consistent face and hairstyle from reference, warm golden daytime outfit, soft studio light",
  "video_prompt": "Vertical 9:16, Nia Nova turns and outfit snaps from warm gold daytime look to cold silver evening glam, fast cut every 2 seconds, confident playful energy",
  "caption": "Warm girl or cold-glam girl tonight? 👀",
  "hashtags": ["#outfitcheck", "#aicreator", "#fashiontok"],
  "call_to_action": "Comment 1 or 2 for tonight",
  "ai_disclosure": "Nia Nova is a virtual AI creator.",
  "safety_check": "passed"
}`;

interface ShotListItem {
  timing: string;
  visual: string;
  on_screen_text: string;
}
interface NiaBrief {
  title: string;
  content_pillar: string;
  concept: string;
  hook: string;
  voiceover_script: string;
  shot_list: ShotListItem[];
  image_prompt: string;
  video_prompt: string;
  caption: string;
  hashtags: string[];
  call_to_action: string;
  ai_disclosure: string;
  safety_check: string;
}

function londonLongDate(d: Date): string {
  // Luxon: cccc, dd LLLL yyyy  ->  "Wednesday, 14 October 2026"
  const wd = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "Europe/London" }).format(d);
  const day = new Intl.DateTimeFormat("en-GB", { day: "2-digit", timeZone: "Europe/London" }).format(d);
  const month = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "Europe/London" }).format(d);
  const year = new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone: "Europe/London" }).format(d);
  return `${wd}, ${day} ${month} ${year}`;
}

function londonIsoDate(d: Date): string {
  // en-CA gives YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Europe/London",
  }).format(d);
}

function londonSubjectDate(d: Date): string {
  // Luxon: cccc dd LLL  ->  "Wednesday 14 Oct"
  const wd = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "Europe/London" }).format(d);
  const day = new Intl.DateTimeFormat("en-GB", { day: "2-digit", timeZone: "Europe/London" }).format(d);
  const month = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "Europe/London" }).format(d);
  return `${wd} ${day} ${month}`;
}

export default defineWorkflow({
  id: WORKFLOW_ID,
  name: "Nia Nova - Daily TikTok Content Brief",
  n8nId: "MrMYNyT1swfeUqkA",
  brand: "nianova",
  description:
    "Daily 09:00 London brief generator: GPT-4o (temp 0.9, structured output) writes one on-brand Nia Nova concept from the canonical identity registry, emails it, prepares the reference-media generation request and saves a dated row to the content queue.",
  trigger: "schedule",
  schedule: "0 8 * * *", // 09:00 Europe/London (BST, Oct) = 08:00 UTC
  enabled: true,

  async run(ctx) {
    const now = new Date();
    const identity = NIA_IDENTITY;

    // === Nia Nova Brief Generator (OpenAI GPT-4o + structured output) ======
    const userPrompt =
      `Generate one original Nia Nova short-form concept for ${londonLongDate(now)}, suitable for Instagram Reels and adaptable to TikTok. Canonical identity registry: ${JSON.stringify(
        identity,
      )}` +
      `\n\nReturn ONLY valid JSON matching exactly this shape:\n${OUTPUT_SCHEMA_EXAMPLE}`;

    await ctx.log("brief:generate", { model: "gpt-4o", temperature: 0.9 });
    const brief = await generateJson<NiaBrief>({
      system: SYSTEM_MESSAGE,
      prompt: userPrompt,
      model: "gpt-4o",
      temperature: 0.9,
    });
    await ctx.log("brief:generated", { title: brief.title, content_pillar: brief.content_pillar });

    // === Email Brief to Me (Gmail HTML template, verbatim) =================
    const shotRows = (brief.shot_list ?? [])
      .map(
        (s) =>
          `<tr><td valign=top>${s.timing}</td><td>${s.visual}</td><td>${s.on_screen_text}</td></tr>`,
      )
      .join("");
    const html = `<div style='font-family:Arial,sans-serif;font-size:14px;line-height:1.5'><h2 style='margin:0 0 4px'>${brief.title}</h2><p style='color:#888;margin:0 0 12px'>${brief.content_pillar}</p><p><strong>Concept:</strong> ${brief.concept}</p><p><strong>Hook:</strong> ${brief.hook}</p><h3>Voiceover</h3><p>${brief.voiceover_script}</p><h3>Shot list</h3><table cellpadding='6' cellspacing='0' border='1' style='border-collapse:collapse'><tr><th align='left'>Timing</th><th align='left'>Visual</th><th align='left'>On-screen text</th></tr>${shotRows}</table><h3>Image prompt</h3><p>${brief.image_prompt}</p><h3>Video prompt</h3><p>${brief.video_prompt}</p><h3>Caption</h3><p>${brief.caption}</p><p><strong>Hashtags:</strong> ${(brief.hashtags ?? []).join(" ")}</p><p><strong>CTA:</strong> ${brief.call_to_action}</p><hr><p style='color:#888;font-size:12px'>${brief.ai_disclosure} · Safety check: ${brief.safety_check}</p></div>`;
    await sendEmail({
      to: EMAIL_TO,
      subject: `Nia Nova brief · ${londonSubjectDate(now)} — ${brief.title}`,
      html,
    });
    await ctx.log("brief:emailed", { to: EMAIL_TO });

    // === Prepare Nia Generation Request (verbatim logic) ==================
    if (!brief || typeof brief.video_prompt !== "string" || !brief.video_prompt.trim()) {
      throw new Error("Missing video prompt.");
    }
    if (
      identity.instagram.username !== "nianova186" ||
      identity.instagram.user_id !== "17841423897325080"
    ) {
      throw new Error("Instagram destination mismatch.");
    }
    if (!identity.primary_reference_media_id || !Array.isArray(identity.reference_images)) {
      throw new Error("Missing canonical reference inputs.");
    }
    const refs = [
      identity.primary_reference_media_id,
      ...identity.reference_images
        .filter((r) => r.role === "three-quarter portrait" || r.role === "smiling frontal portrait")
        .map((r) => r.higgsfield_media_id),
    ];
    const medias = [...new Set(refs)].map((value) => ({ role: "image", value }));
    const params = {
      model: "gemini_omni_flash_1_1",
      mode: "reference-to-video",
      duration: 10,
      resolution: "720p",
      aspect_ratio: "9:16",
      count: 1,
      medias,
      prompt:
        brief.video_prompt +
        "\nUse the supplied images as actual identity inputs. Preserve Nia Nova facial identity, warm medium tan complexion, brown eyes and long dark-brown hair with caramel highlights. Adult virtual AI creator. No text or watermark.",
    };
    const contentKey = "nianova186:" + londonIsoDate(now);
    const row = {
      content_key: contentKey,
      target_account: "nianova186",
      brief_json: JSON.stringify(brief),
      generation_params_json: JSON.stringify(params),
      status: "AWAITING_GENERATION_CONNECTION_AND_COST_APPROVAL",
      video_url: "",
      instagram_media_id: "",
      permalink: "",
      last_error: "",
    };

    // === Skip Existing Daily Brief -> Save Brief to Content Queue ==========
    const existing = await getState<typeof row>(WORKFLOW_ID, contentKey);
    let saved = false;
    if (existing) {
      await ctx.log("queue:skip-existing", { content_key: contentKey });
    } else {
      await setState(WORKFLOW_ID, contentKey, row);
      saved = true;
      await ctx.log("queue:saved", { content_key: contentKey, status: row.status });
    }

    // === Higgsfield - Quote Only (MCP estimate_video_cost) ================
    // TODO: not ported — external MCP server https://mcp.higgsfield.ai/mcp
    // (tool estimate_video_cost). Noted quote: 10s/720p/9:16/Omni Flash 1.1 = 30 credits.
    await ctx.log("higgsfield:quote-skipped", { note: "external MCP; ~30 credits" });

    return {
      summary: `Generated Nia Nova brief "${brief.title}" (${saved ? "queued" : "duplicate skipped"})`,
      data: { brief, generation_params: params, content_key: contentKey, saved },
    };
  },
});
