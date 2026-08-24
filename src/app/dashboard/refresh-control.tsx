"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const AUTO_REFRESH_MS = 25_000;

/**
 * The Command Center is revalidation-based, not a live WebSocket feed:
 * router.refresh() re-runs the dashboard's server component (which computes
 * updatedLabel fresh on every render) on an interval plus a manual button.
 * The label always comes from the server render, not a client-side Date(),
 * so there's no hydration mismatch and no synchronous setState-in-effect.
 */
export default function RefreshControl({ updatedLabel }: { updatedLabel: string }) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [router]);

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-emerald-100/70">
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold tracking-wide text-emerald-200">
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-400" aria-hidden />
        LIVE
      </span>
      <span className="min-w-0 truncate">Updating every {AUTO_REFRESH_MS / 1000}s · Last updated {updatedLabel}</span>
      <button
        type="button"
        onClick={() => router.refresh()}
        className="shrink-0 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 font-medium text-emerald-100 transition-colors hover:border-emerald-300/50 hover:bg-white/10 hover:text-white"
      >
        Refresh now
      </button>
    </div>
  );
}
