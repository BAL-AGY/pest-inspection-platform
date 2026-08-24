import { redirect } from "next/navigation";
import { requireSession } from "@/lib/require-session";
import { getDashboardMetrics } from "@/lib/dashboard-metrics";
import { computeChannelPerformance } from "@/lib/integrations/channel-performance";
import { CHANNELS, channelConnectionStatus, type ChannelCategory } from "@/lib/integrations/channels";
import { Badge, Card, EmptyState, SectionHeader, StatCard } from "../ui";

const money = (cents: number | null) => (cents === null ? "Unavailable" : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`);
const CATEGORY_LABELS: Record<ChannelCategory, string> = {
  media_spend: "Media spend",
  outreach_cost: "Outreach cost",
  platform_cost: "Platform cost",
  organic: "Organic",
};

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ range?: string; start?: string; end?: string }> }) {
  const session = await requireSession();
  if (!session) redirect("/login");
  const query = await searchParams;
  const m = await getDashboardMetrics(session.companyId, { preset: query.range, start: query.start, end: query.end });
  const channelPerformance = computeChannelPerformance(m.marketingPerformance);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Acquisition Integrations</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-500">Connect every channel that generates customers and track performance from first touch to revenue.</p>
      </div>

      {/* Unified summary — reuses the exact same top-line numbers as the
          Overview Command Center, never a second/divergent calculation. */}
      <section>
        <SectionHeader title="Total acquisition performance" hint="All channels combined, this range." />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Total spend" value={money(m.marketingSpendCents)} />
          <StatCard label="Total leads" value={m.newLeads} />
          <StatCard label="Qualified" value={m.qualifiedCount} />
          <StatCard label="Bookings" value={m.bookedCount} accent />
          <StatCard label="Customers" value={m.customersWon} />
          <StatCard label="Revenue" value={money(m.revenueCents)} accent />
          <StatCard label="Blended CAC" value={money(m.cac)} hint="Marketing spend ÷ customers won" />
          <StatCard label="Blended ROAS" value={m.roas === null ? "Unavailable" : `${m.roas.toFixed(2)}x`} hint="Revenue ÷ marketing spend" />
        </div>
      </section>

      <section>
        <SectionHeader title="Channel breakdown" hint="Real attributed leads/bookings/revenue per channel, this range. Spend shown only where logged." />
        {channelPerformance.length === 0 ? (
          <EmptyState title="No channel activity yet in this range" body="Once leads start arriving with UTM attribution, each channel's real performance will appear here." />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {channelPerformance.map((c) => (
              <Card key={c.channel.id} className="p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-zinc-900">{c.channel.label}</h3>
                  <Badge tone="neutral">{CATEGORY_LABELS[c.channel.category]}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <Field label="Spend" value={money(c.spendCents)} />
                  <Field label="Revenue" value={money(c.revenueCents)} />
                  <Field label="Leads" value={String(c.leads)} />
                  <Field label="Customers" value={String(c.customers)} />
                  <Field label="ROAS" value={c.roas === null ? "Unavailable" : `${c.roas.toFixed(2)}x`} />
                  <Field label="CAC" value={money(c.cac)} />
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeader title="Connect a channel" hint="Real connection status only — nothing here is simulated. Unconnected channels never show spend or performance." />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CHANNELS.map((channel) => {
            const status = channelConnectionStatus(channel);
            const performance = channelPerformance.find((c) => c.channel.id === channel.id);
            return (
              <Card key={channel.id} className="flex flex-col p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-zinc-900">{channel.label}</h3>
                  <Badge tone={status === "connected" ? "emerald" : "neutral"}>{status === "connected" ? "Connected" : "Not connected"}</Badge>
                </div>
                <p className="text-sm text-zinc-500">{channel.description}</p>

                {status === "connected" && performance ? (
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <Field label="Spend this range" value={money(performance.spendCents)} />
                    <Field label="Leads" value={String(performance.leads)} />
                    <Field label="Bookings" value={String(performance.booked)} />
                    <Field label="Customers" value={String(performance.customers)} />
                    <Field label="Revenue" value={money(performance.revenueCents)} />
                    <Field label="ROAS" value={performance.roas === null ? "Unavailable" : `${performance.roas.toFixed(2)}x`} />
                  </div>
                ) : (
                  <details className="mt-3 text-xs text-zinc-500">
                    <summary className="cursor-pointer font-medium text-emerald-700">What connecting this imports</summary>
                    <ul className="mt-2 flex flex-col gap-1 pl-4">
                      {channel.imports.map((item) => (
                        <li key={item} className="list-disc">{item}</li>
                      ))}
                    </ul>
                  </details>
                )}

                <div className="mt-4">
                  {channel.hasAdapter ? (
                    <button
                      type="button"
                      disabled
                      title="Requires META_ACCESS_TOKEN/GOOGLE_ADS credentials configured server-side — contact your platform administrator."
                      className="w-full cursor-not-allowed rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2 text-sm font-semibold text-zinc-400"
                    >
                      Connect {channel.label}
                    </button>
                  ) : (
                    <p className="text-xs text-zinc-400">Integration adapter not built yet — see docs/marketing-intelligence/README.md.</p>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[10px] font-medium uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="truncate text-sm font-semibold text-zinc-900">{value}</p>
    </div>
  );
}
