const applications = [
  { id: 1, nickname: "쿼리러버", subject: "데이터베이스", message: "JOIN과 서브쿼리를 복습하고 싶습니다. 매주 성실하게 참여하겠습니다.", date: "10월 16일", status: "waiting" },
  { id: 2, nickname: "SQL초보", subject: "컴퓨터공학", message: "기본 SQL 문법은 학습했습니다. 함께 문제를 풀며 실력을 높이고 싶어요.", date: "10월 16일", status: "waiting" },
];

const members = [
  { nickname: "학습메이트", subject: "데이터베이스", leader: true },
  { nickname: "정규화마스터", subject: "소프트웨어학과", leader: false },
];

let activeFilter = "all";
const capacity = 4;
let manuallyClosed = false;
const applicationList = document.querySelector("#application-list");
const memberList = document.querySelector("#member-list");
const emptyApplications = document.querySelector("#empty-applications");
const toast = document.querySelector("#manage-toast");
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

function renderApplications() {
  const isFull = members.length >= capacity;
  const visible = applications.filter((application) => activeFilter === "all" || application.status === activeFilter);
  applicationList.innerHTML = visible.map((application) => {
    const action = application.status === "waiting"
      ? `<div class="decision-actions"><button class="decision-button reject" type="button" data-decision="rejected" data-id="${application.id}">거절</button><button class="decision-button approve" type="button" data-decision="approved" data-id="${application.id}" ${isFull || manuallyClosed ? "disabled" : ""}>${isFull ? "정원 마감" : manuallyClosed ? "모집 마감" : "승인"}</button></div>`
      : `<span class="status-result ${application.status}">${application.status === "approved" ? "승인 완료" : "거절 완료"}</span>`;
    return `<tr>
      <td><div class="applicant"><span class="applicant-avatar">${escapeHtml(application.nickname[0])}</span><div><strong>${escapeHtml(application.nickname)}</strong><small>${escapeHtml(application.subject)}</small></div></div></td>
      <td class="application-message"><strong>신청 메시지</strong><p>${escapeHtml(application.message)}</p></td>
      <td class="application-date">${escapeHtml(application.date)}</td>
      <td>${action}</td>
    </tr>`;
  }).join("");
  emptyApplications.hidden = visible.length > 0;
  document.querySelector("#waiting-count").textContent = applications.filter((item) => item.status === "waiting").length;
}

function renderMembers() {
  memberList.innerHTML = members.map((member) => `<article class="member-item">
    <span class="member-avatar">${escapeHtml(member.nickname[0])}</span>
    <div><strong>${escapeHtml(member.nickname)}</strong><small>${escapeHtml(member.subject)}</small></div>
    ${member.leader ? '<span class="leader-badge">그룹장</span>' : ""}
  </article>`).join("");
  document.querySelector("#member-count").textContent = members.length;
  document.querySelector("#capacity-count").textContent = members.length;
  updateRecruitmentStatus();
}

function updateRecruitmentStatus() {
  const isFull = members.length >= capacity;
  const status = document.querySelector("#recruitment-status");
  const closeButton = document.querySelector("#close-recruitment");
  status.textContent = isFull ? "정원 마감" : manuallyClosed ? "모집 마감" : "모집 중";
  closeButton.disabled = isFull || manuallyClosed;
  closeButton.textContent = isFull ? "정원 충족 · 자동 마감" : manuallyClosed ? "모집 마감됨" : "모집 수동 마감";
}

applicationList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-decision]");
  if (!button) return;
  const application = applications.find((item) => item.id === Number(button.dataset.id));
  if (!application || application.status !== "waiting") return;
  application.status = button.dataset.decision;
  if (application.status === "approved" && members.length < capacity && !manuallyClosed) {
    members.push({ nickname: application.nickname, subject: application.subject, leader: false });
    showToast(
      members.length >= capacity
        ? `${application.nickname}님의 신청을 승인했습니다. 정원이 충족되어 모집이 자동 마감되었습니다.`
        : `${application.nickname}님의 신청을 승인했습니다.`,
    );
  } else if (application.status === "approved") {
    application.status = "waiting";
    showToast(manuallyClosed ? "마감된 스터디에서는 신청을 승인할 수 없습니다." : "정원이 가득 차 더 이상 승인할 수 없습니다.");
  } else {
    showToast(`${application.nickname}님의 신청을 거절했습니다.`);
  }
  renderApplications();
  renderMembers();
});

document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((item) => item.classList.toggle("is-active", item === button));
    renderApplications();
  });
});

document.querySelector("#close-recruitment").addEventListener("click", (event) => {
  manuallyClosed = true;
  updateRecruitmentStatus();
  renderApplications();
  showToast("스터디 모집을 마감했습니다.");
});

renderApplications();
renderMembers();
