import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { parseFile } from "music-metadata";
import { calculateAvailability } from "../public/availability.js";
import {
  loadConfirmedTimetable,
  saveConfirmedTimetable,
} from "../public/timetableStorage.js";
import { createApp } from "../src/app.js";
import { FfmpegAudioSplitter } from "../src/services/audioSplitter.js";
import { RecordingAnalysisService } from "../src/services/recordingAnalysisService.js";
import { GeminiSummaryService } from "../src/services/summaryService.js";
import { GeminiTranscriptionService } from "../src/services/transcriptionService.js";
import { GeminiTimetableImageService } from "../src/services/timetableImageService.js";
import { validateTimetableResult } from "../src/services/timetableValidationService.js";

function createSilentWav(durationSeconds = 0.1) {
  const sampleRate = 8000;
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

async function withServer(transcriptionService, callback, options = {}) {
  const uploadDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "transcribe-test-"));
  const app = await createApp({
    config: { uploadDirectory, maxUploadMb: 1, ...options.config },
    transcriptionService,
    summaryService: options.summaryService ?? {
      summarize: async () => "핵심 내용을 정리한 요약입니다.",
    },
    audioSplitter: options.audioSplitter,
    readAudioMetadata: options.readAudioMetadata,
    recordingAnalysisService: options.recordingAnalysisService,
    timetableImageService: options.timetableImageService,
    inspectImage: options.inspectImage,
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  try {
    await callback(`http://127.0.0.1:${address.port}`, uploadDirectory);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(uploadDirectory, { recursive: true, force: true });
  }
}

function audioForm(fileName, type, bytes) {
  const form = new FormData();
  form.append("audio", new Blob([bytes], { type }), fileName);
  return form;
}

function imageForm(fileName, type, bytes) {
  const form = new FormData();
  form.append("timetableImage", new Blob([bytes], { type }), fileName);
  return form;
}

function createPng(width = 20, height = 20) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

test("NDJSON progress stream returns stages and final result", async () => {
  const recordingAnalysisService = {
    async analyze({ onProgress }) {
      onProgress({ phase: "splitting" });
      onProgress({ phase: "transcribing", completedChunks: 0, totalChunks: 2 });
      onProgress({ phase: "transcribing", completedChunks: 1, totalChunks: 2 });
      onProgress({ phase: "transcribing", completedChunks: 2, totalChunks: 2 });
      onProgress({ phase: "summarizing" });
      return { transcript: "full transcript", summary: "summary", chunkCount: 2 };
    },
  };

  await withServer(
    { transcribe: async () => "unused" },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/transcriptions`, {
        method: "POST",
        headers: { Accept: "application/x-ndjson" },
        body: audioForm("lecture.wav", "audio/wav", createSilentWav()),
      });
      const events = (await response.text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));

      assert.equal(response.status, 200);
      assert.deepEqual(
        events.filter((event) => event.type === "progress").map((event) => event.phase),
        [
          "preparing",
          "splitting",
          "transcribing",
          "transcribing",
          "transcribing",
          "summarizing",
        ],
      );
      assert.deepEqual(events.at(-1), {
        type: "result",
        transcript: "full transcript",
        summary: "summary",
        chunkCount: 2,
      });
    },
    { recordingAnalysisService },
  );
});

test("정적 웹페이지와 공개 설정을 제공한다", async () => {
  await withServer({ transcribe: async () => "" }, async (baseUrl) => {
    const page = await fetch(baseUrl);
    assert.equal(page.status, 200);
    const pageHtml = await page.text();
    assert.match(pageHtml, /AI 학습 도구/);
    assert.match(pageHtml, /data-expand-target="transcript"/);
    assert.match(pageHtml, /data-expand-target="summary"/);
    assert.match(pageHtml, /id="expandedDialog"/);

    const timetablePage = await fetch(`${baseUrl}/timetable.html`);
    assert.equal(timetablePage.status, 200);
    assert.match(await timetablePage.text(), /AI 시간표 분석 시작/);

    const configResponse = await fetch(`${baseUrl}/api/config`);
    assert.deepEqual(await configResponse.json(), {
      maxUploadMb: 1,
      maxAudioDurationMinutes: 120,
      transcriptionChunkMinutes: 50,
      supportedExtensions: ["mp3", "wav", "m4a"],
      maxImageUploadMb: 10,
      supportedImageExtensions: ["png", "jpg", "jpeg"],
      timetableStartHour: 8,
      timetableEndHour: 22,
    });
  });
});

test("유효한 WAV를 처리하고 로컬 임시 파일을 삭제한다", async () => {
  let received;
  const service = {
    async transcribe(input) {
      received = input;
      assert.equal((await fs.stat(input.filePath)).isFile(), true);
      return "안녕하세요. 테스트 녹음입니다.";
    },
  };

  await withServer(service, async (baseUrl, uploadDirectory) => {
    const response = await fetch(`${baseUrl}/api/transcriptions`, {
      method: "POST",
      body: audioForm("lecture.wav", "audio/wav", createSilentWav()),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      transcript: "안녕하세요. 테스트 녹음입니다.",
      summary: "핵심 내용을 정리한 요약입니다.",
      chunkCount: 1,
    });
    assert.equal(received.mimeType, "audio/wav");
    assert.deepEqual(await fs.readdir(uploadDirectory), []);
  });
});

test("MP3와 M4A 업로드를 각각 올바른 MIME으로 서비스에 전달한다", async () => {
  const receivedMimeTypes = [];
  const service = {
    async transcribe({ mimeType }) {
      receivedMimeTypes.push(mimeType);
      return "테스트 결과";
    },
  };

  await withServer(
    service,
    async (baseUrl) => {
      const samples = [
        ["lecture.mp3", "audio/mpeg"],
        ["lecture.m4a", "audio/mp4"],
      ];

      for (const [fileName, mimeType] of samples) {
        const response = await fetch(`${baseUrl}/api/transcriptions`, {
          method: "POST",
          body: audioForm(fileName, mimeType, "mock audio bytes"),
        });
        assert.equal(response.status, 200);
      }
    },
    {
      readAudioMetadata: async () => ({ format: { duration: 10 } }),
    },
  );

  assert.deepEqual(receivedMimeTypes, ["audio/mpeg", "audio/m4a"]);
});

test("확장자와 MIME이 허용 목록과 다르면 거부한다", async () => {
  await withServer({ transcribe: async () => "unexpected" }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/transcriptions`, {
      method: "POST",
      body: audioForm("notes.txt", "text/plain", "not audio"),
    });

    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "UNSUPPORTED_FILE_TYPE");
  });
});

test("확장자를 속인 손상 오디오를 거부하고 파일을 삭제한다", async () => {
  await withServer(
    { transcribe: async () => "unexpected" },
    async (baseUrl, uploadDirectory) => {
      const response = await fetch(`${baseUrl}/api/transcriptions`, {
        method: "POST",
        body: audioForm("fake.mp3", "audio/mpeg", "not an mp3"),
      });

      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, "INVALID_AUDIO_FILE");
      assert.deepEqual(await fs.readdir(uploadDirectory), []);
    },
  );
});

test("API 키가 없으면 명확한 오류를 반환하고 파일을 삭제한다", async () => {
  const service = new GeminiTranscriptionService({ apiKey: "" });

  await withServer(service, async (baseUrl, uploadDirectory) => {
    const response = await fetch(`${baseUrl}/api/transcriptions`, {
      method: "POST",
      body: audioForm("lecture.wav", "audio/wav", createSilentWav()),
    });

    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "API_KEY_MISSING");
    assert.deepEqual(await fs.readdir(uploadDirectory), []);
  });
});

test("Gemini 서비스가 Files API, 한국어 verbatim 전사, 원격 삭제를 수행한다", async () => {
  const calls = [];
  const client = {
    files: {
      upload: async (input) => {
        calls.push(["upload", input]);
        return {
          name: "files/test-audio",
          uri: "https://example.invalid/files/test-audio",
          mimeType: "audio/mpeg",
        };
      },
      delete: async (input) => calls.push(["delete", input]),
    },
    interactions: {
      create: async (input, options) => {
        calls.push(["create", input, options]);
        return { output_text: " 한글 전사 결과 " };
      },
    },
  };
  const service = new GeminiTranscriptionService({ client, timeoutMs: 1000 });
  const result = await service.transcribe({
    filePath: "sample.mp3",
    mimeType: "audio/mpeg",
  });

  assert.equal(result, "한글 전사 결과");
  assert.equal(calls[0][0], "upload");
  assert.deepEqual(calls[0][1].config, { mimeType: "audio/mpeg" });
  assert.deepEqual(calls[1][1].generation_config, {
    transcription_config: {
      language_codes: ["ko-KR"],
      mode: { type: "verbatim" },
    },
  });
  assert.equal(calls[1][2], undefined);
  assert.deepEqual(calls[2], ["delete", { name: "files/test-audio" }]);
});

test("Interactions API가 404이면 Generate Content API로 전환한다", async () => {
  const calls = [];
  const notFound = Object.assign(new Error("Not Found"), { status: 404 });
  const client = {
    files: {
      upload: async () => ({
        name: "files/fallback-audio",
        uri: "https://example.invalid/files/fallback-audio",
        mimeType: "audio/wav",
      }),
      delete: async (input) => calls.push(["delete", input]),
    },
    interactions: {
      create: async () => {
        calls.push(["interaction"]);
        throw notFound;
      },
    },
    models: {
      generateContent: async (input) => {
        calls.push(["generateContent", input]);
        return { text: " 대체 경로 한글 전사 " };
      },
    },
  };
  const service = new GeminiTranscriptionService({ client, timeoutMs: 2000 });

  const result = await service.transcribe({
    filePath: "sample.wav",
    mimeType: "audio/wav",
  });

  assert.equal(result, "대체 경로 한글 전사");
  assert.deepEqual(calls[1][1], {
    model: "gemini-3.5-transcribe",
    contents: [
      {
        fileData: {
          fileUri: "https://example.invalid/files/fallback-audio",
          mimeType: "audio/wav",
        },
      },
    ],
  });
  assert.deepEqual(calls[2], ["delete", { name: "files/fallback-audio" }]);
});

test("2시간 녹음을 여러 조각으로 전사한 뒤 하나의 요약을 만든다", async () => {
  const transcribedFiles = [];
  let cleaned = false;
  let summarizedTranscript;
  const service = new RecordingAnalysisService({
    transcriptionService: {
      async transcribe({ filePath, mimeType }) {
        transcribedFiles.push([filePath, mimeType]);
        return `${path.basename(filePath)} 전사`;
      },
    },
    summaryService: {
      async summarize(transcript) {
        summarizedTranscript = transcript;
        return "전체 강의 요약";
      },
    },
    audioSplitter: {
      async split() {
        return {
          files: ["chunk-000.mp3", "chunk-001.mp3", "chunk-002.mp3"],
          cleanup: async () => {
            cleaned = true;
          },
        };
      },
    },
    chunkMinutes: 50,
  });

  const result = await service.analyze({
    filePath: "lecture.m4a",
    mimeType: "audio/m4a",
    durationSeconds: 120 * 60,
  });

  assert.equal(result.chunkCount, 3);
  assert.equal(result.summary, "전체 강의 요약");
  assert.equal(result.transcript, summarizedTranscript);
  assert.deepEqual(
    transcribedFiles.map((item) => item[1]),
    ["audio/mpeg", "audio/mpeg", "audio/mpeg"],
  );
  assert.equal(cleaned, true);
});

test("FFmpeg가 WAV를 독립 재생 가능한 MP3 조각으로 분할한다", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "split-test-"));
  const inputPath = path.join(directory, "long.wav");
  await fs.writeFile(inputPath, createSilentWav(2.5));
  const splitter = new FfmpegAudioSplitter({ chunkMinutes: 0.02 });

  try {
    const result = await splitter.split(inputPath);
    assert.equal(result.files.length >= 2, true);
    for (const file of result.files) {
      const metadata = await parseFile(file, { duration: true });
      assert.equal(metadata.format.container, "MPEG");
      assert.equal(metadata.format.duration > 0, true);
    }
    await result.cleanup();
    assert.equal(await fs.stat(path.dirname(result.files[0])).catch(() => null), null);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("요약 서비스가 전체 전사문을 Gemini 3.8 Flash에 전달한다", async () => {
  let request;
  const service = new GeminiSummaryService({
    model: "gemini-3.8-flash",
    timeoutMs: 1000,
    client: {
      models: {
        async generateContent(input) {
          request = input;
          return { text: " 강의 핵심 요약 " };
        },
      },
    },
  });

  assert.equal(await service.summarize("전체 강의 전사문"), "강의 핵심 요약");
  assert.equal(request.model, "gemini-3.8-flash");
  assert.match(request.contents, /전체 강의 전사문/);
  assert.match(request.contents, /간단명료하게 요약/);
  assert.match(request.contents, /반복 표현, 군더더기는 제거/);
  assert.match(request.contents, /중요한 근거·예시, 결론은 보존/);
});

test("120분을 초과한 녹음은 Gemini 호출 전에 거부한다", async () => {
  let called = false;
  await withServer(
    {
      async transcribe() {
        called = true;
        return "unexpected";
      },
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/transcriptions`, {
        method: "POST",
        body: audioForm("lecture.mp3", "audio/mpeg", "mock audio bytes"),
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, "AUDIO_TOO_LONG");
    },
    {
      readAudioMetadata: async () => ({ format: { duration: 121 * 60 } }),
    },
  );
  assert.equal(called, false);
});

test("PNG 시간표를 분석하고 처리 후 임시 파일을 삭제한다", async () => {
  let received;
  const timetableImageService = {
    async analyze(input) {
      received = input;
      assert.equal((await fs.stat(input.filePath)).isFile(), true);
      return {
        courses: [
          {
            id: "course-1",
            name: "데이터베이스",
            day: "MON",
            startTime: "09:00",
            endTime: "10:30",
            location: "공학관 101",
            professor: null,
            needsReview: false,
            reviewReason: null,
          },
        ],
        warnings: [],
      };
    },
  };

  await withServer(
    { transcribe: async () => "unused" },
    async (baseUrl, uploadDirectory) => {
      const response = await fetch(`${baseUrl}/api/timetables/analyze`, {
        method: "POST",
        body: imageForm("schedule.png", "image/png", createPng()),
      });
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.courses[0].name, "데이터베이스");
      assert.deepEqual(body.image, { width: 20, height: 20 });
      assert.equal(received.mimeType, "image/png");
      assert.deepEqual(await fs.readdir(uploadDirectory), []);
    },
    { timetableImageService },
  );
});

test("시간표 분석 진행 상태와 결과를 NDJSON 스트림으로 전달한다", async () => {
  await withServer(
    { transcribe: async () => "unused" },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/timetables/analyze`, {
        method: "POST",
        headers: { Accept: "application/x-ndjson" },
        body: imageForm("schedule.png", "image/png", createPng()),
      });
      const events = (await response.text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.equal(response.status, 200);
      assert.deepEqual(
        events.filter((event) => event.type === "progress").map((event) => event.phase),
        ["validating", "analyzing"],
      );
      assert.equal(events.at(-1).type, "result");
      assert.equal(events.at(-1).courses[0].name, "데이터베이스");
    },
    {
      timetableImageService: {
        async analyze() {
          return {
            courses: [
              {
                id: "course-1",
                name: "데이터베이스",
                day: "MON",
                startTime: "09:00",
                endTime: "10:30",
                location: null,
                professor: null,
                needsReview: false,
                reviewReason: null,
              },
            ],
            warnings: [],
          };
        },
      },
    },
  );
});

test("JPEG 확장자와 MIME을 이미지 분석 서비스에 전달한다", async () => {
  let receivedMimeType;
  await withServer(
    { transcribe: async () => "unused" },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/timetables/analyze`, {
        method: "POST",
        body: imageForm("schedule.jpeg", "image/jpeg", "jpeg bytes"),
      });
      assert.equal(response.status, 200);
      assert.equal(receivedMimeType, "image/jpeg");
    },
    {
      inspectImage: async () => ({ width: 1000, height: 800 }),
      timetableImageService: {
        async analyze({ mimeType }) {
          receivedMimeType = mimeType;
          return { courses: [], warnings: [] };
        },
      },
    },
  );
});

test("지원하지 않는 이미지와 손상된 PNG를 거부하고 임시 파일을 정리한다", async () => {
  await withServer(
    { transcribe: async () => "unused" },
    async (baseUrl, uploadDirectory) => {
      const unsupported = await fetch(`${baseUrl}/api/timetables/analyze`, {
        method: "POST",
        body: imageForm("schedule.gif", "image/gif", "GIF89a"),
      });
      assert.equal(unsupported.status, 400);
      assert.equal((await unsupported.json()).error.code, "UNSUPPORTED_IMAGE_TYPE");

      const damaged = await fetch(`${baseUrl}/api/timetables/analyze`, {
        method: "POST",
        body: imageForm("schedule.png", "image/png", Buffer.from("not a png")),
      });
      assert.equal(damaged.status, 400);
      assert.equal((await damaged.json()).error.code, "INVALID_IMAGE_FILE");
      assert.deepEqual(await fs.readdir(uploadDirectory), []);
    },
    { timetableImageService: { analyze: async () => ({ courses: [], warnings: [] }) } },
  );
});

test("설정된 시간표 이미지 용량을 초과하면 413으로 거부한다", async () => {
  await withServer(
    { transcribe: async () => "unused" },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/timetables/analyze`, {
        method: "POST",
        body: imageForm("schedule.png", "image/png", createPng(200, 200)),
      });
      assert.equal(response.status, 413);
      assert.equal((await response.json()).error.code, "FILE_TOO_LARGE");
    },
    {
      config: { maxImageUploadMb: 0.00001 },
      timetableImageService: { analyze: async () => ({ courses: [], warnings: [] }) },
    },
  );
});

test("시간표 분석 API 키가 없으면 명확한 오류를 반환한다", async () => {
  await withServer(
    { transcribe: async () => "unused" },
    async (baseUrl, uploadDirectory) => {
      const response = await fetch(`${baseUrl}/api/timetables/analyze`, {
        method: "POST",
        body: imageForm("schedule.png", "image/png", createPng()),
      });
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error.code, "API_KEY_MISSING");
      assert.deepEqual(await fs.readdir(uploadDirectory), []);
    },
    { config: { geminiApiKey: "" } },
  );
});

test("Gemini 시간표 서비스가 이미지와 JSON 스키마를 Interactions API에 전달한다", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "timetable-service-test-"));
  const imagePath = path.join(directory, "schedule.png");
  await fs.writeFile(imagePath, createPng());
  let request;
  let requestOptions;
  const service = new GeminiTimetableImageService({
    model: "gemini-3.8-flash",
    timeoutMs: 1000,
    client: {
      interactions: {
        async create(input, options) {
          request = input;
          requestOptions = options;
          return {
            output_text: JSON.stringify({
              courses: [
                {
                  name: "웹 개발",
                  day: "WED",
                  startTime: "13:00",
                  endTime: "14:30",
                  location: null,
                  professor: null,
                  needsReview: false,
                  reviewReason: null,
                },
              ],
              warnings: [],
            }),
          };
        },
      },
    },
  });

  try {
    const result = await service.analyze({ filePath: imagePath, mimeType: "image/png" });
    assert.equal(result.courses[0].name, "웹 개발");
    assert.equal(request.model, "gemini-3.8-flash");
    assert.equal(request.input[1].type, "image");
    assert.equal(request.input[1].mime_type, "image/png");
    assert.equal(request.response_format.mime_type, "application/json");
    assert.equal(request.response_format.schema.properties.courses.type, "array");
    assert.equal(requestOptions.timeout_ms, 1000);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("시간표 이미지 모델에 접근할 수 없으면 원인을 구분한다", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "timetable-model-test-"));
  const imagePath = path.join(directory, "schedule.png");
  await fs.writeFile(imagePath, createPng());
  const service = new GeminiTimetableImageService({
    timeoutMs: 1000,
    client: {
      interactions: {
        async create() {
          const error = new Error("model not found");
          error.status = 404;
          throw error;
        },
      },
    },
  });

  try {
    await assert.rejects(
      service.analyze({ filePath: imagePath, mimeType: "image/png" }),
      (error) => error.code === "TIMETABLE_MODEL_UNAVAILABLE" && error.status === 503,
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("시간표 검증이 불확실한 값, 중복과 시간 충돌을 검토 대상으로 표시한다", () => {
  const result = validateTimetableResult({
    courses: [
      {
        name: "운영체제",
        day: "MON",
        startTime: "09:00",
        endTime: "10:30",
        location: null,
        professor: null,
        needsReview: false,
        reviewReason: null,
      },
      {
        name: "운영체제",
        day: "MON",
        startTime: "09:00",
        endTime: "10:30",
        location: null,
        professor: null,
        needsReview: false,
        reviewReason: null,
      },
      {
        name: "알 수 없는 수업",
        day: null,
        startTime: null,
        endTime: null,
        location: null,
        professor: null,
        needsReview: true,
        reviewReason: "교시 시간 확인 필요",
      },
    ],
    warnings: [],
  });
  assert.equal(result.courses.every((course) => course.needsReview), true);
  assert.match(result.courses[0].reviewReason, /중복 수업/);
  assert.match(result.courses[2].reviewReason, /수업 시간 확인/);
  assert.equal(result.warnings.some((warning) => warning.includes("중복")), true);
});

test("가용시간 계산이 겹친 수업과 개인 일정을 병합해 제외한다", () => {
  const result = calculateAvailability({
    studyWindows: [{ day: "MON", startTime: "09:00", endTime: "18:00" }],
    courses: [
      { day: "MON", startTime: "09:00", endTime: "11:00" },
      { day: "MON", startTime: "10:30", endTime: "12:00" },
    ],
    personalEvents: [{ day: "MON", startTime: "14:00", endTime: "15:30" }],
  });
  assert.deepEqual(result.MON, [
    { day: "MON", startTime: "12:00", endTime: "14:00" },
    { day: "MON", startTime: "15:30", endTime: "18:00" },
  ]);
});

test("확정 시간표를 저장하고 새로고침용 데이터로 복원한다", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  saveConfirmedTimetable(
    {
      courses: [{ id: "course-1", name: "클라우드", day: "FRI" }],
      studyWindows: [{ day: "FRI", startTime: "09:00", endTime: "18:00" }],
      personalEvents: [],
      matchingData: {
        version: 1,
        availableSlots: [{ day: "FRI", startTime: "12:00", endTime: "18:00" }],
      },
    },
    storage,
  );
  const restored = loadConfirmedTimetable(storage);
  assert.equal(restored.version, 1);
  assert.equal(restored.courses[0].name, "클라우드");
  assert.deepEqual(restored.matchingData.availableSlots, [
    { day: "FRI", startTime: "12:00", endTime: "18:00" },
  ]);
});
