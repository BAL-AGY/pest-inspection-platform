import { describe, expect, it } from "vitest";
import { generateOfferHypotheses, recommendExperimentAction, RECOMMENDATION_THRESHOLDS } from "./recommendations";
import { computeBenchmark } from "./benchmarks";
import type { CaseStudy } from "./case-study-schema";
import {
  ALL_FIXTURE_STUDIES,
  FIXTURE_metaContactUsLow1,
  FIXTURE_metaContactUsLow2,
  FIXTURE_metaFreeInspectionHigh1,
  FIXTURE_metaFreeInspectionHigh2,
} from "./__fixtures__/test-case-studies";

// TEST/FIXTURE DATA — see __fixtures__/test-case-studies.ts for the base
// convention. These two extra fixture pairs exist only to exercise the
// medium/experimental confidence tiers, which the shared fixture set doesn't
// naturally produce.
const mediumA: CaseStudy = { ...FIXTURE_metaFreeInspectionHigh1, id: "fixture-medium-a", platform: "google_search", offer: "discount", evidenceQuality: "medium", sourceUrl: "https://example.com/medium-a" };
const mediumA2: CaseStudy = { ...mediumA, id: "fixture-medium-a2", sourceUrl: "https://example.com/medium-a2" };
const mediumB: CaseStudy = { ...FIXTURE_metaContactUsLow1, id: "fixture-medium-b", platform: "google_search", offer: "seasonal_promo", evidenceQuality: "medium", sourceUrl: "https://example.com/medium-b" };
const mediumB2: CaseStudy = { ...mediumB, id: "fixture-medium-b2", sourceUrl: "https://example.com/medium-b2" };
const experimentalA: CaseStudy = { ...FIXTURE_metaFreeInspectionHigh1, id: "fixture-exp-a", platform: "google_local_services", offer: "free_quote", evidenceQuality: "low", sourceUrl: "https://example.com/exp-a" };
const experimentalA2: CaseStudy = { ...experimentalA, id: "fixture-exp-a2", sourceUrl: "https://example.com/exp-a2" };
const experimentalB: CaseStudy = { ...FIXTURE_metaContactUsLow1, id: "fixture-exp-b", platform: "google_local_services", offer: "no_offer", evidenceQuality: "low", sourceUrl: "https://example.com/exp-b" };
const experimentalB2: CaseStudy = { ...experimentalB, id: "fixture-exp-b2", sourceUrl: "https://example.com/exp-b2" };

describe("generateOfferHypotheses", () => {
  it("generates a hypothesis when one offer's benchmark is meaningfully better than another's", () => {
    const hypotheses = generateOfferHypotheses(ALL_FIXTURE_STUDIES, "costPerBookedInspectionCents");
    const freeVsContact = hypotheses.find((h) => h.platform === "meta" && (h.betterOffer === "free_inspection" || h.worseOffer === "free_inspection"));
    expect(freeVsContact).toBeDefined();
    expect(freeVsContact!.betterOffer).toBe("free_inspection");
    expect(freeVsContact!.worseOffer).toBe("contact_us");
    expect(freeVsContact!.percentDifference).toBeGreaterThan(RECOMMENDATION_THRESHOLDS.MEANINGFUL_DIFFERENCE_RATIO);
  });

  it("classifies confidence as high with 4+ combined studies and >=50% high-quality share", () => {
    const hypotheses = generateOfferHypotheses(
      [FIXTURE_metaFreeInspectionHigh1, FIXTURE_metaFreeInspectionHigh2, FIXTURE_metaContactUsLow1, FIXTURE_metaContactUsLow2],
      "costPerBookedInspectionCents",
    );
    expect(hypotheses).toHaveLength(1);
    expect(hypotheses[0].confidence).toBe("high");
    expect(hypotheses[0].sampleSize).toBe(4);
  });

  it("classifies confidence as medium for a smaller, medium-quality pair", () => {
    const hypotheses = generateOfferHypotheses([mediumA, mediumA2, mediumB, mediumB2], "costPerBookedInspectionCents");
    expect(hypotheses.length).toBeGreaterThan(0);
    expect(hypotheses[0].confidence).toBe("medium");
  });

  it("classifies confidence as experimental when every contributing study is low-quality", () => {
    const hypotheses = generateOfferHypotheses([experimentalA, experimentalA2, experimentalB, experimentalB2], "costPerBookedInspectionCents");
    expect(hypotheses.length).toBeGreaterThan(0);
    expect(hypotheses[0].confidence).toBe("experimental");
  });

  it("never generates a hypothesis across different platforms", () => {
    const hypotheses = generateOfferHypotheses(ALL_FIXTURE_STUDIES, "costPerBookedInspectionCents");
    for (const h of hypotheses) {
      // every supporting study must share the same platform as the hypothesis
      const studies = ALL_FIXTURE_STUDIES.filter((s) => h.supportingStudyIds.includes(s.id));
      expect(studies.every((s) => s.platform === h.platform)).toBe(true);
    }
  });

  it("returns an empty array when no case studies exist (production empty state)", () => {
    expect(generateOfferHypotheses([])).toEqual([]);
  });

  it("never states a hypothesis as certain — reason text uses hedged language", () => {
    const hypotheses = generateOfferHypotheses(ALL_FIXTURE_STUDIES, "costPerBookedInspectionCents");
    for (const h of hypotheses) {
      expect(h.reason).toMatch(/suggests|may|stronger starting hypothesis/i);
      expect(h.reason).not.toMatch(/will work|guaranteed|proven/i);
    }
  });
});

describe("recommendExperimentAction", () => {
  const benchmark = computeBenchmark([FIXTURE_metaFreeInspectionHigh1, FIXTURE_metaFreeInspectionHigh2], { platform: "meta", offer: "free_inspection" }, "costPerBookedInspectionCents");

  it("returns insufficient_data below the minimum booking count", () => {
    const result = recommendExperimentAction({ bookedInspections: 1, costPerBookedInspectionCents: 1000, benchmark });
    expect(result.action).toBe("insufficient_data");
  });

  it("returns insufficient_data when no spend is logged", () => {
    const result = recommendExperimentAction({ bookedInspections: 10, costPerBookedInspectionCents: null, benchmark });
    expect(result.action).toBe("insufficient_data");
  });

  it("returns insufficient_data when no compatible benchmark exists", () => {
    const noBenchmark = computeBenchmark([], { platform: "google_local_services" }, "costPerBookedInspectionCents");
    const result = recommendExperimentAction({ bookedInspections: 10, costPerBookedInspectionCents: 1000, benchmark: noBenchmark });
    expect(result.action).toBe("insufficient_data");
  });

  it("recommends scale when meaningfully beating the benchmark", () => {
    // benchmark median ~= 1291.67; well below it (>15%) should scale
    const result = recommendExperimentAction({ bookedInspections: 10, costPerBookedInspectionCents: 800, benchmark });
    expect(result.action).toBe("scale");
  });

  it("recommends keep_testing when close to the benchmark", () => {
    const result = recommendExperimentAction({ bookedInspections: 10, costPerBookedInspectionCents: benchmark.median!, benchmark });
    expect(result.action).toBe("keep_testing");
  });

  it("recommends modify when moderately worse than the benchmark", () => {
    const worse = benchmark.median! * 1.3; // 30% worse
    const result = recommendExperimentAction({ bookedInspections: 10, costPerBookedInspectionCents: worse, benchmark });
    expect(result.action).toBe("modify");
  });

  it("recommends pause when substantially worse than the benchmark", () => {
    const muchWorse = benchmark.median! * 2; // 100% worse
    const result = recommendExperimentAction({ bookedInspections: 10, costPerBookedInspectionCents: muchWorse, benchmark });
    expect(result.action).toBe("pause");
  });

  it("never claims certainty in its reason text", () => {
    const result = recommendExperimentAction({ bookedInspections: 10, costPerBookedInspectionCents: 800, benchmark });
    expect(result.reason.toLowerCase()).not.toContain("guaranteed");
  });
});
