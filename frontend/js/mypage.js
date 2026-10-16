const studyData = {
  joined: [
    { title: "데이터베이스 중간고사 복습", meta: "10월 21일 · 14:00–16:00", status: "참여 확정" },
    { title: "알고리즘 코딩테스트 준비", meta: "10월 23일 · 18:00–20:00", status: "참여 확정" },
  ],
  created: [
    { title: "웹 개발 프로젝트 코드 리뷰", meta: "10월 25일 · 신청자 2명", status: "모집 중" },
  ],
  applied: [
    { title: "운영체제 동기화 개념 정리", meta: "10월 24일 · 10:00–12:30", status: "승인 대기" },
  ],
};

let availability = [
  { day: "월요일", start: "13:00", end: "18:00" },
  { day: "수요일", start: "10:00", end: "16:00" },
  { day: "금요일", start: "14:00", end: "19:00" },
];

const studyList = document.querySelector("#study-list");
const availabilityList = document.querySelector("#availability-list");
const toast = document.querySelector("#mypage-toast");
let toastTimer;

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2400);
}

function renderStudies(type = "joined") {
  studyList.innerHTML = studyData[type].map((study) => `
    <article class="mini-study">
      <h3>${escapeHtml(study.title)}</h3>
      <p>${escapeHtml(study.meta)}</p>
      <span class="status-chip">${escapeHtml(study.status)}</span>
    </article>
  `).join("");
}

function renderAvailability() {
  availabilityList.innerHTML = availability.map((item, index) => `
    <div class="availability-row">
      <strong>${escapeHtml(item.day)}</strong>
      <span>${escapeHtml(item.start)} – ${escapeHtml(item.end)}</span>
      <button class="remove-time" type="button" data-remove-time="${index}" aria-label="${escapeHtml(item.day)} 가용시간 삭제">×</button>
    </div>
  `).join("");
}

document.querySelectorAll("[data-study-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-study-tab]").forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    renderStudies(button.dataset.studyTab);
  });
});

document.querySelector("#profile-form").addEventListener("submit", (event) => {
  event.preventDefault();
  showToast("프로필이 저장되었습니다.");
});

document.querySelector("#add-availability").addEventListener("click", () => {
  const day = document.querySelector("#availability-day").value;
  const start = document.querySelector("#availability-start").value;
  const end = document.querySelector("#availability-end").value;
  if (!start || !end || start >= end) {
    showToast("종료 시간은 시작 시간보다 늦어야 합니다.");
    return;
  }
  availability.push({ day, start, end });
  renderAvailability();
});

availabilityList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-time]");
  if (!button) return;
  availability.splice(Number(button.dataset.removeTime), 1);
  renderAvailability();
});

document.querySelector("#save-availability").addEventListener("click", () => showToast("가용시간이 저장되었습니다."));
document.querySelector("#password-button").addEventListener("click", () => showToast("비밀번호 변경 기능은 계정 API 연결 후 제공됩니다."));

renderStudies();
renderAvailability();
