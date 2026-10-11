import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import multer from "multer";
import { parseFile } from "music-metadata";
import { config as defaultConfig } from "./config.js";
import { AppError } from "./errors/AppError.js";
import {
  createImageUploadMiddleware,
  createUploadMiddleware,
  normalizeImageMimeType,
  normalizeMimeType,
} from "./middleware/upload.js";
import { GeminiTranscriptionService } from "./services/transcriptionService.js";
import { FfmpegAudioSplitter } from "./services/audioSplitter.js";
import { GeminiSummaryService } from "./services/summaryService.js";
import { RecordingAnalysisService } from "./services/recordingAnalysisService.js";
import { GeminiTimetableImageService } from "./services/timetableImageService.js";
import { validateImageFile } from "./services/imageValidationService.js";

async function removeTemporaryFile(filePath) {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("로컬 임시 파일 삭제 실패", { code: error.code });
    }
  }
}

export async function createApp(options = {}) {
  const appConfig = { ...defaultConfig, ...options.config };
  const transcriptionService =
    options.transcriptionService ??
    new GeminiTranscriptionService({
      apiKey: appConfig.geminiApiKey,
      timeoutMs: appConfig.geminiTimeoutMs,
    });
  const summaryService =
    options.summaryService ??
    new GeminiSummaryService({
      apiKey: appConfig.geminiApiKey,
      model: appConfig.geminiSummaryModel,
      timeoutMs: appConfig.geminiTimeoutMs,
    });
  const audioSplitter =
    options.audioSplitter ??
    new FfmpegAudioSplitter({
      chunkMinutes: appConfig.transcriptionChunkMinutes,
    });
  const recordingAnalysisService =
    options.recordingAnalysisService ??
    new RecordingAnalysisService({
      transcriptionService,
      summaryService,
      audioSplitter,
      chunkMinutes: appConfig.transcriptionChunkMinutes,
    });
  const readAudioMetadata = options.readAudioMetadata ?? parseFile;
  const timetableImageService =
    options.timetableImageService ??
    new GeminiTimetableImageService({
      apiKey: appConfig.geminiApiKey,
      model: appConfig.geminiTimetableModel,
      timeoutMs: appConfig.geminiTimetableTimeoutMs,
    });
  const inspectImage = options.inspectImage ?? validateImageFile;

  if (appConfig.timetableEndHour <= appConfig.timetableStartHour) {
    throw new Error("TIMETABLE_END_HOUR는 TIMETABLE_START_HOUR보다 커야 합니다.");
  }

  await fs.mkdir(appConfig.uploadDirectory, { recursive: true });
  const uploadAudio = createUploadMiddleware(appConfig);
  const uploadTimetableImage = createImageUploadMiddleware(appConfig);
  const app = express();

  app.disable("x-powered-by");
  app.use(express.static(path.resolve("public")));

  app.get("/api/config", (_request, response) => {
    response.json({
      maxUploadMb: appConfig.maxUploadMb,
      maxAudioDurationMinutes: appConfig.maxAudioDurationMinutes,
      transcriptionChunkMinutes: appConfig.transcriptionChunkMinutes,
      supportedExtensions: ["mp3", "wav", "m4a"],
      maxImageUploadMb: appConfig.maxImageUploadMb,
      supportedImageExtensions: ["png", "jpg", "jpeg"],
      timetableStartHour: appConfig.timetableStartHour,
      timetableEndHour: appConfig.timetableEndHour,
    });
  });

  app.post("/api/timetables/analyze", (request, response, next) => {
    uploadTimetableImage(request, response, async (uploadError) => {
      if (uploadError) {
        next(uploadError);
        return;
      }

      const temporaryPath = request.file?.path;
      const streamsProgress = request.get("accept")?.includes(
        "application/x-ndjson",
      );
      try {
        if (!request.file) {
          throw new AppError(
            400,
            "IMAGE_REQUIRED",
            "분석할 시간표 이미지를 선택해 주세요.",
          );
        }
        if (request.file.size === 0) {
          throw new AppError(400, "EMPTY_FILE", "빈 파일은 업로드할 수 없습니다.");
        }

        const mimeType = normalizeImageMimeType(request.file);
        if (streamsProgress) {
          response.status(200);
          response.set({
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "X-Content-Type-Options": "nosniff",
          });
          response.flushHeaders();
          writeStreamEvent(response, { type: "progress", phase: "validating" });
        }
        const dimensions = await inspectImage(temporaryPath, mimeType);
        if (streamsProgress) {
          writeStreamEvent(response, { type: "progress", phase: "analyzing" });
        }
        const result = await timetableImageService.analyze({
          filePath: temporaryPath,
          mimeType,
        });
        const responseBody = { ...result, image: dimensions };
        if (streamsProgress) {
          writeStreamEvent(response, { type: "result", ...responseBody });
          response.end();
        } else {
          response.json(responseBody);
        }
      } catch (error) {
        if (streamsProgress && response.headersSent) {
          const normalizedError = normalizeError(error, appConfig);
          logError(normalizedError);
          writeStreamEvent(response, {
            type: "error",
            error: {
              code: normalizedError.code,
              message: normalizedError.publicMessage,
            },
          });
          response.end();
        } else {
          next(error);
        }
      } finally {
        await removeTemporaryFile(temporaryPath);
      }
    });
  });

  app.post("/api/transcriptions", (request, response, next) => {
    uploadAudio(request, response, async (uploadError) => {
      if (uploadError) {
        next(uploadError);
        return;
      }

      const temporaryPath = request.file?.path;
      const streamsProgress = request.get("accept")?.includes(
        "application/x-ndjson",
      );
      try {
        if (!request.file) {
          throw new AppError(
            400,
            "FILE_REQUIRED",
            "변환할 녹음 파일을 선택해 주세요.",
          );
        }
        if (request.file.size === 0) {
          throw new AppError(
            400,
            "EMPTY_FILE",
            "빈 파일은 업로드할 수 없습니다.",
          );
        }

        let metadata;
        try {
          metadata = await readAudioMetadata(temporaryPath, { duration: true });
        } catch (error) {
          throw new AppError(
            400,
            "INVALID_AUDIO_FILE",
            "파일의 오디오 데이터를 읽을 수 없습니다.",
            { cause: error },
          );
        }

        const durationSeconds = metadata.format.duration;
        if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
          throw new AppError(
            400,
            "INVALID_AUDIO_FILE",
            "재생 가능한 녹음 파일인지 확인해 주세요.",
          );
        }
        if (durationSeconds > appConfig.maxAudioDurationMinutes * 60) {
          throw new AppError(
            400,
            "AUDIO_TOO_LONG",
            `녹음 길이는 최대 ${appConfig.maxAudioDurationMinutes}분까지 지원합니다.`,
          );
        }

        if (streamsProgress) {
          response.status(200);
          response.set({
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "X-Content-Type-Options": "nosniff",
          });
          response.flushHeaders();
          writeStreamEvent(response, {
            type: "progress",
            phase: "preparing",
          });
        }

        const result = await recordingAnalysisService.analyze({
          filePath: temporaryPath,
          mimeType: normalizeMimeType(request.file),
          durationSeconds,
          onProgress: streamsProgress
            ? (progress) =>
                writeStreamEvent(response, { type: "progress", ...progress })
            : undefined,
        });

        if (streamsProgress) {
          writeStreamEvent(response, { type: "result", ...result });
          response.end();
        } else {
          response.json(result);
        }
      } catch (error) {
        if (streamsProgress && response.headersSent) {
          const normalizedError = normalizeError(error, appConfig);
          logError(normalizedError);
          writeStreamEvent(response, {
            type: "error",
            error: {
              code: normalizedError.code,
              message: normalizedError.publicMessage,
            },
          });
          response.end();
        } else {
          next(error);
        }
      } finally {
        await removeTemporaryFile(temporaryPath);
      }
    });
  });

  app.use((error, _request, response, _next) => {
    const normalizedError = normalizeError(error, appConfig);
    logError(normalizedError);

    if (!response.headersSent) {
      response.status(normalizedError.status).json({
        error: {
          code: normalizedError.code,
          message: normalizedError.publicMessage,
        },
      });
    }
  });

  return app;
}

function writeStreamEvent(response, event) {
  response.write(`${JSON.stringify(event)}\n`);
}

function normalizeError(error, appConfig) {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    const isImage = error.field === "timetableImage";
    const limitMb = isImage
      ? appConfig.maxImageUploadMb
      : appConfig.maxUploadMb;
    return new AppError(
      413,
      "FILE_TOO_LARGE",
      `파일 용량은 최대 ${limitMb}MB까지 업로드할 수 있습니다.`,
    );
  }
  if (error instanceof AppError) return error;
  return new AppError(
    500,
    "INTERNAL_SERVER_ERROR",
    "서버에서 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
    { cause: error },
  );
}

function logError(error) {
  console.error("요청 처리 실패", {
    code: error.code,
    status: error.status,
    causeName: error.cause?.name,
    causeStatus: readSafeStatus(error.cause),
    causeMessage: sanitizeErrorMessage(error.cause?.message),
  });
}

function readSafeStatus(error) {
  return error?.status ?? error?.statusCode ?? error?.code;
}

function sanitizeErrorMessage(message) {
  if (!message) return undefined;
  return String(message)
    .replace(/AIza[\w-]+/g, "[REDACTED_API_KEY]")
    .slice(0, 500);
}
