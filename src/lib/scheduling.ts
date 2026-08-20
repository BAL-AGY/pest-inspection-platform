/**
 * Pure scheduling/availability logic. Kept free of Prisma/DB calls so it's
 * directly unit-testable; API routes wrap this with real persistence.
 */

export interface DayHours {
  open: string; // "HH:mm", 24h
  close: string; // "HH:mm", 24h
}

/** Keyed 0 (Sunday) - 6 (Saturday). `null` means closed that day. */
export type BusinessHours = Record<number, DayHours | null>;

export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  0: null,
  1: { open: "08:00", close: "17:00" },
  2: { open: "08:00", close: "17:00" },
  3: { open: "08:00", close: "17:00" },
  4: { open: "08:00", close: "17:00" },
  5: { open: "08:00", close: "17:00" },
  6: { open: "09:00", close: "13:00" },
};

export interface TimeRange {
  start: Date;
  end: Date;
}

function parseHm(hm: string): { hours: number; minutes: number } {
  const [hours, minutes] = hm.split(":").map(Number);
  return { hours, minutes };
}

export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Generates candidate inspection slots between `rangeStart` and `rangeEnd`,
 * honoring per-weekday business hours and appointment duration. Does not
 * know about existing bookings or capacity — see `filterAvailableSlots`.
 */
export function generateCandidateSlots(params: {
  rangeStart: Date;
  rangeEnd: Date;
  durationMinutes: number;
  businessHours: BusinessHours;
  now?: Date;
}): TimeRange[] {
  const { rangeStart, rangeEnd, durationMinutes, businessHours } = params;
  const now = params.now ?? new Date();
  const slots: TimeRange[] = [];

  const cursor = new Date(rangeStart);
  cursor.setHours(0, 0, 0, 0);

  while (cursor <= rangeEnd) {
    const hours = businessHours[cursor.getDay()];
    if (hours) {
      const { hours: openH, minutes: openM } = parseHm(hours.open);
      const { hours: closeH, minutes: closeM } = parseHm(hours.close);

      const dayOpen = new Date(cursor);
      dayOpen.setHours(openH, openM, 0, 0);
      const dayClose = new Date(cursor);
      dayClose.setHours(closeH, closeM, 0, 0);

      let slotStart = new Date(dayOpen);
      while (slotStart.getTime() + durationMinutes * 60_000 <= dayClose.getTime()) {
        const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60_000);
        if (slotStart >= rangeStart && slotStart <= rangeEnd && slotStart > now) {
          slots.push({ start: new Date(slotStart), end: slotEnd });
        }
        slotStart = new Date(slotStart.getTime() + durationMinutes * 60_000);
      }
    }
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(0, 0, 0, 0);
  }

  return slots;
}

/**
 * Filters candidate slots down to ones that don't overlap an existing
 * appointment for the given inspector (when one is specified) and that
 * don't push the day over `maxDailyInspections` company-wide capacity.
 */
export function filterAvailableSlots(params: {
  candidates: TimeRange[];
  existingAppointments: TimeRange[];
  maxDailyInspections: number;
}): TimeRange[] {
  const { candidates, existingAppointments, maxDailyInspections } = params;

  const countForDay = (day: Date) =>
    existingAppointments.filter(
      (a) =>
        a.start.getFullYear() === day.getFullYear() &&
        a.start.getMonth() === day.getMonth() &&
        a.start.getDate() === day.getDate(),
    ).length;

  return candidates.filter((slot) => {
    const overlapsExisting = existingAppointments.some((a) => rangesOverlap(slot, a));
    if (overlapsExisting) return false;
    if (countForDay(slot.start) >= maxDailyInspections) return false;
    return true;
  });
}

export class DoubleBookingError extends Error {
  constructor() {
    super("This time slot is no longer available.");
    this.name = "DoubleBookingError";
  }
}

export class CapacityExceededError extends Error {
  constructor() {
    super("No inspection capacity remains for that day.");
    this.name = "CapacityExceededError";
  }
}

/**
 * Validates a requested booking against existing appointments before the
 * caller persists it. A partial unique DB index on
 * (companyId, scheduledStart) for active-status appointments is the final,
 * atomic guard against races (see prisma/schema.prisma's Appointment model
 * comment); this function is the primary, testable business-rule check —
 * and the only place that must reject a duration/slot-alignment that
 * doesn't match what the company actually offers.
 *
 * `requested.end` is trusted only to the extent that it must exactly equal
 * `requested.start + durationMinutes` — callers must derive it themselves
 * from the company's configured duration, never from client input, so a
 * caller can't submit a zero, negative, shortened, or lengthened
 * appointment. `requested.start` must also land exactly on the slot grid
 * `generateCandidateSlots` would produce (business-hours-open plus a whole
 * number of `durationMinutes` increments) — this rejects times a client
 * fabricates outside the actual bookable grid.
 */
export function assertSlotBookable(params: {
  requested: TimeRange;
  existingAppointments: TimeRange[];
  businessHours: BusinessHours;
  maxDailyInspections: number;
  durationMinutes: number;
  now?: Date;
}): void {
  const { requested, existingAppointments, businessHours, maxDailyInspections, durationMinutes } =
    params;
  const now = params.now ?? new Date();

  if (requested.start <= now) {
    throw new Error("Cannot book an appointment in the past.");
  }

  const durationMs = durationMinutes * 60_000;
  const actualDurationMs = requested.end.getTime() - requested.start.getTime();
  if (actualDurationMs !== durationMs) {
    throw new Error("Appointment duration does not match the configured inspection duration.");
  }

  const hours = businessHours[requested.start.getDay()];
  if (!hours) {
    throw new Error("Selected day is outside business hours.");
  }
  const { hours: openH, minutes: openM } = parseHm(hours.open);
  const { hours: closeH, minutes: closeM } = parseHm(hours.close);
  const dayOpen = new Date(requested.start);
  dayOpen.setHours(openH, openM, 0, 0);
  const dayClose = new Date(requested.start);
  dayClose.setHours(closeH, closeM, 0, 0);
  if (requested.start < dayOpen || requested.end > dayClose) {
    throw new Error("Selected time is outside business hours.");
  }

  const offsetMs = requested.start.getTime() - dayOpen.getTime();
  if (offsetMs % durationMs !== 0) {
    throw new Error("Selected time does not align to a valid inspection slot.");
  }

  const overlaps = existingAppointments.some((a) => rangesOverlap(requested, a));
  if (overlaps) {
    throw new DoubleBookingError();
  }

  const sameDayCount = existingAppointments.filter(
    (a) =>
      a.start.getFullYear() === requested.start.getFullYear() &&
      a.start.getMonth() === requested.start.getMonth() &&
      a.start.getDate() === requested.start.getDate(),
  ).length;
  if (sameDayCount >= maxDailyInspections) {
    throw new CapacityExceededError();
  }
}
