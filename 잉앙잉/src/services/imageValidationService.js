import fs from "node:fs/promises";
import { AppError } from "../errors/AppError.js";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

export async function validateImageFile(filePath, mimeType) {
  const buffer = await fs.readFile(filePath);
  try {
    const dimensions =
      mimeType === "image/png" ? readPngDimensions(buffer) : readJpegDimensions(buffer);
    if (dimensions.width < 10 || dimensions.height < 10) throw new Error("Image is too small");
    return dimensions;
  } catch (error) {
    throw new AppError(
      400,
      "INVALID_IMAGE_FILE",
      "손상되었거나 읽을 수 없는 이미지입니다. 다른 PNG 또는 JPEG 파일을 선택해 주세요.",
      { cause: error },
    );
  }
}

function readPngDimensions(buffer) {
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("Invalid PNG signature");
  }
  let offset = 8;
  let width;
  let height;
  let hasImageData = false;
  let hasEnd = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > buffer.length) throw new Error("Truncated PNG chunk");
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const chunkBody = buffer.subarray(offset + 4, offset + 8 + length);
    const expectedCrc = buffer.readUInt32BE(offset + 8 + length);
    if (crc32(chunkBody) !== expectedCrc) throw new Error("Invalid PNG CRC");
    if (type === "IHDR") {
      width = buffer.readUInt32BE(offset + 8);
      height = buffer.readUInt32BE(offset + 12);
    } else if (type === "IDAT") {
      hasImageData = true;
    } else if (type === "IEND") {
      hasEnd = true;
      if (chunkEnd !== buffer.length) throw new Error("Unexpected data after PNG IEND");
      break;
    }
    offset = chunkEnd;
  }
  if (!hasImageData || !hasEnd) throw new Error("Incomplete PNG structure");
  if (!width || !height) throw new Error("Invalid PNG dimensions");
  return { width, height };
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

function readJpegDimensions(buffer) {
  if (
    buffer.length < 4 ||
    buffer[0] !== 0xff ||
    buffer[1] !== 0xd8 ||
    buffer[buffer.length - 2] !== 0xff ||
    buffer[buffer.length - 1] !== 0xd9
  ) {
    throw new Error("Invalid JPEG markers");
  }

  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > buffer.length) break;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break;
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      if (!width || !height) throw new Error("Invalid JPEG dimensions");
      return { width, height };
    }
    offset += segmentLength;
  }
  throw new Error("Missing JPEG dimensions");
}
