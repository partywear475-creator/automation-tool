import { env } from "./env";
import { httpJson } from "./http";

/**
 * Minimal Google Gemini text client — used by workflows that originally ran on
 * Gemini (The Ember Wolf episode generator; some Nia Nova briefs).
 * REST call so we don't pull in another SDK.
 */
export async function geminiGenerate(opts: {
  prompt: string;
  system?: string;
  model?: string;
  json?: boolean;
}): Promise<string> {
  const key = env.geminiKey();
  if (!key) throw new Error("GEMINI_API_KEY not set");
  const model = opts.model ?? "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const body = await httpJson<{ candidates: Array<{ content: { parts: Array<{ text: string }> } }> }>(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
      contents: [{ parts: [{ text: opts.prompt }] }],
      ...(opts.json ? { generationConfig: { responseMimeType: "application/json" } } : {}),
    }),
  });
  return body.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}
