import { env } from "./env";

/**
 * Cloudinary re-upload hop.
 *
 * Faithful-port note: the n8n workflows download the source image (often a
 * Higgsfield CloudFront PNG) and re-upload it to Cloudinary, then hand
 * Instagram a `f_jpg,q_auto` JPEG URL. This exists because the IG Graph API
 * rejects some source URLs / PNGs; Cloudinary normalises format + hosting.
 *
 * Original workflow used cloud `e38kpvav`, unsigned upload preset `n9o5mzxk`.
 * Those now come from env so they aren't baked into code.
 */

/** Upload a remote image URL (or data buffer) to Cloudinary, return secure_url. */
export async function uploadToCloudinary(source: string | Buffer): Promise<string> {
  const cloud = env.cloudinaryCloud();
  const preset = env.cloudinaryUploadPreset();
  if (!cloud || !preset) {
    throw new Error(
      "Cloudinary not configured — set CLOUDINARY_CLOUD_NAME and CLOUDINARY_UPLOAD_PRESET",
    );
  }

  const form = new FormData();
  if (typeof source === "string") {
    // Cloudinary can fetch a remote URL directly — avoids the download hop.
    form.append("file", source);
  } else {
    form.append("file", new Blob([new Uint8Array(source)]));
  }
  form.append("upload_preset", preset);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, {
    method: "POST",
    body: form,
  });
  const body = (await res.json()) as { secure_url?: string; error?: { message: string } };
  if (!res.ok || !body.secure_url) {
    throw new Error(`Cloudinary upload failed: ${body.error?.message ?? res.statusText}`);
  }
  return body.secure_url;
}

/** Apply the `f_jpg,q_auto` transform the workflows use before handing to IG. */
export function toJpegUrl(secureUrl: string): string {
  return secureUrl.replace("/upload/", "/upload/f_jpg,q_auto/");
}

/** Upload + JPEG transform in one step. */
export async function cloudinaryJpeg(source: string | Buffer): Promise<string> {
  return toJpegUrl(await uploadToCloudinary(source));
}
