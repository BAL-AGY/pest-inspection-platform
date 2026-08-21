import { describe, expect, it } from "vitest";
import {
  computeCac,
  computeAttributionBreakdown,
  computeCloseRate,
  computeConversionRate,
  computeCostMetrics,
  computeFunnelCounts,
  computeReturnOnSpend,
  computeRoi,
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

describe("computeAttributionBreakdown", () => {
  it("counts each lead once even when its appointment existence is already summarized", () => {
    const rows = computeAttributionBreakdown([
      {
        source: "google",
        campaign: "termite-search",
        classification: "sql",
        outcome: "won",
        contractValueCents: 45_000,
        hasAppointment: true,
      },
      {
        source: "google",
        campaign: "termite-search",
        classification: "prospect",
        outcome: null,
        contractValueCents: null,
        hasAppointment: false,
      },
    ]);

    expect(rows).toEqual([{
      source: "google",
      campaign: "termite-search",
      leads: 2,
      qualified: 1,
      booked: 1,
      won: 1,
      contractValueCents: 45_000,
    }]);
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
      qualifiedCount: 6,
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
      qualifiedCount: 5,
      mqlCount: 5,
      sqlCount: 2,
      bookedCount: 2,
      completedCount: 1,
    });
    expect(metrics.costPerLeadCents).toBe(1000);
    expect(metrics.costPerQualifiedLeadCents).toBe(2000);
    expect(metrics.costPerBookedInspectionCents).toBe(5000);
    expect(metrics.costPerCompletedInspectionCents).toBe(10000);
  });

  it("returns null when the count is zero even with known spend", () => {
    const metrics = computeCostMetrics({
      spendCents: 100_00,
      leadsCount: 0,
      qualifiedCount: 0,
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

  it("computes ROI and leaves it unknown without spend/revenue", () => {
    expect(computeRoi(450_00, 100_00)).toBe(3.5);
    expect(computeRoi(null, 100_00)).toBeNull();
    expect(computeRoi(450_00, 0)).toBeNull();
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

  it("computes explicit funnel conversion rates", () => {
    expect(computeConversionRate(6, 10)).toBe(0.6);
    expect(computeConversionRate(0, 0)).toBeNull();
  });
});
