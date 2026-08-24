// Shared visual primitives for the owner/admin dashboard — the "design
// system" referenced across dashboard pages. Kept intentionally small:
// a handful of composable building blocks (Card, SectionHeader, Badge,
// StatCard, EmptyState, IconButton) rather than a component library, so
// every page can hand-tune layout while staying visually consistent.
// Nothing here touches data/business logic.

import { Fragment, type ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-zinc-200 bg-white shadow-sm ${className}`}>{children}</div>;
}

// Deliberately renders NO wrapping element (a Fragment): several e2e
// assertions do page.getByRole("heading", {name}).locator("..") and expect
// the resulting parent to also contain that section's content (a stat
// grid, a table). The heading must stay a direct child of whatever
// <section> renders it — the same DOM position it held before this
// component existed — so wrapping it here would silently break those
// assertions by pointing ".." at this component's own div instead of the
// real section.
export function SectionHeader({ eyebrow, title, hint }: { eyebrow?: string; title: string; hint?: string }) {
  return (
    <Fragment>
      {eyebrow && <span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wider text-emerald-700">{eyebrow}</span>}
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
      {hint && <p className="mb-3 text-xs text-zinc-400">{hint}</p>}
      {!hint && <div className="mb-3" />}
    </Fragment>
  );
}

const BADGE_TONES: Record<string, string> = {
  neutral: "border-zinc-200 bg-zinc-100 text-zinc-600",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  rose: "border-rose-200 bg-rose-50 text-rose-800",
  sky: "border-sky-200 bg-sky-50 text-sky-800",
  violet: "border-violet-200 bg-violet-50 text-violet-800",
};

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof BADGE_TONES; children: ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${BADGE_TONES[tone]}`}>{children}</span>;
}

export function StatCard({ label, value, hint, accent = false }: { label: string; value: string | number; hint?: string; accent?: boolean }) {
  return (
    <div className={`min-w-0 rounded-xl border p-4 transition-colors ${accent ? "border-emerald-200 bg-emerald-50" : "border-zinc-200 bg-white hover:border-zinc-300"}`} title={hint}>
      <p className="truncate text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 truncate text-2xl font-bold text-zinc-900">{value}</p>
      {hint && <p className="mt-1 truncate text-xs text-zinc-400">{hint}</p>}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
      <p className="font-semibold text-zinc-700">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// Relative "time ago" for lead cards — pure, server-render-safe (no client
// Date() needed since this only ever renders once per request/refresh).
export function timeAgo(date: Date, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
