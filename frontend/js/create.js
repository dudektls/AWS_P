const CREATED_STUDIES_KEY = "study-recruit.created-studies.v1";
const DEFAULT_MAP_CENTER = { latitude: 37.5665, longitude: 126.978 };

const form = document.querySelector("#create-study-form");
const message = document.querySelector("#create-form-message");
const mapElement = document.querySelector("#study-map");
const mapStatus = document.querySelector("#map-status");
const searchInput = document.querySelector("#map-search-query");
const searchButton = document.querySelector("#map-search-button");
const searchResults = document.querySelector("#map-search-results");
const exampleButtons = [...document.querySelectorAll("[data-example-target]")];
const fields = Object.fromEntries(
  [...form.elements]
    .filter((element) => element.name)
    .map((element) => [element.name, element]),
);

let map;
let marker;
let placeService;
let geocoder;
let addressSearchTimer;
let addressSearchRequestId = 0;
let lastGeocodedAddress = "";

function readStudies() {
  try {
    const value = JSON.parse(localStorage.getItem(CREATED_STUDIES_KEY));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function fullAddress() {
  const placeName = fields.placeName.value.trim();
  const address = fields.address.value.trim();
  const detailAddress = fields.detailAddress.value.trim();
  const primaryLocation = placeName && address ? `${placeName}(${address})` : placeName || address;
  return [primaryLocation, detailAddress].filter(Boolean).join(", ");
}

function resolveExample(button) {
  const subject = fields.subject.value.trim() || "선택한 과목";
  return button.dataset.exampleTemplate.replaceAll("{subject}", subject);
}

function updateExampleButtons() {
  for (const button of exampleButtons) {
    const target = document.querySelector(`#${button.dataset.exampleTarget}`);
    const example = resolveExample(button);
    button.textContent = example;
    button.title = `선택하면 입력됩니다: ${example}`;
    button.setAttribute("aria-pressed", String(target.value.trim() === example));
  }
}

function applyExample(button) {
  const target = document.querySelector(`#${button.dataset.exampleTarget}`);
  target.value = resolveExample(button);
  target.dispatchEvent(new Event("input", { bubbles: true }));
  target.focus();
}

function validate() {
  for (const field of Object.values(fields)) field.removeAttribute("aria-invalid");
  if (!form.checkValidity()) {
    const invalid = form.querySelector(":invalid");
    invalid?.setAttribute("aria-invalid", "true");
    invalid?.focus();
    return "필수 항목을 모두 올바르게 입력해 주세요.";
  }
  if (fields.startTime.value >= fields.endTime.value) {
    fields.startTime.setAttribute("aria-invalid", "true");
    fields.endTime.setAttribute("aria-invalid", "true");
    fields.endTime.focus();
    return "종료 시간은 시작 시간보다 늦어야 합니다.";
  }
  return "";
}

function updatePreview() {
  document.querySelector("#preview-title").textContent = fields.title.value.trim() || "스터디 정보를 입력해 주세요";
  document.querySelector("#preview-goal").textContent = fields.goal.value.trim() || "입력한 내용이 탐색 카드에 어떻게 표시되는지 확인할 수 있습니다.";
  document.querySelector("#preview-subject").textContent = fields.subject.value.trim() || "입력 전";
  document.querySelector("#preview-location").textContent = fullAddress() || "입력 전";
  document.querySelector("#preview-capacity").textContent = `${fields.capacity.value || 4}명`;
  const schedule = [fields.date.value, fields.startTime.value && fields.endTime.value ? `${fields.startTime.value}–${fields.endTime.value}` : ""].filter(Boolean).join(" · ");
  document.querySelector("#preview-schedule").textContent = schedule || "입력 전";
}

function setMapStatus(text, isError = false) {
  mapStatus.textContent = text;
  mapStatus.classList.toggle("is-error", isError);
}

function setSelectedLocation({ latitude, longitude, address, placeName, focusDetail = true }) {
  const position = new kakao.maps.LatLng(latitude, longitude);
  marker.setPosition(position);
  marker.setMap(map);
  map.setCenter(position);
  map.setLevel(3);
  fields.address.value = address;
  if (placeName !== undefined) fields.placeName.value = placeName;
  fields.latitude.value = latitude;
  fields.longitude.value = longitude;
  searchResults.hidden = true;
  setMapStatus("주소가 자동 입력되었습니다. 필요한 경우 주소와 상세주소를 수정해 주세요.");
  updatePreview();
  if (focusDetail) fields.detailAddress.focus();
}

function clearSelectedCoordinates() {
  fields.latitude.value = "";
  fields.longitude.value = "";
}

function locateAddressOnMap() {
  clearTimeout(addressSearchTimer);
  const address = fields.address.value.trim();
  if (!address || !geocoder) return;
  if (address === lastGeocodedAddress && fields.latitude.value && fields.longitude.value) return;

  const requestId = ++addressSearchRequestId;
  setMapStatus("입력한 주소를 지도에서 찾고 있습니다.");
  geocoder.addressSearch(address, (result, status) => {
    if (requestId !== addressSearchRequestId) return;
    if (status !== kakao.maps.services.Status.OK || !result[0]) {
      marker.setMap(null);
      clearSelectedCoordinates();
      setMapStatus("주소를 찾지 못했습니다. 정확한 도로명 또는 지번 주소를 입력해 주세요.", true);
      return;
    }
    setSelectedLocation({
      latitude: Number(result[0].y),
      longitude: Number(result[0].x),
      address,
      focusDetail: false,
    });
    lastGeocodedAddress = address;
    setMapStatus("입력한 주소의 위치를 지도에 표시했습니다.");
  }, { size: 1 });
}

function scheduleAddressSearch() {
  lastGeocodedAddress = "";
  clearSelectedCoordinates();
  addressSearchRequestId += 1;
  clearTimeout(addressSearchTimer);
  if (!fields.address.value.trim()) {
    marker?.setMap(null);
    return;
  }
  if (!geocoder) return;
  addressSearchTimer = setTimeout(locateAddressOnMap, 700);
}

function selectSearchResult(place) {
  setSelectedLocation({
    latitude: Number(place.y),
    longitude: Number(place.x),
    address: place.road_address_name || place.address_name,
    placeName: place.place_name,
  });
}

function showSearchResults(places) {
  searchResults.replaceChildren();
  for (const place of places) {
    const button = document.createElement("button");
    const title = document.createElement("strong");
    const address = document.createElement("span");
    button.className = "map-result";
    button.type = "button";
    title.textContent = place.place_name;
    address.textContent = place.road_address_name || place.address_name;
    button.append(title, address);
    button.addEventListener("click", () => selectSearchResult(place));
    searchResults.append(button);
  }
  searchResults.hidden = false;
}

function searchPlaces() {
  const keyword = searchInput.value.trim();
  if (!placeService) {
    setMapStatus("지도 API가 준비되지 않아 검색할 수 없습니다. 아래 주소 칸에 직접 입력해 주세요.", true);
    return;
  }
  if (!keyword) {
    searchInput.focus();
    setMapStatus("검색할 장소명이나 주소를 입력해 주세요.", true);
    return;
  }

  setMapStatus("장소를 검색하고 있습니다.");
  placeService.keywordSearch(keyword, (places, status) => {
    if (status === kakao.maps.services.Status.OK) {
      showSearchResults(places);
      setMapStatus(`${places.length}개의 검색 결과가 있습니다. 장소를 선택해 주세요.`);
      return;
    }
    searchResults.hidden = true;
    setMapStatus(
      status === kakao.maps.services.Status.ZERO_RESULT
        ? "검색 결과가 없습니다. 다른 검색어를 입력해 주세요."
        : "장소 검색 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
      true,
    );
  }, { size: 8 });
}

function selectMapPoint(mouseEvent) {
  const position = mouseEvent.latLng;
  marker.setPosition(position);
  marker.setMap(map);
  geocoder.coord2Address(position.getLng(), position.getLat(), (result, status) => {
    if (status !== kakao.maps.services.Status.OK || !result[0]) {
      setMapStatus("이 위치의 주소를 찾지 못했습니다. 아래 주소 칸에 직접 입력해 주세요.", true);
      return;
    }
    const address = result[0].road_address?.address_name || result[0].address?.address_name;
    setSelectedLocation({
      latitude: position.getLat(),
      longitude: position.getLng(),
      address,
      placeName: "",
      focusDetail: false,
    });
    setMapStatus("주소가 자동 입력되었습니다. 장소명이나 건물명을 입력해 주세요.");
    fields.placeName.focus();
  });
}

function initializeMap() {
  const center = new kakao.maps.LatLng(DEFAULT_MAP_CENTER.latitude, DEFAULT_MAP_CENTER.longitude);
  mapElement.replaceChildren();
  map = new kakao.maps.Map(mapElement, { center, level: 4 });
  marker = new kakao.maps.Marker();
  placeService = new kakao.maps.services.Places();
  geocoder = new kakao.maps.services.Geocoder();
  kakao.maps.event.addListener(map, "click", selectMapPoint);
  setMapStatus("장소를 검색하거나 지도에서 모임 위치를 클릭해 주세요.");
}

async function loadKakaoMap() {
  let appKey = "";
  try {
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error("설정을 불러오지 못했습니다.");
    const runtimeConfig = await response.json();
    appKey = String(runtimeConfig.kakaoMapJavaScriptKey || "").trim();
  } catch {
    mapElement.innerHTML = "<p>서버 설정을 불러오지 못했습니다.<br />서버를 실행한 뒤 다시 접속해 주세요.</p>";
    searchButton.disabled = true;
    setMapStatus("지도 설정을 불러오지 못했습니다. 주소를 직접 입력해 주세요.", true);
    return;
  }

  if (!appKey) {
    mapElement.innerHTML = "<p>서버의 KAKAO_MAP_JAVASCRIPT_KEY 환경변수를 설정하면<br />장소 검색과 지도 클릭을 사용할 수 있습니다.</p>";
    searchButton.disabled = true;
    setMapStatus("지도 API 키가 설정되지 않았습니다. 주소를 직접 입력해 주세요.", true);
    return;
  }

  const script = document.createElement("script");
  script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false&libraries=services`;
  script.addEventListener("load", () => kakao.maps.load(initializeMap));
  script.addEventListener("error", () => {
    mapElement.innerHTML = "<p>지도를 불러오지 못했습니다. 네트워크와 카카오맵 도메인 설정을 확인해 주세요.<br />아래 주소 칸은 직접 입력할 수 있습니다.</p>";
    searchButton.disabled = true;
    setMapStatus("지도 API를 불러오지 못했습니다. 주소를 직접 입력해 주세요.", true);
  });
  document.head.append(script);
}

searchButton.addEventListener("click", searchPlaces);
for (const button of exampleButtons) {
  button.addEventListener("click", () => applyExample(button));
}
searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    searchPlaces();
  }
});
fields.address.addEventListener("input", scheduleAddressSearch);
fields.address.addEventListener("change", locateAddressOnMap);
fields.address.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    locateAddressOnMap();
  }
});
form.addEventListener("input", (event) => {
  if (event.target === fields.subject) {
    const selectedButtons = exampleButtons.filter((button) => button.getAttribute("aria-pressed") === "true");
    for (const button of selectedButtons) {
      document.querySelector(`#${button.dataset.exampleTarget}`).value = resolveExample(button);
    }
  }
  updatePreview();
  updateExampleButtons();
});
form.addEventListener("submit", (event) => {
  event.preventDefault();
  const error = validate();
  if (error) {
    message.textContent = error;
    return;
  }
  const latitude = Number(fields.latitude.value);
  const longitude = Number(fields.longitude.value);
  const study = {
    id: Date.now(),
    title: fields.title.value.trim(),
    subject: fields.subject.value.trim(),
    goal: fields.goal.value.trim(),
    date: fields.date.value,
    startTime: fields.startTime.value,
    endTime: fields.endTime.value,
    location: fullAddress(),
    address: fields.address.value.trim(),
    detailAddress: fields.detailAddress.value.trim(),
    placeName: fields.placeName.value.trim(),
    latitude: Number.isFinite(latitude) && fields.latitude.value ? latitude : null,
    longitude: Number.isFinite(longitude) && fields.longitude.value ? longitude : null,
    currentMembers: 1,
    capacity: Number(fields.capacity.value),
    leader: "나",
    condition: fields.condition.value.trim(),
  };
  localStorage.setItem(CREATED_STUDIES_KEY, JSON.stringify([...readStudies(), study]));
  window.location.href = "./find-group.html?created=1";
});

updatePreview();
updateExampleButtons();
loadKakaoMap();
