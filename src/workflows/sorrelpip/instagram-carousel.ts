import { defineWorkflow } from "../types";
import { env } from "@/lib/env";
import { httpJson, sleep } from "@/lib/http";
import {
  createCarouselItem,
  createCarouselContainer,
  publishContainer,
} from "@/lib/instagram";

/**
 * Faithful port of n8n "Sorrel & Pip - Instagram Carousel" (pe29cLrjfNZRH4xW).
 *
 * Standalone, approval-gated publisher for @sorrelandpip (EP-001). Manual
 * trigger. Nothing posts unless approved === true.
 *
 * Flow: Carousel Start -> Settings (approved=false, caption) -> Read Account
 * (page 1373619562503420 -> instagram_business_account{id,username}) ->
 * Image List (10 slide URLs) -> Create Carousel Item (x10) -> Collect Children
 * -> Create Carousel Container (caption) -> Wait 20s -> Approved? ->
 * Publish + Permalink (PUBLISHED) : Not Approved (AWAITING_HUMAN_APPROVAL).
 *
 * The n8n uses the "Sorrel & Pip Instagram" Graph credential directly (no
 * /me/accounts page-token hop); here that maps to the shared IG access token.
 */

// Facebook Page whose linked IG business account is @sorrelandpip.
const SORRELPIP_PAGE_ID = "1373619562503420";
// Dry-run guard: Read Account should show this username before publishing.
const EXPECTED_USERNAME = "sorrelandpip";

const GRAPH = () => `https://graph.facebook.com/${env.graphVersion()}`;

// Carousel: Settings.caption (verbatim).
const CAPTION =
  "You don't owe a paragraph with every no. The moment you start listing reasons, you hand the other person something to argue with — and a clear boundary quietly turns into a negotiation.\n\nClear is kind. You can be warm, say no, and stop there. A reason is a gift you choose to give, never a tax you're required to pay.\n\nSave this for the next time you're tempted to over-explain, and send it to someone who apologizes too much. 👇\n— Sorrel & Pip\n\n#selfrespect #boundaries #confidence #emotionalintelligence #sayno";

// Carousel: Image List (10 slide URLs, verbatim).
const IMAGE_URLS = [
  "https://d8j0ntlcm91z4.cloudfront.net/user_32ZgfZc2L6tfBGBRTWykhhaFcP4/hf_20261001_055814_e2faea84-d0fb-4055-b5a8-3b86de262167.png",
  "https://d8j0ntlcm91z4.cloudfront.net/user_32ZgfZc2L6tfBGBRTWykhhaFcP4/hf_20261001_055814_04ebb664-a42b-43ec-a53c-32d4c9312ffd.png",
  "https://d8j0ntlcm91z4.cloudfront.net/user_32ZgfZc2L6tfBGBRTWykhhaFcP4/hf_20261001_060236_807ea98b-7cb5-4ec1-b48c-50f0d985244b.png",
  "https://d8j0ntlcm91z4.cloudfront.net/user_32ZgfZc2L6tfBGBRTWykhhaFcP4/hf_20261001_055814_8033a0d9-6924-41ae-90fb-079b91e0146b.png",
  "https://d8j0ntlcm91z4.cloudfront.net/user_32ZgfZc2L6tfBGBRTWykhhaFcP4/hf_20261001_060149_e0e4e20d-28e9-45bc-a333-ee68f7f50cd7.png",
  "https://d8j0ntlcm91z4.cloudfront.net/user_32ZgfZc2L6tfBGBRTWykhhaFcP4/hf_20261001_060149_9617326f-e0db-46c1-8300-0434ddeb3b37.png",
  "https://d8j0ntlcm91z4.cloudfront.net/user_32ZgfZc2L6tfBGBRTWykhhaFcP4/hf_20261001_060236_1785f484-bb4a-4c44-8b0c-b4b4b3a837e1.png",
  "https://d8j0ntlcm91z4.cloudfront.net/user_32ZgfZc2L6tfBGBRTWykhhaFcP4/hf_20261001_060149_4ee5c7f6-1b01-4b93-95bb-a575320059f8.png",
  "https://d8j0ntlcm91z4.cloudfront.net/user_32ZgfZc2L6tfBGBRTWykhhaFcP4/hf_20261001_060149_d08f9f3f-57d0-4969-b4eb-1ccf96415537.png",
  "https://d8j0ntlcm91z4.cloudfront.net/user_32ZgfZc2L6tfBGBRTWykhhaFcP4/hf_20261001_060236_2ba7498d-2bde-4117-9a21-09867d4fd25f.png",
];

interface ReadAccount {
  id: string;
  name?: string;
  instagram_business_account?: { id: string; username?: string };
}

export default defineWorkflow({
  id: "sorrelpip-instagram-carousel",
  name: "Sorrel & Pip - Instagram Carousel",
  n8nId: "pe29cLrjfNZRH4xW",
  brand: "sorrelpip",
  description:
    "Approval-gated Instagram carousel publisher for @sorrelandpip (EP-001): reads the linked IG business account, builds one container per slide, bundles into a CAROUSEL container, and publishes only when approved=true.",
  trigger: "manual",
  enabled: true,

  async run(ctx) {
    // Carousel: Settings — approved defaults to false (dry run), caption fixed.
    const approved = ((ctx.input ?? {}) as Record<string, unknown>).approved === true;
    const caption = CAPTION;
    await ctx.log("settings", { approved });

    // --- Carousel: Read Account (page -> instagram_business_account) ---
    const accUrl =
      `${GRAPH()}/${SORRELPIP_PAGE_ID}` +
      `?fields=id,name,instagram_business_account{id,username}` +
      `&access_token=${env.igAccessToken()}`;
    const account = await httpJson<ReadAccount>(accUrl);
    const igAccount = account.instagram_business_account;
    if (!igAccount?.id) {
      throw new Error(
        `Page ${SORRELPIP_PAGE_ID} has no linked instagram_business_account — ` +
          `@${EXPECTED_USERNAME} must be a Business/Creator account linked to a Facebook Page.`,
      );
    }
    const igUserId = env.igAccountOptional("sorrelpip") || igAccount.id;
    await ctx.log("account:read", { igUserId, username: igAccount.username });

    // Account guard — confirm we resolved @sorrelandpip before posting.
    if (igAccount.username && igAccount.username !== EXPECTED_USERNAME) {
      throw new Error(
        `Account guard failed: resolved @${igAccount.username}, expected @${EXPECTED_USERNAME}`,
      );
    }

    // --- Create Carousel Item (x10) ---
    const children: string[] = [];
    for (let i = 0; i < IMAGE_URLS.length; i++) {
      const id = await createCarouselItem(igUserId, IMAGE_URLS[i]);
      children.push(id);
      await ctx.log("item:created", { idx: i + 1, id });
    }

    // --- Collect Children -> Create Carousel Container ---
    const carouselId = await createCarouselContainer(igUserId, children, caption);
    await ctx.log("carousel:created", { carouselId, count: children.length });

    // Carousel: Wait (20s)
    await sleep(20_000);

    // --- Carousel Approved? ---
    if (!approved) {
      // Carousel Not Approved
      const data = {
        platform: "instagram_carousel",
        status: "AWAITING_HUMAN_APPROVAL",
        container_id: carouselId,
        next_step:
          "Container built but not published. Review slides, set approved=true, re-run to publish (container may expire after ~24h).",
      };
      await ctx.log("carousel:not-approved", data);
      return {
        summary: `Sorrel & Pip carousel built but NOT published (awaiting approval) — container ${carouselId}`,
        data,
      };
    }

    // --- Publish Carousel -> Read Carousel Permalink ---
    const mediaId = await publishContainer(igUserId, carouselId);
    const permaUrl = `${GRAPH()}/${mediaId}?fields=id,permalink&access_token=${env.igAccessToken()}`;
    const perma = await httpJson<{ id: string; permalink?: string }>(permaUrl);
    await ctx.log("carousel:published", { mediaId, permalink: perma.permalink });

    // Carousel Published
    const data = {
      platform: "instagram_carousel",
      status: "PUBLISHED",
      media_id: mediaId,
      permalink: perma.permalink ?? "",
    };
    return {
      summary: `Published Sorrel & Pip carousel (${children.length} slides) to @${EXPECTED_USERNAME}`,
      data,
    };
  },
});
