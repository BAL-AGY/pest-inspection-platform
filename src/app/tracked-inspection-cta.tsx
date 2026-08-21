"use client";

import Link from "next/link";
import { track } from "@/lib/visitor";

export default function TrackedInspectionCta({ href }: { href: string }) {
  return (
    <Link
      href={href}
      onClick={() => { void track("inspection_cta_clicked"); }}
      className="inline-flex items-center justify-center rounded-md bg-emerald-700 px-8 py-4 text-lg font-semibold text-white shadow hover:bg-emerald-800 transition-colors w-full sm:w-auto"
    >
      Get My Free Inspection
    </Link>
  );
}
