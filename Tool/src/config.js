import "dotenv/config";
import path from "node:path";

function readPositiveNumber(name, fallback, maximum = Number.POSITIVE_INFINITY) {
  const rawValue = process.env[name];
  if (!rawValue) return fallback;

  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} 환경변수는 0보다 큰 숫자여야 합니다.`);
  }
  if (value > maximum) {
    throw new Error(`${name} 환경변수는 ${maximum}을 초과할 수 없습니다.`);
  }
  return value;
}

export const config = Object.freeze({
  port: readPositiveNumber("PORT", 3000),
  geminiApiKey: process.env.GEMINI_API_KEY?.trim() ?? "",
  kakaoMapJavaScriptKey:
    process.env.KAKAO_MAP_JAVASCRIPT_KEY?.trim() ?? "",
  maxUploadMb: readPositiveNumber("MAX_UPLOAD_MB", 500),
  maxImageUploadMb: readPositiveNumber("MAX_IMAGE_UPLOAD_MB", 10, 20),
  maxAudioDurationMinutes: readPositiveNumber(
    "MAX_AUDIO_DURATION_MINUTES",
    120,
    120,
  ),
  transcriptionChunkMinutes: readPositiveNumber(
    "TRANSCRIPTION_CHUNK_MINUTES",
    50,
    55,
  ),
  geminiTimeoutMs: readPositiveNumber("GEMINI_TIMEOUT_MS", 300_000),
  geminiTimetableTimeoutMs: readPositiveNumber(
    "GEMINI_TIMETABLE_TIMEOUT_MS",
    90_000,
    300_000,
  ),
  geminiSummaryModel:
    process.env.GEMINI_SUMMARY_MODEL?.trim() || "gemini-3.8-flash",
  geminiTimetableModel:
    process.env.GEMINI_TIMETABLE_MODEL?.trim() || "gemini-3.8-flash",
  timetableStartHour: readPositiveNumber("TIMETABLE_START_HOUR", 8, 23),
  timetableEndHour: readPositiveNumber("TIMETABLE_END_HOUR", 22, 24),
  uploadDirectory: path.resolve("uploads"),
});
