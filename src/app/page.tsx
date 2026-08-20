"use client";

import Link from "next/link";
import { useEffect } from "react";
import { track } from "@/lib/visitor";

export default function LandingPage() {
  useEffect(() => {
    track("visit");
  }, []);

  return (
    <main className="flex-1 flex flex-col bg-white text-zinc-900">
      <section className="flex-1 flex flex-col justify-center px-6 py-16 sm:py-24 max-w-3xl mx-auto text-center gap-6">
        <p className="text-sm font-semibold tracking-wide text-emerald-700 uppercase">
          Free, no-obligation home inspection
        </p>
        <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-balance">
          Still seeing pests? Get a free home inspection from a local
          technician.
        </h1>
        <p className="text-lg text-zinc-600 text-balance">
          Takes 2 minutes. We&apos;ll check whether you&apos;re in our service
          area and get you on the calendar — no purchase required.
        </p>
        <div className="flex justify-center pt-2">
          <Link
            href="/inspection"
            className="inline-flex items-center justify-center rounded-md bg-emerald-700 px-8 py-4 text-lg font-semibold text-white shadow hover:bg-emerald-800 transition-colors w-full sm:w-auto"
          >
            Get My Free Inspection
          </Link>
        </div>
        <p className="text-sm text-zinc-500">
          Already work with another pest control company? We offer free
          second opinions too.
        </p>
      </section>

      <footer className="border-t border-zinc-200 px-6 py-6 text-center text-sm text-zinc-500">
        <Link href="/login" className="hover:underline">
          Staff login
        </Link>
      </footer>
    </main>
  );
}
