import { GoogleGenAI } from "@google/genai";
import { AppError } from "../errors/AppError.js";

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error("Gemini summary request timed out");
      error.code = "GEMINI_TIMEOUT";
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class GeminiSummaryService {
  constructor({ apiKey, model, timeoutMs, client } = {}) {
    this.apiKey = apiKey;
    this.model = model ?? "gemini-3.8-flash";
    this.timeoutMs = timeoutMs ?? 300_000;
    this.client = client;
  }

  async summarize(transcript) {
    if (!this.apiKey && !this.client) {
      throw new AppError(
        503,
        "API_KEY_MISSING",
        "서버에 GEMINI_API_KEY가 설정되지 않았습니다.",
      );
    }

    const client = this.client ?? new GoogleGenAI({ apiKey: this.apiKey });
    try {
      const response = await withTimeout(
        client.models.generateContent({
          model: this.model,
          contents: `다음은 한국어 강의 녹음의 전체 전사문입니다. 아래 기준에 따라 간단명료하게 요약하세요.

- 원문에 없는 사실이나 해석을 추가하지 마세요.
- 인사말, 반복 표현, 군더더기는 제거하세요.
- 핵심 주제, 반드시 알아야 할 개념, 중요한 근거·예시, 결론은 보존하세요.
- 서로 관련된 내용은 묶고 짧은 제목과 글머리표를 사용하세요.
- 세부 설명을 과도하게 나열하지 말고, 일반적으로 8~12개 핵심 항목 안에서 정리하세요.
- 내용이 적으면 항목 수를 억지로 늘리지 마세요.

[전체 전사문]
${transcript}`,
        }),
        this.timeoutMs,
      );
      const summary = response.text?.trim();
      if (!summary) {
        throw new AppError(
          422,
          "EMPTY_SUMMARY",
          "요약 결과를 생성하지 못했습니다.",
        );
      }
      return summary;
    } catch (error) {
      if (error instanceof AppError) throw error;
      const status = Number(error?.status ?? error?.statusCode ?? error?.code);
      if (status === 429) {
        throw new AppError(
          429,
          "QUOTA_EXCEEDED",
          "Gemini API 사용량 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.",
          { cause: error },
        );
      }
      if (status === 401) {
        throw new AppError(
          401,
          "INVALID_API_KEY",
          "Gemini API 키가 올바르지 않거나 만료되었습니다.",
          { cause: error },
        );
      }
      if (status === 403) {
        throw new AppError(
          403,
          "API_PERMISSION_DENIED",
          "Gemini API 키 또는 프로젝트에 요약 모델 사용 권한이 없습니다.",
          { cause: error },
        );
      }
      if (status === 404) {
        throw new AppError(
          503,
          "SUMMARY_MODEL_UNAVAILABLE",
          "현재 계정에서 설정된 요약 모델을 사용할 수 없습니다.",
          { cause: error },
        );
      }
      if (error?.code === "GEMINI_TIMEOUT") {
        throw new AppError(
          504,
          "API_TIMEOUT",
          "요약 생성 응답 시간이 초과되었습니다.",
          { cause: error },
        );
      }
      throw new AppError(
        502,
        "SUMMARY_FAILED",
        "전체 스크립트는 변환했지만 요약문 생성에 실패했습니다.",
        { cause: error },
      );
    }
  }
}
