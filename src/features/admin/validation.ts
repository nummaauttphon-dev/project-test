/**
 * Input rules for the admin product and settings forms. Pure functions: the Server Actions call
 * them, and so do the unit tests. Messages are Thai because they are shown under the field.
 */

export const MAX_PRODUCT_PRICE_BAHT = 10_000_000;
export const MAX_SHIPPING_FEE_BAHT = 10_000;
export const MAX_STOCK = 1_000_000;
export const MIN_PAYMENT_WINDOW = 1;
export const MAX_PAYMENT_WINDOW = 10_080;
export const MAX_CONTACT_URL = 500;
export const MAX_SLUG = 80;
export const MAX_NAME = 120;
export const MAX_DESCRIPTION = 2000;

export const FIELD_MESSAGES = {
  slug: "ชื่อในลิงก์ใช้ได้เฉพาะตัวอักษรอังกฤษพิมพ์เล็ก ตัวเลข และขีดกลาง ยาว 1-80 ตัวอักษร",
  slugTaken: "ชื่อในลิงก์นี้ซ้ำกับสินค้าอื่น กรุณาใช้ชื่ออื่น",
  name: "กรุณากรอกชื่อสินค้า ไม่เกิน 120 ตัวอักษร",
  description: "คำอธิบายต้องไม่เกิน 2,000 ตัวอักษร",
  price: "กรุณากรอกราคาเป็นบาท 0-10,000,000 ทศนิยมไม่เกิน 2 ตำแหน่ง เช่น 120 หรือ 120.50",
  stock: "จำนวนสต็อกเริ่มต้นต้องเป็นจำนวนเต็ม 0-1,000,000",
  shippingFee: "กรุณากรอกค่าส่งเป็นบาท 0-10,000 ทศนิยมไม่เกิน 2 ตำแหน่ง เช่น 50 หรือ 49.50",
  paymentWindowMinutes: "เวลาแนบสลิปต้องเป็นจำนวนเต็มนาที 1-10,080",
  contactUrl: "ช่องทางติดต่อต้องว่างไว้ หรือเป็นลิงก์ที่ขึ้นต้นด้วย http:// หรือ https:// ไม่เกิน 500 ตัวอักษร",
} as const;

export type FieldErrors = Record<string, string>;
export type Validated<T> = { ok: true; value: T } | { ok: false; fieldErrors: FieldErrors };

/** Characters as a person counts them: an emoji is one, not two UTF-16 units. */
function length(text: string): number {
  return [...text].length;
}

const BAHT = /^(\d+)(?:\.(\d{1,2}))?$/;

/**
 * Baht with up to two decimals to whole satang, by string arithmetic only: 0.1 + 0.2 style drift
 * cannot occur because no fractional number is ever formed. Null for anything else, including a
 * sign, an exponent, a grouping comma, more than two decimals, or a value above `maxBaht`.
 */
export function parseBahtToSatang(value: unknown, maxBaht: number): number | null {
  if (typeof value !== "string") return null;
  const match = BAHT.exec(value.trim());
  if (!match) return null;
  const whole = match[1].replace(/^0+(?=\d)/, "");
  // Longer than the limit's own digits cannot fit; this also keeps Number() exact below.
  if (whole.length > String(maxBaht).length) return null;
  const satang = Number(whole) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return satang <= maxBaht * 100 ? satang : null;
}

/** Satang as the text of a baht input: "12.50", "7" for 700, "0.07". */
export function satangToBahtInput(satang: number): string {
  const whole = Math.trunc(satang / 100);
  const part = satang % 100;
  return part === 0 ? String(whole) : `${whole}.${String(part).padStart(2, "0")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integer(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "string" || !/^\d{1,10}$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return n >= min && n <= max ? n : null;
}

export type ProductValues = {
  slug: string;
  name: string;
  description: string;
  priceSatang: number;
  /** The opening stock of a new product; undefined when editing, where stock has its own action. */
  stock?: number;
};

const SLUG = /^[a-z0-9-]{1,80}$/;

export function validateProductInput(input: unknown, options: { creating: boolean }): Validated<ProductValues> {
  const source = isRecord(input) ? input : {};
  const fieldErrors: FieldErrors = {};

  const slug = typeof source.slug === "string" ? source.slug.trim() : "";
  if (!SLUG.test(slug)) fieldErrors.slug = FIELD_MESSAGES.slug;

  const name = typeof source.name === "string" ? source.name.trim() : "";
  if (length(name) < 1 || length(name) > MAX_NAME) fieldErrors.name = FIELD_MESSAGES.name;

  const description = typeof source.description === "string" ? source.description.trim() : "";
  if (typeof source.description !== "string" || length(description) > MAX_DESCRIPTION) {
    fieldErrors.description = FIELD_MESSAGES.description;
  }

  const priceSatang = parseBahtToSatang(source.price, MAX_PRODUCT_PRICE_BAHT);
  if (priceSatang === null) fieldErrors.price = FIELD_MESSAGES.price;

  let stock: number | undefined;
  if (options.creating) {
    const parsed = integer(source.stock, 0, MAX_STOCK);
    if (parsed === null) fieldErrors.stock = FIELD_MESSAGES.stock;
    else stock = parsed;
  }

  if (Object.keys(fieldErrors).length > 0 || priceSatang === null) return { ok: false, fieldErrors };
  return { ok: true, value: { slug, name, description, priceSatang, stock } };
}

/** Empty, or an http or https link; anything else, javascript: and data: included, is refused. */
export function validateContactUrl(value: unknown): Validated<string> {
  const bad: Validated<string> = { ok: false, fieldErrors: { contactUrl: FIELD_MESSAGES.contactUrl } };
  if (typeof value !== "string") return bad;
  const url = value.trim();
  if (url === "") return { ok: true, value: "" };
  if (length(url) > MAX_CONTACT_URL) return bad;
  // No whitespace or control characters anywhere: a link has none, and URL parsing would drop them.
  if (/[\s\p{Cc}]/u.test(url) || !/^https?:\/\/[^/?#]/i.test(url)) return bad;
  try {
    const parsed = new URL(url);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.hostname === "") return bad;
  } catch {
    return bad;
  }
  return { ok: true, value: url };
}

export type SettingsValues = {
  shippingFeeSatang: number;
  paymentWindowMinutes: number;
  contactUrl: string;
};

export function validateSettingsInput(input: unknown): Validated<SettingsValues> {
  const source = isRecord(input) ? input : {};
  const fieldErrors: FieldErrors = {};

  const shippingFeeSatang = parseBahtToSatang(source.shippingFee, MAX_SHIPPING_FEE_BAHT);
  if (shippingFeeSatang === null) fieldErrors.shippingFee = FIELD_MESSAGES.shippingFee;

  const paymentWindowMinutes = integer(source.paymentWindowMinutes, MIN_PAYMENT_WINDOW, MAX_PAYMENT_WINDOW);
  if (paymentWindowMinutes === null) fieldErrors.paymentWindowMinutes = FIELD_MESSAGES.paymentWindowMinutes;

  const contact = validateContactUrl(source.contactUrl);
  if (!contact.ok) Object.assign(fieldErrors, contact.fieldErrors);

  if (shippingFeeSatang === null || paymentWindowMinutes === null || !contact.ok) {
    return { ok: false, fieldErrors };
  }
  return { ok: true, value: { shippingFeeSatang, paymentWindowMinutes, contactUrl: contact.value } };
}
