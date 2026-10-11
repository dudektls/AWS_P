import { GoogleGenAI } from "@google/genai";
import { AppError } from "../errors/AppError.js";

function readStatus(error) {
  return Number(error?.status ?? error?.statusCode ?? error?.code);
}

function isNotFound(error) {
  return readStatus(error) === 404;
}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error("Gemini API request timed out");
      error.code = "GEMINI_TIMEOUT";
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function mapGeminiError(error) {
  if (error instanceof AppError) return error;

  const status = readStatus(error);
  const message = String(error?.message ?? "").toLowerCase();

  if (
    status === 404 ||
    message.includes("model") &&
      (message.includes("not found") || message.includes("permission"))
  ) {
    return new AppError(
      503,
      "MODEL_UNAVAILABLE",
      "현재 계정에서 음성 인식 모델을 사용할 수 없습니다.",
      { cause: error },
    );
  }
  if (status === 401 || message.includes("api key")) {
    return new AppError(
      401,
      "INVALID_API_KEY",
      "Gemini API 키가 올바르지 않거나 사용할 권한이 없습니다.",
      { cause: error },
    );
  }
  if (status === 403) {
    return new AppError(
      403,
      "API_PERMISSION_DENIED",
      "Gemini API 키 또는 연결된 프로젝트에 필요한 권한이 없습니다.",
      { cause: error },
    );
  }
  if (status === 429 || message.includes("quota") || message.includes("rate limit")) {
    return new AppError(
      429,
      "QUOTA_EXCEEDED",
      "Gemini API 사용량 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.",
      { cause: error },
    );
  }
  if (
    error?.name === "AbortError" ||
    error?.code === "GEMINI_TIMEOUT" ||
    message.includes("timeout")
  ) {
    return new AppError(
      504,
      "API_TIMEOUT",
      "음성 분석 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.",
      { cause: error },
    );
  }
  if (
    error?.code === "ECONNRESET" ||
    error?.code === "ENOTFOUND" ||
    error?.code === "ETIMEDOUT" ||
    message.includes("fetch failed") ||
    message.includes("network")
  ) {
    return new AppError(
      502,
      "NETWORK_ERROR",
      "Gemini API와 통신하지 못했습니다. 네트워크 상태를 확인해 주세요.",
      { cause: error },
    );
  }

  return new AppError(
    502,
    "TRANSCRIPTION_FAILED",
    "음성 인식 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    { cause: error },
  );
}

export class GeminiTranscriptionService {
  constructor({ apiKey, timeoutMs, client } = {}) {
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs ?? 300_000;
    this.client = client;
  }

  async transcribe({ filePath, mimeType }) {
    if (!this.apiKey && !this.client) {
      throw new AppError(
        503,
        "API_KEY_MISSING",
        "서버에 GEMINI_API_KEY가 설정되지 않았습니다.",
      );
    }

    const client = this.client ?? new GoogleGenAI({ apiKey: this.apiKey });
    let remoteFile;

    try {
      remoteFile = await withTimeout(
        client.files.upload({
          file: filePath,
          config: { mimeType },
        }),
        this.timeoutMs,
      );

      if (!remoteFile.uri) {
        throw new Error("Gemini Files API response did not include a file URI");
      }

      const transcript = await this.#requestTranscript(
        client,
        remoteFile,
        mimeType,
      );
      if (!transcript) {
        throw new AppError(
          422,
          "EMPTY_TRANSCRIPT",
          "음성에서 인식 가능한 발화를 찾지 못했습니다.",
        );
      }

      return transcript;
    } catch (error) {
      throw mapGeminiError(error);
    } finally {
      if (remoteFile?.name) {
        try {
          await client.files.delete({ name: remoteFile.name });
        } catch (error) {
          console.error("Gemini 임시 파일 삭제 실패", {
            name: error?.name,
            status: readStatus(error),
          });
        }
      }
    }
  }

  async #requestTranscript(client, remoteFile, fallbackMimeType) {
    const mimeType = remoteFile.mimeType ?? fallbackMimeType;

    try {
      const interaction = await withTimeout(
        client.interactions.create({
          model: "gemini-3.5-transcribe",
          input: [
            {
              type: "audio",
              uri: remoteFile.uri,
              mime_type: mimeType,
            },
          ],
          generation_config: {
            transcription_config: {
              language_codes: ["ko-KR"],
              mode: { type: "verbatim" },
            },
          },
        }),
        this.timeoutMs,
      );

      return interaction.output_text?.trim();
    } catch (error) {
      if (!isNotFound(error) || !client.models?.generateContent) {
        throw error;
      }

      console.warn(
        "Interactions API를 찾을 수 없어 Generate Content API로 전환합니다.",
      );
      const response = await withTimeout(
        client.models.generateContent({
          model: "gemini-3.5-transcribe",
          contents: [
            {
              fileData: {
                fileUri: remoteFile.uri,
                mimeType,
              },
            },
          ],
        }),
        this.timeoutMs,
      );

      return response.text?.trim();
    }
  }
}
