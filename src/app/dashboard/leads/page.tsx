import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/require-session";
import { prisma } from "@/lib/prisma";
import { LEAD_STATUS_LABELS, LEAD_STATUSES, type LeadStatus } from "@/lib/pipeline";
import { humanizePestLabel } from "@/lib/service-catalog";
import { timeAgo } from "../ui";

const COLUMN_ACCENT: Record<LeadStatus, string> = {
  new: "border-t-zinc-400",
  engaged: "border-t-sky-400",
  mql: "border-t-amber-400",
  sql: "border-t-violet-400",
  inspection_booked: "border-t-emerald-400",
  inspection_completed: "border-t-emerald-500",
  customer_won: "border-t-emerald-600",
  customer_lost: "border-t-rose-400",
};

const SCORE_TONE = (score: number) =>
  score >= 70 ? "bg-emerald-100 text-emerald-800" : score >= 40 ? "bg-amber-100 text-amber-800" : "bg-zinc-100 text-zinc-600";

export default async function LeadsPage() {
  const session = await requireSession();
  if (!session) redirect("/login");

  const leads = await prisma.lead.findMany({
    where: { companyId: session.companyId },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: {
      id: true, firstName: true, lastName: true, pestConcern: true, zipCode: true,
      source: true, campaign: true, status: true, score: true, updatedAt: true,
      appointments: { orderBy: { scheduledStart: "desc" }, take: 1, select: { scheduledStart: true, status: true } },
    },
  });
  const now = new Date();

  const byStatus = new Map<string, typeof leads>();
  for (const status of LEAD_STATUSES) byStatus.set(status, []);
  for (const lead of leads) {
    if (!byStatus.has(lead.status)) byStatus.set(lead.status, []);
    byStatus.get(lead.status)!.push(lead);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Pipeline</h1>
        <p className="mt-1 text-sm text-zinc-500">Every homeowner currently moving through acquisition — click a card to open the full lead.</p>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {LEAD_STATUSES.map((status) => {
          const columnLeads = byStatus.get(status) ?? [];
          return (
            <div key={status} className="w-72 flex-shrink-0">
              <div className={`mb-2 flex items-center justify-between border-t-2 pt-2 ${COLUMN_ACCENT[status]}`}>
                <h2 className="text-sm font-semibold text-zinc-700">{LEAD_STATUS_LABELS[status]}</h2>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-bold text-zinc-500">{columnLeads.length}</span>
              </div>
              <div className="flex flex-col gap-2">
                {columnLeads.map((lead) => {
                  const name = lead.firstName || lead.lastName ? `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim() : "Unnamed lead";
                  const appointment = lead.appointments[0];
                  return (
                    <Link
                      key={lead.id}
                      href={`/dashboard/leads/${lead.id}`}
                      className="block rounded-xl border border-zinc-200 bg-white p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 truncate text-sm font-semibold text-zinc-900">{name}</p>
                        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${SCORE_TONE(lead.score)}`}>{lead.score}</span>
                      </div>
                      <p className="mt-1 truncate text-xs text-zinc-500">{humanizePestLabel(lead.pestConcern)}{lead.zipCode ? ` · ${lead.zipCode}` : ""}</p>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-[11px] text-zinc-400">
                          {lead.campaign ? `${lead.source ?? "direct"}/${lead.campaign}` : lead.source ?? "direct"}
                        </span>
                        <span className="shrink-0 text-[11px] text-zinc-400">{timeAgo(lead.updatedAt, now)}</span>
                      </div>
                      {appointment && (
                        <p className="mt-1.5 truncate text-[11px] font-medium text-emerald-700">
                          Inspection {new Date(appointment.scheduledStart).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </p>
                      )}
                    </Link>
                  );
                })}
                {columnLeads.length === 0 && <p className="text-xs text-zinc-400">No leads yet</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
