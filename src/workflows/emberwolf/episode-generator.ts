import { defineWorkflow } from "../types";
import { geminiGenerate } from "@/lib/gemini";
import { setState } from "@/lib/logger";

/**
 * Faithful port of n8n "The Ember Wolf — Episode Generator" (IocFtPmkY0VyzZl8).
 *
 * Form Trigger (topic, pillar, duration) -> Generate Episode (AI Agent: Google
 * Gemini models/gemini-3.1-pro-preview, temp 0.85, maxOutputTokens 8192, with a
 * structured output parser) -> Prepare Review Row (build episode_json +
 * episode_markdown + metadata) -> Save to "Wolf Episodes" data table.
 *
 * Nothing publishes automatically; every episode is saved AWAITING HUMAN APPROVAL.
 *
 * Notes:
 *  - Ran on Gemini -> geminiGenerate (json). The shared geminiGenerate signature
 *    does not accept temperature/maxOutputTokens, so n8n's temp 0.85 /
 *    maxOutputTokens 8192 are not applied. See report.
 *  - The "Wolf Episodes" n8n data table is reproduced via setState (keyed per row).
 */

const WORKFLOW_ID = "emberwolf-episode-generator";

const PILLARS = [
  "Self-respect and boundaries",
  "Discipline and delayed gratification",
  "Relationships and emotional intelligence",
  "Confidence and social intelligence",
  "Money habits and decision-making",
  "Resilience after rejection or failure",
];
const DURATIONS = ["30", "35", "40", "45"];

// === Generate Episode (Gemini) — system message, verbatim ==================
const SYSTEM_MESSAGE = `You are the creative director and production planner for an original short-form vertical video brand called "The Ember Wolf". The recurring character is Aren, an original adult anthropomorphic wolf. You produce ONE complete, original episode package per request, strictly following the brand rules below. Never copy any competitor account name, mascot, script, caption, hook, slogan, thumbnail, or composition. Every hook, script, pose, prompt, caption, and title must be newly created.

=== CHARACTER: AREN (locked identity) ===
Charcoal-gray fur; soft silver-gray muzzle, cheeks and throat; warm amber eyes with dark brown pupils; long narrow muzzle; upright triangular ears with a small natural notch on the outer edge of the LEFT ear; thick swept-back head fur with ONE subtle silver streak above the RIGHT temple; athletic balanced build, realistic hands and proportions; mature adult. Wardrobe (do not change unless a script explicitly requires a special outfit): midnight-navy three-piece suit with subtle woven texture, warm cream dress shirt, deep burgundy tie, small round brass tie pin, brown leather shoes and belt, vintage brass wristwatch on the LEFT wrist. Personality: quietly confident, observant, patient, emotionally intelligent; never boasts, threatens, bullies or belittles.

=== IDENTITY BLOCK (begin EVERY image_prompt and thumbnail_prompt with this text verbatim) ===
"Aren, the same original adult anthropomorphic wolf character in every shot: charcoal-gray fur, soft silver-gray muzzle cheeks and throat, warm amber eyes, long narrow muzzle, upright triangular ears with a small notch on the outer edge of his left ear, thick swept-back head fur with one subtle silver streak above the right temple, athletic balanced build, wearing the same midnight-navy three-piece suit, warm cream shirt, deep burgundy tie, round brass tie pin, brown leather shoes, and vintage brass wristwatch on his left wrist." Then add the shot-specific action, setting, camera angle, lighting, and emotion.

=== NEGATIVE PROMPT (use for EVERY scene and the thumbnail, in the negative_prompt field) ===
"no different fur color, no blue eyes, no missing ear notch, no extra limbs or fingers, no human face, no dog muzzle, no childlike proportions, no exaggerated muscles, no casual clothing, no black suit, no red necktie, no duplicate character, no text, no logo, no watermark, no copied competitor character, no recognizable copyrighted character".

=== VISUAL STYLE ===
Cinematic, elegant, richly colored storybook realism, vertical 9:16. Warm amber lighting, midnight shadows, burgundy accents. Palette: midnight navy #101820, ember amber #D89A3D, deep burgundy #5A1F2B, warm cream #F2E6D0, charcoal #282A2D. Locations: private library, refined office, quiet train carriage, elegant restaurant, city street after rain, tasteful home interior. Colour images only, no black-and-white. No readable text inside scenes (captions are added in editing). No third-party logos or copyrighted characters. Generate one scene per prompt, never a storyboard grid.

=== SCRIPT RULES ===
Teach ONE lesson only. Open with an immediate curiosity/emotional hook in the first ~1.5s. Include a concrete miniature story with a specific situation, decision, and consequence, and a turn around the middle. End with one memorable, useful closing line (not a generic slogan). Use short natural spoken sentences. Aim 75-105 words scaled to target duration. No manufactured quotations, no false attribution to famous people, no unsupported medical/legal/financial/psychological claims, no misogyny, no manipulation, no humiliation. Do not copy or lightly rewrite any competitor post.

=== STRUCTURE ===
Produce 6-8 numbered scenes covering the whole narration, each with a timestamp, a detailed image_prompt (starting with the identity block), and the negative_prompt. First meaningful visual within 1.5s; no shot static longer than 4s. on_screen_text must match the narration exactly, max two lines, ~6-9 words per line, timestamped. Provide exactly three original hook options, exactly five relevant hashtags, a thumbnail_prompt (identity block + composition) and a short punchy thumbnail_headline.

=== CHECKS & STATUS ===
Fill the checks object honestly (originality, continuity, spelling, safety). If any check would fail, fix the content before returning. ALWAYS set status to exactly "AWAITING HUMAN APPROVAL". Never claim anything is approved, scheduled, or published.

Return ONLY the structured JSON described by the output parser. episode_id may be a placeholder like EP-XXX; a human will assign the final number.`;

// Structured output parser — jsonSchemaExample (shape the agent must return).
const OUTPUT_SCHEMA_EXAMPLE = `{"episode_id":"EP-001","title":"The Weight of a Quiet No","pillar":"Self-respect and boundaries","lesson":"A clear boundary earns more respect than an anxious yes.","hooks":["hook option one","hook option two","hook option three"],"voiceover_script":"Full narration text here.","estimated_duration_seconds":35,"estimated_word_count":92,"scenes":[{"scene_number":1,"timestamp":"0.0-4.0s","image_prompt":"Aren, the same original adult anthropomorphic wolf character... [full identity block] ... shot-specific action, setting, camera angle, lighting, emotion.","negative_prompt":"no different fur color, no blue eyes, no missing ear notch, no extra limbs..."}],"on_screen_text":[{"timestamp":"0.0-2.0s","caption":"Saying no is not rejection."}],"voice_direction":"Warm low-mid male register, ~140 wpm, calm authority.","music_and_sound":"Understated cinematic score low under narration; soft room tone.","instagram_caption":"Caption text.","hashtags":["#tag1","#tag2","#tag3","#tag4","#tag5"],"thumbnail_prompt":"Aren... [identity block] ... thumbnail composition.","thumbnail_headline":"THE QUIET NO","checks":{"originality":"pass — original concept, no copied phrasing","continuity":"pass — wardrobe and features consistent","spelling":"pass","safety":"pass — no unsupported claims, no manipulation"},"status":"AWAITING HUMAN APPROVAL"}`;

interface EpisodeScene {
  scene_number: number;
  timestamp: string;
  image_prompt: string;
  negative_prompt: string;
}
interface EpisodePackage {
  episode_id: string;
  title: string;
  pillar: string;
  lesson: string;
  hooks: string[];
  voiceover_script: string;
  estimated_duration_seconds: number;
  estimated_word_count: number;
  scenes: EpisodeScene[];
  on_screen_text: Array<{ timestamp: string; caption: string }>;
  voice_direction: string;
  music_and_sound: string;
  instagram_caption: string;
  hashtags: string[];
  thumbnail_prompt: string;
  thumbnail_headline: string;
  checks: Record<string, string>;
  status: string;
}

export default defineWorkflow({
  id: WORKFLOW_ID,
  name: "The Ember Wolf — Episode Generator",
  n8nId: "IocFtPmkY0VyzZl8",
  brand: "emberwolf",
  description:
    "Form-triggered Gemini generator for 'The Ember Wolf': produces one complete original episode package (locked Aren identity, per-scene image prompts + negative prompts, hooks, caption, thumbnail) and saves it AWAITING HUMAN APPROVAL. Nothing publishes automatically.",
  trigger: "form",
  enabled: true,

  async run(ctx) {
    const topic = String(ctx.input?.topic ?? "");
    const pillar = String(ctx.input?.pillar ?? "");
    const duration = String(ctx.input?.duration ?? "");
    if (!topic) throw new Error("Missing required form field: topic");
    if (!PILLARS.includes(pillar)) {
      throw new Error(`Invalid pillar "${pillar}". Expected one of: ${PILLARS.join(" | ")}`);
    }
    if (!DURATIONS.includes(duration)) {
      throw new Error(`Invalid duration "${duration}". Expected one of: ${DURATIONS.join(" | ")}`);
    }
    await ctx.log("form:received", { topic, pillar, duration });

    // === Generate Episode (Gemini) — user prompt, verbatim ================
    const userPrompt =
      `Create one complete original episode package.\n\n` +
      `Topic / idea: ${topic}\n` +
      `Content pillar: ${pillar}\n` +
      `Target duration (seconds): ${duration}\n\n` +
      `Follow every brand, character, script, visual, caption, audio and safety rule in your system instructions. Return only the structured JSON.` +
      `\n\nReturn ONLY valid JSON matching exactly this shape:\n${OUTPUT_SCHEMA_EXAMPLE}`;

    await ctx.log("episode:generate", { model: "gemini-3.1-pro-preview" });
    const raw = await geminiGenerate({
      system: SYSTEM_MESSAGE,
      prompt: userPrompt,
      model: "gemini-3.1-pro-preview",
      json: true,
    });
    const output = JSON.parse(raw) as EpisodePackage;
    await ctx.log("episode:generated", {
      episode_id: output.episode_id,
      title: output.title,
      status: output.status,
    });

    // === Prepare Review Row (verbatim fields + markdown template) =========
    const episodeMarkdown =
      `# ${output.title} (${output.episode_id})\n\n` +
      `**Pillar:** ${output.pillar}\n` +
      `**Lesson:** ${output.lesson}\n` +
      `**Est. duration:** ${output.estimated_duration_seconds}s (~${output.estimated_word_count} words)\n` +
      `**Status:** ${output.status}\n\n` +
      `## Hook options\n${(output.hooks ?? []).join("\n")}\n\n` +
      `## Voiceover\n${output.voiceover_script}\n\n` +
      `## Voice direction\n${output.voice_direction}\n\n` +
      `## Music & sound\n${output.music_and_sound}\n\n` +
      `## Instagram caption\n${output.instagram_caption}\n\n` +
      `## Hashtags\n${(output.hashtags ?? []).join(" ")}\n\n` +
      `## Thumbnail\n**Headline:** ${output.thumbnail_headline}\n${output.thumbnail_prompt}`;

    const reviewRow = {
      episode_id: output.episode_id,
      title: output.title,
      pillar: output.pillar,
      status: "AWAITING HUMAN APPROVAL",
      topic_input: topic,
      episode_json: JSON.stringify(output),
      episode_markdown: episodeMarkdown,
      created_at: new Date().toISOString(),
    };

    // === Save to Wolf Episodes (data table -> state) ======================
    const rowKey = `episode:${reviewRow.created_at}:${output.episode_id}`;
    await setState(WORKFLOW_ID, rowKey, reviewRow);
    await ctx.log("episode:saved", { rowKey, status: reviewRow.status });

    return {
      summary: `Generated Ember Wolf episode "${output.title}" (${output.episode_id}) — ${reviewRow.status}`,
      data: { review_row: reviewRow, episode: output },
    };
  },
});
