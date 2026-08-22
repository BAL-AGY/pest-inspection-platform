import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/require-session";
import { prisma } from "@/lib/prisma";
import { LEAD_STATUS_LABELS, LEAD_STATUSES } from "@/lib/pipeline";

export default async function LeadsPage() {
  const session = await requireSession();
  if (!session) redirect("/login");

  const leads = await prisma.lead.findMany({
    where: { companyId: session.companyId },
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  const byStatus = new Map<string, typeof leads>();
  for (const status of LEAD_STATUSES) byStatus.set(status, []);
  for (const lead of leads) {
    if (!byStatus.has(lead.status)) byStatus.set(lead.status, []);
    byStatus.get(lead.status)!.push(lead);
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Pipeline</h1>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {LEAD_STATUSES.map((status) => (
          <div key={status} className="min-w-64 flex-shrink-0">
            <h2 className="text-sm font-semibold text-zinc-500 uppercase mb-2">
              {LEAD_STATUS_LABELS[status]} ({byStatus.get(status)?.length ?? 0})
            </h2>
            <div className="flex flex-col gap-2">
              {(byStatus.get(status) ?? []).map((lead) => (
                <Link
                  key={lead.id}
                  href={`/dashboard/leads/${lead.id}`}
                  className="block bg-white border border-zinc-200 rounded-lg p-3 hover:border-emerald-700"
                >
                  <p className="font-medium text-sm">
                    {lead.firstName || lead.lastName
                      ? `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim()
                      : "Unnamed lead"}
                  </p>
                  <p className="text-xs text-zinc-500 mt-1">
                    {lead.pestConcern ?? "—"} · score {lead.score}
                  </p>
                  {lead.source && (
                    <p className="text-xs text-zinc-400 mt-1">{lead.source}</p>
                  )}
                </Link>
              ))}
              {(byStatus.get(status) ?? []).length === 0 && (
                <p className="text-xs text-zinc-400">No leads yet</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
