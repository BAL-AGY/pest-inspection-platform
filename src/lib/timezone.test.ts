import { describe, expect, it } from "vitest";
import {
  assertValidIanaTimeZone,
  companyDayRange,
  companyWeekRange,
  isCanonicalLocalInstant,
  localDateKey,
  localDateTimeToInstant,
} from "./timezone";
import { dashboardOperationalRanges } from "./dashboard-metrics";

const CHICAGO = "America/Chicago";

describe("company timezone primitives", () => {
  it("accepts IANA zones and rejects ambiguous abbreviations", () => {
    expect(assertValidIanaTimeZone(CHICAGO)).toBe(CHICAGO);
    expect(() => assertValidIanaTimeZone("CST")).toThrow(/IANA/);
  });

  it("maps a Chicago business day to UTC independently of process timezone", () => {
    const range = companyDayRange("2026-08-20", CHICAGO);
    expect(range.start.toISOString()).toBe("2026-08-20T05:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-08-21T05:00:00.000Z");
    expect(localDateKey(new Date("2026-08-21T00:30:00Z"), CHICAGO)).toBe("2026-08-20");
  });

  it("uses 23-hour and 25-hour UTC ranges across DST transitions", () => {
    const spring = companyDayRange("2026-03-08", CHICAGO);
    const fall = companyDayRange("2026-11-01", CHICAGO);
    expect(spring.end.getTime() - spring.start.getTime()).toBe(23 * 60 * 60_000);
    expect(fall.end.getTime() - fall.start.getTime()).toBe(25 * 60 * 60_000);
  });

  it("rejects nonexistent spring time and the second fall-back occurrence", () => {
    expect(
      localDateTimeToInstant(
        { year: 2026, month: 3, day: 8, hour: 2, minute: 30 },
        CHICAGO,
      ),
    ).toBeNull();
    expect(isCanonicalLocalInstant(new Date("2026-11-01T06:30:00Z"), CHICAGO)).toBe(true);
    expect(isCanonicalLocalInstant(new Date("2026-11-01T07:30:00Z"), CHICAGO)).toBe(false);
  });
});

describe("operational reporting boundaries", () => {
  it("dashboard today and week use the company's local calendar", () => {
    const now = new Date("2026-08-21T00:30:00Z"); // Thursday evening in Chicago
    const ranges = dashboardOperationalRanges(now, CHICAGO);
    expect(ranges.todayStart.toISOString()).toBe("2026-08-20T05:00:00.000Z");
    expect(ranges.tomorrowStart.toISOString()).toBe("2026-08-21T05:00:00.000Z");
    expect(ranges.weekStart.toISOString()).toBe("2026-08-16T05:00:00.000Z");
    expect(ranges.weekEnd.toISOString()).toBe("2026-08-23T05:00:00.000Z");
  });

  it("calendar grouping assigns post-UTC-midnight appointments to the local prior day", () => {
    expect(localDateKey(new Date("2026-08-21T00:30:00Z"), CHICAGO)).toBe("2026-08-20");
    expect(companyWeekRange(new Date("2026-11-01T07:30:00Z"), CHICAGO).start).toBeInstanceOf(Date);
  });
});
