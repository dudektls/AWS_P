const elements = {
  fileInput: document.querySelector("#audioFile"),
  dropZone: document.querySelector("#dropZone"),
  uploadHint: document.querySelector("#uploadHint"),
  fileCard: document.querySelector("#fileCard"),
  fileName: document.querySelector("#fileName"),
  fileMeta: document.querySelector("#fileMeta"),
  removeFile: document.querySelector("#removeFile"),
  audioPreview: document.querySelector("#audioPreview"),
  statusBox: document.querySelector("#statusBox"),
  statusText: document.querySelector("#statusText"),
  progressPanel: document.querySelector("#progressPanel"),
  progressLabel: document.querySelector("#progressLabel"),
  progressDetail: document.querySelector("#progressDetail"),
  progressBar: document.querySelector("#progressBar"),
  submitButton: document.querySelector("#submitButton"),
  copyTranscriptButton: document.querySelector("#copyTranscriptButton"),
  copySummaryButton: document.querySelector("#copySummaryButton"),
  transcript: document.querySelector("#transcript"),
  summary: document.querySelector("#summary"),
  expandButtons: document.querySelectorAll(".expand-button"),
  expandedDialog: document.querySelector("#expandedDialog"),
  expandedDialogTitle: document.querySelector("#expandedDialogTitle"),
  expandedText: document.querySelector("#expandedText"),
  closeExpandedDialog: document.querySelector("#closeExpandedDialog"),
};

const state = {
  file: null,
  previewUrl: null,
  isSubmitting: false,
  expandedSource: null,
  config: {
    maxUploadMb: 500,
    maxAudioDurationMinutes: 120,
    supportedExtensions: ["mp3", "wav", "m4a"],
  },
};

function setStatus(message, tone = "neutral") {
  elements.statusText.textContent = message;
  elements.statusBox.dataset.tone = tone;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)) - 1,
    units.length - 1,
  );
  const value = bytes / 1024 ** (unitIndex + 1);
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function extensionOf(fileName) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function resetResults() {
  if (elements.expandedDialog.open) elements.expandedDialog.close();
  elements.transcript.value = "";
  elements.summary.value = "";
  elements.copyTranscriptButton.disabled = true;
  elements.copySummaryButton.disabled = true;
}

function resetProgress() {
  elements.progressPanel.hidden = true;
  elements.progressBar.value = 0;
  elements.progressBar.setAttribute("value", "0");
  elements.progressLabel.textContent = "";
  elements.progressDetail.textContent = "";
}

function showProgress(label, detail = "", percentage = null) {
  elements.progressPanel.hidden = false;
  elements.progressLabel.textContent = label;
  elements.progressDetail.textContent = detail;
  if (percentage === null) {
    elements.progressBar.removeAttribute("value");
  } else {
    elements.progressBar.value = Math.max(0, Math.min(100, percentage));
  }
}

function formatRemaining(milliseconds) {
  const totalSeconds = Math.max(1, Math.ceil(milliseconds / 1000));
  if (totalSeconds < 60) return `약 ${totalSeconds}초 남음`;
  const minutes = Math.ceil(totalSeconds / 60);
  return `약 ${minutes}분 남음`;
}

function clearFile() {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.file = null;
  state.previewUrl = null;
  elements.fileInput.value = "";
  elements.fileCard.hidden = true;
  elements.audioPreview.hidden = true;
  elements.audioPreview.removeAttribute("src");
  elements.audioPreview.load();
  elements.submitButton.disabled = true;
  resetResults();
  resetProgress();
  setStatus("파일을 선택해 주세요.");
}

function rejectFile(message) {
  clearFile();
  setStatus(message, "error");
}

function selectFile(file) {
  resetResults();
  resetProgress();

  const extension = extensionOf(file.name);
  if (!state.config.supportedExtensions.includes(extension)) {
    rejectFile("MP3, WAV, M4A 형식의 녹음 파일만 선택할 수 있습니다.");
    return;
  }
  if (file.size === 0) {
    rejectFile("빈 파일은 업로드할 수 없습니다.");
    return;
  }
  if (file.size > state.config.maxUploadMb * 1024 * 1024) {
    rejectFile(`파일 용량은 최대 ${state.config.maxUploadMb}MB입니다.`);
    return;
  }

  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.file = file;
  state.previewUrl = URL.createObjectURL(file);
  elements.fileName.textContent = file.name;
  elements.fileMeta.textContent = `${extension.toUpperCase()} · ${formatBytes(file.size)}`;
  elements.fileCard.hidden = false;
  elements.audioPreview.src = state.previewUrl;
  elements.audioPreview.hidden = false;
  elements.submitButton.disabled = false;
  setStatus("업로드 준비가 완료되었습니다.", "success");
}

function submitTranscription() {
  if (!state.file || state.isSubmitting) return;

  state.isSubmitting = true;
  elements.submitButton.disabled = true;
  elements.fileInput.disabled = true;
  elements.removeFile.disabled = true;
  resetResults();
  setStatus("파일을 서버에 업로드하는 중입니다.", "working");
  showProgress("파일 업로드 중", "0%", 0);

  const formData = new FormData();
  formData.append("audio", state.file);
  const request = new XMLHttpRequest();
  let parsedLength = 0;
  let pendingLine = "";
  let transcriptionStartedAt = null;
  let receivedResult = false;

  function finishRequest() {
    state.isSubmitting = false;
    elements.fileInput.disabled = false;
    elements.removeFile.disabled = false;
    elements.submitButton.disabled = !state.file;
  }

  function handleEvent(event) {
    if (event.type === "error") {
      throw new Error(event.error?.message ?? "변환 요청에 실패했습니다.");
    }
    if (event.type === "result") {
      receivedResult = true;
      elements.transcript.value = event.transcript;
      elements.summary.value = event.summary;
      elements.copyTranscriptButton.disabled = false;
      elements.copySummaryButton.disabled = false;
      showProgress("처리 완료", "100%", 100);
      const chunkMessage =
        event.chunkCount > 1
          ? ` ${event.chunkCount}개 구간을 이어 붙였습니다.`
          : "";
      setStatus(
        `스크립트 변환과 요약이 완료되었습니다.${chunkMessage}`,
        "success",
      );
      return;
    }
    if (event.type !== "progress") return;

    if (event.phase === "preparing") {
      showProgress("오디오 정보 확인 중");
      setStatus("오디오 길이와 형식을 확인하는 중입니다.", "working");
    } else if (event.phase === "splitting") {
      showProgress("긴 녹음 분할 중", "완료 시간을 계산 중입니다.");
      setStatus("긴 녹음을 전사 가능한 구간으로 나누는 중입니다.", "working");
    } else if (event.phase === "transcribing") {
      if (transcriptionStartedAt === null) transcriptionStartedAt = Date.now();
      const completed = event.completedChunks;
      const total = event.totalChunks;
      const percentage = total > 0 ? (completed / total) * 100 : null;
      let remaining = "첫 구간 처리 후 남은 시간을 계산합니다.";
      if (completed > 0 && completed < total) {
        const average = (Date.now() - transcriptionStartedAt) / completed;
        remaining = `${formatRemaining(average * (total - completed))} · 요약 시간 제외`;
      } else if (completed === total && total > 0) {
        remaining = "전사 완료 · 요약 준비 중";
      }
      showProgress(
        `음성 전사 ${completed}/${total} 구간`,
        remaining,
        percentage,
      );
      setStatus("AI가 음성을 구간별로 전사하는 중입니다.", "working");
    } else if (event.phase === "summarizing") {
      showProgress("요약문 생성 중", "남은 시간은 모델 응답 속도에 따라 달라집니다.");
      setStatus("전체 스크립트를 바탕으로 요약문을 만드는 중입니다.", "working");
    }
  }

  function parseStreamingResponse(final = false) {
    const newText = request.responseText.slice(parsedLength);
    parsedLength = request.responseText.length;
    pendingLine += newText;
    const lines = pendingLine.split("\n");
    pendingLine = final ? "" : (lines.pop() ?? "");
    if (final && pendingLine) lines.push(pendingLine);

    for (const line of lines) {
      if (!line.trim()) continue;
      handleEvent(JSON.parse(line));
    }
  }

  request.open("POST", "/api/transcriptions");
  request.setRequestHeader("Accept", "application/x-ndjson");
  request.upload.addEventListener("progress", (event) => {
    if (!event.lengthComputable) {
      showProgress("파일 업로드 중", "전송 용량을 계산 중입니다.");
      return;
    }
    const percentage = (event.loaded / event.total) * 100;
    showProgress("파일 업로드 중", `${Math.round(percentage)}%`, percentage);
  });
  request.addEventListener("progress", () => {
    try {
      parseStreamingResponse();
    } catch (error) {
      request.abort();
      setStatus(error.message, "error");
      resetProgress();
      finishRequest();
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
          throw new Error(body.error?.message ?? "변환 요청에 실패했습니다.");
        }
      }
      if (!receivedResult) throw new Error("서버에서 최종 결과를 받지 못했습니다.");
    } catch (error) {
      setStatus(error.message || "변환에 실패했습니다.", "error");
      resetProgress();
    } finally {
      finishRequest();
    }
  });
  request.addEventListener("error", () => {
    setStatus("서버와 통신하지 못했습니다. 네트워크 상태를 확인해 주세요.", "error");
    resetProgress();
    finishRequest();
  });
  request.send(formData);
}

elements.fileInput.addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) selectFile(file);
});

for (const eventName of ["dragenter", "dragover"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (!state.isSubmitting) elements.dropZone.classList.add("is-dragging");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("is-dragging");
  });
}

elements.dropZone.addEventListener("drop", (event) => {
  if (state.isSubmitting) return;
  const [file] = event.dataTransfer.files;
  if (file) selectFile(file);
});

elements.removeFile.addEventListener("click", clearFile);
elements.submitButton.addEventListener("click", submitTranscription);

function openExpandedResult(button) {
  const source = document.querySelector(`#${button.dataset.expandTarget}`);
  if (!source) return;
  state.expandedSource = source;
  elements.expandedDialogTitle.textContent = button.dataset.expandTitle;
  elements.expandedText.value = source.value;
  elements.expandedDialog.showModal();
  elements.expandedText.focus();
}

for (const button of elements.expandButtons) {
  button.addEventListener("click", () => openExpandedResult(button));
}

elements.expandedText.addEventListener("input", () => {
  if (state.expandedSource) {
    state.expandedSource.value = elements.expandedText.value;
  }
});

elements.expandedDialog.addEventListener("close", () => {
  if (state.expandedSource) {
    state.expandedSource.value = elements.expandedText.value;
  }
  state.expandedSource = null;
});

elements.expandedDialog.addEventListener("click", (event) => {
  if (event.target === elements.expandedDialog) elements.expandedDialog.close();
});

elements.closeExpandedDialog.addEventListener("click", () => {
  elements.expandedDialog.close();
});

async function copyText(textarea, successMessage) {
  try {
    await navigator.clipboard.writeText(textarea.value);
    setStatus(successMessage, "success");
  } catch {
    textarea.select();
    setStatus("자동 복사가 차단되었습니다. 선택된 텍스트를 직접 복사해 주세요.");
  }
}

elements.copyTranscriptButton.addEventListener("click", () =>
  copyText(elements.transcript, "스크립트를 클립보드에 복사했습니다."),
);
elements.copySummaryButton.addEventListener("click", () =>
  copyText(elements.summary, "요약문을 클립보드에 복사했습니다."),
);

fetch("/api/config")
  .then((response) => response.json())
  .then((config) => {
    state.config = config;
    elements.uploadHint.textContent = `MP3, WAV, M4A · 최대 ${config.maxUploadMb}MB · ${config.maxAudioDurationMinutes}분 이내`;
  })
  .catch(() => {
    elements.uploadHint.textContent = "MP3, WAV, M4A · 최대 500MB · 120분 이내";
  });
