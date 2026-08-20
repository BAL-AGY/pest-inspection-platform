import { describe, expect, it } from "vitest";
import {
  computeCac,
  computeCloseRate,
  computeCostMetrics,
  computeFunnelCounts,
  computeReturnOnSpend,
  computeShowRate,
  computeStageConversionRates,
} from "./analytics";

describe("computeFunnelCounts", () => {
  it("tallies known event types and ignores unknown ones", () => {
    const counts = computeFunnelCounts([
      { eventType: "visit" },
      { eventType: "visit" },
      { eventType: "lead_created" },
      { eventType: "not_a_real_event" },
    ]);
    expect(counts.visit).toBe(2);
    expect(counts.lead_created).toBe(1);
    expect(counts.sql).toBe(0);
  });
});

describe("computeStageConversionRates", () => {
  it("computes rate as null when the prior stage has zero count", () => {
    const counts = computeFunnelCounts([]);
    const rates = computeStageConversionRates(counts);
    expect(rates.every((r) => r.rate === null)).toBe(true);
  });

  it("computes a correct rate and drop-off", () => {
    const counts = computeFunnelCounts([
      { eventType: "visit" },
      { eventType: "visit" },
      { eventType: "visit" },
      { eventType: "visit" },
      { eventType: "assessment_start" },
    ]);
    const rates = computeStageConversionRates(counts);
    const visitToStart = rates.find((r) => r.from === "visit" && r.to === "assessment_start");
    expect(visitToStart?.rate).toBe(0.25);
    expect(visitToStart?.dropOff).toBe(0.75);
  });
});

describe("computeCostMetrics", () => {
  it("returns null for every metric when spend is unknown", () => {
    const metrics = computeCostMetrics({
      spendCents: null,
      leadsCount: 10,
      mqlCount: 5,
      sqlCount: 2,
      bookedCount: 2,
      completedCount: 1,
    });
    expect(Object.values(metrics).every((v) => v === null)).toBe(true);
  });

  it("computes real cost-per-X when spend and counts exist", () => {
    const metrics = computeCostMetrics({
      spendCents: 100_00,
      leadsCount: 10,
      mqlCount: 5,
      sqlCount: 2,
      bookedCount: 2,
      completedCount: 1,
    });
    expect(metrics.costPerLeadCents).toBe(1000);
    expect(metrics.costPerBookedInspectionCents).toBe(5000);
    expect(metrics.costPerCompletedInspectionCents).toBe(10000);
  });

  it("returns null when the count is zero even with known spend", () => {
    const metrics = computeCostMetrics({
      spendCents: 100_00,
      leadsCount: 0,
      mqlCount: 0,
      sqlCount: 0,
      bookedCount: 0,
      completedCount: 0,
    });
    expect(metrics.costPerLeadCents).toBeNull();
  });
});

describe("computeCac / computeReturnOnSpend", () => {
  it("returns null CAC without spend or customers", () => {
    expect(computeCac(null, 5)).toBeNull();
    expect(computeCac(10000, 0)).toBeNull();
  });

  it("computes CAC correctly", () => {
    expect(computeCac(50_00, 2)).toBe(2500);
  });

  it("returns null ROAS without revenue or spend", () => {
    expect(computeReturnOnSpend(null, 100)).toBeNull();
    expect(computeReturnOnSpend(100, null)).toBeNull();
    expect(computeReturnOnSpend(100, 0)).toBeNull();
  });

  it("computes ROAS correctly", () => {
    expect(computeReturnOnSpend(400, 100)).toBe(4);
  });
});

describe("computeShowRate / computeCloseRate", () => {
  it("returns null with zero denominator", () => {
    expect(computeShowRate(0, 0)).toBeNull();
    expect(computeCloseRate(0, 0)).toBeNull();
  });

  it("computes rates correctly", () => {
    expect(computeShowRate(3, 4)).toBe(0.75);
    expect(computeCloseRate(1, 4)).toBe(0.25);
  });
});
