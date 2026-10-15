/** Tiny fetch helpers with sane errors and simple retry. */

export async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function httpJson<T = any>(
  url: string,
  init?: RequestInit & { retries?: number },
): Promise<T> {
  const retries = init?.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, init);
      const text = await res.text();
      const body = text ? safeParse(text) : null;
      if (!res.ok) {
        throw new Error(
          `HTTP ${res.status} ${res.statusText} for ${redact(url)} :: ${text.slice(0, 500)}`,
        );
      }
      return body as T;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(500 * (attempt + 1));
    }
  }
  throw lastErr;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Strip access_token query params before putting a URL in an error/log. */
export function redact(url: string): string {
  return url.replace(/access_token=[^&]+/g, "access_token=***");
}
