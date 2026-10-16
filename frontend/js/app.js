const studies = [
  {
    id: 101,
    title: "데이터베이스 중간고사 복습",
    subject: "데이터베이스",
    goal: "정규화와 SQL 핵심 개념을 정리하고 기출 유형 문제를 함께 풉니다.",
    date: "2026-10-14",
    startTime: "14:00",
    endTime: "16:00",
    location: "서울 중구 중앙도서관 스터디룸",
    currentMembers: 2,
    capacity: 4,
    leader: "학습메이트",
    condition: "기본 SQL 문법을 학습한 학생",
  },
  {
    id: 102,
    title: "SQL 문제 함께 풀기",
    subject: "데이터베이스",
    goal: "JOIN과 서브쿼리 문제를 각자 풀고 풀이 과정을 공유합니다.",
    date: "2026-10-14",
    startTime: "15:00",
    endTime: "17:00",
    location: "서울 종로구 청년센터 회의실",
    currentMembers: 3,
    capacity: 5,
    leader: "쿼리러버",
    condition: "2시간 동안 적극적으로 문제 풀이에 참여할 학생",
  },
  {
    id: 103,
    title: "운영체제 동기화 개념 정리",
    subject: "운영체제",
    goal: "프로세스 동기화와 교착상태 개념을 발표 형식으로 정리합니다.",
    date: "2026-10-15",
    startTime: "10:00",
    endTime: "12:30",
    location: "서울 마포구 스터디카페 합정점",
    currentMembers: 2,
    capacity: 4,
    leader: "OS정복",
    condition: "운영체제 기본 강의를 수강 중인 학생",
  },
  {
    id: 104,
    title: "알고리즘 코딩테스트 준비",
    subject: "알고리즘",
    goal: "그래프 탐색 문제를 제한 시간 안에 풀고 서로의 코드를 리뷰합니다.",
    date: "2026-10-16",
    startTime: "14:00",
    endTime: "17:00",
    location: "서울 성동구 청년공간 스터디룸",
    currentMembers: 4,
    capacity: 6,
    leader: "BFS마스터",
    condition: "백준 실버 이상 문제 풀이 경험이 있는 학생",
  },
  {
    id: 105,
    title: "웹 개발 프로젝트 코드 리뷰",
    subject: "웹 개발",
    goal: "HTML, CSS, JavaScript로 만든 프로젝트를 함께 확인하고 개선점을 찾습니다.",
    date: "2026-10-17",
    startTime: "13:00",
    endTime: "16:00",
    location: "서울 강남구 역삼 청년센터",
    currentMembers: 2,
    capacity: 5,
    leader: "프론트꿈나무",
    condition: "리뷰할 개인 프로젝트를 준비할 수 있는 학생",
  },
  {
    id: 106,
    title: "컴퓨터네트워크 시험 대비",
    subject: "컴퓨터네트워크",
    goal: "OSI 7계층과 TCP/IP 흐름을 화이트보드로 설명하며 복습합니다.",
    date: "2026-10-19",
    startTime: "18:00",
    endTime: "20:00",
    location: "서울 서대문구 신촌 스터디룸",
    currentMembers: 1,
    capacity: 4,
    leader: "패킷추적자",
    condition: "네트워크 과목 중간고사를 준비하는 학생",
  },
];

const CREATED_STUDIES_KEY = "study-recruit.created-studies.v1";

function loadCreatedStudies(storage = localStorage) {
  try {
    const value = JSON.parse(storage.getItem(CREATED_STUDIES_KEY));
    if (!Array.isArray(value)) return [];
    return value.filter(
      (study) =>
        Number.isFinite(study?.id) &&
        typeof study.title === "string" &&
        typeof study.subject === "string" &&
        typeof study.date === "string" &&
        typeof study.startTime === "string" &&
        typeof study.endTime === "string",
    );
  } catch {
    return [];
  }
}

studies.push(...loadCreatedStudies());

const TIMETABLE_STORAGE_KEY = "ai-study-tool.confirmed-timetable.v1";
const DAY_INDEX = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

let savedAvailability = loadSavedAvailability();

const elements = {
  form: document.querySelector("#search-form"),
  title: document.querySelector("#title-filter"),
  subject: document.querySelector("#subject-filter"),
  date: document.querySelector("#date-filter"),
  start: document.querySelector("#start-filter"),
  end: document.querySelector("#end-filter"),
  availability: document.querySelector("#availability-filter"),
  availabilityHint: document.querySelector("#availability-hint"),
  grid: document.querySelector("#study-grid"),
  resultCount: document.querySelector("#result-count"),
  heroCount: document.querySelector("#hero-count"),
  activeFilters: document.querySelector("#active-filters"),
  emptyState: document.querySelector("#empty-state"),
  reset: document.querySelector("#reset-button"),
  emptyReset: document.querySelector("#empty-reset-button"),
  dialog: document.querySelector("#study-dialog"),
  dialogBody: document.querySelector("#dialog-body"),
  dialogClose: document.querySelector("#dialog-close"),
  toast: document.querySelector("#toast"),
  gridViewButton: document.querySelector("#grid-view-button"),
  listViewButton: document.querySelector("#list-view-button"),
};

const VIEW_STORAGE_KEY = "study-list-view";

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  month: "long",
  day: "numeric",
  weekday: "short",
});

function toMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function isFullyContained(studyStart, studyEnd, availableStart, availableEnd) {
  return (
    toMinutes(studyStart) >= toMinutes(availableStart) &&
    toMinutes(studyEnd) <= toMinutes(availableEnd)
  );
}

function formatDate(dateString) {
  return dateFormatter.format(new Date(`${dateString}T00:00:00`));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatStudyLocation(study) {
  const placeName = String(study.placeName || "").trim();
  const address = String(study.address || "").trim();
  const detailAddress = String(study.detailAddress || "").trim();
  const primaryLocation = placeName && address ? `${placeName}(${address})` : placeName || address;
  return [primaryLocation, detailAddress].filter(Boolean).join(", ") || study.location;
}

function loadSavedAvailability(storage = localStorage) {
  try {
    const saved = JSON.parse(storage.getItem(TIMETABLE_STORAGE_KEY));
    const slots = saved?.matchingData?.availableSlots;
    if (saved?.version !== 1 || !Array.isArray(slots)) return {};

    return slots.reduce((availability, slot) => {
      const weekday = DAY_INDEX[slot?.day];
      if (
        weekday === undefined ||
        typeof slot.startTime !== "string" ||
        typeof slot.endTime !== "string"
      ) {
        return availability;
      }
      availability[weekday] ??= [];
      availability[weekday].push({ start: slot.startTime, end: slot.endTime });
      return availability;
    }, {});
  } catch {
    return {};
  }
}

function refreshAvailabilityControl() {
  savedAvailability = loadSavedAvailability();
  const slotCount = Object.values(savedAvailability).reduce(
    (total, slots) => total + slots.length,
    0,
  );
  elements.availability.disabled = slotCount === 0;
  if (slotCount === 0) elements.availability.checked = false;
  elements.availabilityHint.textContent = slotCount
    ? `AI 시간표에서 계산한 가용시간 ${slotCount}개를 적용합니다.`
    : "AI 시간표에서 시간표를 저장하면 사용할 수 있습니다.";
}

function populateSubjects() {
  const subjects = [...new Set(studies.map((study) => study.subject))].sort();
  elements.subject.insertAdjacentHTML(
    "beforeend",
    subjects.map((subject) => `<option value="${escapeHtml(subject)}">${escapeHtml(subject)}</option>`).join(""),
  );
}

function readFilters() {
  return {
    title: elements.title.value.trim().toLocaleLowerCase("ko-KR"),
    subject: elements.subject.value,
    date: elements.date.value,
    start: elements.start.value,
    end: elements.end.value,
    useAvailability: elements.availability.checked,
  };
}

function matchesSavedAvailability(study) {
  const weekday = new Date(`${study.date}T00:00:00`).getDay();
  const windows = savedAvailability[weekday] ?? [];
  return windows.some((window) =>
    isFullyContained(study.startTime, study.endTime, window.start, window.end),
  );
}

function filterStudies(filters) {
  return studies.filter((study) => {
    const matchesTitle = !filters.title || study.title.toLocaleLowerCase("ko-KR").includes(filters.title);
    const matchesSubject = !filters.subject || study.subject === filters.subject;
    const matchesDate = !filters.date || study.date === filters.date;
    const matchesStart = !filters.start || toMinutes(study.startTime) >= toMinutes(filters.start);
    const matchesEnd = !filters.end || toMinutes(study.endTime) <= toMinutes(filters.end);
    const matchesAvailability = !filters.useAvailability || matchesSavedAvailability(study);

    return matchesTitle && matchesSubject && matchesDate && matchesStart && matchesEnd && matchesAvailability;
  });
}

function studyCard(study) {
  const percentage = Math.round((study.currentMembers / study.capacity) * 100);
  return `
    <article class="study-card">
      <div class="card-top">
        <span class="subject-badge">${escapeHtml(study.subject)}</span>
        <span class="status-badge">모집 중</span>
      </div>
      <div class="study-summary">
        <h3>${escapeHtml(study.title)}</h3>
        <p class="study-goal">${escapeHtml(study.goal)}</p>
      </div>
      <div class="study-meta">
        <div class="meta-item"><span class="meta-icon" aria-hidden="true">◷</span><span>${formatDate(study.date)} · ${study.startTime}–${study.endTime}</span></div>
        <div class="meta-item"><span class="meta-icon" aria-hidden="true">⌖</span><span>${escapeHtml(formatStudyLocation(study))}</span></div>
      </div>
      <div class="card-footer">
        <div class="capacity-info">
          <div class="capacity-label"><span>확정 인원</span><strong>${study.currentMembers} / ${study.capacity}명</strong></div>
          <div class="capacity-track" aria-label="정원 ${percentage}% 충원"><span style="width:${percentage}%"></span></div>
        </div>
        <button class="button button-secondary detail-button" type="button" data-study-id="${study.id}">상세 보기</button>
      </div>
    </article>
  `;
}

function renderFilterChips(filters) {
  const chips = [];
  if (filters.title) chips.push(`스터디명: ${elements.title.value.trim()}`);
  if (filters.subject) chips.push(filters.subject);
  if (filters.date) chips.push(formatDate(filters.date));
  if (filters.start || filters.end) chips.push(`${filters.start || "00:00"}–${filters.end || "24:00"}`);
  if (filters.useAvailability) chips.push("저장된 가용시간");

  elements.activeFilters.innerHTML = chips
    .map((chip) => `<span class="filter-chip">${escapeHtml(chip)}</span>`)
    .join("");
}

function renderStudies(filteredStudies, filters = readFilters()) {
  elements.grid.innerHTML = filteredStudies.map(studyCard).join("");
  elements.resultCount.textContent = filteredStudies.length;
  elements.heroCount.textContent = studies.length;
  elements.grid.hidden = filteredStudies.length === 0;
  elements.emptyState.hidden = filteredStudies.length !== 0;
  renderFilterChips(filters);
}

function setViewMode(mode, save = true) {
  const isList = mode === "list";
  elements.grid.classList.toggle("list-view", isList);
  elements.gridViewButton.classList.toggle("is-active", !isList);
  elements.listViewButton.classList.toggle("is-active", isList);
  elements.gridViewButton.setAttribute("aria-pressed", String(!isList));
  elements.listViewButton.setAttribute("aria-pressed", String(isList));

  if (save) {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, isList ? "list" : "grid");
    } catch {
      // 브라우저가 로컬 저장소를 제한해도 보기 전환 기능은 유지합니다.
    }
  }
}

function getSavedViewMode() {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

function runSearch() {
  const filters = readFilters();

  if (filters.start && filters.end && toMinutes(filters.start) > toMinutes(filters.end)) {
    showToast("종료 가능 시간은 시작 가능 시간보다 늦어야 합니다.");
    elements.end.focus();
    return;
  }

  renderStudies(filterStudies(filters), filters);
}

function resetFilters() {
  elements.form.reset();
}

function openStudyDialog(studyId) {
  const study = studies.find((item) => item.id === Number(studyId));
  if (!study) return;

  elements.dialogBody.innerHTML = `
    <span class="subject-badge">${escapeHtml(study.subject)}</span>
    <h2>${escapeHtml(study.title)}</h2>
    <p class="dialog-goal">${escapeHtml(study.goal)}</p>
    <dl class="dialog-detail-list">
      <div><dt>일정</dt><dd>${formatDate(study.date)} ${study.startTime}–${study.endTime}</dd></div>
      <div><dt>장소</dt><dd>${escapeHtml(formatStudyLocation(study))}</dd></div>
      <div><dt>모집 현황</dt><dd>${study.currentMembers} / ${study.capacity}명</dd></div>
      <div><dt>참여 조건</dt><dd>${escapeHtml(study.condition)}</dd></div>
      <div><dt>그룹장</dt><dd>${escapeHtml(study.leader)}</dd></div>
    </dl>
    <div class="dialog-actions">
      <button class="button button-secondary" type="button" data-close-dialog>닫기</button>
      <button class="button button-primary" type="button" data-apply-study="${study.id}">참여 신청</button>
    </div>
  `;
  elements.dialog.showModal();
}

let toastTimer;
function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 2600);
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch();
});

elements.form.addEventListener("reset", () => {
  window.setTimeout(() => renderStudies(studies, readFilters()), 0);
});

elements.emptyReset.addEventListener("click", resetFilters);
elements.availability.addEventListener("change", runSearch);

elements.grid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-study-id]");
  if (button) {
    window.location.href = `./group-detail.html?id=${encodeURIComponent(button.dataset.studyId)}`;
  }
});

elements.dialog.addEventListener("click", (event) => {
  if (event.target === elements.dialog || event.target.closest("[data-close-dialog]")) {
    elements.dialog.close();
  }

  const applyButton = event.target.closest("[data-apply-study]");
  if (applyButton) {
    elements.dialog.close();
    showToast("참여 신청 화면은 다음 단계에서 연결합니다.");
  }
});

elements.dialogClose.addEventListener("click", () => elements.dialog.close());
elements.gridViewButton.addEventListener("click", () => setViewMode("grid"));
elements.listViewButton.addEventListener("click", () => setViewMode("list"));
window.addEventListener("storage", (event) => {
  if (event.key !== TIMETABLE_STORAGE_KEY) return;
  refreshAvailabilityControl();
  runSearch();
});

populateSubjects();
refreshAvailabilityControl();
setViewMode(getSavedViewMode(), false);
renderStudies(studies);

const pageParameters = new URLSearchParams(window.location.search);
if (pageParameters.get("created") === "1") {
  showToast("스터디를 개설하고 탐색 목록에 추가했습니다.");
  window.history.replaceState({}, "", window.location.pathname);
}
