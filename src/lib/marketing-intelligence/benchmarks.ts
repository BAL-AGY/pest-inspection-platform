import type { CaseStudy, EvidenceQuality } from "./case-study-schema";

// The benchmark engine — see docs/marketing-intelligence/BENCHMARKS.md for
// the full explanation. Two hard rules enforced everywhere in this file:
//
// 1. Never mix incompatible studies into one number. A benchmark is always
//    computed over a specific segment (e.g. platform=meta AND offer=
//    free_inspection) — there is no "overall industry average" that blends
//    different platforms/offers/pest categories together.
// 2. Never show a number without enough evidence behind it. Below
//    MIN_BENCHMARK_SAMPLE_SIZE compatible studies reporting the metric, the
//    result is `{ insufficientEvidence: true }`, not a number computed from
//    too little data.
export const MIN_BENCHMARK_SAMPLE_SIZE = 2;

export type DerivedMetricKey =
  | "cplCents"
  | "cpcCents"
  | "ctr"
  | "bookingRate"
  | "costPerBookedInspectionCents"
  | "cacCents"
  | "roas"
  | "leadToCustomerRate";

// A study's directly-reported metric is always preferred over one derived
// from its other reported numbers (the source may have used a methodology —
// e.g. excluding branded search — that a naive spend/leads division can't
// reproduce). A derived value is computed ONLY as a fallback, and ONLY from
// two numbers the same study actually reported — never from a mix of a
// reported number and an assumption.
export function deriveMetric(study: CaseStudy, key: DerivedMetricKey): number | null {
  const spend = study.reportedAdSpendCents ?? null;
  const clicks = study.reportedClicks ?? null;
  const impressions = study.reportedImpressions ?? null;
  const leads = study.reportedLeads ?? null;
  const booked = study.reportedBookedInspections ?? null;
  const customers = study.reportedCustomers ?? null;
  const revenue = study.reportedRevenueCents ?? null;

  const ratio = (numerator: number | null, denominator: number | null) =>
    numerator !== null && denominator !== null && denominator > 0 ? numerator / denominator : null;

  switch (key) {
    case "cplCents":
      return study.reportedCplCents ?? ratio(spend, leads);
    case "cpcCents":
      return study.reportedCpcCents ?? ratio(spend, clicks);
    case "ctr":
      return study.reportedCtr ?? ratio(clicks, impressions);
    case "bookingRate":
      return study.reportedBookingRate ?? ratio(booked, leads);
    case "costPerBookedInspectionCents":
      return ratio(spend, booked);
    case "cacCents":
      return study.reportedCacCents ?? ratio(spend, customers);
    case "roas":
      return study.reportedRoas ?? ratio(revenue, spend);
    case "leadToCustomerRate":
      return ratio(customers, leads);
  }
}

export interface BenchmarkSegmentFilter {
  platform?: CaseStudy["platform"];
  offer?: string;
  pestCategory?: string;
  serviceType?: CaseStudy["serviceType"];
}

export interface BenchmarkResult {
  metric: DerivedMetricKey;
  segment: BenchmarkSegmentFilter;
  sampleSize: number;
  insufficientEvidence: boolean;
  median: number | null;
  min: number | null;
  max: number | null;
  evidenceQualityCounts: Record<EvidenceQuality, number>;
  studyIds: string[];
}

function matchesSegment(study: CaseStudy, segment: BenchmarkSegmentFilter): boolean {
  if (segment.platform && study.platform !== segment.platform) return false;
  if (segment.offer && study.offer !== segment.offer) return false;
  if (segment.pestCategory && study.pestCategory !== segment.pestCategory) return false;
  if (segment.serviceType && study.serviceType !== segment.serviceType) return false;
  return true;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function computeBenchmark(
  studies: CaseStudy[],
  segment: BenchmarkSegmentFilter,
  metric: DerivedMetricKey,
): BenchmarkResult {
  const matching = studies.filter((s) => matchesSegment(s, segment));
  const withMetric = matching
    .map((study) => ({ study, value: deriveMetric(study, metric) }))
    .filter((row): row is { study: CaseStudy; value: number } => row.value !== null);

  const evidenceQualityCounts: Record<EvidenceQuality, number> = { high: 0, medium: 0, low: 0 };
  for (const row of withMetric) evidenceQualityCounts[row.study.evidenceQuality]++;

  const insufficientEvidence = withMetric.length < MIN_BENCHMARK_SAMPLE_SIZE;
  const values = withMetric.map((r) => r.value);

  return {
    metric,
    segment,
    sampleSize: withMetric.length,
    insufficientEvidence,
    median: insufficientEvidence ? null : median(values),
    min: insufficientEvidence ? null : Math.min(...values),
    max: insufficientEvidence ? null : Math.max(...values),
    evidenceQualityCounts,
    studyIds: withMetric.map((r) => r.study.id),
  };
}

// Curated set of segments the Acquisition Intelligence UI displays as
// "Industry benchmark" cards. Each is computed independently — adding a new
// segment here never changes the sample size or result of another.
export function computeStandardBenchmarks(studies: CaseStudy[]): BenchmarkResult[] {
  const platforms = [...new Set(studies.map((s) => s.platform))];
  const offers = [...new Set(studies.map((s) => s.offer).filter((v): v is string => Boolean(v)))];
  const metrics: DerivedMetricKey[] = ["cplCents", "bookingRate", "costPerBookedInspectionCents", "cacCents", "roas"];

  const results: BenchmarkResult[] = [];
  for (const platform of platforms) {
    for (const metric of metrics) {
      results.push(computeBenchmark(studies, { platform }, metric));
    }
  }
  for (const offer of offers) {
    for (const metric of metrics) {
      results.push(computeBenchmark(studies, { offer }, metric));
    }
  }
  return results.filter((r) => !r.insufficientEvidence);
}
