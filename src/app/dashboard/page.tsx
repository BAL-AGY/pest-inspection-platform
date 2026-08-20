import { redirect } from "next/navigation";
import { requireSession } from "@/lib/require-session";
import { getDashboardMetrics } from "@/lib/dashboard-metrics";

function fmtCents(cents: number | null): string {
  if (cents === null) return "No data yet";
  return `$${(cents / 100).toFixed(2)}`;
}
function fmtPct(rate: number | null): string {
  if (rate === null) return "No data yet";
  return `${(rate * 100).toFixed(0)}%`;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-4">
      <p className="text-sm text-zinc-500">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}

export default async function DashboardOverviewPage() {
  const session = await requireSession();
  if (!session) redirect("/login");

  const m = await getDashboardMetrics(session.companyId);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">Overview</h1>
        <p className="text-zinc-500 text-sm mt-1">
          North star: cost per qualified booked inspection —{" "}
          <strong>{fmtCents(m.costMetrics.costPerBookedInspectionCents)}</strong>
        </p>
      </div>

      <section>
        <h2 className="text-sm font-semibold text-zinc-500 uppercase mb-3">Inspections</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Booked today" value={m.inspectionsToday} />
          <Stat label="Booked this week" value={m.inspectionsThisWeek} />
          <Stat label="Completed" value={m.completedInspections} />
          <Stat label="Show rate" value={fmtPct(m.showRate)} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-zinc-500 uppercase mb-3">Funnel</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="New leads" value={m.newLeads} />
          <Stat label="MQLs" value={m.mqlCount} />
          <Stat label="SQLs" value={m.sqlCount} />
          <Stat label="Booked inspections" value={m.bookedCount} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-zinc-500 uppercase mb-3">Outcomes</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Customers won" value={m.customersWon} />
          <Stat label="Customers lost" value={m.customersLost} />
          <Stat label="Close rate" value={fmtPct(m.closeRate)} />
          <Stat label="Revenue attributed" value={fmtCents(m.revenueCents)} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-zinc-500 uppercase mb-3">
          Marketing economics
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Marketing spend" value={fmtCents(m.marketingSpendCents)} />
          <Stat label="Cost per lead" value={fmtCents(m.costMetrics.costPerLeadCents)} />
          <Stat label="Cost per SQL" value={fmtCents(m.costMetrics.costPerSqlCents)} />
          <Stat
            label="Cost per booked inspection"
            value={fmtCents(m.costMetrics.costPerBookedInspectionCents)}
          />
          <Stat label="Customer acquisition cost" value={fmtCents(m.cac)} />
          <Stat label="Return on ad spend" value={m.roas === null ? "No data yet" : `${m.roas.toFixed(2)}x`} />
        </div>
        {m.marketingSpendCents === null && (
          <p className="text-sm text-zinc-500 mt-2">
            Enter marketing spend under Marketing to see real cost-per-lead figures.
          </p>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-zinc-500 uppercase mb-3">
          Funnel drop-off
        </h2>
        <div className="bg-white border border-zinc-200 rounded-lg divide-y divide-zinc-100">
          {m.stageRates.map((r) => (
            <div key={`${r.from}-${r.to}`} className="flex justify-between px-4 py-3 text-sm">
              <span className="text-zinc-600">
                {r.from} → {r.to}
              </span>
              <span className="font-medium">
                {r.rate === null ? "No data yet" : `${(r.rate * 100).toFixed(0)}% converted`}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
