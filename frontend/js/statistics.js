// 추후 API 응답으로 교체할 수 있도록 모든 통계 값을 한곳에서 관리합니다.
const statistics = {
  // [수정 위치 1] 상단 통계 카드: label은 항목명, value는 수치, unit은 단위입니다.
  // 카드를 추가하거나 삭제하려면 아래 배열의 항목을 추가하거나 삭제하세요.
  metrics: [
    { label: "현재 모집 그룹", value: 32, unit: "개" },
    { label: "모집 중인 과목", value: 5, unit: "개" },
    { label: "오늘 개설된 그룹", value: 14, unit: "개" },
  ],

  // [수정 위치 2] 과목별 막대그래프: label은 과목명, value는 모집 중인 그룹 수입니다.
  // 과목을 변경하거나 추가하려면 아래 배열을 수정하세요.
  subjects: [
    { label: "데이터베이스", value: 8 },
    { label: "운영체제", value: 7 },
    { label: "알고리즘", value: 6 },
    { label: "웹 개발", value: 5 },
    { label: "컴퓨터네트워크", value: 6 },
  ],

  // [수정 위치 3] 요일별 막대그래프: label은 요일, value는 모집 중인 그룹 수입니다.
  // 주말을 표시하려면 같은 형식으로 토·일 항목을 추가하세요.
  weekdays: [
    { label: "월", value: 5 },
    { label: "화", value: 6 },
    { label: "수", value: 9 },
    { label: "목", value: 7 },
    { label: "금", value: 5 },
  ],
};

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function renderMetrics() {
  document.querySelector("#metric-grid").innerHTML = statistics.metrics.map((metric) => `
    <article class="metric-card">
      <span>${escapeHtml(metric.label)}</span>
      <strong>${metric.value}</strong><small>${escapeHtml(metric.unit)}</small>
    </article>
  `).join("");
}

function renderChart(elementId, data) {
  const chart = document.querySelector(`#${elementId}`);
  const maxValue = Math.max(...data.map((item) => item.value), 1);
  chart.style.setProperty("--bar-count", data.length);
  chart.innerHTML = data.map((item) => {
    const height = Math.max((item.value / maxValue) * 78, 5);
    return `<div class="bar-item">
      <span class="bar-value">${item.value}</span>
      <span class="bar" style="height:${height}%" title="${escapeHtml(item.label)} ${item.value}개"></span>
      <span class="bar-label">${escapeHtml(item.label)}</span>
    </div>`;
  }).join("");
}

renderMetrics();
renderChart("subject-chart", statistics.subjects);
renderChart("weekday-chart", statistics.weekdays);
