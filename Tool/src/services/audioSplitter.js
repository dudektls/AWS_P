import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { AppError } from "../errors/AppError.js";

function runFfmpeg(argumentsList) {
  return new Promise((resolve, reject) => {
    const process = spawn(ffmpegPath, argumentsList, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let errorOutput = "";

    process.stderr.on("data", (chunk) => {
      if (errorOutput.length < 8_000) errorOutput += chunk.toString();
    });
    process.once("error", reject);
    process.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const error = new Error(`FFmpeg exited with code ${code}`);
      error.details = errorOutput.slice(-2_000);
      reject(error);
    });
  });
}

export class FfmpegAudioSplitter {
  constructor({ chunkMinutes = 50 } = {}) {
    this.chunkSeconds = Math.floor(chunkMinutes * 60);
  }

  async split(filePath) {
    const outputDirectory = path.join(
      path.dirname(filePath),
      `chunks-${crypto.randomUUID()}`,
    );
    await fs.mkdir(outputDirectory, { recursive: true });
    const outputPattern = path.join(outputDirectory, "chunk-%03d.mp3");

    try {
      await runFfmpeg([
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        filePath,
        "-map",
        "0:a:0",
        "-vn",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "96k",
        "-f",
        "segment",
        "-segment_time",
        String(this.chunkSeconds),
        "-reset_timestamps",
        "1",
        outputPattern,
      ]);

      const files = (await fs.readdir(outputDirectory))
        .filter((name) => name.endsWith(".mp3"))
        .sort()
        .map((name) => path.join(outputDirectory, name));

      if (files.length === 0) {
        throw new Error("FFmpeg did not create any audio chunks");
      }

      return {
        files,
        cleanup: () => fs.rm(outputDirectory, { recursive: true, force: true }),
      };
    } catch (error) {
      await fs.rm(outputDirectory, { recursive: true, force: true });
      throw new AppError(
        500,
        "AUDIO_SPLIT_FAILED",
        "긴 녹음 파일을 분할하지 못했습니다. 파일이 손상되지 않았는지 확인해 주세요.",
        { cause: error },
      );
    }
  }
}
