import type { Workflow } from "./types";

// --- Workflow modules ------------------------------------------------------
// Each file default-exports one `defineWorkflow({...})`.
// Grouped by brand; ids are unique across the whole registry.

// CocoGrove
import cocogroveStorytellingCarousel from "./cocogrove/storytelling-carousel";
import cocogroveCaptionAssistant from "./cocogrove/caption-assistant";
import cocogroveInstagramPerformanceReport from "./cocogrove/instagram-performance-report";
import cocogroveDailySalesReport from "./cocogrove/daily-sales-report";

// Tixuy
import tixuyPublishCsraoul from "./tixuy/publish-csraoul";
import tixuyRealisticAvatarPost from "./tixuy/realistic-avatar-post";
import tixuyReelTrendingMusic from "./tixuy/reel-trending-music";
import tixuyInstagramCarouselPost from "./tixuy/instagram-carousel-post";
import tixuyInstagramAutoPostCarousel from "./tixuy/instagram-auto-post-carousel";

// Nia Nova
import nianovaApprovedReels from "./nianova/approved-reels";
import nianovaInstagramAutoPost from "./nianova/instagram-auto-post";
import nianovaDailyTiktokBrief from "./nianova/daily-tiktok-brief";

// Sorrel & Pip
import sorrelpipInstagramCarousel from "./sorrelpip/instagram-carousel";

// essiby
import essibyVideoPost from "./essiby/video-post";

// The Ember Wolf
import emberwolfEpisodeGenerator from "./emberwolf/episode-generator";

// Shared / cross-brand
import sharedInstagramPerformanceReport from "./shared/instagram-performance-report";
import sharedInstagramCompetitorTrendTracker from "./shared/instagram-competitor-trend-tracker";

const all: Workflow[] = [
  // CocoGrove
  cocogroveStorytellingCarousel,
  cocogroveCaptionAssistant,
  cocogroveInstagramPerformanceReport,
  cocogroveDailySalesReport,
  // Tixuy
  tixuyPublishCsraoul,
  tixuyRealisticAvatarPost,
  tixuyReelTrendingMusic,
  tixuyInstagramCarouselPost,
  tixuyInstagramAutoPostCarousel,
  // Nia Nova
  nianovaApprovedReels,
  nianovaInstagramAutoPost,
  nianovaDailyTiktokBrief,
  // Sorrel & Pip
  sorrelpipInstagramCarousel,
  // essiby
  essibyVideoPost,
  // Ember Wolf
  emberwolfEpisodeGenerator,
  // Shared
  sharedInstagramPerformanceReport,
  sharedInstagramCompetitorTrendTracker,
];

export const registry: Record<string, Workflow> = Object.fromEntries(
  all.map((w) => [w.id, w]),
);

export function getWorkflow(id: string): Workflow | undefined {
  return registry[id];
}

export function listWorkflows(): Workflow[] {
  return [...all].sort((a, b) => a.brand.localeCompare(b.brand) || a.id.localeCompare(b.id));
}

/** Scheduled + enabled workflows — used to generate vercel.json cron entries. */
export function scheduledWorkflows(): Workflow[] {
  return all.filter((w) => w.enabled && w.trigger === "schedule" && w.schedule);
}
