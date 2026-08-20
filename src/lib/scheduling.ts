import {
  addLocalCalendarDays,
  companyDayRange,
  isCanonicalLocalInstant,
  localDateKey,
  localDateTimeToInstant,
  localWeekday,
  parseLocalDateKey,
  zonedDateTimeParts,
} from "./timezone";

export interface DayHours {
  open: string;
  close: string;
}

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

function parseHm(hm: string): { hours: number; minutes: number; totalMinutes: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(hm);
  if (!match) throw new Error("Invalid business-hours configuration.");
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error("Invalid business-hours configuration.");
  return { hours, minutes, totalMinutes: hours * 60 + minutes };
}

function wallTimeOnDate(dateKey: string, hm: string, timeZone: string): Date | null {
  const date = parseLocalDateKey(dateKey);
  const time = parseHm(hm);
  return localDateTimeToInstant({ ...date, hour: time.hours, minute: time.minutes }, timeZone);
}

export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Generate UTC instants from the company's local wall-clock slot grid. */
export function generateCandidateSlots(params: {
  rangeStart: Date;
  rangeEnd: Date;
  durationMinutes: number;
  businessHours: BusinessHours;
  timeZone: string;
  now?: Date;
}): TimeRange[] {
  const { rangeStart, rangeEnd, durationMinutes, businessHours, timeZone } = params;
  const now = params.now ?? new Date();
  const slots: TimeRange[] = [];
  let dateKey = localDateKey(rangeStart, timeZone);
  const finalDateKey = localDateKey(rangeEnd, timeZone);

  while (dateKey <= finalDateKey) {
    const hours = businessHours[localWeekday(dateKey)];
    if (hours) {
      const open = parseHm(hours.open);
      const close = parseHm(hours.close);
      const dayClose = wallTimeOnDate(dateKey, hours.close, timeZone);
      if (dayClose && close.totalMinutes > open.totalMinutes) {
        for (
          let wallMinutes = open.totalMinutes;
          wallMinutes + durationMinutes <= close.totalMinutes;
          wallMinutes += durationMinutes
        ) {
          const date = parseLocalDateKey(dateKey);
          const slotStart = localDateTimeToInstant(
            { ...date, hour: Math.floor(wallMinutes / 60), minute: wallMinutes % 60 },
            timeZone,
          );
          // Spring-gap wall times are null. Fall overlaps resolve to one
          // canonical occurrence, preventing duplicate wall-clock capacity.
          if (!slotStart) continue;
          const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60_000);
          if (
            slotEnd <= dayClose &&
            slotStart >= rangeStart &&
            slotStart <= rangeEnd &&
            slotStart > now
          ) slots.push({ start: slotStart, end: slotEnd });
        }
      }
    }
    dateKey = addLocalCalendarDays(dateKey, 1);
  }
  return slots;
}

export function filterAvailableSlots(params: {
  candidates: TimeRange[];
  existingAppointments: TimeRange[];
  maxDailyInspections: number;
  timeZone: string;
}): TimeRange[] {
  const { candidates, existingAppointments, maxDailyInspections, timeZone } = params;
  const countForDay = (day: Date) => {
    const key = localDateKey(day, timeZone);
    return existingAppointments.filter((a) => localDateKey(a.start, timeZone) === key).length;
  };
  return candidates.filter((slot) => {
    if (existingAppointments.some((a) => rangesOverlap(slot, a))) return false;
    return countForDay(slot.start) < maxDailyInspections;
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

/** Validate a requested UTC instant against the company-local slot grid. */
export function assertSlotBookable(params: {
  requested: TimeRange;
  existingAppointments: TimeRange[];
  businessHours: BusinessHours;
  maxDailyInspections: number;
  durationMinutes: number;
  timeZone: string;
  now?: Date;
}): void {
  const {
    requested,
    existingAppointments,
    businessHours,
    maxDailyInspections,
    durationMinutes,
    timeZone,
  } = params;
  const now = params.now ?? new Date();

  if (requested.start <= now) throw new Error("Cannot book an appointment in the past.");
  const durationMs = durationMinutes * 60_000;
  if (requested.end.getTime() - requested.start.getTime() !== durationMs) {
    throw new Error("Appointment duration does not match the configured inspection duration.");
  }
  if (!isCanonicalLocalInstant(requested.start, timeZone)) {
    throw new Error("Selected time is invalid or ambiguous in the company timezone.");
  }

  const dateKey = localDateKey(requested.start, timeZone);
  const hours = businessHours[localWeekday(dateKey)];
  if (!hours) throw new Error("Selected day is outside business hours.");
  const dayOpen = wallTimeOnDate(dateKey, hours.open, timeZone);
  const dayClose = wallTimeOnDate(dateKey, hours.close, timeZone);
  if (!dayOpen || !dayClose) {
    throw new Error("Business hours are invalid in the company timezone on this date.");
  }
  if (requested.start < dayOpen || requested.end > dayClose) {
    throw new Error("Selected time is outside business hours.");
  }

  const local = zonedDateTimeParts(requested.start, timeZone);
  const open = parseHm(hours.open);
  const localMinutes = local.hour * 60 + local.minute;
  if (
    local.second !== 0 ||
    local.millisecond !== 0 ||
    (localMinutes - open.totalMinutes) % durationMinutes !== 0
  ) throw new Error("Selected time does not align to a valid inspection slot.");

  if (existingAppointments.some((a) => rangesOverlap(requested, a))) {
    throw new DoubleBookingError();
  }
  const sameDayCount = existingAppointments.filter(
    (a) => localDateKey(a.start, timeZone) === dateKey,
  ).length;
  if (sameDayCount >= maxDailyInspections) throw new CapacityExceededError();
}

export function appointmentCompanyDayRange(start: Date, timeZone: string) {
  return companyDayRange(start, timeZone);
}
