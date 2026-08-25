import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient as createRawClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client for use inside Server Components and Route
 * Handlers. Carries the caller's session, so all queries are subject to
 * Row-Level Security exactly as if made from the browser. This is the
 * client every dashboard page and every RBAC-scoped API route should use.
 */
export async function createServerSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from a Server Component that can't set cookies — safe to
          // ignore as long as middleware is refreshing the session.
        }
      },
    },
  });
}

/**
 * Service-role Supabase client. BYPASSES Row-Level Security entirely.
 *
 * Restricted to:
 *  - the KPI calculation engine (lib/calc-engine/**), which by design
 *    must read/write across all employees to compute peer benchmarks
 *  - the Excel import pipeline (lib/import/**), which writes to staging
 *    and conformed tables before any per-row RBAC context exists
 *
 * NEVER import this from a client component, and never use it to serve
 * a single user's dashboard request — that must go through
 * createServerSupabaseClient() so RLS scoping applies.
 */
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. This client is " +
        "only for server-only calc-engine/import code and must never run in the browser."
    );
  }

  return createRawClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
