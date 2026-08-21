import { describe, expect, it } from "vitest";
import { resolveAnalyticsRange } from "./analytics-range";

describe("resolveAnalyticsRange", () => {
  it("uses company-local calendar boundaries independently of process timezone", () => {
    const range = resolveAnalyticsRange({ preset: "today" }, "America/Chicago", new Date("2026-08-21T04:30:00Z"));
    expect(range.startKey).toBe("2026-08-20");
    expect(range.start.toISOString()).toBe("2026-08-20T05:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-08-21T05:00:00.000Z");
  });

  it("uses inclusive custom local dates and rejects reversed ranges", () => {
    const range = resolveAnalyticsRange({ preset: "custom", start: "2026-11-01", end: "2026-11-02" }, "America/Chicago", new Date("2026-11-03T12:00:00Z"));
    expect(range.start.toISOString()).toBe("2026-11-01T05:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-11-03T06:00:00.000Z");
    const fallback = resolveAnalyticsRange({ preset: "custom", start: "not-a-date", end: "2026-11-01" }, "America/Chicago", new Date("2026-11-03T12:00:00Z"));
    expect(fallback.startKey).toBe("2026-10-05");
  });
});
