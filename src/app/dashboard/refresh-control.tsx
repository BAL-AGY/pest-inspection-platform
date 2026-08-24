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
    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
        <span className="truncate">Updating every {AUTO_REFRESH_MS / 1000}s · Last updated {updatedLabel}</span>
      </span>
      <button
        type="button"
        onClick={() => router.refresh()}
        className="shrink-0 rounded border border-zinc-300 px-2 py-1 font-medium text-zinc-600 transition-colors hover:border-emerald-600 hover:text-emerald-700"
      >
        Refresh now
      </button>
    </div>
  );
}
