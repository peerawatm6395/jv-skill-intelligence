export function SetupNotice() {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-6 py-8 text-sm text-amber-900">
      <p className="font-medium">Supabase is not configured yet.</p>
      <p className="mt-1">
        Copy <code className="rounded bg-amber-100 px-1">.env.example</code> to{" "}
        <code className="rounded bg-amber-100 px-1">.env.local</code> and fill in your Supabase
        project&apos;s URL and keys, then run the migrations in{" "}
        <code className="rounded bg-amber-100 px-1">supabase/migrations/</code> and seed data with{" "}
        <code className="rounded bg-amber-100 px-1">supabase/seed.sql</code>. For a UI preview
        with synthetic data, run <code className="rounded bg-amber-100 px-1">npm run seed</code>{" "}
        after connecting to a project.
      </p>
    </div>
  );
}
