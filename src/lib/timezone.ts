import { TZDate } from "@date-fns/tz";

export interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

export interface LocalDateTimeParts extends LocalDateParts {
  hour: number;
  minute: number;
  second?: number;
  millisecond?: number;
}

export function assertValidIanaTimeZone(timeZone: string): string {
  if (timeZone !== "UTC" && !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+$/.test(timeZone)) {
    throw new Error("Company timezone must be a valid IANA timezone.");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
  } catch {
    throw new Error("Company timezone must be a valid IANA timezone.");
  }
  return timeZone;
}

export function zonedDateTimeParts(instant: Date, timeZone: string): Required<LocalDateTimeParts> {
  assertValidIanaTimeZone(timeZone);
  const zoned = new TZDate(instant.getTime(), timeZone);
  return {
    year: zoned.getFullYear(),
    month: zoned.getMonth() + 1,
    day: zoned.getDate(),
    hour: zoned.getHours(),
    minute: zoned.getMinutes(),
    second: zoned.getSeconds(),
    millisecond: zoned.getMilliseconds(),
  };
}

export function localDateKey(instant: Date, timeZone: string): string {
  const parts = zonedDateTimeParts(instant, timeZone);
  return `${parts.year.toString().padStart(4, "0")}-${parts.month
    .toString()
    .padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;
}

export function parseLocalDateKey(key: string): LocalDateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) throw new Error("Invalid local calendar date.");
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function addLocalCalendarDays(key: string, days: number): string {
  const { year, month, day } = parseLocalDateKey(key);
  const carrier = new Date(Date.UTC(year, month - 1, day + days));
  return `${carrier.getUTCFullYear().toString().padStart(4, "0")}-${(carrier.getUTCMonth() + 1)
    .toString()
    .padStart(2, "0")}-${carrier.getUTCDate().toString().padStart(2, "0")}`;
}

export function localWeekday(key: string): number {
  const { year, month, day } = parseLocalDateKey(key);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function localDateTimeToInstant(
  parts: LocalDateTimeParts,
  timeZone: string,
): Date | null {
  assertValidIanaTimeZone(timeZone);
  const second = parts.second ?? 0;
  const millisecond = parts.millisecond ?? 0;
  const zoned = new TZDate(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    second,
    millisecond,
    timeZone,
  );
  if (
    zoned.getFullYear() !== parts.year ||
    zoned.getMonth() + 1 !== parts.month ||
    zoned.getDate() !== parts.day ||
    zoned.getHours() !== parts.hour ||
    zoned.getMinutes() !== parts.minute ||
    zoned.getSeconds() !== second ||
    zoned.getMilliseconds() !== millisecond
  ) return null;
  return new Date(zoned.getTime());
}

export function isCanonicalLocalInstant(instant: Date, timeZone: string): boolean {
  const canonical = localDateTimeToInstant(zonedDateTimeParts(instant, timeZone), timeZone);
  return canonical?.getTime() === instant.getTime();
}

export function companyDayRange(
  instantOrKey: Date | string,
  timeZone: string,
): { start: Date; end: Date; dateKey: string } {
  const dateKey = typeof instantOrKey === "string"
    ? instantOrKey
    : localDateKey(instantOrKey, timeZone);
  const startParts = parseLocalDateKey(dateKey);
  const endParts = parseLocalDateKey(addLocalCalendarDays(dateKey, 1));
  const start = localDateTimeToInstant({ ...startParts, hour: 0, minute: 0 }, timeZone);
  const end = localDateTimeToInstant({ ...endParts, hour: 0, minute: 0 }, timeZone);
  if (!start || !end) throw new Error("Company calendar day could not be resolved.");
  return { start, end, dateKey };
}

export function companyCalendarRange(startKey: string, days: number, timeZone: string) {
  return {
    start: companyDayRange(startKey, timeZone).start,
    end: companyDayRange(addLocalCalendarDays(startKey, days), timeZone).start,
  };
}

export function companyWeekRange(now: Date, timeZone: string) {
  const todayKey = localDateKey(now, timeZone);
  const sundayKey = addLocalCalendarDays(todayKey, -localWeekday(todayKey));
  return companyCalendarRange(sundayKey, 7, timeZone);
}

export function formatInCompanyTime(
  instant: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
  locale = "en-US",
): string {
  assertValidIanaTimeZone(timeZone);
  return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(instant);
}
