import type { CaseStudy } from "./case-study-schema";
import { type BenchmarkResult, type DerivedMetricKey, computeBenchmark, MIN_BENCHMARK_SAMPLE_SIZE } from "./benchmarks";

// Deterministic, fully transparent scoring — no ML, no hidden weighting.
// Every threshold below is a named constant with a one-line reason next to
// it, and every recommendation carries the exact numbers that produced it so
// the UI can show its work. See docs/marketing-intelligence/CAMPAIGN-PLAYBOOK.md
// for the narrative version of these same rules.

export type ConfidenceLevel = "high" | "medium" | "experimental";

// A hypothesis is only worth surfacing if one option's benchmark is enough
// better than the alternative's to plausibly not be noise between two small
// samples.
const MEANINGFUL_DIFFERENCE_RATIO = 0.15; // 15% lower cost (or higher rate) to count as "better"
// HIGH confidence requires more total evidence than the bare statistical
// minimum, and that evidence skewing toward directly-documented (not just
// claimed) results.
const HIGH_CONFIDENCE_MIN_COMBINED_SAMPLE = 4;
const HIGH_CONFIDENCE_MIN_HIGH_QUALITY_SHARE = 0.5;

export interface OfferHypothesis {
  platform: CaseStudy["platform"];
  metric: DerivedMetricKey;
  betterOffer: string;
  worseOffer: string;
  betterMedian: number;
  worseMedian: number;
  percentDifference: number; // positive = betterOffer is that much better
  confidence: ConfidenceLevel;
  supportingStudyIds: string[];
  sampleSize: number;
  recommendedTest: string;
  reason: string;
}

// Lower-is-better vs higher-is-better differs by metric — cost metrics want
// the lower number to win, rate/ROAS metrics want the higher number to win.
const LOWER_IS_BETTER: DerivedMetricKey[] = ["cplCents", "cpcCents", "costPerBookedInspectionCents", "cacCents"];

function classifyConfidence(a: BenchmarkResult, b: BenchmarkResult): ConfidenceLevel {
  const combinedSample = a.sampleSize + b.sampleSize;
  const combinedHighQuality = a.evidenceQualityCounts.high + b.evidenceQualityCounts.high;
  if (
    combinedSample >= HIGH_CONFIDENCE_MIN_COMBINED_SAMPLE &&
    combinedHighQuality / combinedSample >= HIGH_CONFIDENCE_MIN_HIGH_QUALITY_SHARE
  ) {
    return "high";
  }
  // Meets the bare minimum sample size for a benchmark to exist at all
  // (MIN_BENCHMARK_SAMPLE_SIZE, enforced by computeBenchmark before this
  // function ever sees the result) but doesn't clear the high-confidence bar.
  const combinedLowQuality = a.evidenceQualityCounts.low + b.evidenceQualityCounts.low;
  if (combinedLowQuality === combinedSample) return "experimental"; // every contributing study is low-quality
  return "medium";
}

// Compares every pair of offers within the same platform on one metric and
// surfaces a hypothesis for each pair where the difference is large enough
// to plausibly matter. Deliberately does NOT compare across platforms or
// pest categories — that would mix incompatible evidence (see
// docs/marketing-intelligence/BENCHMARKS.md).
export function generateOfferHypotheses(studies: CaseStudy[], metric: DerivedMetricKey = "costPerBookedInspectionCents"): OfferHypothesis[] {
  const platforms = [...new Set(studies.map((s) => s.platform))];
  const hypotheses: OfferHypothesis[] = [];

  for (const platform of platforms) {
    const offers = [...new Set(studies.filter((s) => s.platform === platform).map((s) => s.offer).filter((v): v is string => Boolean(v)))];
    for (let i = 0; i < offers.length; i++) {
      for (let j = i + 1; j < offers.length; j++) {
        const resultA = computeBenchmark(studies, { platform, offer: offers[i] }, metric);
        const resultB = computeBenchmark(studies, { platform, offer: offers[j] }, metric);
        if (resultA.insufficientEvidence || resultB.insufficientEvidence) continue;
        if (resultA.median === null || resultB.median === null) continue;

        const lowerIsBetter = LOWER_IS_BETTER.includes(metric);
        const aIsBetter = lowerIsBetter ? resultA.median < resultB.median : resultA.median > resultB.median;
        const [better, worse] = aIsBetter ? [resultA, resultB] : [resultB, resultA];
        const [betterOffer, worseOffer] = aIsBetter ? [offers[i], offers[j]] : [offers[j], offers[i]];
        if (better.median === null || worse.median === null || worse.median === 0) continue;

        const percentDifference = lowerIsBetter
          ? (worse.median - better.median) / worse.median
          : (better.median - worse.median) / worse.median;
        if (percentDifference < MEANINGFUL_DIFFERENCE_RATIO) continue;

        hypotheses.push({
          platform,
          metric,
          betterOffer,
          worseOffer,
          betterMedian: better.median,
          worseMedian: worse.median,
          percentDifference,
          confidence: classifyConfidence(better, worse),
          supportingStudyIds: [...better.studyIds, ...worse.studyIds],
          sampleSize: better.sampleSize + worse.sampleSize,
          recommendedTest: `${labelOffer(betterOffer)} vs ${labelOffer(worseOffer)}`,
          reason: `Existing evidence suggests ${labelOffer(betterOffer)} is a stronger starting hypothesis than ${labelOffer(worseOffer)} for ${platform.replace(/_/g, " ")} (${better.sampleSize + worse.sampleSize} compatible ${better.sampleSize + worse.sampleSize === 1 ? "study" : "studies"}).`,
        });
      }
    }
  }
  return hypotheses;
}

function labelOffer(offer: string): string {
  return offer.replace(/_/g, " ");
}

// -----------------------------------------------------------------------
// Phase 8 — post-data experiment recommendation. Operates on a RUNNING or
// completed experiment's real, live-computed metrics (never on case-study
// data) compared against the matching industry benchmark segment, if one
// exists.
// -----------------------------------------------------------------------

export type ExperimentAction = "scale" | "keep_testing" | "modify" | "pause" | "insufficient_data";

// Below this many real bookings, any comparison to a benchmark is judged too
// noisy to act on — the experiment needs more real traffic first, which is
// exactly the point of Phase 6 (industry evidence matters most early,
// first-party data takes over as it accumulates).
const MIN_EXPERIMENT_BOOKINGS_FOR_COMPARISON = 3;
// How far from the benchmark median counts as "meaningfully" better/worse,
// as a fraction of the benchmark median.
const SCALE_THRESHOLD = 0.15; // >=15% better than benchmark median
const MODIFY_THRESHOLD = 0.15; // 15%-50% worse than benchmark median
const PAUSE_THRESHOLD = 0.5; // >50% worse than benchmark median

export interface ExperimentRecommendation {
  action: ExperimentAction;
  reason: string;
  benchmarkMedian: number | null;
  experimentValue: number | null;
  percentVsBenchmark: number | null; // positive = worse than benchmark, negative = better
}

export function recommendExperimentAction(params: {
  bookedInspections: number;
  costPerBookedInspectionCents: number | null;
  benchmark: BenchmarkResult;
}): ExperimentRecommendation {
  const { bookedInspections, costPerBookedInspectionCents, benchmark } = params;

  if (bookedInspections < MIN_EXPERIMENT_BOOKINGS_FOR_COMPARISON) {
    return {
      action: "insufficient_data",
      reason: `Only ${bookedInspections} real booked inspection${bookedInspections === 1 ? "" : "s"} so far — needs at least ${MIN_EXPERIMENT_BOOKINGS_FOR_COMPARISON} before comparing to industry data.`,
      benchmarkMedian: benchmark.insufficientEvidence ? null : benchmark.median,
      experimentValue: costPerBookedInspectionCents,
      percentVsBenchmark: null,
    };
  }
  if (costPerBookedInspectionCents === null) {
    return {
      action: "insufficient_data",
      reason: "No marketing spend logged for this experiment yet, so cost per booked inspection is unknown.",
      benchmarkMedian: benchmark.insufficientEvidence ? null : benchmark.median,
      experimentValue: null,
      percentVsBenchmark: null,
    };
  }
  if (benchmark.insufficientEvidence || benchmark.median === null) {
    return {
      action: "insufficient_data",
      reason: "No compatible industry benchmark exists yet for this platform/offer combination — nothing to compare against.",
      benchmarkMedian: null,
      experimentValue: costPerBookedInspectionCents,
      percentVsBenchmark: null,
    };
  }

  const percentVsBenchmark = (costPerBookedInspectionCents - benchmark.median) / benchmark.median;

  if (percentVsBenchmark <= -SCALE_THRESHOLD) {
    return {
      action: "scale",
      reason: `Cost per booked inspection is ${Math.round(Math.abs(percentVsBenchmark) * 100)}% below the industry benchmark — real results are outperforming the prior evidence.`,
      benchmarkMedian: benchmark.median, experimentValue: costPerBookedInspectionCents, percentVsBenchmark,
    };
  }
  if (percentVsBenchmark > PAUSE_THRESHOLD) {
    return {
      action: "pause",
      reason: `Cost per booked inspection is ${Math.round(percentVsBenchmark * 100)}% above the industry benchmark — real results are substantially underperforming the prior evidence.`,
      benchmarkMedian: benchmark.median, experimentValue: costPerBookedInspectionCents, percentVsBenchmark,
    };
  }
  if (percentVsBenchmark > MODIFY_THRESHOLD) {
    return {
      action: "modify",
      reason: `Cost per booked inspection is ${Math.round(percentVsBenchmark * 100)}% above the industry benchmark — worth adjusting creative, offer, or targeting before scaling.`,
      benchmarkMedian: benchmark.median, experimentValue: costPerBookedInspectionCents, percentVsBenchmark,
    };
  }
  return {
    action: "keep_testing",
    reason: `Cost per booked inspection is within ${Math.round(MODIFY_THRESHOLD * 100)}% of the industry benchmark — not yet a clear enough signal to scale, modify, or pause.`,
    benchmarkMedian: benchmark.median, experimentValue: costPerBookedInspectionCents, percentVsBenchmark,
  };
}

export const RECOMMENDATION_THRESHOLDS = {
  MIN_BENCHMARK_SAMPLE_SIZE,
  MEANINGFUL_DIFFERENCE_RATIO,
  HIGH_CONFIDENCE_MIN_COMBINED_SAMPLE,
  HIGH_CONFIDENCE_MIN_HIGH_QUALITY_SHARE,
  MIN_EXPERIMENT_BOOKINGS_FOR_COMPARISON,
  SCALE_THRESHOLD,
  MODIFY_THRESHOLD,
  PAUSE_THRESHOLD,
} as const;
