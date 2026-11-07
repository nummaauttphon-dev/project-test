"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { validateSlipFile, type SlipValidation } from "@/lib/slip-file";
import { fail, ok, type ActionResult } from "@/lib/result";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "./auth";
import { FIELD_MESSAGES, isUuid, validateProductInput } from "./validation";

/**
 * Admin product actions. Each one's first statement is requireAdmin(), before any argument is
 * read: tests/unit/admin-guards.test.ts holds every action to that. There is deliberately no
 * delete: order_items keep their foreign key, and a product leaves the store by being hidden.
 */

const BUCKET = "product-images";
const UNIQUE_VIOLATION = "23505";

const MESSAGES = {
  INVALID_INPUT: "กรุณาตรวจสอบข้อมูลที่กรอก แล้วลองบันทึกอีกครั้ง",
  NOT_FOUND: "ไม่พบสินค้านี้ อาจถูกเปลี่ยนจากหน้าอื่น กรุณากลับไปที่รายการสินค้า",
  SAVE_FAILED: "บันทึกสินค้าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
  UPLOAD_FAILED: "อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
  ACTION_FAILED: "ทำรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
  INSUFFICIENT_STOCK: "สต็อกไม่พอให้ลดตามจำนวนนี้ สต็อกต้องไม่ต่ำกว่า 0",
  STOCK_LIMIT: "สต็อกรวมจะเกินค่าสูงสุดที่ระบบเก็บได้",
  INVALID_DELTA: "จำนวนที่ปรับต้องเป็นจำนวนเต็ม -1,000 ถึง 1,000 และไม่เป็น 0",
} as const;

const IMAGE_MESSAGES: Record<Extract<SlipValidation, { ok: false }>["code"], string> = {
  TOO_LARGE: "รูปใหญ่เกิน 4 MB กรุณาเลือกรูปที่เล็กลง",
  UNSUPPORTED_TYPE: "รองรับเฉพาะรูป JPEG, PNG หรือ WebP",
  HEIC: "ไม่รองรับไฟล์ HEIC กรุณาแปลงเป็น JPEG, PNG หรือ WebP ก่อน",
  EMPTY: "ไฟล์รูปว่างเปล่า กรุณาเลือกรูปใหม่",
};

export type ProductInput = {
  /** Present when editing an existing product. */
  id?: string;
  slug: string;
  name: string;
  description: string;
  /** Baht as typed, up to two decimals. */
  price: string;
  /** Opening stock of a new product, as typed. Ignored when editing: stock has its own action. */
  stock?: string;
};

/** Only a short, code-shaped value is logged; anything else could carry data. */
function loggable(code: unknown): string {
  return typeof code === "string" && /^[A-Z0-9_]{1,40}$/.test(code) ? code : "unexpected";
}

/** Product changes show in the store at once, and in the admin lists. */
function revalidateProducts(): void {
  revalidatePath("/");
  revalidatePath("/products/[slug]", "page");
  revalidatePath("/cart");
  revalidatePath("/admin");
  revalidatePath("/admin/products");
  revalidatePath("/admin/products/[id]", "page");
}

function slugTaken(): ActionResult<never> {
  return fail("INVALID_INPUT", MESSAGES.INVALID_INPUT, { slug: FIELD_MESSAGES.slugTaken });
}

function notFound(): ActionResult<never> {
  return fail("NOT_FOUND", MESSAGES.NOT_FOUND);
}

/** Best effort: a leftover object is harmless, a failed save is not. */
async function removeObject(path: string): Promise<void> {
  try {
    const { error } = await createAdminClient().storage.from(BUCKET).remove([path]);
    if (error) console.error("product image cleanup failed", error.name);
  } catch {
    console.error("product image cleanup threw");
  }
}

export async function saveProductAction(
  input: ProductInput,
  image?: File | null,
): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;

  const rawId = typeof input === "object" && input !== null ? input.id : undefined;
  const editing = rawId !== undefined && rawId !== null;
  if (editing && !isUuid(rawId)) return notFound();

  const checked = validateProductInput(input, { creating: !editing });
  const fieldErrors: Record<string, string> = checked.ok ? {} : { ...checked.fieldErrors };

  let file: Extract<SlipValidation, { ok: true }> | null = null;
  if (image !== undefined && image !== null) {
    const validated = image instanceof File ? await validateSlipFile(image) : null;
    if (!validated) fieldErrors.image = IMAGE_MESSAGES.UNSUPPORTED_TYPE;
    else if (!validated.ok) fieldErrors.image = IMAGE_MESSAGES[validated.code];
    else file = validated;
  }
  if (!checked.ok || Object.keys(fieldErrors).length > 0) {
    return fail("INVALID_INPUT", MESSAGES.INVALID_INPUT, fieldErrors);
  }

  const { slug, name, description, priceSatang, stock } = checked.value;
  const fields = { slug, name, description, price_satang: priceSatang };
  const db = createAdminClient();

  try {
    const productId = editing ? (rawId as string) : randomUUID();

    let previousPath: string | null = null;
    if (editing) {
      const current = await db.from("products").select("image_path").eq("id", productId).maybeSingle();
      if (current.error) {
        console.error("saveProduct read failed", loggable(current.error.code));
        return fail("SAVE_FAILED", MESSAGES.SAVE_FAILED);
      }
      if (!current.data) return notFound();
      previousPath = current.data.image_path ? String(current.data.image_path) : null;
    }

    // Upload first so the row never points at a missing object; undo it if the row is refused.
    let newPath: string | null = null;
    if (file) {
      newPath = `products/${productId}/${randomUUID()}.${file.ext}`;
      const uploaded = await db.storage.from(BUCKET).upload(newPath, file.bytes, {
        contentType: file.mime,
        upsert: false,
      });
      if (uploaded.error) {
        console.error("product image upload failed", uploaded.error.name);
        return fail("UPLOAD_FAILED", MESSAGES.UPLOAD_FAILED, { image: MESSAGES.UPLOAD_FAILED });
      }
    }

    const saved = editing
      ? await db
          .from("products")
          .update(newPath ? { ...fields, image_path: newPath } : fields)
          .eq("id", productId)
          .select("id")
          .maybeSingle()
      : await db
          .from("products")
          .insert({ ...fields, id: productId, stock_quantity: stock ?? 0, image_path: newPath })
          .select("id")
          .maybeSingle();

    if (saved.error || !saved.data) {
      if (newPath) await removeObject(newPath);
      if (saved.error?.code === UNIQUE_VIOLATION) return slugTaken();
      if (!saved.error) return notFound();
      console.error("saveProduct failed", loggable(saved.error.code));
      return fail("SAVE_FAILED", MESSAGES.SAVE_FAILED);
    }

    // Only now is the old image unreferenced.
    if (newPath && previousPath && previousPath !== newPath) await removeObject(previousPath);

    revalidateProducts();
    return ok({ id: productId });
  } catch {
    console.error("saveProduct threw");
    return fail("SAVE_FAILED", MESSAGES.SAVE_FAILED);
  }
}

/** Hiding keeps the product and every order that bought it; showing brings it back. */
export async function setProductActiveAction(
  id: string,
  active: boolean,
): Promise<ActionResult<{ isActive: boolean }>> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;
  if (!isUuid(id)) return notFound();
  if (typeof active !== "boolean") return fail("INVALID_INPUT", MESSAGES.INVALID_INPUT);

  try {
    const { data, error } = await createAdminClient()
      .from("products")
      .update({ is_active: active })
      .eq("id", id)
      .select("is_active")
      .maybeSingle();
    if (error) {
      console.error("setProductActive failed", loggable(error.code));
      return fail("ACTION_FAILED", MESSAGES.ACTION_FAILED);
    }
    if (!data) return notFound();
    revalidateProducts();
    return ok({ isActive: Boolean(data.is_active) });
  } catch {
    console.error("setProductActive threw");
    return fail("ACTION_FAILED", MESSAGES.ACTION_FAILED);
  }
}

const KNOWN_STOCK_CODES = {
  NOT_FOUND: MESSAGES.NOT_FOUND,
  INSUFFICIENT_STOCK: MESSAGES.INSUFFICIENT_STOCK,
  STOCK_LIMIT: MESSAGES.STOCK_LIMIT,
} as const;

/** Adds delta (negative to remove) to the stock in one database statement, never below 0. */
export async function adjustStockAction(id: string, delta: number): Promise<ActionResult<{ stock: number }>> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;
  if (!isUuid(id)) return notFound();
  if (typeof delta !== "number" || !Number.isInteger(delta) || delta === 0 || delta < -1000 || delta > 1000) {
    return fail("INVALID_INPUT", MESSAGES.INVALID_DELTA);
  }

  try {
    const { data, error } = await createAdminClient().rpc("adjust_product_stock", {
      p_product_id: id,
      p_delta: delta,
    });
    if (error) {
      console.error("adjust_product_stock failed", loggable(error.code));
      return fail("ACTION_FAILED", MESSAGES.ACTION_FAILED);
    }
    const result = data as { ok?: unknown; stock?: unknown; code?: unknown } | null;
    if (result?.ok === true) {
      revalidateProducts();
      return ok({ stock: Number(result.stock) });
    }
    if (typeof result?.code === "string" && Object.hasOwn(KNOWN_STOCK_CODES, result.code)) {
      const code = result.code as keyof typeof KNOWN_STOCK_CODES;
      return fail(code, KNOWN_STOCK_CODES[code]);
    }
    console.error("adjust_product_stock refused", loggable(result?.code));
    return fail("ACTION_FAILED", MESSAGES.ACTION_FAILED);
  } catch {
    console.error("adjust_product_stock threw");
    return fail("ACTION_FAILED", MESSAGES.ACTION_FAILED);
  }
}
