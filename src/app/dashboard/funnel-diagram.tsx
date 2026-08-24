"use client";

import { useMemo, useState } from "react";
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

// A "wormhole" tunnel: each stage row is width-scaled by sqrt(count) so the
// tube visibly narrows through qualification, then the revenue capstone
// deliberately flares back out (a stylized "value expands" cue, not a
// literal count — revenue is a dollar figure, a different unit entirely).
// sqrt (not linear) keeps the taper readable even with a large range
// between visitors and won customers.
const MIN_WIDTH_PCT = 34;
const MAX_WIDTH_PCT = 96;
const REVENUE_WIDTH_PCT = 80;

function stageWidths(counts: number[]): number[] {
  const max = Math.max(1, ...counts);
  return counts.map((c) => MIN_WIDTH_PCT + (MAX_WIDTH_PCT - MIN_WIDTH_PCT) * (Math.sqrt(Math.max(0, c)) / Math.sqrt(max)));
}

export default function FunnelDiagram({ stages, stageLeads, revenueCents }: FunnelDiagramProps) {
  const [openStage, setOpenStage] = useState<string | null>(null);
  const widths = useMemo(() => [...stageWidths(stages.map((s) => s.count)), REVENUE_WIDTH_PCT], [stages]);
  const rowCount = stages.length + 1;

  return (
    <div className="flex flex-col gap-5">
      <div className="relative overflow-hidden rounded-2xl bg-[radial-gradient(ellipse_at_50%_0%,rgba(45,212,191,0.16),rgba(2,6,23,0)_60%)] px-2 py-4 sm:px-4">
        <TunnelBackdrop widths={widths} rowCount={rowCount} />
        <div className="relative flex flex-col items-center gap-2">
          {stages.map((stage, index) => {
            const drilldownKey = DRILLDOWN_KEYS[stage.key as StageKey];
            const clickable = Boolean(drilldownKey);
            const isOpen = openStage === stage.key;
            return (
              <div key={stage.key} className="flex w-full flex-col items-center">
                {index > 0 && <StageConnector percent={stage.conversionFromPrevious} />}
                <button
                  type="button"
                  disabled={!clickable}
                  onClick={() => setOpenStage(isOpen ? null : stage.key)}
                  aria-expanded={isOpen}
                  style={{ width: `clamp(190px, ${widths[index]}%, 100%)` }}
                  className={`group relative flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-left transition-all duration-200 ${
                    isOpen
                      ? "border-cyan-300/70 bg-white/15 shadow-[0_0_0_1px_rgba(103,232,249,0.5)]"
                      : clickable
                        ? "border-white/15 bg-white/[0.06] hover:border-cyan-300/50 hover:bg-white/[0.11]"
                        : "border-white/10 bg-white/[0.03]"
                  } ${clickable ? "cursor-pointer" : "cursor-default"}`}
                >
                  <span className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wide text-emerald-200/75">{stage.label}</span>
                  <span className="flex shrink-0 items-baseline gap-2">
                    <span className="text-xl font-bold tabular-nums text-white sm:text-2xl">{stage.count}</span>
                    {clickable && (
                      <span className="hidden text-[10px] font-medium text-cyan-200/90 sm:inline">
                        {isOpen ? "Hide ▲" : "View ›"}
                      </span>
                    )}
                  </span>
                </button>
              </div>
            );
          })}
          <StageConnector percent={null} />
          <div
            style={{ width: `${REVENUE_WIDTH_PCT}%` }}
            className="flex items-center justify-between gap-3 rounded-xl border border-amber-300/30 bg-gradient-to-r from-amber-400/15 via-amber-300/10 to-amber-400/15 px-4 py-3"
          >
            <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-200/85">Revenue</span>
            <span className="truncate text-xl font-bold tabular-nums text-amber-100 sm:text-2xl" title={money(revenueCents) ?? undefined}>
              {money(revenueCents) ?? "—"}
            </span>
          </div>
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

// Decorative SVG contour lines tracing the tunnel silhouette behind the
// real, interactive stage rows above — aria-hidden since every fact it
// depicts (the taper) is already conveyed accessibly by the rows' widths
// being irrelevant to a screen reader; the actual data is in the buttons'
// text content, read in document order regardless of visual layout.
function TunnelBackdrop({ widths, rowCount }: { widths: number[]; rowCount: number }) {
  const ROW_H = 100 / rowCount;
  const points = widths.map((w, i) => ({ x: w / 2, y: ROW_H * i + ROW_H / 2 }));
  const leftPath = points.map((p, i) => (i === 0 ? `M ${50 - p.x} ${p.y}` : `L ${50 - p.x} ${p.y}`)).join(" ");
  const rightPath = [...points].reverse().map((p) => `L ${50 + p.x} ${p.y}`).join(" ");

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full opacity-70"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="tunnel-stroke" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(110,231,183,0.5)" />
          <stop offset="55%" stopColor="rgba(103,232,249,0.35)" />
          <stop offset="100%" stopColor="rgba(252,211,77,0.45)" />
        </linearGradient>
      </defs>
      <path d={`${leftPath} ${rightPath} Z`} fill="none" stroke="url(#tunnel-stroke)" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
      {points.map((p, i) => (
        <ellipse key={i} cx="50" cy={p.y} rx={p.x} ry="1.1" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="0.25" vectorEffect="non-scaling-stroke" />
      ))}
      {/* Slow-moving glow tracing the central conversion path — purely
          decorative motion; globals.css zeroes animation-duration under
          prefers-reduced-motion, so this collapses to a static glow. */}
      <circle cx="50" cy="0" r="1.6" fill="rgba(165,243,252,0.9)">
        <animate attributeName="cy" values="0;100;0" dur="7s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0;0.9;0" dur="7s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

function StageConnector({ percent }: { percent: number | null }) {
  const text = percent === null ? null : `${Math.round(percent * 100)}%`;
  return (
    <div className="relative flex h-5 items-center justify-center" aria-hidden>
      <div className="h-full w-px bg-gradient-to-b from-white/10 via-cyan-200/40 to-white/10" />
      {text && (
        <span className="absolute rounded-full border border-cyan-300/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-bold text-cyan-100 shadow-sm backdrop-blur-sm">
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
