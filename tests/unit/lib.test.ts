import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatBaht } from "@/lib/money";
import { fail, ok } from "@/lib/result";
import { generateIdempotencyKey } from "@/lib/idempotency";
import { deriveOrderToken, hashOrderToken } from "@/lib/order-token";
import { maskAddress, maskName } from "@/lib/mask";
import { createPromptPayPayload, renderQrDataUrl } from "@/lib/promptpay";
import { validateSlipFile } from "@/lib/slip-file";

function crc16Ccitt(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function fixtureBytes(name: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(readFileSync(path.join(import.meta.dirname, "..", "fixtures", name)));
}

function fileFromFixture(name: string, type: string): File {
  return new File([fixtureBytes(name)], name, { type });
}

function bigPng(size: number): File {
  const bytes = new Uint8Array(size);
  // Valid PNG signature + IHDR header from the real fixture, zero padding after.
  bytes.set(fixtureBytes("real.png").subarray(0, 33));
  return new File([bytes], "big.png", { type: "image/png" });
}

function bigFile(size: number): File {
  return new File([new Uint8Array(size)], "big.bin", { type: "image/png" });
}

describe("money and result", () => {
  it("formats satang as baht", () => {
    expect(formatBaht(12350)).toBe("฿123.50");
    expect(formatBaht(5)).toBe("฿0.05");
    expect(formatBaht(1234500)).toBe("฿12,345.00");
  });

  it("builds ActionResult values", () => {
    expect(ok(1)).toEqual({ ok: true, data: 1 });
    expect(fail("X", "ผิดพลาด", { a: "b" })).toEqual({
      ok: false,
      code: "X",
      message: "ผิดพลาด",
      fieldErrors: { a: "b" },
    });
    expect(fail("X", "m")).not.toHaveProperty("fieldErrors");
  });
});

describe("tokens", () => {
  it("derives deterministic order tokens", () => {
    expect(deriveOrderToken("k", "s")).toBe(deriveOrderToken("k", "s"));
    expect(deriveOrderToken("k", "s")).not.toBe(deriveOrderToken("k", "other"));
    expect(deriveOrderToken("k", "s")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("hashes tokens as sha256 hex", () => {
    expect(hashOrderToken("t")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generates 16-byte idempotency keys", () => {
    expect(Buffer.from(generateIdempotencyKey(), "base64url")).toHaveLength(16);
    expect(generateIdempotencyKey()).not.toBe(generateIdempotencyKey());
    expect(generateIdempotencyKey()).toMatch(/^[A-Za-z0-9_-]{22,}$/);
  });
});

describe("masking", () => {
  it("masks names keeping first grapheme per word", () => {
    expect(maskName("สมชาย ใจดี")).toBe("ส*** ใ***");
  });

  it("masks addresses keeping only the postal code", () => {
    expect(maskAddress("123/45 ถ.สุขุมวิท กรุงเทพฯ 10110")).toBe("••• 10110");
    expect(maskAddress("ไม่มีรหัสไปรษณีย์")).toBe("•••");
  });
});

describe("PromptPay", () => {
  it("creates a valid payload with amount and CRC", () => {
    const payload = createPromptPayPayload("0812345678", 12350);
    expect(payload).toMatch(/^000201/);
    expect(payload).toContain("5406123.50");
    expect(payload.slice(-4)).toBe(crc16Ccitt(payload.slice(0, -4)));
  });

  it("renders a PNG data URL", async () => {
    const url = await renderQrDataUrl(createPromptPayPayload("0812345678", 100));
    expect(url).toMatch(/^data:image\/png;base64,/);
  });
});

describe("validateSlipFile", () => {
  it("accepts a real PNG", async () => {
    const result = await validateSlipFile(fileFromFixture("real.png", "image/png"));
    expect(result).toMatchObject({ ok: true, ext: "png", mime: "image/png" });
  });

  it("rejects content that is not an allowed image", async () => {
    expect(await validateSlipFile(new File(["<svg/>"], "x.png", { type: "image/png" }))).toMatchObject({
      ok: false,
      code: "UNSUPPORTED_TYPE",
    });
  });

  it("rejects HEIC", async () => {
    expect(await validateSlipFile(fileFromFixture("photo.heic", "image/heic"))).toMatchObject({
      ok: false,
      code: "HEIC",
    });
  });

  it("rejects empty files", async () => {
    expect(await validateSlipFile(new File([], "e.png", { type: "image/png" }))).toMatchObject({
      ok: false,
      code: "EMPTY",
    });
  });

  it("enforces the 4 MiB limit", async () => {
    expect(await validateSlipFile(bigFile(4_194_305))).toMatchObject({ ok: false, code: "TOO_LARGE" });
    expect(await validateSlipFile(bigPng(4_194_304))).toMatchObject({ ok: true, ext: "png" });
  });

  it("does not read contents of oversized files", async () => {
    const file = bigFile(4_194_305);
    let read = false;
    file.arrayBuffer = async () => {
      read = true;
      return new ArrayBuffer(0);
    };
    await validateSlipFile(file);
    expect(read).toBe(false);
  });
});
