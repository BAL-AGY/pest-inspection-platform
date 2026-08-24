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
  revenueCents: number | null;
}

const DRILLDOWN_KEYS: Partial<Record<StageKey, keyof FunnelDiagramProps["stageLeads"]>> = {
  lead_qualified: "qualified",
  inspection_booked: "booked",
  inspection_completed: "completed",
  customer_won: "won",
};

const money = (cents: number | null) =>
  cents === null ? null : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export default function FunnelDiagram({ stages, stageLeads, revenueCents }: FunnelDiagramProps) {
  const [openStage, setOpenStage] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col sm:flex-row sm:items-stretch">
        {stages.map((stage, index) => {
          const drilldownKey = DRILLDOWN_KEYS[stage.key as StageKey];
          const clickable = Boolean(drilldownKey);
          const isOpen = openStage === stage.key;
          return (
            <div key={stage.key} className="flex min-w-0 flex-1 flex-col sm:contents">
              {index > 0 && <Connector percent={stage.conversionFromPrevious} />}
              <button
                type="button"
                disabled={!clickable}
                onClick={() => setOpenStage(isOpen ? null : stage.key)}
                aria-expanded={isOpen}
                className={`group relative flex min-w-0 flex-1 flex-col gap-1 rounded-xl border px-3 py-3 text-left transition-all duration-200 sm:px-4 sm:py-4 ${
                  isOpen
                    ? "border-emerald-300 bg-white/15 shadow-[0_0_0_1px_rgba(110,231,183,0.5)]"
                    : clickable
                      ? "border-white/15 bg-white/[0.06] hover:border-emerald-300/60 hover:bg-white/[0.1]"
                      : "border-white/10 bg-white/[0.03]"
                } ${clickable ? "cursor-pointer" : "cursor-default"}`}
              >
                <span className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-emerald-200/70">{stage.label}</span>
                <span className="text-2xl font-bold tabular-nums text-white sm:text-3xl">{stage.count}</span>
                {clickable && (
                  <span className="mt-0.5 text-[10px] font-medium text-emerald-300/90">
                    {isOpen ? "Hide records ▲" : "View records ›"}
                  </span>
                )}
              </button>
            </div>
          );
        })}
        <Connector percent={null} label="revenue" />
        <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-xl border border-amber-300/30 bg-gradient-to-br from-amber-400/15 to-amber-600/5 px-3 py-3 sm:px-4 sm:py-4">
          <span className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-amber-200/80">Revenue</span>
          <span className="truncate text-xl font-bold tabular-nums text-amber-100 sm:text-2xl" title={money(revenueCents) ?? undefined}>
            {money(revenueCents) ?? "—"}
          </span>
          <span className="mt-0.5 text-[10px] leading-tight text-amber-200/60">From won customers</span>
        </div>
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

function Connector({ percent, label }: { percent: number | null; label?: string }) {
  const text = percent === null ? null : `${Math.round(percent * 100)}%`;
  return (
    <div
      className="relative flex shrink-0 items-center justify-center py-2 sm:w-10 sm:py-0"
      aria-hidden
      data-connector={label}
    >
      <div className="h-6 w-px bg-gradient-to-b from-white/5 via-white/25 to-white/5 sm:h-px sm:w-full sm:bg-[length:200%_100%] sm:bg-gradient-to-r sm:from-white/10 sm:via-emerald-300/50 sm:to-white/10 sm:animate-[funnel-flow_3s_linear_infinite]" />
      {text && (
        <span className="absolute rounded-full border border-emerald-300/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-200 shadow-sm backdrop-blur-sm">
          {text}
        </span>
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
    <div className="rounded-xl border border-white bg-white p-4 shadow-xl animate-[fade-in_0.15s_ease-out]">
      <h3 className="mb-3 text-sm font-semibold text-zinc-900">{stageLabel} · {records.length} shown</h3>
      {records.length === 0 ? (
        <p className="text-sm text-zinc-500">No records in this range yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {records.map((record) => (
            <li key={record.id}>
              <Link
                href={`/dashboard/leads/${record.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-100 bg-white px-4 py-3 text-sm shadow-sm transition-colors hover:border-emerald-300"
              >
                <span className="min-w-0 truncate font-medium text-zinc-900">{record.name}</span>
                <span className="min-w-0 truncate text-xs text-zinc-500">
                  {humanizePestLabel(record.pestConcern)}
                  {record.zipCode ? ` · ${record.zipCode}` : ""}
                  {record.campaign ? ` · ${record.source ?? "direct"}/${record.campaign}` : record.source ? ` · ${record.source}` : ""}
                </span>
                {"appointment" in record && record.appointment && (
                  <span className="shrink-0 text-xs text-emerald-700">
                    {new Date(record.appointment.scheduledStart).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                )}
                {"contractValueCents" in record && record.contractValueCents !== null && (
                  <span className="shrink-0 text-xs font-semibold text-emerald-700">{money(record.contractValueCents)}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
