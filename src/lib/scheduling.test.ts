import { describe, expect, it } from "vitest";
import {
  DEFAULT_BUSINESS_HOURS,
  DoubleBookingError,
  assertSlotBookable as assertSlotBookableInZone,
  filterAvailableSlots as filterAvailableSlotsInZone,
  generateCandidateSlots as generateCandidateSlotsInZone,
  rangesOverlap,
} from "./scheduling";
import { localDateTimeToInstant, zonedDateTimeParts } from "./timezone";

// Anchor "now" to a fixed Monday so weekday math is deterministic.
const TEST_TIME_ZONE = "UTC";
const NOW = new Date("2026-08-24T12:00:00Z"); // Monday
const nextDay = (offset: number, hour: number, minute = 0) => {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() + offset);
  d.setUTCHours(hour, minute, 0, 0);
  return d;
};

const generateCandidateSlots = (
  params: Omit<Parameters<typeof generateCandidateSlotsInZone>[0], "timeZone">,
) => generateCandidateSlotsInZone({ ...params, timeZone: TEST_TIME_ZONE });

const filterAvailableSlots = (
  params: Omit<Parameters<typeof filterAvailableSlotsInZone>[0], "timeZone">,
) => filterAvailableSlotsInZone({ ...params, timeZone: TEST_TIME_ZONE });

const assertSlotBookable = (
  params: Omit<Parameters<typeof assertSlotBookableInZone>[0], "timeZone">,
) => assertSlotBookableInZone({ ...params, timeZone: TEST_TIME_ZONE });

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
      const hours = DEFAULT_BUSINESS_HOURS[slot.start.getUTCDay()];
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
    const sundaySlots = slots.filter((s) => s.start.getUTCDay() === 0);
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
        durationMinutes: 60,
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
        durationMinutes: 60,
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
        durationMinutes: 60,
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
        durationMinutes: 60,
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
        durationMinutes: 60,
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
        durationMinutes: 60,
        now: NOW,
      }),
    ).toThrow(/capacity/);
  });

  it("rejects zero-duration timing (start === end)", () => {
    expect(() =>
      assertSlotBookable({
        requested: { start: nextDay(1, 9), end: nextDay(1, 9) },
        existingAppointments: [],
        businessHours: DEFAULT_BUSINESS_HOURS,
        maxDailyInspections: 8,
        durationMinutes: 60,
        now: NOW,
      }),
    ).toThrow(/duration/);
  });

  it("rejects negative-duration timing (end before start)", () => {
    expect(() =>
      assertSlotBookable({
        requested: { start: nextDay(1, 10), end: nextDay(1, 9) },
        existingAppointments: [],
        businessHours: DEFAULT_BUSINESS_HOURS,
        maxDailyInspections: 8,
        durationMinutes: 60,
        now: NOW,
      }),
    ).toThrow(/duration/);
  });

  it("rejects a shortened appointment that doesn't match the configured duration", () => {
    expect(() =>
      assertSlotBookable({
        requested: { start: nextDay(1, 9), end: nextDay(1, 9, 5) },
        existingAppointments: [],
        businessHours: DEFAULT_BUSINESS_HOURS,
        maxDailyInspections: 8,
        durationMinutes: 60,
        now: NOW,
      }),
    ).toThrow(/duration/);
  });

  it("rejects a lengthened appointment that doesn't match the configured duration", () => {
    expect(() =>
      assertSlotBookable({
        requested: { start: nextDay(1, 9), end: nextDay(1, 15) },
        existingAppointments: [],
        businessHours: DEFAULT_BUSINESS_HOURS,
        maxDailyInspections: 8,
        durationMinutes: 60,
        now: NOW,
      }),
    ).toThrow(/duration/);
  });

  it("rejects a start time that doesn't align to the slot grid", () => {
    expect(() =>
      assertSlotBookable({
        requested: { start: nextDay(1, 9, 7), end: nextDay(1, 10, 7) },
        existingAppointments: [],
        businessHours: DEFAULT_BUSINESS_HOURS,
        maxDailyInspections: 8,
        durationMinutes: 60,
        now: NOW,
      }),
    ).toThrow(/align/);
  });
});

describe("company-timezone and DST scheduling", () => {
  const CHICAGO = "America/Chicago";
  const everyDay = Object.fromEntries(
    Array.from({ length: 7 }, (_, day) => [day, { open: "01:00", close: "04:00" }]),
  ) as typeof DEFAULT_BUSINESS_HOURS;

  it("generates 9 AM Central as the correct UTC instant on a UTC server", () => {
    const slots = generateCandidateSlotsInZone({
      rangeStart: new Date("2026-08-24T00:00:00Z"),
      rangeEnd: new Date("2026-08-25T00:00:00Z"),
      durationMinutes: 60,
      businessHours: { ...DEFAULT_BUSINESS_HOURS, 1: { open: "09:00", close: "11:00" } },
      timeZone: CHICAGO,
      now: new Date("2026-08-23T00:00:00Z"),
    });
    expect(slots.map((slot) => slot.start.toISOString())).toEqual([
      "2026-08-24T14:00:00.000Z",
      "2026-08-24T15:00:00.000Z",
    ]);
  });

  it("never generates the nonexistent spring-forward hour", () => {
    const slots = generateCandidateSlotsInZone({
      rangeStart: new Date("2026-03-08T05:00:00Z"),
      rangeEnd: new Date("2026-03-09T05:00:00Z"),
      durationMinutes: 60,
      businessHours: everyDay,
      timeZone: CHICAGO,
      now: new Date("2026-03-01T00:00:00Z"),
    });
    expect(slots.map((slot) => zonedDateTimeParts(slot.start, CHICAGO).hour)).toEqual([1, 3]);
  });

  it("generates only one canonical occurrence during fall-back", () => {
    const slots = generateCandidateSlotsInZone({
      rangeStart: new Date("2026-11-01T05:00:00Z"),
      rangeEnd: new Date("2026-11-02T06:00:00Z"),
      durationMinutes: 60,
      businessHours: everyDay,
      timeZone: CHICAGO,
      now: new Date("2026-10-01T00:00:00Z"),
    });
    const oneAm = slots.filter((slot) => zonedDateTimeParts(slot.start, CHICAGO).hour === 1);
    expect(oneAm).toHaveLength(1);
    expect(oneAm[0].start.toISOString()).toBe("2026-11-01T06:00:00.000Z");

    const secondOccurrence = new Date("2026-11-01T07:00:00Z");
    expect(() =>
      assertSlotBookableInZone({
        requested: { start: secondOccurrence, end: new Date(secondOccurrence.getTime() + 60 * 60_000) },
        existingAppointments: [],
        businessHours: everyDay,
        maxDailyInspections: 8,
        durationMinutes: 60,
        timeZone: CHICAGO,
        now: new Date("2026-10-01T00:00:00Z"),
      }),
    ).toThrow(/ambiguous/);
  });

  it("counts capacity by Chicago date across UTC midnight", () => {
    const requestedStart = localDateTimeToInstant(
      { year: 2026, month: 8, day: 20, hour: 22, minute: 0 },
      CHICAGO,
    )!;
    const eveningHours = Object.fromEntries(
      Array.from({ length: 7 }, (_, day) => [day, { open: "18:00", close: "23:59" }]),
    ) as typeof DEFAULT_BUSINESS_HOURS;
    expect(() =>
      assertSlotBookableInZone({
        requested: { start: requestedStart, end: new Date(requestedStart.getTime() + 60 * 60_000) },
        existingAppointments: [
          { start: new Date("2026-08-21T00:30:00Z"), end: new Date("2026-08-21T01:30:00Z") },
        ],
        businessHours: eveningHours,
        maxDailyInspections: 1,
        durationMinutes: 60,
        timeZone: CHICAGO,
        now: new Date("2026-08-01T00:00:00Z"),
      }),
    ).toThrow(/capacity/);
  });
});
