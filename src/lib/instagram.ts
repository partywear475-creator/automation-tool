import { env } from "./env";
import { httpJson, redact, sleep } from "./http";

/**
 * Instagram / Meta Graph API client.
 *
 * Covers every Graph operation the migrated n8n workflows used:
 *  - resolve a Page access token from /me/accounts
 *  - account guard (verify we're posting to the intended IG user)
 *  - single-image, carousel and Reel publishing (container -> poll -> publish)
 *  - Business Discovery (competitor tracker)
 *  - account + media insights (performance reports)
 *
 * The two-step publish mirrors the workflows exactly: create a media container,
 * wait for it to finish processing, then call media_publish.
 */

const GRAPH = () => `https://graph.facebook.com/${env.graphVersion()}`;

function token(explicit?: string): string {
  return explicit ?? env.igAccessToken();
}

// --- Page token resolution -------------------------------------------------

export interface FacebookPage {
  id: string;
  name: string;
  access_token: string;
}

/** GET /me/accounts and return the Page whose name matches (exact, as the workflows do). */
export async function resolvePageToken(pageName: string, accessToken?: string): Promise<FacebookPage> {
  const url = `${GRAPH()}/me/accounts?fields=id,name,access_token&access_token=${token(accessToken)}`;
  const body = await httpJson<{ data: FacebookPage[] }>(url);
  const pages = body.data ?? [];
  const match = pages.find((p) => p.name === pageName);
  if (!match) {
    throw new Error(
      `No Facebook Page named "${pageName}" in /me/accounts. Pages: ${pages.map((p) => p.name).join(", ") || "(none)"}`,
    );
  }
  return match;
}

// --- Account guard ---------------------------------------------------------

/**
 * Verify the IG Business account we're about to post to is the expected one.
 * Several workflows guard on this to prevent cross-posting to the wrong brand.
 */
export async function assertAccount(igUserId: string, expectedId: string, accessToken?: string): Promise<void> {
  if (igUserId !== expectedId) {
    throw new Error(`Account guard failed: target ${igUserId} !== expected ${expectedId}`);
  }
  // Also confirm the id resolves and the token can see it.
  const url = `${GRAPH()}/${igUserId}?fields=id,username&access_token=${token(accessToken)}`;
  const body = await httpJson<{ id: string; username?: string }>(url);
  if (body.id !== expectedId) {
    throw new Error(`Account guard failed: Graph returned id ${body.id} for ${igUserId}`);
  }
}

// --- Container creation ----------------------------------------------------

async function postMedia(
  igUserId: string,
  params: Record<string, string | boolean>,
  accessToken?: string,
): Promise<string> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  qs.set("access_token", token(accessToken));
  const url = `${GRAPH()}/${igUserId}/media?${qs.toString()}`;
  const body = await httpJson<{ id: string }>(url, { method: "POST", retries: 3 });
  if (!body.id) throw new Error(`No container id returned from ${redact(url)}`);
  return body.id;
}

export function createImageContainer(
  igUserId: string,
  imageUrl: string,
  caption: string,
  accessToken?: string,
): Promise<string> {
  return postMedia(igUserId, { image_url: imageUrl, caption }, accessToken);
}

export function createCarouselItem(
  igUserId: string,
  imageUrl: string,
  accessToken?: string,
): Promise<string> {
  return postMedia(igUserId, { image_url: imageUrl, is_carousel_item: true }, accessToken);
}

export function createCarouselContainer(
  igUserId: string,
  childrenIds: string[],
  caption: string,
  accessToken?: string,
): Promise<string> {
  return postMedia(
    igUserId,
    { media_type: "CAROUSEL", children: childrenIds.join(","), caption },
    accessToken,
  );
}

export function createReelContainer(
  igUserId: string,
  videoUrl: string,
  caption: string,
  opts?: { shareToFeed?: boolean; coverUrl?: string; audioName?: string },
  accessToken?: string,
): Promise<string> {
  const params: Record<string, string | boolean> = {
    media_type: "REELS",
    video_url: videoUrl,
    caption,
    share_to_feed: opts?.shareToFeed ?? true,
  };
  if (opts?.coverUrl) params.cover_url = opts.coverUrl;
  if (opts?.audioName) params.audio_name = opts.audioName;
  return postMedia(igUserId, params, accessToken);
}

// --- Poll + publish --------------------------------------------------------

/**
 * Poll a container until FINISHED. Images are usually instant (the workflows
 * just Wait 15s); videos/Reels need real polling. Default budget ~5 min.
 */
export async function waitForContainer(
  creationId: string,
  opts?: { intervalMs?: number; maxAttempts?: number },
  accessToken?: string,
): Promise<void> {
  const interval = opts?.intervalMs ?? 10_000;
  const maxAttempts = opts?.maxAttempts ?? 30;
  for (let i = 0; i < maxAttempts; i++) {
    const url = `${GRAPH()}/${creationId}?fields=status_code,status&access_token=${token(accessToken)}`;
    const body = await httpJson<{ status_code: string; status?: string }>(url);
    if (body.status_code === "FINISHED") return;
    if (body.status_code === "ERROR" || body.status_code === "EXPIRED") {
      throw new Error(`Container ${creationId} failed: ${body.status_code} — ${body.status ?? ""}`);
    }
    await sleep(interval);
  }
  throw new Error(`Container ${creationId} not FINISHED after ${maxAttempts} attempts`);
}

export async function publishContainer(
  igUserId: string,
  creationId: string,
  accessToken?: string,
): Promise<string> {
  const url = `${GRAPH()}/${igUserId}/media_publish?creation_id=${creationId}&access_token=${token(accessToken)}`;
  const body = await httpJson<{ id: string }>(url, { method: "POST", retries: 3 });
  return body.id;
}

// --- High-level publish helpers -------------------------------------------

export interface PublishResult {
  mediaId: string;
  creationId: string;
}

/** Single image: container -> (fixed wait, as the workflows do) -> publish. */
export async function publishSingleImage(args: {
  igUserId: string;
  imageUrl: string;
  caption: string;
  waitMs?: number;
  accessToken?: string;
}): Promise<PublishResult> {
  const creationId = await createImageContainer(args.igUserId, args.imageUrl, args.caption, args.accessToken);
  await sleep(args.waitMs ?? 15_000); // workflows use a 15s Wait before publishing images
  const mediaId = await publishContainer(args.igUserId, creationId, args.accessToken);
  return { mediaId, creationId };
}

/** Carousel: one item container per image -> CAROUSEL container -> publish. */
export async function publishCarousel(args: {
  igUserId: string;
  imageUrls: string[];
  caption: string;
  accessToken?: string;
}): Promise<PublishResult> {
  const children: string[] = [];
  for (const imageUrl of args.imageUrls) {
    children.push(await createCarouselItem(args.igUserId, imageUrl, args.accessToken));
  }
  const creationId = await createCarouselContainer(args.igUserId, children, args.caption, args.accessToken);
  await waitForContainer(creationId, { intervalMs: 5_000, maxAttempts: 12 }, args.accessToken);
  const mediaId = await publishContainer(args.igUserId, creationId, args.accessToken);
  return { mediaId, creationId };
}

/** Reel: REELS container -> poll until FINISHED -> publish. */
export async function publishReel(args: {
  igUserId: string;
  videoUrl: string;
  caption: string;
  shareToFeed?: boolean;
  coverUrl?: string;
  audioName?: string;
  accessToken?: string;
}): Promise<PublishResult> {
  const creationId = await createReelContainer(
    args.igUserId,
    args.videoUrl,
    args.caption,
    { shareToFeed: args.shareToFeed, coverUrl: args.coverUrl, audioName: args.audioName },
    args.accessToken,
  );
  await waitForContainer(creationId, { intervalMs: 10_000, maxAttempts: 30 }, args.accessToken);
  const mediaId = await publishContainer(args.igUserId, creationId, args.accessToken);
  return { mediaId, creationId };
}

// --- Read: Business Discovery (competitor tracker) -------------------------

export interface BusinessDiscoveryStats {
  username: string;
  followers_count: number;
  follows_count: number;
  media_count: number;
  recentMedia: Array<{ like_count?: number; comments_count?: number; timestamp?: string; caption?: string }>;
}

export async function businessDiscovery(
  igUserId: string,
  targetUsername: string,
  accessToken?: string,
): Promise<BusinessDiscoveryStats> {
  const fields =
    `business_discovery.username(${targetUsername})` +
    `{username,followers_count,follows_count,media_count,media.limit(12){like_count,comments_count,timestamp,caption}}`;
  const url = `${GRAPH()}/${igUserId}?fields=${encodeURIComponent(fields)}&access_token=${token(accessToken)}`;
  const body = await httpJson<{ business_discovery: any }>(url);
  const bd = body.business_discovery;
  return {
    username: bd.username,
    followers_count: bd.followers_count,
    follows_count: bd.follows_count,
    media_count: bd.media_count,
    recentMedia: bd.media?.data ?? [],
  };
}

// --- Read: account + media insights (performance reports) ------------------

export async function getAccount(
  igUserId: string,
  accessToken?: string,
): Promise<{ username: string; followers_count: number; media_count: number }> {
  const url = `${GRAPH()}/${igUserId}?fields=username,followers_count,media_count&access_token=${token(accessToken)}`;
  return httpJson(url);
}

export async function getRecentMedia(
  igUserId: string,
  limit = 25,
  accessToken?: string,
): Promise<Array<{ id: string; caption?: string; like_count?: number; comments_count?: number; timestamp?: string; media_type?: string }>> {
  const url = `${GRAPH()}/${igUserId}/media?fields=id,caption,like_count,comments_count,timestamp,media_type&limit=${limit}&access_token=${token(accessToken)}`;
  const body = await httpJson<{ data: any[] }>(url);
  return body.data ?? [];
}

export async function getAccountInsights(
  igUserId: string,
  metrics: string[],
  period = "day",
  accessToken?: string,
): Promise<Record<string, number>> {
  const url = `${GRAPH()}/${igUserId}/insights?metric=${metrics.join(",")}&period=${period}&access_token=${token(accessToken)}`;
  const body = await httpJson<{ data: Array<{ name: string; values: Array<{ value: number }> }> }>(url);
  const out: Record<string, number> = {};
  for (const m of body.data ?? []) out[m.name] = m.values?.[0]?.value ?? 0;
  return out;
}
