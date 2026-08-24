"use client";

import { useState } from "react";
import Link from "next/link";
import { humanizePestLabel } from "@/lib/service-catalog";

type StageKey = "landing_page_view" | "funnel_started" | "lead_created" | "lead_qualified" | "inspection_booked" | "inspection_completed" | "customer_won";

interface StageLeadBase {
  id: string;
  name: string;
  pestConcern: string | null;
  zipCode: string | null;
  source: string | null;
  campaign: string | null;
  status: string;
  createdAt: Date;
}

export interface FunnelDiagramProps {
  stages: { key: string; label: string; count: number; conversionFromPrevious: number | null }[];
  stageLeads: {
    qualified: StageLeadBase[];
    booked: (StageLeadBase & { appointment: { scheduledStart: Date; status: string } | null })[];
    completed: StageLeadBase[];
    won: (StageLeadBase & { contractValueCents: number | null; serviceArrangement: string | null })[];
  };
}

const DRILLDOWN_KEYS: Partial<Record<StageKey, keyof FunnelDiagramProps["stageLeads"]>> = {
  lead_qualified: "qualified",
  inspection_booked: "booked",
  inspection_completed: "completed",
  customer_won: "won",
};

const money = (cents: number | null) =>
  cents === null ? null : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export default function FunnelDiagram({ stages, stageLeads }: FunnelDiagramProps) {
  const [openStage, setOpenStage] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        {stages.map((stage, index) => {
          const drilldownKey = DRILLDOWN_KEYS[stage.key as StageKey];
          const clickable = Boolean(drilldownKey);
          const isOpen = openStage === stage.key;
          return (
            <div key={stage.key} className="flex min-w-0 flex-1 flex-col items-stretch gap-2">
              <button
                type="button"
                disabled={!clickable}
                onClick={() => setOpenStage(isOpen ? null : stage.key)}
                aria-expanded={isOpen}
                className={`min-w-0 rounded-xl border p-4 text-left transition-all sm:text-center ${
                  isOpen
                    ? "border-emerald-600 bg-emerald-50 shadow-md"
                    : "border-zinc-200 bg-white hover:border-emerald-300 hover:shadow-sm"
                } ${clickable ? "cursor-pointer" : "cursor-default opacity-90"}`}
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{stage.label}</p>
                <p className="mt-1 text-3xl font-bold text-zinc-900">{stage.count}</p>
                {index > 0 && (
                  <p className="mt-1 text-xs font-medium text-emerald-700">
                    {stage.conversionFromPrevious === null ? "—" : `${Math.round(stage.conversionFromPrevious * 100)}% from prior`}
                  </p>
                )}
                {clickable && (
                  <p className="mt-1 text-[11px] text-zinc-400">{isOpen ? "Hide records ▲" : "View records ▼"}</p>
                )}
              </button>
              {index < stages.length - 1 && (
                <div className="flex items-center justify-center text-zinc-300" aria-hidden>
                  <span className="sm:hidden">↓</span>
                  <span className="hidden sm:block">→</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {openStage && DRILLDOWN_KEYS[openStage as StageKey] && (
        <StageRecordsPanel
          stageLabel={stages.find((s) => s.key === openStage)?.label ?? openStage}
          records={stageLeads[DRILLDOWN_KEYS[openStage as StageKey]!]}
        />
      )}
    </div>
  );
}

function StageRecordsPanel({
  stageLabel,
  records,
}: {
  stageLabel: string;
  records: FunnelDiagramProps["stageLeads"][keyof FunnelDiagramProps["stageLeads"]];
}) {
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 animate-[fade-in_0.15s_ease-out]">
      <h3 className="mb-3 text-sm font-semibold text-emerald-900">{stageLabel} · {records.length} shown</h3>
      {records.length === 0 ? (
        <p className="text-sm text-zinc-500">No records in this range yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {records.map((record) => (
            <li key={record.id}>
              <Link
                href={`/dashboard/leads/${record.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white bg-white px-4 py-3 text-sm shadow-sm transition-colors hover:border-emerald-300"
              >
                <span className="font-medium text-zinc-900">{record.name}</span>
                <span className="text-xs text-zinc-500">
                  {humanizePestLabel(record.pestConcern)}
                  {record.zipCode ? ` · ${record.zipCode}` : ""}
                  {record.campaign ? ` · ${record.source ?? "direct"}/${record.campaign}` : record.source ? ` · ${record.source}` : ""}
                </span>
                {"appointment" in record && record.appointment && (
                  <span className="text-xs text-emerald-700">
                    {new Date(record.appointment.scheduledStart).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                )}
                {"contractValueCents" in record && record.contractValueCents !== null && (
                  <span className="text-xs font-semibold text-emerald-700">{money(record.contractValueCents)}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
