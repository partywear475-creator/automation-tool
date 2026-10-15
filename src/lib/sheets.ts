import crypto from "node:crypto";
import { env } from "./env";
import { httpJson } from "./http";

/**
 * Minimal Google Sheets append — used by the report + tracker workflows that
 * log a row to a spreadsheet. Authenticates a service account with a signed JWT
 * (no googleapis dependency).
 *
 * Set GOOGLE_SERVICE_ACCOUNT_JSON to the full service-account JSON (as a string),
 * and share the target sheet with that service account's client_email.
 */

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let _tokenCache: { token: string; exp: number } | null = null;

async function accessToken(): Promise<string> {
  if (_tokenCache && _tokenCache.exp > Date.now() + 60_000) return _tokenCache.token;

  const raw = env.googleServiceAccountJson();
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON not set");
  const sa = JSON.parse(raw) as ServiceAccount;

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const signature = base64url(signer.sign(sa.private_key));
  const jwt = `${header}.${claim}.${signature}`;

  const tok = await httpJson<{ access_token: string; expires_in: number }>(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }).toString(),
    },
  );
  _tokenCache = { token: tok.access_token, exp: Date.now() + tok.expires_in * 1000 };
  return tok.access_token;
}

/** Append a single row to a sheet tab (e.g. "Sheet1"). */
export async function appendRow(spreadsheetId: string, tab: string, row: (string | number)[]): Promise<void> {
  const token = await accessToken();
  const range = encodeURIComponent(`${tab}!A1`);
  await httpJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ values: [row] }),
    },
  );
}
