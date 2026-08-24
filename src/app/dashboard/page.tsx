import { redirect } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/require-session";
import { getDashboardMetrics, getFunnelStageLeads } from "@/lib/dashboard-metrics";
import { QUALIFICATION_QUESTIONS } from "@/lib/qualification";
import { formatInCompanyTime } from "@/lib/timezone";
import { humanizePestLabel } from "@/lib/service-catalog";
import FunnelDiagram from "./funnel-diagram";
import RefreshControl from "./refresh-control";

const money = (value: number | null) => value === null ? "Unavailable" : `$${(value / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const percent = (value: number | null) => value === null ? "Unavailable" : `${(value * 100).toFixed(0)}%`;
function Stat({ label, value, accent = false, hint }: { label: string; value: string | number; accent?: boolean; hint?: string }) {
  return <div className={`rounded-xl border p-4 ${accent ? "border-emerald-200 bg-emerald-50" : "border-zinc-200 bg-white"}`} title={hint}><p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p>{hint && <p className="mt-1 text-xs text-zinc-400">{hint}</p>}</div>;
}
function HeroStat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm" title={hint}>
      <p className="truncate text-[11px] font-medium uppercase tracking-wide text-emerald-200/80">{label}</p>
      <p className="mt-1 truncate text-2xl font-bold text-white">{value}</p>
    </div>
  );
}

export default async function DashboardOverviewPage({ searchParams }: { searchParams: Promise<{ range?: string; start?: string; end?: string }> }) {
  const session = await requireSession(); if (!session) redirect("/login");
  const query = await searchParams;
  const rangeOptions = { preset: query.range, start: query.start, end: query.end };
  const [m, stageLeads] = await Promise.all([
    getDashboardMetrics(session.companyId, rangeOptions),
    getFunnelStageLeads(session.companyId, rangeOptions),
  ]);
  return <div className="flex flex-col gap-8">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><div className="flex items-center gap-3"><h1 className="text-2xl font-bold">Acquisition overview</h1>{m.isDemo && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">DEMO DATA</span>}</div><p className="mt-1 text-sm text-zinc-500">North star: cost per qualified booked inspection — <strong>{money(m.costMetrics.costPerBookedInspectionCents)}</strong></p><p className="text-xs text-zinc-400">Every online booking has passed the authoritative qualification gate. Company-local reporting in {m.timeZone}.</p></div>
      <div className="flex flex-wrap gap-2 text-sm">{[["today","Today"],["7d","Last 7 days"],["30d","Last 30 days"]].map(([key,label]) => <Link key={key} href={`/dashboard?range=${key}`} className={`rounded-lg border px-3 py-2 ${m.range.preset === key ? "border-emerald-700 bg-emerald-700 text-white" : "border-zinc-300 bg-white"}`}>{label}</Link>)}</div>
    </div>
    <form className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-200 bg-white p-3" action="/dashboard"><input type="hidden" name="range" value="custom"/><label className="text-xs text-zinc-500">From<input className="ml-2 rounded border px-2 py-1.5" type="date" name="start" defaultValue={m.range.startKey}/></label><label className="text-xs text-zinc-500">To<input className="ml-2 rounded border px-2 py-1.5" type="date" name="end" defaultValue={m.range.endKey}/></label><button className="rounded bg-zinc-900 px-3 py-2 text-xs font-semibold text-white">Apply custom range</button></form>

    {/* COMMAND CENTER — the at-a-glance money + pipeline story, per CLAUDE.md's
        traffic → landing → funnel start → qualified → booked → inspection →
        won → revenue journey. Built entirely from the same real, stored
        metrics used in the detailed sections below (never a separate/fake
        number). */}
    <section className="rounded-2xl bg-gradient-to-br from-emerald-950 via-emerald-900 to-zinc-900 p-6 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-200">Acquisition command center</h2>
        <RefreshControl updatedLabel={new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: m.timeZone })} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <HeroStat label="Visitors" value={m.visitors} />
        <HeroStat label="Leads" value={m.newLeads} />
        <HeroStat label="Qualified" value={m.qualifiedCount} />
        <HeroStat label="Booked" value={m.bookedCount} />
        <HeroStat label="Completed" value={m.completedInspections} />
        <HeroStat label="Won customers" value={m.customersWon} />
        <HeroStat label="Ad spend" value={money(m.marketingSpendCents)} />
        <HeroStat label="Revenue" value={money(m.revenueCents)} />
        <HeroStat label="CAC" value={money(m.cac)} hint="Marketing spend ÷ customers won" />
        <HeroStat label="ROAS" value={m.roas === null ? "Unavailable" : `${m.roas.toFixed(2)}x`} hint="Revenue ÷ marketing spend" />
      </div>
      <p className="mt-4 text-xs text-emerald-200/70">
        Ad traffic → qualified homeowner → inspection → customer → revenue. Every number above comes from real stored leads, appointments, and marketing-spend rows for this range — nothing here is simulated as &quot;live.&quot;
      </p>

      <div className="mt-6 border-t border-white/10 pt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-200">Live acquisition funnel</h2>
        <p className="mb-4 mt-1 text-xs text-emerald-200/60">Click a stage to see the actual homeowners currently there. Traffic → landed → started → qualified → booked → inspection → won → revenue.</p>
        <FunnelDiagram stages={m.funnelStages} stageLeads={stageLeads} revenueCents={m.revenueCents} />
      </div>
    </section>

    <section><h2 className="mb-3 text-sm font-semibold uppercase text-zinc-500">Needs your attention today</h2><div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="min-w-0 rounded-lg border border-zinc-200 bg-white p-4"><h3 className="mb-2 text-sm font-semibold">Today&apos;s inspections ({m.upcomingAppointments.length})</h3>{m.upcomingAppointments.length === 0 ? <p className="text-sm text-zinc-400">None scheduled today.</p> : <ul className="flex flex-col gap-2">{m.upcomingAppointments.map((a) => <li key={a.id}><Link href={`/dashboard/leads/${a.leadId}`} className="flex items-center justify-between gap-3 rounded-md border border-zinc-100 px-3 py-2 text-sm hover:border-emerald-700"><span className="min-w-0 truncate font-medium">{formatInCompanyTime(a.scheduledStart, m.timeZone, { hour: "numeric", minute: "2-digit" })} — {a.name}</span><span className="shrink-0 text-xs text-zinc-500">{humanizePestLabel(a.pestConcern)}{a.phone ? ` · ${a.phone}` : ""}</span></Link></li>)}</ul>}</div>
      <div className="min-w-0 rounded-lg border border-zinc-200 bg-white p-4"><h3 className="mb-2 text-sm font-semibold">Qualified, not yet booked ({m.needsFollowUp.length})</h3><p className="mb-2 text-xs text-zinc-400">Live reminder/follow-up sends aren&apos;t connected to a real provider yet — call these leads directly.</p>{m.needsFollowUp.length === 0 ? <p className="text-sm text-zinc-400">Nothing waiting on follow-up.</p> : <ul className="flex flex-col gap-2">{m.needsFollowUp.map((l) => <li key={l.id}><Link href={`/dashboard/leads/${l.id}`} className="flex items-center justify-between gap-3 rounded-md border border-zinc-100 px-3 py-2 text-sm hover:border-emerald-700"><span className="min-w-0 truncate font-medium">{l.name} <span className="uppercase text-emerald-700">{l.classification}</span></span><span className="shrink-0 text-xs text-zinc-500">{humanizePestLabel(l.pestConcern)}{l.phone ? ` · ${l.phone}` : l.email ? ` · ${l.email}` : ""}</span></Link></li>)}</ul>}</div>
    </div></section>
    <section><h2 className="mb-3 text-sm font-semibold uppercase text-zinc-500">Business outcome</h2><div className="grid grid-cols-2 gap-3 lg:grid-cols-6"><Stat label="Marketing spend" value={money(m.marketingSpendCents)}/><Stat label="Leads" value={m.newLeads}/><Stat label="Qualified leads" value={m.qualifiedCount}/><Stat label="Booked inspections" value={m.bookedCount} accent/><Stat label="Customers won" value={m.customersWon}/><Stat label="Revenue attributed" value={money(m.revenueCents)} accent/></div></section>
    <section><h2 className="mb-3 text-sm font-semibold uppercase text-zinc-500">Marketing efficiency</h2><div className="grid grid-cols-2 gap-3 lg:grid-cols-6"><Stat label="Cost per lead" value={money(m.costMetrics.costPerLeadCents)} hint="Marketing spend ÷ leads"/><Stat label="Cost per qualified lead" value={money(m.costMetrics.costPerQualifiedLeadCents)} hint="Marketing spend ÷ qualified leads"/><Stat label="Cost per qualified booked inspection" value={money(m.costMetrics.costPerBookedInspectionCents)} accent hint="Marketing spend ÷ booked inspections"/><Stat label="Customer acquisition cost" value={money(m.cac)} hint="Marketing spend ÷ customers won"/><Stat label="ROAS" value={m.roas === null ? "Unavailable" : `${m.roas.toFixed(2)}x`} hint="Revenue ÷ marketing spend"/><Stat label="ROI" value={percent(m.roi)} hint="Profit as a % of marketing spend"/></div></section>

    <section><h2 className="mb-1 text-sm font-semibold uppercase text-zinc-500">Funnel drop-off</h2><p className="mb-3 text-xs text-zinc-400">Where homeowners stop answering questions before finishing the funnel.</p><div className="overflow-hidden rounded-lg border border-zinc-200 bg-white"><div className="grid grid-cols-4 border-b bg-zinc-50 px-4 py-2 text-xs font-semibold text-zinc-500"><span>Step</span><span>Reached</span><span>Completed</span><span>Abandoned</span></div>{m.questionDropOff.map((row) => <div key={row.key} className="grid grid-cols-4 border-b px-4 py-2 text-sm last:border-0"><span>{row.key === "contact" ? "Contact information" : QUALIFICATION_QUESTIONS.find((q) => q.id === row.key)?.prompt ?? row.key}</span><span>{row.reached}</span><span>{row.completed} ({percent(row.conversion)})</span><span className={row.abandoned ? "text-rose-700" : ""}>{row.abandoned}</span></div>)}</div></section>

    <section><h2 className="mb-3 text-sm font-semibold uppercase text-zinc-500">Marketing performance · event attribution</h2><div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white"><table className="w-full text-sm"><thead className="border-b bg-zinc-50 text-left text-zinc-500"><tr>{["Source / Medium","Campaign / Creative","Spend","Visitors","Leads","Qualified","Booked","Completed","Customers","Revenue","CPL","CP Booked","CAC","ROAS"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-3">{h}</th>)}</tr></thead><tbody className="divide-y">{m.marketingPerformance.map((row) => <tr key={`${row.source}:${row.medium}:${row.campaign}:${row.content}`}><td className="whitespace-nowrap px-3 py-3 font-medium">{row.source} / {row.medium}</td><td className="whitespace-nowrap px-3 py-3">{row.campaign} / {row.content}</td><td className="px-3">{money(row.spendCents)}</td><td className="px-3">{row.visitors}</td><td className="px-3">{row.leads}</td><td className="px-3">{row.qualified}</td><td className="px-3">{row.booked}</td><td className="px-3">{row.completed}</td><td className="px-3">{row.customers}</td><td className="px-3">{money(row.revenueCents)}</td><td className="px-3">{money(row.costPerLeadCents)}</td><td className="px-3">{money(row.costPerBookedInspectionCents)}</td><td className="px-3">{money(row.cac)}</td><td className="px-3">{row.roas === null ? "Unavailable" : `${row.roas.toFixed(2)}x`}</td></tr>)}{m.marketingPerformance.length === 0 && <tr><td colSpan={14} className="p-5 text-zinc-500">No funnel activity in this range.</td></tr>}</tbody></table><p className="border-t bg-zinc-50 px-3 py-2 text-xs text-zinc-500">&quot;Unavailable&quot; means no marketing spend has been logged yet for that exact source/medium/campaign — enter it on the Marketing page to unlock cost figures for that row.</p></div></section>
    <section><h2 className="mb-3 text-sm font-semibold uppercase text-zinc-500">Performance by pest category</h2><div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white"><table className="w-full text-sm"><thead className="border-b bg-zinc-50 text-left text-zinc-500"><tr>{["Category","Leads","Qualified","Booked","Completed","Customers","Close Rate","Actual Revenue","Revenue / Completed Inspection"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-3">{h}</th>)}</tr></thead><tbody className="divide-y">{m.pestCategoryPerformance.map((row) => <tr key={row.category}><td className="px-3 py-3 font-medium">{row.label}</td><td className="px-3">{row.leads}</td><td className="px-3">{row.qualified}</td><td className="px-3">{row.booked}</td><td className="px-3">{row.completed}</td><td className="px-3">{row.customers}</td><td className="px-3">{percent(row.closeRate)}</td><td className="px-3">{money(row.revenueCents)}</td><td className="px-3">{money(row.revenuePerCompletedInspectionCents)}</td></tr>)}</tbody></table><p className="border-t bg-zinc-50 px-3 py-2 text-xs text-zinc-500">Revenue uses staff-entered won contract values only. Potential value ranges are excluded.</p></div></section>
    <section><h2 className="mb-3 text-sm font-semibold uppercase text-zinc-500">Operations and conversion</h2><div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6"><Stat label="Booked today" value={m.inspectionsToday}/><Stat label="Booked this week" value={m.inspectionsThisWeek}/><Stat label="Lead to qualified" value={percent(m.leadToQualifiedRate)}/><Stat label="Qualified to booked" value={percent(m.qualifiedToBookedRate)}/><Stat label="Show rate" value={percent(m.showRate)}/><Stat label="Close rate" value={percent(m.closeRate)}/></div></section>
  </div>;
}
