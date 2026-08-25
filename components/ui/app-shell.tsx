import Link from "next/link";

const NAV_SECTIONS: { title: string; items: { href: string; label: string }[] }[] = [
  {
    title: "Overview",
    items: [{ href: "/", label: "Executive Dashboard" }],
  },
  {
    title: "Layer 1 — Skill Intelligence",
    items: [
      { href: "/skill-intelligence", label: "Skill Intelligence" },
      { href: "/skill-matrix", label: "Skill Matrix" },
      { href: "/compare", label: "Compare Employees" },
      { href: "/team-builder", label: "Team Builder" },
    ],
  },
  {
    title: "Layer 2 — Performance Evidence",
    items: [{ href: "/performance-evidence", label: "Performance Evidence" }],
  },
  {
    title: "Layer 3 — Labor Analytics",
    items: [
      { href: "/labor-analytics", label: "Productivity / Labor Analytics" },
      { href: "/labor-cost", label: "Labor Cost" },
    ],
  },
  {
    title: "Layer 4 — Skill Gap",
    items: [{ href: "/gap-review-queue", label: "Skill Gap & Development" }],
  },
  {
    title: "Teams",
    items: [{ href: "/teams", label: "Supervisor / Team Analysis" }],
  },
  {
    title: "Analysis",
    items: [
      { href: "/trend", label: "Trend Analysis" },
      { href: "/assistant", label: "AI Workforce Assistant" },
    ],
  },
  {
    title: "Admin",
    items: [
      { href: "/data-quality", label: "Data Quality" },
      { href: "/admin/import", label: "Excel Upload / Import History" },
      { href: "/admin/weight-profiles", label: "Weight Profiles" },
      { href: "/admin/target-skill-profiles", label: "Target Skill Profiles" },
      { href: "/admin/users", label: "Users & Roles" },
      { href: "/kpi-dictionary", label: "KPI Dictionary" },
    ],
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="w-64 shrink-0 border-r border-gray-200 bg-white px-4 py-6">
        <div className="mb-6 px-2">
          <div className="text-sm font-semibold text-gray-900">JV Skill Intelligence</div>
          <div className="text-xs text-gray-500">4-layer workforce analytics</div>
        </div>
        <nav className="space-y-6">
          {NAV_SECTIONS.map((section) => (
            <div key={section.title}>
              <div className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                {section.title}
              </div>
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="block rounded px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 px-8 py-6">{children}</main>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  layerBadge,
}: {
  title: string;
  description?: string;
  layerBadge?: string;
}) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
        {layerBadge && (
          <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
            {layerBadge}
          </span>
        )}
      </div>
      {description && <p className="mt-1 text-sm text-gray-600">{description}</p>}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-white px-6 py-12 text-center text-sm text-gray-500">
      {message}
    </div>
  );
}
