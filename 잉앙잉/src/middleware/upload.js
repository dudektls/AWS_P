import crypto from "node:crypto";
import path from "node:path";
import multer from "multer";
import { AppError } from "../errors/AppError.js";

const allowedTypes = new Map([
  [".mp3", new Set(["audio/mpeg", "audio/mp3"])],
  [".wav", new Set(["audio/wav", "audio/x-wav", "audio/wave"])],
  [".m4a", new Set(["audio/m4a", "audio/mp4", "audio/x-m4a"])],
]);

const allowedImageTypes = new Map([
  [".png", new Set(["image/png"])],
  [".jpg", new Set(["image/jpeg", "image/jpg"])],
  [".jpeg", new Set(["image/jpeg", "image/jpg"])],
]);

function createDiskStorage(uploadDirectory) {
  return multer.diskStorage({
    destination: uploadDirectory,
    filename(_request, file, callback) {
      const extension = path.extname(file.originalname).toLowerCase();
      callback(null, `${crypto.randomUUID()}${extension}`);
    },
  });
}

export function createUploadMiddleware({ uploadDirectory, maxUploadMb }) {
  return multer({
    storage: createDiskStorage(uploadDirectory),
    limits: {
      fileSize: Math.floor(maxUploadMb * 1024 * 1024),
      files: 1,
    },
    fileFilter(_request, file, callback) {
      const extension = path.extname(file.originalname).toLowerCase();
      const mimeTypes = allowedTypes.get(extension);

      if (!mimeTypes || !mimeTypes.has(file.mimetype.toLowerCase())) {
        callback(
          new AppError(
            400,
            "UNSUPPORTED_FILE_TYPE",
            "MP3, WAV, M4A 형식의 녹음 파일만 업로드할 수 있습니다.",
          ),
        );
        return;
      }

      callback(null, true);
    },
  }).single("audio");
}

export function createImageUploadMiddleware({
  uploadDirectory,
  maxImageUploadMb,
}) {
  return multer({
    storage: createDiskStorage(uploadDirectory),
    limits: {
      fileSize: Math.floor(maxImageUploadMb * 1024 * 1024),
      files: 1,
    },
    fileFilter(_request, file, callback) {
      const extension = path.extname(file.originalname).toLowerCase();
      const mimeTypes = allowedImageTypes.get(extension);

      if (!mimeTypes || !mimeTypes.has(file.mimetype.toLowerCase())) {
        callback(
          new AppError(
            400,
            "UNSUPPORTED_IMAGE_TYPE",
            "PNG, JPG, JPEG 형식의 시간표 이미지만 업로드할 수 있습니다.",
          ),
        );
        return;
      }

      callback(null, true);
    },
  }).single("timetableImage");
}

export function normalizeMimeType(file) {
  const extension = path.extname(file.originalname).toLowerCase();
  const canonicalMimeTypes = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/m4a",
  };
  return canonicalMimeTypes[extension];
}

export function normalizeImageMimeType(file) {
  const extension = path.extname(file.originalname).toLowerCase();
  return extension === ".png" ? "image/png" : "image/jpeg";
}
