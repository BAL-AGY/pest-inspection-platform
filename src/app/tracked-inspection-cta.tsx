"use client";

import Link from "next/link";
import { track } from "@/lib/visitor";

export default function TrackedInspectionCta({
  href,
  label = "Check Availability",
  className,
}: {
  href: string;
  label?: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      onClick={() => { void track("inspection_cta_clicked"); }}
      className={
        className ??
        "inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-8 py-4 text-lg font-semibold text-white shadow-lg shadow-emerald-950/20 transition-all hover:bg-emerald-500 hover:shadow-xl active:scale-[0.98] w-full sm:w-auto"
      }
    >
      {label}
      <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
    </Link>
  );
}
