import Link from "next/link";
import LandingTracker from "./landing-tracker";
import TrackedInspectionCta from "./tracked-inspection-cta";

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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
