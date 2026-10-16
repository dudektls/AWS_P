const STUDY_LOCATION = { latitude: 37.5665, longitude: 126.978, name: "서울 중구 중앙도서관 스터디룸" };
const mapElement = document.querySelector("#detail-map");
const mapStatus = document.querySelector("#map-status");
const toast = document.querySelector("#detail-toast");
let toastTimer;

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2400);
}

function initializeMap() {
  const position = new kakao.maps.LatLng(STUDY_LOCATION.latitude, STUDY_LOCATION.longitude);
  mapElement.replaceChildren();
  const map = new kakao.maps.Map(mapElement, { center: position, level: 3 });
  const marker = new kakao.maps.Marker({ position, map });
  const infoWindow = new kakao.maps.InfoWindow({ content: `<div style="padding:8px 12px;font-size:12px;white-space:nowrap">${STUDY_LOCATION.name}</div>` });
  infoWindow.open(map, marker);
  mapStatus.textContent = "지도에서 모임 위치를 확인할 수 있습니다.";
}

async function loadKakaoMap() {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error("config");
    const config = await response.json();
    const appKey = String(config.kakaoMapJavaScriptKey || "").trim();
    if (!appKey) throw new Error("key");
    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false`;
    script.addEventListener("load", () => kakao.maps.load(initializeMap));
    script.addEventListener("error", showMapFallback);
    document.head.append(script);
  } catch {
    showMapFallback();
  }
}

function showMapFallback() {
  mapElement.innerHTML = `<p><strong>${STUDY_LOCATION.name}</strong><br />카카오맵 API 설정 후 상세 위치가 표시됩니다.</p>`;
  mapStatus.textContent = "위의 주소와 큰 지도 보기 버튼으로 장소를 확인할 수 있습니다.";
}

document.querySelector("#share-button").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(window.location.href);
    showToast("스터디 링크를 복사했습니다.");
  } catch {
    showToast("주소창의 링크를 복사해 주세요.");
  }
});

loadKakaoMap();
