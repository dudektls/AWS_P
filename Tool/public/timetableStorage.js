const STORAGE_KEY = "ai-study-tool.confirmed-timetable.v1";

export function saveConfirmedTimetable(value, storage = localStorage) {
  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    courses: value.courses,
    studyWindows: value.studyWindows,
    personalEvents: value.personalEvents,
    matchingData: value.matchingData,
  };
  storage.setItem(STORAGE_KEY, JSON.stringify(payload));
  return payload;
}

export function loadConfirmedTimetable(storage = localStorage) {
  const rawValue = storage.getItem(STORAGE_KEY);
  if (!rawValue) return null;
  try {
    const parsed = JSON.parse(rawValue);
    if (
      parsed?.version !== 1 ||
      !Array.isArray(parsed.courses) ||
      !Array.isArray(parsed.studyWindows) ||
      !Array.isArray(parsed.personalEvents)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export { STORAGE_KEY };
