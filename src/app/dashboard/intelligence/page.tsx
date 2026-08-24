import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/require-session";
import { prisma } from "@/lib/prisma";
import { loadCaseStudies } from "@/lib/marketing-intelligence/case-studies";
import { computeBenchmark, computeStandardBenchmarks, type DerivedMetricKey } from "@/lib/marketing-intelligence/benchmarks";
import { generateOfferHypotheses, recommendExperimentAction } from "@/lib/marketing-intelligence/recommendations";
import { listExperimentsWithMetrics } from "@/lib/marketing-intelligence/experiments";
import { PLATFORM_VALUES } from "@/lib/marketing-intelligence/case-study-schema";

const money = (cents: number | null) => (cents === null ? "Unavailable" : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const percent = (value: number | null) => (value === null ? "Unavailable" : `${(value * 100).toFixed(1)}%`);
const METRIC_LABELS: Record<DerivedMetricKey, string> = {
  cplCents: "Cost per lead", cpcCents: "Cost per click", ctr: "Click-through rate",
  bookingRate: "Booking rate", costPerBookedInspectionCents: "Cost per booked inspection",
  cacCents: "Customer acquisition cost", roas: "ROAS", leadToCustomerRate: "Lead-to-customer rate",
};
const isMoneyMetric: (m: DerivedMetricKey) => boolean = (m) => ["cplCents", "cpcCents", "costPerBookedInspectionCents", "cacCents"].includes(m);
const formatMetricValue = (metric: DerivedMetricKey, value: number | null) => {
  if (value === null) return "Unavailable";
  if (metric === "roas") return `${value.toFixed(2)}x`;
  if (isMoneyMetric(metric)) return money(value);
  return percent(value);
};
const CONFIDENCE_STYLES: Record<string, string> = {
  high: "border-emerald-300 bg-emerald-50 text-emerald-800",
  medium: "border-amber-300 bg-amber-50 text-amber-800",
  experimental: "border-zinc-300 bg-zinc-50 text-zinc-700",
};
const ACTION_STYLES: Record<string, string> = {
  scale: "border-emerald-300 bg-emerald-50 text-emerald-800",
  keep_testing: "border-sky-300 bg-sky-50 text-sky-800",
  modify: "border-amber-300 bg-amber-50 text-amber-800",
  pause: "border-rose-300 bg-rose-50 text-rose-800",
  insufficient_data: "border-zinc-300 bg-zinc-50 text-zinc-600",
};
const ACTION_LABELS: Record<string, string> = { scale: "SCALE", keep_testing: "KEEP TESTING", modify: "MODIFY", pause: "PAUSE", insufficient_data: "INSUFFICIENT DATA" };

export default async function AcquisitionIntelligencePage() {
  const session = await requireSession();
  if (!session) redirect("/login");
  const company = await prisma.company.findUniqueOrThrow({ where: { id: session.companyId } });

  const { studies, errors: loadErrors } = loadCaseStudies();
  const benchmarks = computeStandardBenchmarks(studies);
  const hypotheses = generateOfferHypotheses(studies, "costPerBookedInspectionCents");
  const experiments = await listExperimentsWithMetrics(session.companyId, company.isDemo);

  const hypothesesByConfidence = {
    high: hypotheses.filter((h) => h.confidence === "high"),
    medium: hypotheses.filter((h) => h.confidence === "medium"),
    experimental: hypotheses.filter((h) => h.confidence === "experimental"),
  };

  // First-party vs industry comparisons — only for experiments with enough
  // real bookings AND a compatible benchmark segment (platform + offer).
  const comparisons = experiments
    .map(({ experiment, metrics }) => {
      const benchmark = computeBenchmark(studies, { platform: experiment.platform as never, offer: experiment.offer ?? undefined }, "costPerBookedInspectionCents");
      const recommendation = recommendExperimentAction({ bookedInspections: metrics.booked, costPerBookedInspectionCents: metrics.costPerBookedInspectionCents, benchmark });
      return { experiment, metrics, benchmark, recommendation };
    })
    .filter((c) => c.recommendation.action !== "insufficient_data");

  async function createExperiment(formData: FormData) {
    "use server";
    const hypothesis = String(formData.get("hypothesis") ?? "").trim();
    const platform = String(formData.get("platform") ?? "");
    const utmSource = String(formData.get("utmSource") ?? "").trim();
    if (!hypothesis || hypothesis.length > 500 || !PLATFORM_VALUES.includes(platform as never) || !utmSource || utmSource.length > 100) return;
    const audience = String(formData.get("audience") ?? "").trim();
    const creative = String(formData.get("creative") ?? "").trim();
    const offer = String(formData.get("offer") ?? "").trim();
    const landingPage = String(formData.get("landingPage") ?? "").trim();
    const cta = String(formData.get("cta") ?? "").trim();
    const utmMedium = String(formData.get("utmMedium") ?? "").trim();
    const utmCampaign = String(formData.get("utmCampaign") ?? "").trim();
    const startDateRaw = String(formData.get("startDate") ?? "");
    const startDate = startDateRaw ? new Date(startDateRaw) : null;

    await prisma.campaignExperiment.create({
      data: {
        companyId: session!.companyId,
        isDemo: company.isDemo,
        hypothesis,
        platform,
        audience: audience || null,
        creative: creative || null,
        offer: offer || null,
        landingPage: landingPage || null,
        cta: cta || null,
        utmSource,
        utmMedium: utmMedium || null,
        utmCampaign: utmCampaign || null,
        status: "planned",
        startDate: startDate && Number.isFinite(startDate.getTime()) ? startDate : null,
      },
    });
    revalidatePath("/dashboard/intelligence");
  }

  async function updateExperimentStatus(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "");
    const status = String(formData.get("status") ?? "");
    const VALID_STATUSES = ["planned", "running", "winner", "loser", "inconclusive"];
    if (!id || !VALID_STATUSES.includes(status)) return;
    await prisma.campaignExperiment.update({
      where: { id, companyId: session!.companyId },
      data: { status },
    });
    revalidatePath("/dashboard/intelligence");
  }

  const runningExperiments = experiments.filter(({ experiment }) => experiment.status === "running").length;

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-2xl bg-gradient-to-br from-emerald-950 via-emerald-900 to-zinc-900 p-6 shadow-lg">
        <h1 className="text-sm font-semibold uppercase tracking-wide text-emerald-200">Acquisition Intelligence</h1>
        <p className="mt-2 max-w-3xl text-sm text-emerald-100/80">
          Combines three always-separated categories: <strong className="text-white">external industry evidence</strong> (real, cited pest-control marketing case studies),{" "}
          <strong className="text-white">platform inferences</strong> (deterministic recommendations derived from that evidence), and{" "}
          <strong className="text-white">your real first-party data</strong> (live campaign performance from this platform&apos;s own attribution). Industry evidence never becomes your results, and your results are never blended into an industry number.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <IntelStat label="Case studies" value={studies.length} />
          <IntelStat label="Benchmarks available" value={benchmarks.length} />
          <IntelStat label="Recommended tests" value={hypotheses.length} />
          <IntelStat label="Experiments running" value={runningExperiments} />
        </div>
      </section>

      {loadErrors.length > 0 && (
        <section className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <p className="font-semibold">{loadErrors.length} case-study file{loadErrors.length === 1 ? "" : "s"} failed validation and were not loaded:</p>
          <ul className="mt-1 list-disc pl-5">
            {loadErrors.map((e) => (
              <li key={e.file}><strong>{e.file}</strong>: {e.issues.join("; ")}</li>
            ))}
          </ul>
        </section>
      )}

      {/* ------------------------------------------------------------- */}
      <section>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">Industry benchmarks</h2>
        <p className="mb-3 text-xs text-zinc-400">External evidence only — never your own campaign results. Only shown when at least 2 compatible case studies support a number.</p>
        {benchmarks.length === 0 ? (
          <EmptyState
            title="Insufficient benchmark data"
            body="No verified pest-control case studies are imported yet, so there isn't enough evidence for a benchmark."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {benchmarks.map((b, i) => (
              <div key={i} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  {b.segment.platform ? b.segment.platform.replace(/_/g, " ") : b.segment.offer?.replace(/_/g, " ")}
                </p>
                <p className="mt-0.5 text-xs text-zinc-400">{METRIC_LABELS[b.metric]}</p>
                <p className="mt-1 text-2xl font-bold">{formatMetricValue(b.metric, b.median)}</p>
                <p className="mt-1 text-xs text-zinc-400">
                  Studies: {b.sampleSize} · Range: {formatMetricValue(b.metric, b.min)}–{formatMetricValue(b.metric, b.max)}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------- */}
      <section>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">Case study library</h2>
        <p className="mb-3 text-xs text-zinc-400">{studies.length} verified {studies.length === 1 ? "study" : "studies"} imported.</p>
        {studies.length === 0 ? (
          <EmptyState
            title="No verified pest-control case studies imported yet"
            body="Add one as a JSON file under docs/marketing-intelligence/case-studies/ — see docs/marketing-intelligence/README.md for the exact format and required fields (source, campaign context, evidence quality). Numeric metrics stay optional; never invent a number a source didn't report."
          />
        ) : (
          <div className="flex flex-col gap-2">
            {studies.map((s) => (
              <details key={s.id} className="group rounded-xl border border-zinc-200 bg-white p-4 shadow-sm open:shadow-sm">
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold text-zinc-900">{s.companyOrCampaignName ?? s.sourceTitle}</span>
                    <span className="ml-2 text-xs text-zinc-400">
                      {s.platform.replace(/_/g, " ")} · {s.pestCategory.replace(/_/g, " ")}{s.offer ? ` · ${s.offer.replace(/_/g, " ")}` : ""}
                    </span>
                  </span>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${EVIDENCE_BADGE[s.evidenceQuality]}`}>
                    {s.evidenceQuality} evidence
                  </span>
                  <span className="shrink-0 text-xs text-emerald-700 group-open:hidden">View details ▾</span>
                  <span className="hidden shrink-0 text-xs text-emerald-700 group-open:inline">Hide details ▴</span>
                </summary>
                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-zinc-100 pt-4 text-sm sm:grid-cols-4">
                  <Metric label="CPL" value={formatMetricValue("cplCents", s.reportedCplCents ?? null)} />
                  <Metric label="Booking rate" value={formatMetricValue("bookingRate", s.reportedBookingRate ?? null)} />
                  <Metric label="CAC" value={formatMetricValue("cacCents", s.reportedCacCents ?? null)} />
                  <Metric label="ROAS" value={s.reportedRoas != null ? `${s.reportedRoas.toFixed(2)}x` : "Unavailable"} />
                </div>
                {s.reportedResult && <p className="mt-3 text-sm text-zinc-700">&ldquo;{s.reportedResult}&rdquo;</p>}
                {s.limitations && <p className="mt-2 text-xs text-zinc-500"><strong>Limitations:</strong> {s.limitations}</p>}
                <p className="mt-2 text-xs text-zinc-500"><strong>Why {s.evidenceQuality} evidence:</strong> {s.evidenceQualityReason}</p>
                <p className="mt-3 text-xs text-zinc-400">
                  Source: {s.sourceTitle} — {s.publisher}{s.publicationDate ? `, ${s.publicationDate}` : ""} · Accessed {s.dateAccessed} ·{" "}
                  <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="text-emerald-700 underline">View source ↗</a>
                </p>
              </details>
            ))}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------- */}
      <section>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">Recommended experiments</h2>
        <p className="mb-3 text-xs text-zinc-400">Testable hypotheses derived from industry evidence — priorities for testing, not guarantees.</p>
        {hypotheses.length === 0 ? (
          <EmptyState title="No recommendations yet" body="Recommendations appear once enough compatible case studies exist to compare two offers or platforms." />
        ) : (
          <div className="flex flex-col gap-4">
            {(["high", "medium", "experimental"] as const).map((tier) =>
              hypothesesByConfidence[tier].length === 0 ? null : (
                <div key={tier}>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-500">{tier === "high" ? "High confidence" : tier === "medium" ? "Medium confidence" : "Experimental"}</h3>
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {hypothesesByConfidence[tier].map((h, i) => (
                      <div key={i} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                        <div className="mb-2 flex items-start justify-between gap-2">
                          <p className="font-semibold text-zinc-900">{h.recommendedTest}</p>
                          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${CONFIDENCE_STYLES[h.confidence]}`}>{h.confidence}</span>
                        </div>
                        <p className="text-sm text-zinc-600">{h.reason}</p>
                        <p className="mt-2 text-xs text-zinc-400">
                          {METRIC_LABELS[h.metric]}: {formatMetricValue(h.metric, h.betterMedian)} vs {formatMetricValue(h.metric, h.worseMedian)} · Supported by {h.sampleSize} studies
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------- */}
      {comparisons.length > 0 && (
        <section>
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">First-party vs industry</h2>
          <p className="mb-3 text-xs text-zinc-400">Only shown once an experiment has real, comparable data.</p>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {comparisons.map(({ experiment, recommendation }) => (
              <div key={experiment.id} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <p className="font-semibold text-zinc-900">{experiment.hypothesis}</p>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${ACTION_STYLES[recommendation.action]}`}>{ACTION_LABELS[recommendation.action]}</span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <Metric label="Industry benchmark" value={money(recommendation.benchmarkMedian)} />
                  <Metric label="Your result" value={money(recommendation.experimentValue)} />
                </div>
                <p className="mt-2 text-xs text-zinc-500">{recommendation.reason}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------- */}
      <section>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">Experiment tracker</h2>
        <p className="mb-3 text-xs text-zinc-400">Real campaigns you&apos;re running. Metrics are computed live from real attributed leads/bookings/revenue — never estimated.</p>

        <form action={createExperiment} className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:grid-cols-2">
          <input name="hypothesis" required placeholder="Hypothesis (e.g. Free inspection offer on Meta)" className="col-span-1 rounded border border-zinc-300 px-3 py-2 text-sm sm:col-span-2" />
          <select name="platform" required defaultValue="" className="rounded border border-zinc-300 px-3 py-2 text-sm">
            <option value="" disabled>Platform</option>
            {PLATFORM_VALUES.map((p) => <option key={p} value={p}>{p.replace(/_/g, " ")}</option>)}
          </select>
          <input name="offer" placeholder="Offer (optional)" className="rounded border border-zinc-300 px-3 py-2 text-sm" />
          <input name="audience" placeholder="Audience (optional)" className="rounded border border-zinc-300 px-3 py-2 text-sm" />
          <input name="creative" placeholder="Creative (optional)" className="rounded border border-zinc-300 px-3 py-2 text-sm" />
          <input name="landingPage" placeholder="Landing page (optional)" className="rounded border border-zinc-300 px-3 py-2 text-sm" />
          <input name="cta" placeholder="CTA (optional)" className="rounded border border-zinc-300 px-3 py-2 text-sm" />
          <input name="utmSource" required placeholder="utm_source (must match real traffic)" className="rounded border border-zinc-300 px-3 py-2 text-sm" />
          <input name="utmMedium" placeholder="utm_medium (optional)" className="rounded border border-zinc-300 px-3 py-2 text-sm" />
          <input name="utmCampaign" placeholder="utm_campaign (optional)" className="rounded border border-zinc-300 px-3 py-2 text-sm" />
          <label className="col-span-1 flex flex-col gap-1 text-xs text-zinc-500 sm:col-span-2">
            Start date (optional)
            <input name="startDate" type="date" className="rounded border border-zinc-300 px-3 py-2 text-sm" />
          </label>
          <button className="col-span-1 rounded bg-emerald-700 px-4 py-2 text-sm font-semibold text-white sm:col-span-2">Add experiment</button>
        </form>

        {experiments.length === 0 ? (
          <EmptyState title="No experiments yet" body="Add one above — it'll match to real attributed traffic by UTM source/medium/campaign, the same identifiers already used in Marketing Performance." />
        ) : (
          <div className="flex flex-col gap-3">
            {experiments.map(({ experiment, metrics }) => (
              <div key={experiment.id} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-zinc-900">{experiment.hypothesis}</p>
                    <p className="text-xs text-zinc-400">
                      {experiment.platform.replace(/_/g, " ")}{experiment.offer ? ` · ${experiment.offer}` : ""} · {experiment.utmSource}{experiment.utmMedium ? `/${experiment.utmMedium}` : ""}{experiment.utmCampaign ? `/${experiment.utmCampaign}` : ""}
                    </p>
                  </div>
                  <form action={updateExperimentStatus} className="flex shrink-0 items-center gap-2">
                    <input type="hidden" name="id" value={experiment.id} />
                    <select name="status" defaultValue={experiment.status} className="rounded border border-zinc-300 px-2 py-1 text-xs">
                      {["planned", "running", "winner", "loser", "inconclusive"].map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
                    </select>
                    <button className="rounded border border-zinc-300 px-2 py-1 text-xs font-medium hover:border-emerald-700">Update</button>
                  </form>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 lg:grid-cols-8">
                  <Metric label="Visitors" value={String(metrics.visitors)} />
                  <Metric label="Leads" value={String(metrics.leads)} />
                  <Metric label="Qualified" value={String(metrics.qualified)} />
                  <Metric label="Booked" value={String(metrics.booked)} />
                  <Metric label="Completed" value={String(metrics.completed)} />
                  <Metric label="Customers" value={String(metrics.customers)} />
                  <Metric label="CPL" value={money(metrics.costPerLeadCents)} />
                  <Metric label="CAC" value={money(metrics.cac)} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const EVIDENCE_BADGE: Record<string, string> = {
  high: "border-emerald-300 bg-emerald-50 text-emerald-800",
  medium: "border-amber-300 bg-amber-50 text-amber-800",
  low: "border-zinc-300 bg-zinc-100 text-zinc-600",
};

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
      <p className="font-semibold text-zinc-700">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500">{body}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[10px] font-medium uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="truncate text-sm font-semibold text-zinc-900">{value}</p>
    </div>
  );
}

function IntelStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-white/5 p-3 backdrop-blur-sm">
      <p className="truncate text-[11px] font-medium uppercase tracking-wide text-emerald-200/80">{label}</p>
      <p className="mt-0.5 truncate text-xl font-bold text-white">{value}</p>
    </div>
  );
}
