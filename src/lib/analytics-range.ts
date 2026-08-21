import { addLocalCalendarDays, companyDayRange, localDateKey, parseLocalDateKey } from "./timezone";

export type AnalyticsRangePreset = "today" | "7d" | "30d" | "custom";
export interface AnalyticsRange { preset: AnalyticsRangePreset; start: Date; end: Date; startKey: string; endKey: string }

export function resolveAnalyticsRange(input: { preset?: string; start?: string; end?: string }, timeZone: string, now = new Date()): AnalyticsRange {
  const today = localDateKey(now, timeZone);
  const preset: AnalyticsRangePreset = ["today", "7d", "30d", "custom"].includes(input.preset ?? "") ? input.preset as AnalyticsRangePreset : "30d";
  let startKey = preset === "today" ? today : addLocalCalendarDays(today, preset === "7d" ? -6 : -29);
  let endKey = today;
  if (preset === "custom" && input.start && input.end) {
    try {
      parseLocalDateKey(input.start); parseLocalDateKey(input.end);
      companyDayRange(input.start, timeZone); companyDayRange(input.end, timeZone);
      if (input.start <= input.end) { startKey = input.start; endKey = input.end; }
    } catch { /* malformed custom input falls back to the safe 30-day range */ }
  }
  return { preset, startKey, endKey, start: companyDayRange(startKey, timeZone).start, end: companyDayRange(addLocalCalendarDays(endKey, 1), timeZone).start };
}
