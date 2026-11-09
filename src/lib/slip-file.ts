import { fileTypeFromBuffer } from "file-type";
import { MAX_IMAGE_BYTES } from "./upload-limits";

const ALLOWED = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type SlipMime = keyof typeof ALLOWED;
export type SlipExt = (typeof ALLOWED)[SlipMime];

export type SlipValidation =
  | { ok: true; mime: SlipMime; ext: SlipExt; bytes: Uint8Array }
  | { ok: false; code: "TOO_LARGE" | "UNSUPPORTED_TYPE" | "HEIC" | "EMPTY" };

function isAllowed(mime: string): mime is SlipMime {
  return Object.hasOwn(ALLOWED, mime);
}

/** Validates by file contents only; file.type and file.name are never trusted. */
export async function validateSlipFile(file: File): Promise<SlipValidation> {
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, code: "TOO_LARGE" };
  if (file.size === 0) return { ok: false, code: "EMPTY" };

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) return { ok: false, code: "EMPTY" };
  if (bytes.byteLength > MAX_IMAGE_BYTES) return { ok: false, code: "TOO_LARGE" };

  const detected = await fileTypeFromBuffer(bytes);
  if (!detected) return { ok: false, code: "UNSUPPORTED_TYPE" };
  if (detected.mime === "image/heic" || detected.mime === "image/heif") {
    return { ok: false, code: "HEIC" };
  }
  if (!isAllowed(detected.mime)) return { ok: false, code: "UNSUPPORTED_TYPE" };
  return { ok: true, mime: detected.mime, ext: ALLOWED[detected.mime], bytes };
}
