import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

/**
 * Server-side client using the service role key. Bypasses RLS.
 * NEVER import this into a client component.
 */
let _service: SupabaseClient | null = null;
export function supabaseService(): SupabaseClient {
  if (!_service) {
    _service = createClient(env.supabaseUrl(), env.supabaseServiceKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _service;
}

/**
 * Public (anon) client for the dashboard — read-only via RLS.
 */
let _anon: SupabaseClient | null = null;
export function supabaseAnon(): SupabaseClient {
  if (!_anon) {
    _anon = createClient(env.supabaseUrl(), env.supabaseAnonKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _anon;
}
