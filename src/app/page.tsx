import Link from "next/link";
import LandingTracker from "./landing-tracker";
import TrackedInspectionCta from "./tracked-inspection-cta";
import { getActiveCompany } from "@/lib/company";

// Now reads the company name from the database on every request, so this
// can no longer be safely prerendered once at build time (next build
// forces NODE_ENV=production and would otherwise try to statically
// generate this page against whatever DATABASE_URL the build step has —
// see src/lib/auth.ts's identical build-vs-runtime lesson).
export const dynamic = "force-dynamic";

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const company = await getActiveCompany();
  const query = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(await searchParams)) {
    for (const value of Array.isArray(rawValue) ? rawValue : [rawValue]) {
      if (value !== undefined) query.append(key, value);
    }
  }
  const inspectionHref = query.size > 0 ? `/inspection?${query.toString()}` : "/inspection";

  return (
    <main className="flex-1 flex flex-col bg-white text-zinc-900">
      <LandingTracker />
      <section className="flex-1 flex flex-col justify-center px-6 py-16 sm:py-24 max-w-3xl mx-auto text-center gap-6">
        <p className="text-sm font-semibold text-zinc-500">{company.name}</p>
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
          <TrackedInspectionCta href={inspectionHref} />
        </div>
        <p className="text-sm text-zinc-500">
          Already work with another pest control company? We offer free
          second opinions too.
        </p>
        <dl className="grid grid-cols-1 gap-4 pt-6 text-left sm:grid-cols-3">
          <div className="rounded-lg border border-zinc-200 p-4">
            <dt className="text-sm font-semibold text-zinc-900">1. Check your area</dt>
            <dd className="mt-1 text-sm text-zinc-500">Tell us your ZIP so we know we can actually serve your home.</dd>
          </div>
          <div className="rounded-lg border border-zinc-200 p-4">
            <dt className="text-sm font-semibold text-zinc-900">2. A few quick questions</dt>
            <dd className="mt-1 text-sm text-zinc-500">About 2 minutes, so we send the right technician prepared for your issue.</dd>
          </div>
          <div className="rounded-lg border border-zinc-200 p-4">
            <dt className="text-sm font-semibold text-zinc-900">3. Pick a free inspection time</dt>
            <dd className="mt-1 text-sm text-zinc-500">No payment info, no obligation — just a time that works for you.</dd>
          </div>
        </dl>
        <p className="text-xs text-zinc-400">
          Every property is different. Your technician will inspect the home before recommending treatment or providing accurate pricing.
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
