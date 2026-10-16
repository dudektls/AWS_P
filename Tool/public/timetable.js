import {
  calculateAvailability,
  DAY_LABELS,
  fromMinutes,
  toMinutes,
  WEEKDAYS,
} from "./availability.js";
import {
  loadConfirmedTimetable,
  saveConfirmedTimetable,
} from "./timetableStorage.js";

const ALL_DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const COURSE_COLORS = [
  "#cfe1ff",
  "#d7f2df",
  "#ffe2c6",
  "#eadcff",
  "#ffd9e1",
  "#d4eff3",
  "#fff0b8",
  "#dce4ff",
];

const elements = {
  fileInput: document.querySelector("#timetableImage"),
  dropZone: document.querySelector("#imageDropZone"),
  uploadHint: document.querySelector("#imageUploadHint"),
  fileCard: document.querySelector("#imageFileCard"),
  fileName: document.querySelector("#imageFileName"),
  fileInfo: document.querySelector("#imageFileInfo"),
  removeImage: document.querySelector("#removeImage"),
  preview: document.querySelector("#imagePreview"),
  statusBox: document.querySelector("#imageStatusBox"),
  statusText: document.querySelector("#imageStatusText"),
  progressPanel: document.querySelector("#timetableProgressPanel"),
  progressLabel: document.querySelector("#timetableProgressLabel"),
  progressDetail: document.querySelector("#timetableProgressDetail"),
  progressBar: document.querySelector("#timetableProgressBar"),
  analyzeButton: document.querySelector("#analyzeTimetableButton"),
  warningList: document.querySelector("#analysisWarnings"),
  emptyState: document.querySelector("#courseEmptyState"),
  tableWrap: document.querySelector("#courseTableWrap"),
  courseRows: document.querySelector("#courseRows"),
  editorMessage: document.querySelector("#editorMessage"),
  addCourseButton: document.querySelector("#addCourseButton"),
  saveButton: document.querySelector("#saveTimetableButton"),
  visualTimetable: document.querySelector("#visualTimetable"),
  studyWindowRows: document.querySelector("#studyWindowRows"),
  personalEventRows: document.querySelector("#personalEventRows"),
  addPersonalEventButton: document.querySelector("#addPersonalEventButton"),
  calculateAvailabilityButton: document.querySelector("#calculateAvailabilityButton"),
  availabilityMessage: document.querySelector("#availabilityMessage"),
  availabilityResults: document.querySelector("#availabilityResults"),
};

const state = {
  image: null,
  previewUrl: null,
  isAnalyzing: false,
  analysisSnapshot: null,
  confirmedSnapshot: null,
  courses: [],
  warnings: [],
  config: {
    maxImageUploadMb: 10,
    supportedImageExtensions: ["png", "jpg", "jpeg"],
    timetableStartHour: 8,
    timetableEndHour: 22,
  },
  studyWindows: WEEKDAYS.map((day) => ({ day, startTime: "09:00", endTime: "18:00" })),
  personalEvents: [],
  availability: {},
};

function setStatus(message, tone = "neutral") {
  elements.statusText.textContent = message;
  elements.statusBox.dataset.tone = tone;
}

function resetTimetableProgress() {
  elements.progressPanel.hidden = true;
  elements.progressLabel.textContent = "";
  elements.progressDetail.textContent = "";
  elements.progressBar.value = 0;
  elements.progressBar.setAttribute("value", "0");
}

function showTimetableProgress(label, detail = "", percentage = null) {
  elements.progressPanel.hidden = false;
  elements.progressLabel.textContent = label;
  elements.progressDetail.textContent = detail;
  if (percentage === null) {
    elements.progressBar.removeAttribute("value");
  } else {
    elements.progressBar.value = Math.max(0, Math.min(100, percentage));
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)) - 1, 2);
  const value = bytes / 1024 ** (unitIndex + 1);
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function extensionOf(fileName) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function clearCurrentAnalysis() {
  state.analysisSnapshot = null;
  state.confirmedSnapshot = null;
  state.courses = [];
  state.warnings = [];
  state.availability = {};
  elements.editorMessage.textContent = "";
  renderAll();
}

function clearImage() {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.image = null;
  state.previewUrl = null;
  elements.fileInput.value = "";
  elements.fileCard.hidden = true;
  elements.preview.hidden = true;
  elements.preview.removeAttribute("src");
  elements.analyzeButton.disabled = true;
  resetTimetableProgress();
  clearCurrentAnalysis();
  setStatus("이미지를 선택해 주세요.");
}

function selectImage(file) {
  resetTimetableProgress();
  const extension = extensionOf(file.name);
  const allowedMimeTypes = ["image/png", "image/jpeg"];
  if (
    !state.config.supportedImageExtensions.includes(extension) ||
    !allowedMimeTypes.includes(file.type)
  ) {
    clearImage();
    setStatus("PNG, JPG, JPEG 형식의 이미지만 선택할 수 있습니다.", "error");
    return;
  }
  if (!file.size) {
    clearImage();
    setStatus("빈 파일은 업로드할 수 없습니다.", "error");
    return;
  }
  if (file.size > state.config.maxImageUploadMb * 1024 * 1024) {
    clearImage();
    setStatus(`이미지는 최대 ${state.config.maxImageUploadMb}MB까지 업로드할 수 있습니다.`, "error");
    return;
  }

  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  clearCurrentAnalysis();
  state.image = file;
  state.previewUrl = URL.createObjectURL(file);
  elements.fileName.textContent = file.name;
  elements.fileInfo.textContent = `${extension.toUpperCase()} · ${formatBytes(file.size)}`;
  elements.fileCard.hidden = false;
  elements.preview.src = state.previewUrl;
  elements.preview.hidden = false;
  elements.analyzeButton.disabled = false;
  setStatus("업로드 준비가 완료되었습니다.", "success");
}

function analyzeTimetable() {
  if (!state.image || state.isAnalyzing) return;
  state.isAnalyzing = true;
  elements.analyzeButton.disabled = true;
  elements.fileInput.disabled = true;
  elements.removeImage.disabled = true;
  clearCurrentAnalysis();
  setStatus("시간표 이미지를 서버에 업로드하는 중입니다.", "working");
  showTimetableProgress("이미지 업로드 중", "0%", 0);

  const formData = new FormData();
  formData.append("timetableImage", state.image);
  const request = new XMLHttpRequest();
  let parsedLength = 0;
  let pendingLine = "";
  let receivedResult = false;
  let analysisStartedAt = null;
  let clockTimer = null;
  let finished = false;

  function stopClock() {
    if (clockTimer !== null) window.clearInterval(clockTimer);
    clockTimer = null;
  }

  function updateAnalysisClock() {
    const elapsedSeconds = Math.max(
      1,
      Math.floor((Date.now() - analysisStartedAt) / 1000),
    );
    showTimetableProgress(
      "AI 이미지 분석 중",
      `${elapsedSeconds}초 경과 · 보통 10~60초, 최대 90초까지 기다립니다.`,
    );
  }

  function startAnalysisClock() {
    if (analysisStartedAt !== null) return;
    analysisStartedAt = Date.now();
    updateAnalysisClock();
    clockTimer = window.setInterval(updateAnalysisClock, 1000);
  }

  function finishRequest() {
    if (finished) return;
    finished = true;
    stopClock();
    state.isAnalyzing = false;
    elements.fileInput.disabled = false;
    elements.removeImage.disabled = false;
    elements.analyzeButton.disabled = !state.image;
  }

  function failRequest(message) {
    setStatus(message || "시간표 이미지 분석에 실패했습니다.", "error");
    resetTimetableProgress();
    finishRequest();
  }

  function handleStreamEvent(event) {
    if (event.type === "error") {
      throw new Error(event.error?.message ?? "시간표 이미지 분석에 실패했습니다.");
    }
    if (event.type === "result") {
      receivedResult = true;
      stopClock();
      state.analysisSnapshot = structuredClone(event);
      state.courses = event.courses.map((course) => ({ ...course }));
      state.warnings = [...event.warnings];
      renderAll();
      showTimetableProgress("분석 완료", "100%", 100);
      setStatus(
        state.courses.length
          ? `${state.courses.length}개의 수업 일정을 추출했습니다. 저장 전에 검토해 주세요.`
          : "이미지에서 수업 일정을 찾지 못했습니다.",
        state.courses.length ? "success" : "neutral",
      );
      return;
    }
    if (event.type !== "progress") return;
    if (event.phase === "validating") {
      showTimetableProgress("이미지 검증 중", "파일 구조와 크기를 확인하고 있습니다.");
      setStatus("업로드한 이미지가 정상인지 확인하는 중입니다.", "working");
    } else if (event.phase === "analyzing") {
      startAnalysisClock();
      setStatus("Gemini가 시간표의 글자와 셀 위치를 분석하는 중입니다.", "working");
    }
  }

  function parseStreamingResponse(final = false) {
    const newText = request.responseText.slice(parsedLength);
    parsedLength = request.responseText.length;
    pendingLine += newText;
    const lines = pendingLine.split("\n");
    pendingLine = final ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      if (line.trim()) handleStreamEvent(JSON.parse(line));
    }
  }

  request.open("POST", "/api/timetables/analyze");
  request.setRequestHeader("Accept", "application/x-ndjson");
  request.upload.addEventListener("progress", (event) => {
    if (!event.lengthComputable) {
      showTimetableProgress("이미지 업로드 중", "전송 용량을 계산 중입니다.");
      return;
    }
    const percentage = (event.loaded / event.total) * 100;
    showTimetableProgress("이미지 업로드 중", `${Math.round(percentage)}%`, percentage);
  });
  request.addEventListener("progress", () => {
    try {
      parseStreamingResponse();
    } catch (error) {
      request.abort();
      failRequest(error.message);
    }
  });
  request.addEventListener("load", () => {
    try {
      const contentType = request.getResponseHeader("Content-Type") ?? "";
      if (contentType.includes("application/x-ndjson")) {
        parseStreamingResponse(true);
      } else {
        const body = JSON.parse(request.responseText || "{}");
        if (request.status >= 400) {
          throw new Error(body.error?.message ?? "시간표 이미지 분석에 실패했습니다.");
        }
      }
      if (!receivedResult) throw new Error("서버에서 최종 분석 결과를 받지 못했습니다.");
      finishRequest();
    } catch (error) {
      failRequest(error.message);
    }
  });
  request.addEventListener("error", () => {
    failRequest("서버와 통신하지 못했습니다. 네트워크 상태를 확인해 주세요.");
  });
  request.send(formData);
}

function renderAll() {
  renderWarnings();
  renderCourseRows();
  renderTimetable();
  renderAvailability();
  elements.saveButton.disabled =
    state.courses.length === 0 &&
    state.analysisSnapshot === null &&
    state.confirmedSnapshot === null;
}

function renderWarnings() {
  elements.warningList.replaceChildren();
  if (!state.warnings.length) {
    elements.warningList.hidden = true;
    return;
  }
  const title = document.createElement("strong");
  title.textContent = "검토 안내";
  const list = document.createElement("ul");
  for (const warning of state.warnings) {
    const item = document.createElement("li");
    item.textContent = warning;
    list.append(item);
  }
  elements.warningList.append(title, list);
  elements.warningList.hidden = false;
}

function renderCourseRows() {
  elements.courseRows.replaceChildren();
  elements.emptyState.hidden = state.courses.length > 0;
  elements.tableWrap.hidden = state.courses.length === 0;
  const conflictIds = findConflictIds(state.courses);

  for (const course of state.courses) {
    const row = document.createElement("tr");
    row.dataset.courseId = course.id;
    if (course.needsReview) row.classList.add("needs-review");
    if (conflictIds.has(course.id)) row.classList.add("has-error");

    row.append(
      inputCell("name", course.name, "text"),
      selectCell("day", course.day),
      inputCell("startTime", course.startTime ?? "", "time"),
      inputCell("endTime", course.endTime ?? "", "time"),
      inputCell("location", course.location ?? "", "text"),
      inputCell("professor", course.professor ?? "", "text"),
      actionCell(course.id),
    );
    if (course.needsReview && course.reviewReason) {
      const reason = document.createElement("span");
      reason.className = "review-reason";
      reason.textContent = course.reviewReason;
      row.cells[0].append(reason);
    }
    elements.courseRows.append(row);
  }
}

function inputCell(name, value, type) {
  const cell = document.createElement("td");
  const input = document.createElement("input");
  input.name = name;
  input.type = type;
  input.value = value;
  input.setAttribute("aria-label", fieldLabel(name));
  cell.append(input);
  return cell;
}

function selectCell(name, value) {
  const cell = document.createElement("td");
  const select = document.createElement("select");
  select.name = name;
  select.setAttribute("aria-label", "요일");
  const unknownOption = new Option("확인 필요", "");
  select.append(unknownOption);
  for (const day of ALL_DAYS) select.append(new Option(DAY_LABELS[day], day));
  select.value = value ?? "";
  cell.append(select);
  return cell;
}

function actionCell(courseId) {
  const cell = document.createElement("td");
  const wrap = document.createElement("div");
  wrap.className = "row-actions";
  const applyButton = document.createElement("button");
  applyButton.className = "small-button";
  applyButton.type = "button";
  applyButton.textContent = "수정 적용";
  applyButton.addEventListener("click", () => applyCourseEdit(courseId));
  const deleteButton = document.createElement("button");
  deleteButton.className = "small-button danger";
  deleteButton.type = "button";
  deleteButton.textContent = "삭제";
  deleteButton.addEventListener("click", () => deleteCourse(courseId));
  wrap.append(applyButton, deleteButton);
  cell.append(wrap);
  return cell;
}

function applyCourseEdit(courseId) {
  const row = [...elements.courseRows.rows].find((item) => item.dataset.courseId === courseId);
  const candidate = {
    id: courseId,
    name: row.querySelector('[name="name"]').value.trim(),
    day: row.querySelector('[name="day"]').value,
    startTime: row.querySelector('[name="startTime"]').value,
    endTime: row.querySelector('[name="endTime"]').value,
    location: row.querySelector('[name="location"]').value.trim() || null,
    professor: row.querySelector('[name="professor"]').value.trim() || null,
    needsReview: false,
    reviewReason: null,
  };
  const error = validateEditableCourse(candidate);
  if (error) {
    elements.editorMessage.textContent = error;
    return;
  }
  const index = state.courses.findIndex((course) => course.id === courseId);
  state.courses[index] = candidate;
  elements.editorMessage.textContent = `${candidate.name} 수정사항을 반영했습니다.`;
  renderAll();
}

function deleteCourse(courseId) {
  state.courses = state.courses.filter((course) => course.id !== courseId);
  elements.editorMessage.textContent = "수업을 삭제했습니다.";
  renderAll();
}

function addCourse() {
  const index = state.courses.length + 1;
  state.courses.push({
    id: crypto.randomUUID(),
    name: `새 수업 ${index}`,
    day: "MON",
    startTime: "09:00",
    endTime: "10:00",
    location: null,
    professor: null,
    needsReview: true,
    reviewReason: "직접 추가한 수업을 확인해 주세요.",
  });
  elements.editorMessage.textContent = "새 수업을 추가했습니다. 내용을 수정해 주세요.";
  renderAll();
}

function validateEditableCourse(course) {
  if (!course.name) return "과목명을 입력해 주세요.";
  if (!ALL_DAYS.includes(course.day)) return "요일을 선택해 주세요.";
  if (toMinutes(course.startTime) === null || toMinutes(course.endTime) === null) {
    return "시작 시간과 종료 시간을 올바르게 입력해 주세요.";
  }
  if (toMinutes(course.startTime) >= toMinutes(course.endTime)) {
    return "종료 시간은 시작 시간보다 늦어야 합니다.";
  }
  return null;
}

function renderTimetable() {
  elements.visualTimetable.replaceChildren();
  const startMinute = state.config.timetableStartHour * 60;
  const endMinute = state.config.timetableEndHour * 60;
  const totalMinutes = endMinute - startMinute;
  const hourHeight = 72;
  const bodyHeight = (totalMinutes / 60) * hourHeight;
  const conflictIds = findConflictIds(state.courses);

  elements.visualTimetable.append(headerCell("", "time-corner"));
  for (const day of WEEKDAYS) elements.visualTimetable.append(headerCell(DAY_LABELS[day], "day-header"));

  const timeColumn = document.createElement("div");
  timeColumn.className = "time-column";
  timeColumn.style.height = `${bodyHeight}px`;
  for (let hour = state.config.timetableStartHour; hour <= state.config.timetableEndHour; hour += 1) {
    const label = document.createElement("span");
    label.className = "time-label";
    if (hour === state.config.timetableStartHour) label.classList.add("is-first");
    if (hour === state.config.timetableEndHour) label.classList.add("is-last");
    label.style.top = `${(hour - state.config.timetableStartHour) * hourHeight}px`;
    label.textContent = `${String(hour).padStart(2, "0")}:00`;
    timeColumn.append(label);
  }
  elements.visualTimetable.append(timeColumn);

  const unplaced = [];
  for (const day of WEEKDAYS) {
    const column = document.createElement("div");
    column.className = "day-column";
    column.style.height = `${bodyHeight}px`;
    const validCourses = state.courses.filter((course) => {
      if (course.day !== day) return false;
      const start = toMinutes(course.startTime);
      const end = toMinutes(course.endTime);
      if (start === null || end === null || start >= end) {
        unplaced.push(course);
        return false;
      }
      return true;
    });
    const layouts = assignLanes(validCourses);
    for (const layout of layouts) {
      const event = createCourseEvent(layout.course, conflictIds.has(layout.course.id));
      const courseStart = Math.max(toMinutes(layout.course.startTime), startMinute);
      const courseEnd = Math.min(toMinutes(layout.course.endTime), endMinute);
      if (courseStart >= courseEnd) {
        unplaced.push(layout.course);
        continue;
      }
      event.style.top = `${((courseStart - startMinute) / 60) * hourHeight}px`;
      event.style.height = `${Math.max(28, ((courseEnd - courseStart) / 60) * hourHeight)}px`;
      event.style.left = `${(layout.lane / layout.laneCount) * 100}%`;
      event.style.width = `${100 / layout.laneCount}%`;
      column.append(event);
    }
    elements.visualTimetable.append(column);
  }

  document.querySelector(".unplaced-courses")?.remove();
  const additionalUnplaced = state.courses.filter((course) => !WEEKDAYS.includes(course.day));
  const uniqueUnplaced = [...new Map([...unplaced, ...additionalUnplaced].map((course) => [course.id, course])).values()];
  if (uniqueUnplaced.length) {
    const notice = document.createElement("div");
    notice.className = "unplaced-courses";
    notice.textContent = `시간표에 배치하지 못한 수업: ${uniqueUnplaced.map((course) => course.name).join(", ")}`;
    elements.visualTimetable.parentElement.after(notice);
  }
}

function headerCell(text, className) {
  const element = document.createElement("div");
  element.className = className;
  element.textContent = text;
  return element;
}

function createCourseEvent(course, conflict) {
  const event = document.createElement("div");
  event.className = `course-event${conflict ? " conflict" : ""}`;
  event.style.background = COURSE_COLORS[hashName(course.name) % COURSE_COLORS.length];
  const name = document.createElement("strong");
  name.textContent = course.name;
  const time = document.createElement("span");
  time.textContent = `${course.startTime}~${course.endTime}`;
  event.append(name, time);
  if (course.location) {
    const location = document.createElement("span");
    location.textContent = course.location;
    event.append(location);
  }
  return event;
}

function assignLanes(courses) {
  const sorted = [...courses].sort(
    (left, right) => toMinutes(left.startTime) - toMinutes(right.startTime),
  );
  const laneEnds = [];
  const result = [];
  for (const course of sorted) {
    const start = toMinutes(course.startTime);
    const lane = laneEnds.findIndex((end) => end <= start);
    const selectedLane = lane === -1 ? laneEnds.length : lane;
    laneEnds[selectedLane] = toMinutes(course.endTime);
    result.push({ course, lane: selectedLane });
  }
  const laneCount = Math.max(1, laneEnds.length);
  return result.map((item) => ({ ...item, laneCount }));
}

function findConflictIds(courses) {
  const ids = new Set();
  for (let leftIndex = 0; leftIndex < courses.length; leftIndex += 1) {
    const left = courses[leftIndex];
    const leftStart = toMinutes(left.startTime);
    const leftEnd = toMinutes(left.endTime);
    if (!left.day || leftStart === null || leftEnd === null) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < courses.length; rightIndex += 1) {
      const right = courses[rightIndex];
      const rightStart = toMinutes(right.startTime);
      const rightEnd = toMinutes(right.endTime);
      if (left.day !== right.day || rightStart === null || rightEnd === null) continue;
      if (leftStart < rightEnd && rightStart < leftEnd) {
        ids.add(left.id);
        ids.add(right.id);
      }
    }
  }
  return ids;
}

function hashName(name) {
  return [...name].reduce((total, character) => total + character.codePointAt(0), 0);
}

function renderStudyWindows() {
  elements.studyWindowRows.replaceChildren();
  for (const range of state.studyWindows) {
    const row = document.createElement("div");
    row.className = "study-window-row";
    const label = document.createElement("label");
    label.textContent = DAY_LABELS[range.day];
    const start = timeInput(range.startTime, `${DAY_LABELS[range.day]} 공부 시작`);
    const separator = document.createElement("span");
    separator.textContent = "~";
    const end = timeInput(range.endTime, `${DAY_LABELS[range.day]} 공부 종료`);
    start.addEventListener("change", () => {
      range.startTime = start.value;
    });
    end.addEventListener("change", () => {
      range.endTime = end.value;
    });
    row.append(label, start, separator, end);
    elements.studyWindowRows.append(row);
  }
}

function renderPersonalEvents() {
  elements.personalEventRows.replaceChildren();
  if (!state.personalEvents.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "등록된 개인 일정이 없습니다.";
    elements.personalEventRows.append(empty);
    return;
  }
  for (const event of state.personalEvents) {
    const row = document.createElement("div");
    row.className = "personal-event-row";
    const name = document.createElement("input");
    name.value = event.name;
    name.setAttribute("aria-label", "개인 일정명");
    const day = document.createElement("select");
    day.setAttribute("aria-label", "개인 일정 요일");
    for (const dayCode of WEEKDAYS) day.append(new Option(DAY_LABELS[dayCode], dayCode));
    day.value = event.day;
    const start = timeInput(event.startTime, "개인 일정 시작");
    const separator = document.createElement("span");
    separator.textContent = "~";
    const end = timeInput(event.endTime, "개인 일정 종료");
    const remove = document.createElement("button");
    remove.className = "small-button danger";
    remove.type = "button";
    remove.textContent = "삭제";
    name.addEventListener("change", () => (event.name = name.value.trim() || "개인 일정"));
    day.addEventListener("change", () => (event.day = day.value));
    start.addEventListener("change", () => (event.startTime = start.value));
    end.addEventListener("change", () => (event.endTime = end.value));
    remove.addEventListener("click", () => {
      state.personalEvents = state.personalEvents.filter((item) => item.id !== event.id);
      renderPersonalEvents();
    });
    row.append(name, day, start, separator, end, remove);
    elements.personalEventRows.append(row);
  }
}

function timeInput(value, label) {
  const input = document.createElement("input");
  input.type = "time";
  input.value = value;
  input.setAttribute("aria-label", label);
  return input;
}

function addPersonalEvent() {
  state.personalEvents.push({
    id: crypto.randomUUID(),
    name: "개인 일정",
    day: "MON",
    startTime: "12:00",
    endTime: "13:00",
  });
  renderPersonalEvents();
}

function calculateAndRenderAvailability() {
  const invalidCourse = state.courses.find(validateEditableCourse);
  const invalidWindow = state.studyWindows.find(
    (range) =>
      toMinutes(range.startTime) === null ||
      toMinutes(range.endTime) === null ||
      toMinutes(range.startTime) >= toMinutes(range.endTime),
  );
  const invalidEvent = state.personalEvents.find(
    (event) =>
      toMinutes(event.startTime) === null ||
      toMinutes(event.endTime) === null ||
      toMinutes(event.startTime) >= toMinutes(event.endTime),
  );
  if (invalidCourse || invalidWindow || invalidEvent) {
    elements.availabilityMessage.textContent = "시간 입력을 확인한 후 다시 계산해 주세요.";
    return false;
  }
  state.availability = calculateAvailability({
    studyWindows: state.studyWindows,
    courses: state.courses,
    personalEvents: state.personalEvents,
  });
  elements.availabilityMessage.textContent = "수업과 개인 일정을 제외해 계산했습니다.";
  renderAvailability();
  return true;
}

function renderAvailability() {
  elements.availabilityResults.replaceChildren();
  for (const day of WEEKDAYS) {
    const card = document.createElement("div");
    card.className = "availability-day";
    const title = document.createElement("strong");
    title.textContent = DAY_LABELS[day];
    card.append(title);
    const slots = state.availability[day] ?? [];
    if (!slots.length) {
      const empty = document.createElement("span");
      empty.textContent = "계산 결과 없음";
      card.append(empty);
    } else {
      for (const slot of slots) {
        const range = document.createElement("span");
        range.textContent = `${slot.startTime}~${slot.endTime}`;
        card.append(range);
      }
    }
    elements.availabilityResults.append(card);
  }
}

function saveTimetable() {
  const invalidCourse = state.courses.find(validateEditableCourse);
  if (invalidCourse) {
    elements.editorMessage.textContent = `${invalidCourse.name}: 유효하지 않은 수업 정보가 있어 저장할 수 없습니다.`;
    return;
  }
  if (!calculateAndRenderAvailability()) return;
  const matchingData = {
    version: 1,
    availableSlots: Object.values(state.availability).flat(),
  };
  const saved = saveConfirmedTimetable({
    courses: state.courses,
    studyWindows: state.studyWindows,
    personalEvents: state.personalEvents,
    matchingData,
  });
  state.confirmedSnapshot = structuredClone(saved);
  elements.editorMessage.textContent = `${new Date(saved.savedAt).toLocaleString("ko-KR")}에 브라우저에 저장했습니다.`;
  setStatus("검토가 끝난 시간표를 브라우저에 저장했습니다.", "success");
}

function restoreSavedTimetable() {
  const saved = loadConfirmedTimetable();
  if (!saved) return;
  state.courses = saved.courses.map((course) => ({ ...course }));
  state.confirmedSnapshot = structuredClone(saved);
  state.studyWindows = saved.studyWindows.map((range) => ({ ...range }));
  state.personalEvents = saved.personalEvents.map((event) => ({ ...event }));
  state.availability = Object.fromEntries(WEEKDAYS.map((day) => [day, []]));
  for (const slot of saved.matchingData?.availableSlots ?? []) {
    if (state.availability[slot.day]) state.availability[slot.day].push(slot);
  }
  renderStudyWindows();
  renderPersonalEvents();
  renderAll();
  elements.editorMessage.textContent = "브라우저에 저장된 확정 시간표를 복원했습니다.";
}

function fieldLabel(name) {
  return {
    name: "과목명",
    startTime: "시작 시간",
    endTime: "종료 시간",
    location: "강의실",
    professor: "교수명",
  }[name];
}

elements.fileInput.addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) selectImage(file);
});
for (const eventName of ["dragenter", "dragover"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (!state.isAnalyzing) elements.dropZone.classList.add("is-dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("is-dragging");
  });
}
elements.dropZone.addEventListener("drop", (event) => {
  if (state.isAnalyzing) return;
  const [file] = event.dataTransfer.files;
  if (file) selectImage(file);
});
elements.removeImage.addEventListener("click", clearImage);
elements.analyzeButton.addEventListener("click", analyzeTimetable);
elements.addCourseButton.addEventListener("click", addCourse);
elements.saveButton.addEventListener("click", saveTimetable);
elements.addPersonalEventButton.addEventListener("click", addPersonalEvent);
elements.calculateAvailabilityButton.addEventListener("click", calculateAndRenderAvailability);

renderStudyWindows();
renderPersonalEvents();
renderAll();
restoreSavedTimetable();

fetch("/api/config")
  .then((response) => response.json())
  .then((config) => {
    state.config = { ...state.config, ...config };
    elements.uploadHint.textContent = `PNG, JPG, JPEG · 최대 ${config.maxImageUploadMb}MB`;
    renderTimetable();
  })
  .catch(() => {
    elements.uploadHint.textContent = "PNG, JPG, JPEG · 최대 10MB";
  });
