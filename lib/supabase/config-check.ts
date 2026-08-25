/**
 * Server components call this first so a fresh checkout without
 * .env.local configured yet shows a friendly setup message instead of
 * a crash — useful for local development and for reviewing the UI
 * before a Supabase project is wired up.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
