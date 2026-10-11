import crypto from "node:crypto";
import { AppError } from "../errors/AppError.js";

export const VALID_DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const timetableResponseSchema = {
  type: "object",
  required: ["courses", "warnings"],
  properties: {
    courses: {
      type: "array",
      items: {
        type: "object",
        required: [
          "name",
          "day",
          "startTime",
          "endTime",
          "location",
          "professor",
          "needsReview",
          "reviewReason",
        ],
        properties: {
          name: { type: "string" },
          day: { type: "string", enum: [...VALID_DAYS, "UNKNOWN"] },
          startTime: { type: "string" },
          endTime: { type: "string" },
          location: { type: "string" },
          professor: { type: "string" },
          needsReview: { type: "boolean" },
          reviewReason: { type: "string" },
        },
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
};

export function validateTimetableResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidResponse("응답의 최상위 값이 객체가 아닙니다.");
  }
  if (!Array.isArray(value.courses) || !Array.isArray(value.warnings)) {
    throw invalidResponse("courses 또는 warnings 배열이 없습니다.");
  }
  if (value.courses.length > 100) throw invalidResponse("수업이 100개를 초과했습니다.");

  const warnings = value.warnings
    .filter((warning) => typeof warning === "string")
    .map((warning) => warning.trim())
    .filter(Boolean)
    .slice(0, 50);
  const courses = value.courses.map((course, index) => normalizeCourse(course, index));

  markDuplicates(courses, warnings);
  markConflicts(courses, warnings);
  return { courses, warnings: [...new Set(warnings)] };
}

function normalizeCourse(course, index) {
  if (!course || typeof course !== "object" || Array.isArray(course)) {
    throw invalidResponse(`${index + 1}번째 수업이 객체가 아닙니다.`);
  }

  const name = nullableText(course.name);
  const day = VALID_DAYS.includes(course.day) ? course.day : null;
  const startTime = validTimeOrNull(course.startTime);
  const endTime = validTimeOrNull(course.endTime);
  const location = nullableText(course.location);
  const professor = nullableText(course.professor);
  const reasons = [];

  if (!name) reasons.push("과목명 확인 필요");
  if (!day) reasons.push("요일 확인 필요");
  if (!startTime || !endTime) reasons.push("수업 시간 확인 필요");
  if (startTime && endTime && toMinutes(startTime) >= toMinutes(endTime)) {
    reasons.push("종료 시간은 시작 시간보다 늦어야 함");
  }
  if (typeof course.reviewReason === "string" && course.reviewReason.trim()) {
    reasons.push(course.reviewReason.trim());
  }

  return {
    id: crypto.randomUUID(),
    name: name ?? "확인 필요",
    day,
    startTime,
    endTime,
    location,
    professor,
    needsReview: Boolean(course.needsReview) || reasons.length > 0,
    reviewReason: reasons.length ? [...new Set(reasons)].join(", ") : null,
  };
}

function markDuplicates(courses, warnings) {
  const seen = new Map();
  for (const course of courses) {
    if (!course.day || !course.startTime || !course.endTime) continue;
    const key = `${course.name}|${course.day}|${course.startTime}|${course.endTime}`.toLowerCase();
    const previous = seen.get(key);
    if (previous) {
      markReview(previous, "중복 수업 확인 필요");
      markReview(course, "중복 수업 확인 필요");
      warnings.push(`${course.name}: 동일한 수업 일정이 중복으로 추출되었습니다.`);
    } else {
      seen.set(key, course);
    }
  }
}

function markConflicts(courses, warnings) {
  for (let leftIndex = 0; leftIndex < courses.length; leftIndex += 1) {
    const left = courses[leftIndex];
    if (!left.day || !left.startTime || !left.endTime) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < courses.length; rightIndex += 1) {
      const right = courses[rightIndex];
      if (left.day !== right.day || !right.startTime || !right.endTime) continue;
      if (
        toMinutes(left.startTime) < toMinutes(right.endTime) &&
        toMinutes(right.startTime) < toMinutes(left.endTime)
      ) {
        markReview(left, "다른 수업과 시간 충돌");
        markReview(right, "다른 수업과 시간 충돌");
        warnings.push(`${left.name}과(와) ${right.name}의 시간이 겹칩니다.`);
      }
    }
  }
}

function markReview(course, reason) {
  course.needsReview = true;
  const reasons = course.reviewReason ? course.reviewReason.split(", ") : [];
  if (!reasons.includes(reason)) reasons.push(reason);
  course.reviewReason = reasons.join(", ");
}

function nullableText(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

function validTimeOrNull(value) {
  return typeof value === "string" && TIME_PATTERN.test(value) ? value : null;
}

export function toMinutes(time) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function invalidResponse(detail) {
  return new AppError(
    502,
    "INVALID_AI_RESPONSE",
    "AI가 반환한 시간표 데이터를 검증하지 못했습니다. 이미지를 확인한 후 다시 시도해 주세요.",
    { cause: new Error(detail) },
  );
}
