import { describe, expect, it } from "vitest";
import { computeBenchmark, computeStandardBenchmarks, deriveMetric, MIN_BENCHMARK_SAMPLE_SIZE } from "./benchmarks";
import {
  ALL_FIXTURE_STUDIES,
  FIXTURE_googleTermiteSingle,
  FIXTURE_metaContactUsLow1,
  FIXTURE_metaContactUsLow2,
  FIXTURE_metaFreeInspectionHigh1,
  FIXTURE_metaFreeInspectionHigh2,
  FIXTURE_sparseData,
} from "./__fixtures__/test-case-studies";

describe("deriveMetric", () => {
  it("prefers a directly-reported metric over a derived one", () => {
    expect(deriveMetric(FIXTURE_metaFreeInspectionHigh1, "cplCents")).toBe(500);
  });

  it("derives a metric from other reported numbers when not directly reported", () => {
    const withoutCpl = { ...FIXTURE_metaFreeInspectionHigh1, reportedCplCents: null };
    // 100000 cents spend / 200 leads = 500 cents/lead
    expect(deriveMetric(withoutCpl, "cplCents")).toBe(500);
  });

  it("returns null when the underlying numbers needed to derive are unavailable", () => {
    expect(deriveMetric(FIXTURE_sparseData, "cplCents")).toBeNull();
    expect(deriveMetric(FIXTURE_sparseData, "costPerBookedInspectionCents")).toBeNull();
  });

  it("never fabricates a value from a zero denominator", () => {
    const zeroLeads = { ...FIXTURE_metaFreeInspectionHigh1, reportedCplCents: null, reportedLeads: 0 };
    expect(deriveMetric(zeroLeads, "cplCents")).toBeNull();
  });
});

describe("computeBenchmark — evidence quality gate", () => {
  it("returns insufficientEvidence for a segment with zero matching studies", () => {
    const result = computeBenchmark(ALL_FIXTURE_STUDIES, { platform: "google_local_services" }, "cplCents");
    expect(result.insufficientEvidence).toBe(true);
    expect(result.sampleSize).toBe(0);
    expect(result.median).toBeNull();
  });

  it("returns insufficientEvidence for a single-study segment, below MIN_BENCHMARK_SAMPLE_SIZE", () => {
    expect(MIN_BENCHMARK_SAMPLE_SIZE).toBeGreaterThanOrEqual(2);
    const result = computeBenchmark([FIXTURE_googleTermiteSingle], { platform: "google_search" }, "cplCents");
    expect(result.sampleSize).toBe(1);
    expect(result.insufficientEvidence).toBe(true);
    expect(result.median).toBeNull();
  });

  it("computes a real median once enough compatible studies exist", () => {
    const result = computeBenchmark([FIXTURE_metaFreeInspectionHigh1, FIXTURE_metaFreeInspectionHigh2], { platform: "meta", offer: "free_inspection" }, "cplCents");
    expect(result.insufficientEvidence).toBe(false);
    expect(result.sampleSize).toBe(2);
    expect(result.median).toBe((500 + 533) / 2);
    expect(result.min).toBe(500);
    expect(result.max).toBe(533);
  });

  it("never mixes incompatible segments — platform filter excludes other platforms", () => {
    const result = computeBenchmark(ALL_FIXTURE_STUDIES, { platform: "meta" }, "cplCents");
    expect(result.studyIds).not.toContain(FIXTURE_googleTermiteSingle.id);
  });

  it("never mixes incompatible segments — offer filter excludes other offers", () => {
    const result = computeBenchmark(ALL_FIXTURE_STUDIES, { platform: "meta", offer: "free_inspection" }, "cplCents");
    expect(result.studyIds).not.toContain(FIXTURE_metaContactUsLow1.id);
    expect(result.studyIds).not.toContain(FIXTURE_metaContactUsLow2.id);
  });

  it("tracks evidence quality counts for the contributing studies", () => {
    const result = computeBenchmark([FIXTURE_metaContactUsLow1, FIXTURE_metaContactUsLow2], { platform: "meta", offer: "contact_us" }, "cplCents");
    expect(result.evidenceQualityCounts.low).toBe(2);
    expect(result.evidenceQualityCounts.high).toBe(0);
  });

  it("excludes studies where the metric itself is unavailable, without treating them as zero", () => {
    const result = computeBenchmark([FIXTURE_metaFreeInspectionHigh1, FIXTURE_sparseData], { platform: "meta" }, "cplCents");
    // sparseData has pestCategory mosquito/platform seo — won't match platform:meta anyway,
    // but even if it matched, a study with no cplCents-derivable data must never count.
    expect(result.studyIds).not.toContain(FIXTURE_sparseData.id);
  });
});

describe("computeStandardBenchmarks", () => {
  it("only returns benchmarks with sufficient evidence", () => {
    const results = computeStandardBenchmarks(ALL_FIXTURE_STUDIES);
    expect(results.every((r) => !r.insufficientEvidence)).toBe(true);
    expect(results.every((r) => r.sampleSize >= MIN_BENCHMARK_SAMPLE_SIZE)).toBe(true);
  });

  it("returns an empty array when no case studies are supplied (production empty state)", () => {
    expect(computeStandardBenchmarks([])).toEqual([]);
  });
});
