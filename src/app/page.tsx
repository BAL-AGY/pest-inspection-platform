import Link from "next/link";
import LandingTracker from "./landing-tracker";
import TrackedInspectionCta from "./tracked-inspection-cta";
import HeroMedia from "./hero-media";
import { getActiveCompany } from "@/lib/company";

// Reads the company name from the database on every request, so this can no
// longer be safely prerendered once at build time (next build forces
// NODE_ENV=production and would otherwise try to statically generate this
// page against whatever DATABASE_URL the build step has — see
// src/lib/auth.ts's identical build-vs-runtime lesson).
export const dynamic = "force-dynamic";

const PEST_CARDS = [
  { label: "General Pests", description: "Ants, roaches, spiders, wasps, and more.", icon: "🐜" },
  { label: "Rodents", description: "Mice and rats in or around the home.", icon: "🐀" },
  { label: "Fleas", description: "Flea activity indoors or in the yard.", icon: "🦟" },
  { label: "Other", description: "Not sure what it is? We'll help figure it out.", icon: "❓" },
] as const;

const HOW_IT_WORKS = [
  { step: "1", title: "Tell us what you're seeing", description: "A few quick questions about the problem." },
  { step: "2", title: "We check your location and situation", description: "So we can confirm we actually serve your home." },
  { step: "3", title: "Choose an inspection time", description: "Pick a slot that works for you — no payment info needed." },
  { step: "4", title: "A technician inspects the property", description: "In person, before any treatment or pricing is recommended." },
] as const;

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

      {/* HERO */}
      <section className="relative isolate flex flex-col justify-center overflow-hidden px-6 py-24 sm:py-32 text-center text-white">
        <HeroMedia
          videoSrc="/hero/technician-inspection.mp4"
          webmSrc="/hero/technician-inspection.webm"
          posterSrc="/hero/technician-inspection.jpg"
        />
        <div className="relative mx-auto flex max-w-3xl flex-col items-center gap-6">
          <p className="text-sm font-semibold tracking-wide text-emerald-300">{company.name}</p>
          <p className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-200">
            Free, no-obligation home inspection
          </p>
          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-balance">
            Protect Your Home From Unwanted Pests
          </h1>
          <p className="text-lg sm:text-xl text-emerald-50/90 text-balance max-w-2xl">
            Get your free pest inspection. Answer a few quick questions, we&apos;ll check
            availability in your area, and you pick a time — no obligation, no payment info.
          </p>
          <div className="flex flex-col items-center gap-3 pt-2">
            <TrackedInspectionCta href={inspectionHref} label="Check Availability" />
            <ul className="flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs font-medium text-emerald-100/80">
              <li>No payment info required</li>
              <li>No obligation to buy</li>
              <li>Takes about 2 minutes</li>
            </ul>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="px-6 py-16 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl sm:text-3xl font-bold tracking-tight">How it works</h2>
          <dl className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {HOW_IT_WORKS.map((item) => (
              <div key={item.step} className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
                <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">
                  {item.step}
                </div>
                <dt className="font-semibold text-zinc-900">{item.title}</dt>
                <dd className="mt-1 text-sm text-zinc-500">{item.description}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* PEST CARDS */}
      <section className="bg-zinc-50 px-6 py-16 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl sm:text-3xl font-bold tracking-tight">What are you dealing with?</h2>
          <div className="mt-10 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {PEST_CARDS.map((pest) => (
              <div
                key={pest.label}
                className="flex flex-col items-center gap-2 rounded-xl border border-zinc-200 bg-white p-5 text-center shadow-sm transition-shadow hover:shadow-md"
              >
                <span className="text-3xl" aria-hidden>{pest.icon}</span>
                <p className="font-semibold text-zinc-900">{pest.label}</p>
                <p className="text-xs text-zinc-500">{pest.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TRUST */}
      <section className="px-6 py-16 sm:py-20">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Why homeowners book with us</h2>
          <div className="grid grid-cols-1 gap-4 pt-4 sm:grid-cols-3 w-full">
            <div className="rounded-xl border border-zinc-200 p-5">
              <p className="font-semibold text-zinc-900">Local technicians</p>
              <p className="mt-1 text-sm text-zinc-500">A real person inspects your property before any recommendation.</p>
            </div>
            <div className="rounded-xl border border-zinc-200 p-5">
              <p className="font-semibold text-zinc-900">No pressure</p>
              <p className="mt-1 text-sm text-zinc-500">Free inspection, no payment info, no obligation to purchase.</p>
            </div>
            <div className="rounded-xl border border-zinc-200 p-5">
              <p className="font-semibold text-zinc-900">Accurate pricing</p>
              <p className="mt-1 text-sm text-zinc-500">Every property is different — pricing is set after inspection, not before.</p>
            </div>
          </div>
          <p className="pt-2 text-sm text-zinc-500">
            Already work with another pest control company? We offer free second opinions too.
          </p>
        </div>
      </section>

      <footer className="border-t border-zinc-200 px-6 py-6 text-center text-sm text-zinc-500">
        <Link href="/login" className="hover:underline">
          Staff login
        </Link>
      </footer>
    </main>
  );
}
