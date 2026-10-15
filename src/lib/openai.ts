import OpenAI from "openai";
import { env } from "./env";

let _client: OpenAI | null = null;
export function openai(): OpenAI {
  if (!_client) _client = new OpenAI({ apiKey: env.openaiKey() });
  return _client;
}

/**
 * gpt-5 / o-series reasoning models only accept the default temperature (1),
 * and error on any explicit non-default value. Detect them so we can omit it.
 */
function fixedTemperatureModel(model: string): boolean {
  return /^(gpt-5|o1|o3|o4)/.test(model);
}

/** Plain text/JSON generation. Pass a JSON schema name to force structured output. */
export async function generateText(opts: {
  system?: string;
  prompt: string;
  model?: string;
  json?: boolean;
  temperature?: number;
}): Promise<string> {
  const model = opts.model ?? "gpt-4o";
  const res = await openai().chat.completions.create({
    model,
    // Omit temperature for models that only allow the default, else it 400s.
    ...(fixedTemperatureModel(model) ? {} : { temperature: opts.temperature ?? 0.8 }),
    response_format: opts.json ? { type: "json_object" } : undefined,
    messages: [
      ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
      { role: "user" as const, content: opts.prompt },
    ],
  });
  return res.choices[0]?.message?.content ?? "";
}

export async function generateJson<T = unknown>(opts: {
  system?: string;
  prompt: string;
  model?: string;
  temperature?: number;
}): Promise<T> {
  const text = await generateText({ ...opts, json: true });
  return JSON.parse(text) as T;
}

/**
 * Image generation with gpt-image-1 (the CocoGrove Storytelling Carousel model).
 * Returns a PNG buffer. `size` e.g. "1024x1024", "1024x1536" (portrait).
 */
export async function generateImage(opts: {
  prompt: string;
  size?: "1024x1024" | "1536x1024" | "1024x1536" | "auto";
  quality?: "low" | "medium" | "high" | "auto";
}): Promise<Buffer> {
  const res = await openai().images.generate({
    model: "gpt-image-1",
    prompt: opts.prompt,
    size: opts.size ?? "1024x1024",
    quality: opts.quality ?? "high",
    n: 1,
  });
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error("gpt-image-1 returned no image data");
  return Buffer.from(b64, "base64");
}
