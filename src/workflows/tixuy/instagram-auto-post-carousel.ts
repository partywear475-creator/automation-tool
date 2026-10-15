import { defineWorkflow } from "../types";
import { env } from "@/lib/env";
import {
  resolvePageToken,
  assertAccount,
  getAccount,
  getRecentMedia,
  createCarouselItem,
  createCarouselContainer,
  waitForContainer,
  publishContainer,
} from "@/lib/instagram";
import { uploadToCloudinary } from "@/lib/cloudinary";
import { generateImage, generateJson } from "@/lib/openai";
import { sendEmail } from "@/lib/email";
import { appendRow } from "@/lib/sheets";
import { sleep } from "@/lib/http";

/**
 * Faithful port of n8n "Tixuy Instagram Auto-Post - Carousel Only
 * (Algorithm-Optimized)" (MnFx1dOnPB9wQgTq).
 *
 * Scheduled daily 09:00 Europe/London (BST in October = 08:00 UTC -> "0 8 * * *").
 *
 * Flow:
 *   Schedule -> GET /me/accounts -> select Page "Tixuy"
 *   -> Verify Tixuy Instagram (username/id guard)
 *   -> Get Published Tixuy Media (limit 30)
 *   -> Summarize Recent Topics (dated 30-day calendar + weekly fallback;
 *      SKIP if a post already exists for today UK time)
 *   -> Generate Carousel Content (gpt-5-mini, 7 slides, text-free illustrations)
 *   -> Proofread Carousel Copy (gpt-5-mini) -> Validate Carousel Copy (code gate)
 *   -> per slide: gpt-image-1 (1024x1024, medium, brand-style prefix)
 *      -> Cloudinary upload (raw) -> Build Branded Slide (typeset text layers)
 *      -> create carousel-item container (alt_text)
 *   -> aggregate -> CAROUSEL container -> Wait 10s -> check status
 *   -> if FINISHED publish, log to sheet, email success; else email failure.
 *   Any uncaught error -> Workflow Error Alert email (Error Trigger).
 *
 * Faithful-port notes:
 * - "Get Recent Posts" read the Google Sheet for past topics; sheets.ts only
 *   supports append, so recentTopics here is built from live IG captions only
 *   (logTopics is empty). Reported.
 * - Build Branded Slide's URL regex expects Cloudinary cloud "e38kpvav"
 *   (the original hardcoded cloud). Kept verbatim; set CLOUDINARY_CLOUD_NAME
 *   accordingly. Reported.
 * - Per-slide alt_text cannot be attached via the shared createCarouselItem
 *   helper (no alt_text param); the branded image still publishes. Reported.
 */

const TIXUY_IG_USER_ID = "17841472867696210";
const CONTENT_LOG_SHEET_ID = "1o3m_aSPGJ3-f-GjIO7dtKM8anJvvCGb63fVTAlBMy3E";
const CONTENT_LOG_TAB = "Posts";
const NOTIFY_EMAIL = "partywear475@gmail.com";
const WORKFLOW_NAME = "Tixuy Instagram Auto-Post - Carousel Only (Algorithm-Optimized)";

// Dated 30-day plan (verbatim from the n8n "Summarize Recent Topics" code node).
const CALENDAR = [
  { day: 1, date: "2026-10-06", pillar: "Automation", hook: "Your enquiry should not live in a spreadsheet", concept: "Walk through form → validation → CRM → owner notification → follow-up task. Illustrative workflow, not an installed client system.", cta: "Explain your most repetitive enquiry task.", ctaType: "discussion", format: "workflow walkthrough" },
  { day: 2, date: "2026-10-07", pillar: "Website", hook: "Can customers find your contact button?", concept: "Show an illustrative homepage before/after with clear hierarchy, mobile contact placement and one service-specific CTA.", cta: "Save the five-point contact checklist.", ctaType: "save", format: "before/after explanation" },
  { day: 3, date: "2026-10-08", pillar: "Worked example", hook: "From scattered enquiries to one pipeline", concept: "Follow a fictional local service business enquiry from arrival to response; show stages and a human handoff. Label every example illustrative.", cta: "Which stage slows your enquiries?", ctaType: "discussion", format: "illustrative process story" },
  { day: 4, date: "2026-10-09", pillar: "Practical tip", hook: "Build an FAQ bot with a human exit", concept: "Give a reusable FAQ answer structure, uncertainty response and visible escalation example; no claim of deployed results.", cta: "Save the answer template.", ctaType: "save", format: "step-by-step" },
  { day: 5, date: "2026-10-10", pillar: "FAQ", hook: "Website builder or custom app?", concept: "Compare needs, integration requirements, ownership and maintenance; use decision criteria, not unverified vendor prices.", cta: "What must your next website or app do?", ctaType: "discussion", format: "decision guide" },
  { day: 6, date: "2026-10-11", pillar: "Service", hook: "What to include in your website enquiry", concept: "Offer a five-question project brief: current site, audience, desired action, integrations and constraints. No free audit promise.", cta: "DM WEBSITE with your goal and current URL.", ctaType: "enquiry", format: "project brief" },
  { day: 7, date: "2026-10-12", pillar: "Weekly checklist", hook: "Five checks before you buy another tool", concept: "Inventory task, data, handoff, owner and failure recovery before adding software.", cta: "Save this buying checklist.", ctaType: "save", format: "checklist" },
  { day: 8, date: "2026-10-13", pillar: "Automation", hook: "Stop copying order details by hand", concept: "Illustrate order capture → validation → destination system → exception queue → confirmation. No claimed time saved.", cta: "Which order field do you copy repeatedly?", ctaType: "discussion", format: "workflow walkthrough" },
  { day: 9, date: "2026-10-14", pillar: "Website", hook: "Give mobile visitors one clear next step", concept: "Explain thumb-friendly action placement, readable copy, accessible contrast and a simple form using a labelled mockup.", cta: "Save the mobile checklist.", ctaType: "save", format: "before/after explanation" },
  { day: 10, date: "2026-10-15", pillar: "Worked example", hook: "An appointment request without the back-and-forth", concept: "Use a fictional appointment business: request, availability, confirmation, reminder and cancellation path. Do not promise real bookings.", cta: "Where does your appointment process get stuck?", ctaType: "discussion", format: "illustrative process story" },
  { day: 11, date: "2026-10-16", pillar: "Practical tip", hook: "Map a useful customer support answer", concept: "Show a specific question, approved source, short answer, next action and human handoff.", cta: "Save the response structure.", ctaType: "save", format: "step-by-step" },
  { day: 12, date: "2026-10-17", pillar: "FAQ", hook: "Does every business need a chatbot?", concept: "Explain situations where an FAQ page, form or human inbox may be sufficient and when automation adds value.", cta: "What question do customers repeat most?", ctaType: "discussion", format: "decision guide" },
  { day: 13, date: "2026-10-18", pillar: "Service", hook: "Bring a problem before asking for an app", concept: "Explain a useful automation brief: trigger, inputs, output, exceptions and owner.", cta: "DM AUTOMATE with the task you want to simplify.", ctaType: "enquiry", format: "project brief" },
  { day: 14, date: "2026-10-19", pillar: "Weekly checklist", hook: "Is your enquiry process losing context?", concept: "Check source, ownership, consent requirements, response status and follow-up; provide neutral examples.", cta: "Save the enquiry checklist.", ctaType: "save", format: "checklist" },
  { day: 15, date: "2026-10-20", pillar: "Automation", hook: "Turn enquiry emails into useful tasks", concept: "Illustrate categorisation → missing-detail check → task assignment → acknowledgement draft → human approval.", cta: "Which enquiry type takes longest to organise?", ctaType: "discussion", format: "workflow walkthrough" },
  { day: 16, date: "2026-10-21", pillar: "Website", hook: "A shorter form with better questions", concept: "Explain essential contact/project fields, optional details, field labels, validation and confirmation. Do not claim a conversion lift.", cta: "Save the form checklist.", ctaType: "save", format: "before/after explanation" },
  { day: 17, date: "2026-10-22", pillar: "Worked example", hook: "A quote request with a clear handoff", concept: "Fictional service business: scope capture, evidence upload, owner review, draft quote and decision tracking; human approval required.", cta: "What information is missing from most quote requests?", ctaType: "discussion", format: "illustrative process story" },
  { day: 18, date: "2026-10-23", pillar: "Practical tip", hook: "Make your automation fail visibly", concept: "Show error detection, safe retry limits, duplicate checks, exception queue and owner review using an illustrative workflow.", cta: "Save the failure-recovery checklist.", ctaType: "save", format: "step-by-step" },
  { day: 19, date: "2026-10-24", pillar: "FAQ", hook: "When should an app replace a spreadsheet?", concept: "Compare permissions, concurrent updates, validation, audit trail and integration needs without dismissing spreadsheets.", cta: "What spreadsheet task is hardest to maintain?", ctaType: "discussion", format: "decision guide" },
  { day: 20, date: "2026-10-25", pillar: "Service", hook: "What happens before development starts?", concept: "Explain requirements, scope, mockup, acceptance checks and support planning; no fabricated customer project.", cta: "DM PROJECT with the process you want to improve.", ctaType: "enquiry", format: "process explanation" },
  { day: 21, date: "2026-10-26", pillar: "Weekly checklist", hook: "Who owns your business website?", concept: "Check domain access, hosting ownership, backups, recovery contacts and renewal records. Avoid unsupported legal claims.", cta: "Save the ownership checklist.", ctaType: "save", format: "checklist" },
  { day: 22, date: "2026-10-27", pillar: "Automation", hook: "A reminder workflow that respects customers", concept: "Illustrate valid booking event, authorised contact details, time window, cancellation stop and exception review.", cta: "Where would a reminder help your customers?", ctaType: "discussion", format: "workflow walkthrough" },
  { day: 23, date: "2026-10-28", pillar: "Website", hook: "Show your service before listing features", concept: "Compare vague and specific copy with an illustrative service-page example; include who, problem, deliverable and next step.", cta: "Save the service-copy template.", ctaType: "save", format: "before/after explanation" },
  { day: 24, date: "2026-10-29", pillar: "Worked example", hook: "One clear workflow for a new customer", concept: "Fictional onboarding process: agreed scope, required information, access request, owner check and progress update; no client claims.", cta: "Which onboarding step creates the most delay?", ctaType: "discussion", format: "illustrative process story" },
  { day: 25, date: "2026-10-30", pillar: "Practical tip", hook: "Give AI a brief it can actually use", concept: "Provide a practical prompt template with goal, context, source facts, output format and verification requirements.", cta: "Save the prompt template.", ctaType: "save", format: "step-by-step" },
  { day: 26, date: "2026-10-31", pillar: "FAQ", hook: "Can your tools talk to each other?", concept: "Explain integration requirements, API availability, permissions, limits and fallback handling without inventing provider capabilities.", cta: "Which two tools do you want to connect?", ctaType: "discussion", format: "decision guide" },
  { day: 27, date: "2026-11-01", pillar: "Service", hook: "Choose one business process to improve", concept: "Show a simple prioritisation grid using frequency, error cost, customer impact and implementation effort; no made-up ROI.", cta: "DM AUTOMATE with one repetitive task.", ctaType: "enquiry", format: "project brief" },
  { day: 28, date: "2026-11-02", pillar: "Weekly checklist", hook: "Do your enquiries have a next action?", concept: "Check accountable owner, deadline, status, missing details and response record.", cta: "Save the follow-up checklist.", ctaType: "save", format: "checklist" },
  { day: 29, date: "2026-11-03", pillar: "Automation", hook: "Route enquiries without losing the context", concept: "Illustrate source capture, category, urgency, owner and original-message retention; examples labelled illustrative.", cta: "Which enquiry should reach your team first?", ctaType: "discussion", format: "workflow walkthrough" },
  { day: 30, date: "2026-11-04", pillar: "Website", hook: "A useful confirmation page does more", concept: "Explain next steps, realistic response expectations, record reference, contact route and accessible confirmation.", cta: "Save the confirmation-page checklist.", ctaType: "save", format: "step-by-step" },
];

// Weekly fallback (verbatim). Keyed by ISO weekday (1=Mon .. 7=Sun).
const WEEKLY: Record<number, [string, string, string, string]> = {
  1: ["Weekly checklist", "A practical checklist for choosing, maintaining or improving business technology", "checklist", "save"],
  2: ["Automation", "One specific repetitive small-business task explained as a workflow", "workflow walkthrough", "discussion"],
  3: ["Website", "One specific mobile or service-page improvement with a labelled illustrative example", "before/after explanation", "save"],
  4: ["Worked example", "One fictional business process worked through from input to human handoff; clearly label it illustrative", "illustrative process story", "discussion"],
  5: ["Practical tip", "One immediately usable template or implementation checklist", "step-by-step", "save"],
  6: ["FAQ", "One business-owner decision explained with concrete tradeoffs", "decision guide", "discussion"],
  7: ["Service", "A clear project brief that helps owners enquire about websites, apps or automation", "project brief", "enquiry"],
};

// Generate Carousel Content — AI Agent system message (verbatim).
const GEN_SYSTEM =
  "Act as Tixuy's Instagram content strategist for @tix_uy. Tixuy provides websites, apps, ecommerce, AI automation and cloud/DevOps. Audience assumption: UK small-business owners and growing teams. Primary business goal: qualified enquiries. Supporting goals: useful saves/shares and meaningful comments.\n\nFollow today's assignedPost exactly for date, pillar, format, concept and CTA type. Write one useful 7-slide carousel. Daily series: Monday checklist; Tuesday automation; Wednesday website improvement; Thursday illustrative worked example; Friday practical tip; Saturday business-owner FAQ; Sunday service/project brief. For the dated 30-day plan, the assigned item takes priority. Do not fall back to pricing-page mistakes or repeat/reword a recent topic. If close to a recent caption, retain the assigned pillar but choose a clearly different concrete example.\n\nContent promise: practical websites, apps and automation explained with examples. Generate internally three specific hook options and select the clearest supported one. Resolve the promise by slide 6. Slide 1: clear specific hook, not a sensational or unsupported claim. Slides 2–6: one concrete action, worked example, decision criterion or template per slide. Each value slide must include a headline of at most 8 words AND a supportingLine of at most 18 words. Slide 7: a concise takeaway and ONE CTA matching today's assigned CTA. Use a specific discussion question on discussion days, a useful save prompt on save days, and a clear project enquiry prompt on enquiry days. Do not stack save/share/follow/DM prompts on every post. Never promise a free audit, offer, price, deadline or guaranteed result unless verified.\n\nFacts: no verified client assets, testimonials or measured outcomes are supplied to this generator. Worked examples, mockups and before/after illustrations must set illustrative=true so the final typeset image visibly says \"Illustrative example\" and describe hypothetical improvements, not claimed client work. Do not invent screenshots of deployed systems, analytics percentages, named clients, customer comments, testimonials, awards, follower growth or time/revenue saved. Explain robust human review and exceptions in automation examples. Do not make claims about current algorithms, trends, vendor features or prices that need live research: no research tools are connected.\n\nVisual system: use the verified tixuy.co.uk website palette: black #000000 canvas; charcoal #080808 panels; primary electric blue #0055FE accents; deep navy #0A0B52 subtle glows; white #FFFFFF readable text; muted grey #999999 secondary text. Clean dark technology aesthetic, thin borders, restrained blue glow, ample negative space and bold sans-serif. These colours are mandatory for every slide. Generate only the central text-free illustration: diagram icons, process nodes, geometric mockup shapes or a decision illustration. All visuals must fit in the central band y=330–730 of the 1024-square canvas; leave top 310px and bottom 280px clear. No text, letters, numerals, words, labels, logos, wordmarks, watermarks, fake UI text or typography in imagePrompt or generated artwork. Headlines, supporting lines and illustrative disclosure will be added afterwards with exact typesetting, not painted by the image model. imagePrompt describes only visual content and layout, never requests visible copy.\n\nCopy fields per slide: headline (at most 8 words and 64 characters); supportingLine (at most 18 words and 110 characters); illustrative (boolean, true for all hypothetical workflows, mockups and fictional examples); imagePrompt (text-free central illustration); altText (plain description including the exact headline and supporting line, plus illustrative disclosure when applicable). Keep copy complete, grammatical and useful rather than noun fragments. No placeholder options such as \"checklist or template\"; name the actual resource in the CTA.\n\n\nCaption: 3–5 short sentences, British English, clear and practical, at most 2 emoji. Open with the audience problem and relevant keyword naturally. Add one useful detail beyond the slides, then ONE CTA matching today's assigned item. Use 3–5 genuinely relevant hashtags as categorisation, with no promise they will cause reach.\n\nFinal editing pass before output: proofread every headline, supportingLine, caption, hashtag and altText in British English. Correct spelling, grammar, missing articles, punctuation, repeated words and awkward fragments. Use enquiry/enquiries, colour, organise, optimise and labelled. Preserve Tixuy, tixuy.co.uk, AI, CRM, API, SaaS and DevOps exactly when used. Verify technical claims against the supplied facts; remove unsupported promises. Read the final copy again after editing, then emit only the finished text. Avoid known misspellings including intergration, automtion, enquries, webiste, buisness, seperate and recieive. Do not copy spelling mistakes from the website or source captions. Generated illustrations contain no copy; altText describes the final composed slide rather than claiming the text is baked into the illustration.\n\nOutput ONLY structured JSON with topic, caption, hashtags and slides (exactly 7 objects). Every slide requires headline, supportingLine, illustrative, imagePrompt and altText. No extra keys. No tools are connected; use only supplied facts, plan and recent history.";

// Proofread Carousel Copy — AI Agent system message (verbatim).
const PROOF_SYSTEM =
  'You are Tixuy\'s final British-English copy editor. Review every headline, supportingLine, caption, hashtag and altText independently of the original writer. Correct spelling, grammar, punctuation, awkward fragments, repeated words and missing articles. Use enquiry/enquiries, colour, organise, optimise and labelled; use Tixuy and tixuy.co.uk correctly. Preserve AI, CRM, API, SaaS and DevOps. Read every corrected field again before returning it.\nKeep exactly seven slides in the original order, headlines <=8 words and <=64 characters, supportingLine <=18 words and <=110 characters, 3–5 relevant hashtags. Keep the original single CTA\'s intent, but replace generic placeholder wording such as "checklist or template" with the actual useful resource. Do not add claims, client outcomes, numbers, legal guidance, prices, offers or new calls to action.\nPreserve imagePrompt as a description of a text-free central illustration and keep illustrative true for hypothetical/mockup examples. Preserve the topic, factual meaning and all required fields. Revise altText to match the corrected headline/supportingLine. Return only JSON with topic, caption, hashtags, slides; each slide has headline, supportingLine, illustrative, imagePrompt, altText. No commentary or Markdown.\nMake minimal corrections. Return already correct sentences verbatim. Never replace a save/bookmark CTA with an unrelated operational action, or add a new task to supportingLine. Preserve the original instructions and meaning while correcting the wording.';

// Generate Slide Image — mandatory brand-style prefix (verbatim).
const IMAGE_PREFIX =
  "MANDATORY TIXUY WEBSITE BRAND STYLE: 1024x1024 square. Pure black #000000 background; charcoal #080808 surfaces; electric blue #0055FE outlines and accents; deep navy #0A0B52 glow; white #FFFFFF small graphic highlights. No green, teal, gold, pink or unrelated palette. ALL artwork must be text-free. Do not render words, letters, numbers, glyphs, watermarks, logos, UI copy, captions or labels. Typography will be added separately with exact spelling. Keep the top 310px and bottom 280px black and empty. Put the topic illustration entirely in the central band y=330 through 730, with 64px side margins. Show clear simple visual relationships without writing, and use the same clean premium technology aesthetic across the carousel. Illustration brief: ";

interface GenSlide {
  headline: string;
  supportingLine: string;
  illustrative: boolean;
  imagePrompt: string;
  altText: string;
}
interface GenOutput {
  topic: string;
  caption: string;
  hashtags: string[];
  slides: GenSlide[];
}

// --- Summarize Recent Topics (verbatim logic) ------------------------------

function londonDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

interface Plan {
  localDate: string;
  planDay: number | null;
  freshAngle: string;
  assignedPost: Record<string, unknown>;
  recentTopics: string;
  strategy: string;
  historySource: string;
}

/** Returns a Plan, or null to SKIP (a post already exists for today UK time). */
function summarizeRecentTopics(
  account: { username?: string; id?: string },
  liveMedia: Array<{ caption?: string; timestamp?: string }>,
): Plan | null {
  const now = new Date();
  const localNowWeekday = ((): number => {
    const d = new Date(`${londonDate(now)}T12:00:00Z`).getUTCDay();
    return d === 0 ? 7 : d; // luxon weekday: 1=Mon .. 7=Sun
  })();
  const localDate = londonDate(now);

  if (account.username !== "tix_uy" || String(account.id) !== "17841472867696210") {
    throw new Error("Instagram identity mismatch: expected @tix_uy. Stop before generation or publishing.");
  }
  if (!Array.isArray(liveMedia)) {
    throw new Error("Published-media history was unavailable. Stop rather than generate without history.");
  }

  const localDateOf = (stamp: string): string | null => {
    const d = new Date(stamp);
    if (!Number.isFinite(d.getTime())) return null;
    return londonDate(d);
  };

  // Completed-post check: skip if something already published today UK time.
  if (liveMedia.some((m) => m.timestamp && localDateOf(m.timestamp) === localDate)) return null;

  // "Get Recent Posts" sheet rows aren't readable with the current libs -> logTopics empty.
  const logTopics: string[] = [];
  const liveTopics = liveMedia
    .slice(0, 30)
    .map((x) => (x.caption || "").split("\n")[0].slice(0, 240))
    .filter(Boolean);
  const recentTopics = Array.from(new Set(liveTopics.concat(logTopics))).join("\n");

  const delta = Math.floor(
    (Date.parse(localDate + "T00:00:00Z") - Date.parse("2026-10-06T00:00:00Z")) / 86400000,
  );

  let selected: Record<string, unknown>;
  if (delta >= 0 && delta < CALENDAR.length) {
    selected = CALENDAR[delta];
  } else {
    const [pillar, concept, format, ctaType] = WEEKLY[localNowWeekday];
    selected = {
      date: localDate,
      pillar,
      hook: "Choose a fresh specific hook",
      concept,
      format,
      ctaType,
      cta:
        ctaType === "enquiry"
          ? "DM Tixuy with one project goal or repetitive task."
          : ctaType === "save"
            ? "Save the useful checklist or template."
            : "Ask one specific question about the reader's process.",
    };
  }

  return {
    localDate,
    planDay: delta >= 0 && delta < 30 ? delta + 1 : null,
    freshAngle: selected.hook as string,
    assignedPost: selected,
    recentTopics: recentTopics || "No accessible recent captions.",
    strategy:
      "Practical websites, apps and automation for UK small businesses. Seven-slide carousel, one useful example per value slide, one CTA.",
    historySource: "Last 30 published Instagram captions plus available successful log rows.",
  };
}

// --- Validate Carousel Copy (verbatim gate) --------------------------------

function validateCarouselCopy(o: GenOutput): GenOutput {
  const commonTypos = /\b(?:intergrations?|automtion|enquries|webiste|buisness|seperate|recieive|recieve|sucess|managment|devlopment|teh|thier)\b/i;
  const normalise = (s: unknown): string => {
    if (typeof s !== "string") throw new Error("Expected final text, not a missing or non-string field");
    return s.normalize("NFC").replace(/\s+/g, " ").trim();
  };
  const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
  const checkLines = (s: string, limit: number) => {
    let lines = 1,
      len = 0;
    for (const word of s.split(/\s+/)) {
      if (word.length > limit) throw new Error("Word too long for readable text");
      if (len && len + 1 + word.length > limit) {
        lines++;
        len = word.length;
      } else len += (len ? 1 : 0) + word.length;
    }
    if (lines > 3) throw new Error("Copy needs more than three lines");
  };

  if (!o || typeof o !== "object" || !Array.isArray(o.slides) || o.slides.length !== 7)
    throw new Error("Exactly seven finished slides are required");
  const checked: GenOutput = { ...o, topic: normalise(o.topic), caption: normalise(o.caption) };
  if (!checked.topic || !checked.caption || checked.caption.length > 1800)
    throw new Error("Missing or oversized final copy");
  if (
    !Array.isArray(o.hashtags) ||
    o.hashtags.length < 3 ||
    o.hashtags.length > 5 ||
    o.hashtags.some((h) => typeof h !== "string" || !/^#[A-Za-z][A-Za-z0-9]*$/.test(h))
  )
    throw new Error("Expected 3–5 valid finished hashtags");
  checked.slides = o.slides.map((s, i) => {
    const headline = normalise(s.headline),
      supportingLine = normalise(s.supportingLine),
      imagePrompt = normalise(s.imagePrompt);
    if (!headline || !supportingLine || !imagePrompt || typeof s.illustrative !== "boolean")
      throw new Error("Slide " + (i + 1) + " is incomplete");
    if (words(headline) > 8 || headline.length > 64 || words(supportingLine) > 18 || supportingLine.length > 110)
      throw new Error("Slide " + (i + 1) + " exceeds readable text limits");
    checkLines(headline, 26);
    checkLines(supportingLine, 42);
    if (/(?:render|write|display|overlay)\s+(?:the\s+)?(?:headline|supporting|words?|text|caption|label)/i.test(imagePrompt))
      throw new Error("Illustration must not paint text");
    if (commonTypos.test(headline + " " + supportingLine))
      throw new Error("Known spelling mistake in slide " + (i + 1));
    const altText =
      "Dark Tixuy slide with blue accents. Headline: " +
      headline +
      ". Supporting text: " +
      supportingLine +
      (s.illustrative ? " Illustrative example." : "");
    return { ...s, headline, supportingLine, imagePrompt, altText };
  });
  if (commonTypos.test(checked.topic + " " + checked.caption + " " + o.hashtags.join(" ")))
    throw new Error("Known spelling mistake in caption or metadata");
  if (new Set(checked.slides.map((s) => s.headline.toLowerCase())).size !== 7)
    throw new Error("Repeated slide headline");
  return checked;
}

// --- Build Branded Slide (verbatim Cloudinary typesetting) ------------------

function encodeText(s: string): string {
  return encodeURIComponent(s)
    .replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%2C/gi, "%252C")
    .replace(/%2F/gi, "%252F")
    .replace(/%25(?!2C|2F)/gi, "%2525");
}
function wrapText(s: string, limit: number, maxLines: number): string {
  const lines: string[] = [];
  let line = "";
  for (const word of s.split(/\s+/)) {
    if (word.length > limit) throw new Error("Word too long for readable typesetting");
    if (line && (line + " " + word).length > limit) {
      lines.push(line);
      line = word;
    } else line += (line ? " " : "") + word;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) throw new Error("Text requires too many lines");
  return lines.join("\n");
}
function panel(color: string, width: number, height: number, placement: string): string[] {
  return [
    "l_text:Arial_1:X,co_rgb:" + color + ",b_rgb:" + color,
    "c_scale,w_" + width + ",h_" + height,
    "fl_layer_apply," + placement,
  ];
}
function textLayer(copy: string, size: number, bold: boolean, color: string, placement: string, maxHeight: number): string[] {
  return [
    "l_text:Arial_" + size + (bold ? "_bold" : "") + ":" + encodeText(copy) + ",co_rgb:" + color + ",b_transparent",
    "c_limit,w_896,h_" + maxHeight,
    "fl_layer_apply," + placement,
  ];
}
function buildBrandedSlide(secureUrl: string, slide: GenSlide, index: number): string {
  if (typeof secureUrl !== "string" || !/^https:\/\/res\.cloudinary\.com\/e38kpvav\/image\/upload\//.test(secureUrl))
    throw new Error("Expected persistent Tixuy image URL");
  const title = wrapText(slide.headline, 26, 3),
    body = wrapText(slide.supportingLine, 42, 3);
  const transforms = [
    "c_fill,w_1024,h_1024",
    ...panel("000000", 1024, 310, "g_north"),
    ...panel("080808", 1024, 280, "g_south"),
    ...panel("0055FE", 896, 6, "g_north_west,x_64,y_298"),
    ...textLayer(title, 68, true, "FFFFFF", "g_north_west,x_64,y_64", 216),
    ...textLayer(body, 42, false, "FFFFFF", "g_north_west,x_64,y_778", 154),
    ...textLayer("tixuy.co.uk", 24, false, "999999", "g_south_west,x_64,y_26", 32),
    ...textLayer(index + " / 7", 24, false, "0055FE", "g_south_east,x_64,y_26", 32),
  ];
  if (slide.illustrative)
    transforms.push(...textLayer("Illustrative example", 24, false, "999999", "g_north_west,x_64,y_948", 32));
  transforms.push("f_jpg,q_90");
  return secureUrl.replace("/upload/", "/upload/" + transforms.join("/") + "/");
}

export default defineWorkflow({
  id: "tixuy-instagram-auto-post-carousel",
  name: "Tixuy Instagram Auto-Post - Carousel Only (Algorithm-Optimized)",
  n8nId: "MnFx1dOnPB9wQgTq",
  brand: "tixuy",
  description:
    "Daily 09:00 Europe/London 7-slide carousel for @tix_uy: dated 30-day plan with weekly fallback, gpt-5-mini generate + proofread + validate, gpt-image-1 text-free slides typeset in brand colours via Cloudinary, publish, log and email. Skips if already posted that UK day.",
  trigger: "schedule",
  // 09:00 Europe/London (BST in October = UTC+1).
  schedule: "0 8 * * *",
  enabled: true,

  async run(ctx) {
    const igUserId = env.igAccountOptional("tixuy") || TIXUY_IG_USER_ID;

    try {
      // Get My Facebook Page -> Select Tixuy Page.
      const page = await resolvePageToken("Tixuy");
      await ctx.log("page:resolved", { pageId: page.id, name: page.name });

      // Verify Tixuy Instagram (id + username) + account guard.
      await assertAccount(igUserId, TIXUY_IG_USER_ID, page.access_token);
      const account = await getAccount(igUserId, page.access_token);
      await ctx.log("account:verified", { username: account.username });

      // Get Published Tixuy Media (limit 30).
      const liveMedia = await getRecentMedia(igUserId, 30, page.access_token);

      // Summarize Recent Topics (+ dedupe / skip).
      const plan = summarizeRecentTopics(
        { username: account.username, id: String(igUserId) },
        liveMedia,
      );
      if (!plan) {
        await ctx.log("skip:already-posted-today", {});
        return { summary: "Skipped — a post already exists for today (UK time)", data: {} };
      }
      await ctx.log("plan:selected", { localDate: plan.localDate, planDay: plan.planDay, hook: plan.freshAngle });

      // Generate Carousel Content (gpt-5-mini, 7 slides).
      const userPrompt =
        `Create the carousel assigned for ${plan.localDate}.\n` +
        `Assigned post: ${JSON.stringify(plan.assignedPost)}\n` +
        `Strategy: ${plan.strategy}\n` +
        `Recent published captions and logged topics to avoid:\n${plan.recentTopics}`;
      const generated = await generateJson<GenOutput>({
        system: GEN_SYSTEM,
        prompt: userPrompt,
        model: "gpt-5-mini",
      });
      await ctx.log("content:generated", { topic: generated.topic });

      // Proofread Carousel Copy (gpt-5-mini).
      const proofed = await generateJson<GenOutput>({
        system: PROOF_SYSTEM,
        prompt:
          "Proofread the complete Tixuy carousel JSON below. Keep the assigned topic, one CTA and illustration content. Return the corrected complete JSON only.\n" +
          JSON.stringify(generated),
        model: "gpt-5-mini",
      });

      // Validate Carousel Copy (hard gate; also recomputes altText).
      const content = validateCarouselCopy(proofed);
      await ctx.log("content:validated", { slides: content.slides.length });

      const hashtags = content.hashtags.join(" ");

      // Per slide: generate image -> Cloudinary upload (raw) -> Build Branded Slide -> carousel item.
      const containerIds: string[] = [];
      for (let i = 0; i < content.slides.length; i++) {
        const slide = content.slides[i];
        const buffer = await generateImage({
          prompt: IMAGE_PREFIX + slide.imagePrompt,
          size: "1024x1024",
          quality: "medium",
        });
        const secureUrl = await uploadToCloudinary(buffer);
        const brandedImageUrl = buildBrandedSlide(secureUrl, slide, i + 1);
        // NOTE: n8n also sent alt_text=slide.altText here; createCarouselItem has no alt_text param.
        const itemId = await createCarouselItem(igUserId, brandedImageUrl, page.access_token);
        containerIds.push(itemId);
        await ctx.log("slide:item-created", { index: i + 1, itemId });
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
          subject: "Instagram carousel auto-post failed - media container not ready",
          html: `<p>The Instagram carousel media container did not finish processing in time.</p><p><strong>Status:</strong> ${reason}</p><p><strong>Container ID:</strong> ${carouselId}</p><p>Open the Meta Graph API Explorer to check manually, or re-run this workflow - you may need to increase the Wait node delay.</p>`,
        });
        return { summary: "Tixuy daily carousel failed — container not ready in time", data: { carouselId, reason } };
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
        "7-slide carousel: " + content.slides.map((s) => s.headline).join(" | "),
        containerIds.join(", "),
        postId,
        "Published (Carousel)",
      ]);
      await ctx.log("sheet:logged", {});

      // Send Success Email.
      await sendEmail({
        to: NOTIFY_EMAIL,
        subject: "✅ Instagram carousel published: " + content.topic,
        html: `<h3>Instagram carousel published 🎉</h3><p><strong>Topic:</strong> ${content.topic}</p><p><strong>Caption:</strong><br>${content.caption}</p><p><strong>Hashtags:</strong><br>${hashtags}</p><p><strong>Slides:</strong> ${content.slides.length}</p><p><strong>Post ID:</strong> ${postId}</p>`,
      });

      return {
        summary: `Published Tixuy daily 7-slide carousel to @tix_uy (${postId})`,
        data: { postId, topic: content.topic, planDay: plan.planDay, containerIds },
      };
    } catch (err) {
      // Workflow Error Trigger -> Send Workflow Error Alert.
      const message = err instanceof Error ? err.message : String(err);
      try {
        await sendEmail({
          to: NOTIFY_EMAIL,
          subject: `⚠️ Instagram carousel workflow failed: ${WORKFLOW_NAME}`,
          html: `<h3>Instagram carousel auto-post failed 🚨</h3><p>The workflow <strong>${WORKFLOW_NAME}</strong> stopped with an error and no content was posted for this run.</p><p><strong>Error message:</strong> ${message}</p><p>Check the run log before the next scheduled run at 09:00.</p>`,
        });
      } catch {
        // Don't mask the original error if the alert email fails.
      }
      throw err;
    }
  },
});
