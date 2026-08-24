import { describe, expect, it } from "vitest";
import { parseCaseStudy } from "./case-study-schema";
import { FIXTURE_metaFreeInspectionHigh1 } from "./__fixtures__/test-case-studies";

describe("case-study schema validation", () => {
  it("accepts a well-formed case study", () => {
    const result = parseCaseStudy("fixture.json", FIXTURE_metaFreeInspectionHigh1);
    expect("study" in result).toBe(true);
  });

  it("rejects a study missing required source fields", () => {
    const { sourceUrl: _sourceUrl, ...withoutSourceUrl } = FIXTURE_metaFreeInspectionHigh1;
    const result = parseCaseStudy("bad.json", withoutSourceUrl);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.file).toBe("bad.json");
      expect(result.error.issues.some((i) => i.includes("sourceUrl"))).toBe(true);
    }
  });

  it("rejects a study missing evidenceQualityReason", () => {
    const { evidenceQualityReason: _reason, ...bad } = FIXTURE_metaFreeInspectionHigh1;
    const result = parseCaseStudy("bad.json", bad);
    expect("error" in result).toBe(true);
  });

  it("rejects an invalid evidenceQuality value", () => {
    const bad = { ...FIXTURE_metaFreeInspectionHigh1, evidenceQuality: "super-high" };
    const result = parseCaseStudy("bad.json", bad);
    expect("error" in result).toBe(true);
  });

  it("rejects an invalid platform value", () => {
    const bad = { ...FIXTURE_metaFreeInspectionHigh1, platform: "tiktok" };
    const result = parseCaseStudy("bad.json", bad);
    expect("error" in result).toBe(true);
  });

  it("rejects a negative reported metric", () => {
    const bad = { ...FIXTURE_metaFreeInspectionHigh1, reportedCplCents: -100 };
    const result = parseCaseStudy("bad.json", bad);
    expect("error" in result).toBe(true);
  });

  it("rejects unknown/extra fields (strict schema)", () => {
    const bad = { ...FIXTURE_metaFreeInspectionHigh1, fabricatedField: 123 };
    const result = parseCaseStudy("bad.json", bad);
    expect("error" in result).toBe(true);
  });

  it("allows every optional metric to be null without coercing to 0", () => {
    const sparse = {
      ...FIXTURE_metaFreeInspectionHigh1,
      reportedAdSpendCents: null,
      reportedLeads: null,
      reportedCplCents: null,
      reportedBookedInspections: null,
      reportedCustomers: null,
      reportedRevenueCents: null,
      reportedRoas: null,
    };
    const result = parseCaseStudy("sparse.json", sparse);
    expect("study" in result).toBe(true);
    if ("study" in result) {
      expect(result.study.reportedLeads).toBeNull();
      expect(result.study.reportedRoas).toBeNull();
    }
  });

  it("rejects malformed JSON shape (not an object)", () => {
    const result = parseCaseStudy("bad.json", "just a string");
    expect("error" in result).toBe(true);
  });
});
