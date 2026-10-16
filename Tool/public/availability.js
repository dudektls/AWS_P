export const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI"];
export const DAY_LABELS = {
  MON: "월요일",
  TUE: "화요일",
  WED: "수요일",
  THU: "목요일",
  FRI: "금요일",
  SAT: "토요일",
  SUN: "일요일",
};

export function calculateAvailability({ studyWindows, courses, personalEvents }) {
  const result = {};
  for (const day of WEEKDAYS) {
    const allowed = studyWindows
      .filter((range) => range.day === day)
      .map(normalizeRange)
      .filter(Boolean);
    const blocked = [...courses, ...personalEvents]
      .filter((range) => range.day === day)
      .map(normalizeRange)
      .filter(Boolean);

    result[day] = subtractRanges(mergeRanges(allowed), mergeRanges(blocked)).map(
      ({ start, end }) => ({
        day,
        startTime: fromMinutes(start),
        endTime: fromMinutes(end),
      }),
    );
  }
  return result;
}

export function mergeRanges(ranges) {
  const sorted = ranges
    .map((range) => ({ ...range }))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (!previous || range.start > previous.end) {
      merged.push(range);
    } else {
      previous.end = Math.max(previous.end, range.end);
    }
  }
  return merged;
}

export function subtractRanges(allowedRanges, blockedRanges) {
  const available = [];
  for (const allowed of allowedRanges) {
    let cursor = allowed.start;
    for (const blocked of blockedRanges) {
      if (blocked.end <= cursor || blocked.start >= allowed.end) continue;
      if (blocked.start > cursor) {
        available.push({ start: cursor, end: Math.min(blocked.start, allowed.end) });
      }
      cursor = Math.max(cursor, blocked.end);
      if (cursor >= allowed.end) break;
    }
    if (cursor < allowed.end) available.push({ start: cursor, end: allowed.end });
  }
  return available;
}

export function toMinutes(time) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time ?? "")) return null;
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

export function fromMinutes(minutes) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeRange(range) {
  const start = toMinutes(range.startTime);
  const end = toMinutes(range.endTime);
  if (start === null || end === null || start >= end) return null;
  return { start, end };
}
