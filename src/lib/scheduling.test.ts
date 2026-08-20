import { describe, expect, it } from "vitest";
import {
  DEFAULT_BUSINESS_HOURS,
  DoubleBookingError,
  assertSlotBookable,
  filterAvailableSlots,
  generateCandidateSlots,
  rangesOverlap,
} from "./scheduling";

// Anchor "now" to a fixed Monday so weekday math is deterministic.
const NOW = new Date("2026-08-24T12:00:00"); // Monday
const nextDay = (offset: number, hour: number, minute = 0) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() + offset);
  d.setHours(hour, minute, 0, 0);
  return d;
};

describe("rangesOverlap", () => {
  it("detects overlapping ranges", () => {
    expect(
      rangesOverlap(
        { start: nextDay(1, 9), end: nextDay(1, 10) },
        { start: nextDay(1, 9, 30), end: nextDay(1, 10, 30) },
      ),
    ).toBe(true);
  });

  it("detects non-overlapping ranges", () => {
    expect(
      rangesOverlap(
        { start: nextDay(1, 9), end: nextDay(1, 10) },
        { start: nextDay(1, 10), end: nextDay(1, 11) },
      ),
    ).toBe(false);
  });
});

describe("generateCandidateSlots", () => {
  it("only generates slots within business hours and in the future", () => {
    const rangeStart = NOW;
    const rangeEnd = nextDay(7, 23, 59);
    const slots = generateCandidateSlots({
      rangeStart,
      rangeEnd,
      durationMinutes: 60,
      businessHours: DEFAULT_BUSINESS_HOURS,
      now: NOW,
    });
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      expect(slot.start.getTime()).toBeGreaterThan(NOW.getTime());
      const hours = DEFAULT_BUSINESS_HOURS[slot.start.getDay()];
      expect(hours).not.toBeNull();
    }
  });

  it("produces no slots on a day the business is closed (Sunday)", () => {
    const slots = generateCandidateSlots({
      rangeStart: NOW,
      rangeEnd: nextDay(7, 23, 59),
      durationMinutes: 60,
      businessHours: DEFAULT_BUSINESS_HOURS,
      now: NOW,
    });
    const sundaySlots = slots.filter((s) => s.start.getDay() === 0);
    expect(sundaySlots.length).toBe(0);
  });
});

describe("filterAvailableSlots", () => {
  it("excludes slots that overlap an existing appointment", () => {
    const candidates = [
      { start: nextDay(1, 9), end: nextDay(1, 10) },
      { start: nextDay(1, 10), end: nextDay(1, 11) },
    ];
    const existing = [{ start: nextDay(1, 9), end: nextDay(1, 10) }];
    const result = filterAvailableSlots({
      candidates,
      existingAppointments: existing,
      maxDailyInspections: 8,
    });
    expect(result).toEqual([{ start: nextDay(1, 10), end: nextDay(1, 11) }]);
  });

  it("excludes slots once daily capacity is reached", () => {
    const candidates = [{ start: nextDay(1, 11), end: nextDay(1, 12) }];
    const existing = [
      { start: nextDay(1, 8), end: nextDay(1, 9) },
      { start: nextDay(1, 9), end: nextDay(1, 10) },
    ];
    const result = filterAvailableSlots({
      candidates,
      existingAppointments: existing,
      maxDailyInspections: 2,
    });
    expect(result).toEqual([]);
  });
});

describe("assertSlotBookable", () => {
  it("allows a valid, open, non-conflicting slot", () => {
    expect(() =>
      assertSlotBookable({
        requested: { start: nextDay(1, 9), end: nextDay(1, 10) },
        existingAppointments: [],
        businessHours: DEFAULT_BUSINESS_HOURS,
        maxDailyInspections: 8,
        now: NOW,
      }),
    ).not.toThrow();
  });

  it("throws DoubleBookingError on overlap", () => {
    expect(() =>
      assertSlotBookable({
        requested: { start: nextDay(1, 9), end: nextDay(1, 10) },
        existingAppointments: [{ start: nextDay(1, 9), end: nextDay(1, 10) }],
        businessHours: DEFAULT_BUSINESS_HOURS,
        maxDailyInspections: 8,
        now: NOW,
      }),
    ).toThrow(DoubleBookingError);
  });

  it("rejects a slot outside business hours", () => {
    expect(() =>
      assertSlotBookable({
        requested: { start: nextDay(1, 20), end: nextDay(1, 21) },
        existingAppointments: [],
        businessHours: DEFAULT_BUSINESS_HOURS,
        maxDailyInspections: 8,
        now: NOW,
      }),
    ).toThrow(/business hours/);
  });

  it("rejects a slot on a closed day", () => {
    expect(() =>
      assertSlotBookable({
        requested: { start: nextDay(6, 10), end: nextDay(6, 11) }, // Sunday
        existingAppointments: [],
        businessHours: DEFAULT_BUSINESS_HOURS,
        maxDailyInspections: 8,
        now: NOW,
      }),
    ).toThrow(/business hours/);
  });

  it("rejects a slot in the past", () => {
    expect(() =>
      assertSlotBookable({
        requested: { start: nextDay(-1, 9), end: nextDay(-1, 10) },
        existingAppointments: [],
        businessHours: DEFAULT_BUSINESS_HOURS,
        maxDailyInspections: 8,
        now: NOW,
      }),
    ).toThrow(/past/);
  });

  it("rejects once daily capacity is full", () => {
    expect(() =>
      assertSlotBookable({
        requested: { start: nextDay(1, 11), end: nextDay(1, 12) },
        existingAppointments: [{ start: nextDay(1, 9), end: nextDay(1, 10) }],
        businessHours: DEFAULT_BUSINESS_HOURS,
        maxDailyInspections: 1,
        now: NOW,
      }),
    ).toThrow(/capacity/);
  });
});
