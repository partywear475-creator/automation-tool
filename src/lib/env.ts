/**
 * Typed, validated access to environment variables.
 * Throws early (at first use) with a clear message instead of failing deep
 * inside a workflow with `undefined`.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const env = {
  // Security
  cronSecret: () => required("CRON_SECRET"),

  // Supabase
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseServiceKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  supabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  storageBucket: () => optional("SUPABASE_STORAGE_BUCKET", "automation-assets"),

  // OpenAI
  openaiKey: () => required("OPENAI_API_KEY"),

  // Google Gemini (Ember Wolf, Nia Nova briefs that used Gemini)
  geminiKey: () => optional("GEMINI_API_KEY"),

  // Instagram / Meta Graph API
  igAccessToken: () => required("IG_ACCESS_TOKEN"),
  igAccount: (brand: string) => required(`IG_${brand.toUpperCase()}_BUSINESS_ACCOUNT_ID`),
  igAccountOptional: (brand: string) => optional(`IG_${brand.toUpperCase()}_BUSINESS_ACCOUNT_ID`),
  fbPageId: (brand: string) => optional(`FB_${brand.toUpperCase()}_PAGE_ID`),
  graphVersion: () => optional("GRAPH_API_VERSION", "v23.0"),

  // Cloudinary (faithful-port dependency: several workflows re-upload media here)
  cloudinaryCloud: () => optional("CLOUDINARY_CLOUD_NAME"),
  cloudinaryKey: () => optional("CLOUDINARY_API_KEY"),
  cloudinarySecret: () => optional("CLOUDINARY_API_SECRET"),
  cloudinaryUploadPreset: () => optional("CLOUDINARY_UPLOAD_PRESET"),

  // Square (CocoGrove daily sales report)
  squareToken: () => optional("SQUARE_ACCESS_TOKEN"),
  squareEnv: () => optional("SQUARE_ENVIRONMENT", "production"),
  squareLocationId: () => optional("SQUARE_LOCATION_ID"),

  // Google Sheets (reports/trackers log here)
  googleServiceAccountJson: () => optional("GOOGLE_SERVICE_ACCOUNT_JSON"),

  // Email (Resend)
  resendKey: () => optional("RESEND_API_KEY"),
  reportFrom: () => optional("REPORT_FROM_EMAIL", "reports@example.com"),
  reportTo: () => optional("REPORT_TO_EMAIL"),
};
