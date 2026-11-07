import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminUser, deleteTestUsers, type TestUser } from "../helpers/admin";
import { adminClient, anonClient, resetData, seedOrder, seedProduct } from "../helpers/supabase";

const auth = vi.hoisted(() => ({ userId: "" }));

vi.mock("@/features/admin/auth", () => ({
  requireAdmin: async () => ({ ok: true, userId: auth.userId }),
}));
vi.mock("next/cache", () => ({ refresh: () => {}, revalidatePath: () => {}, updateTag: () => {} }));

import {
  adjustStockAction,
  saveProductAction,
  setProductActiveAction,
} from "@/features/admin/product-actions";
import { saveSettingsAction } from "@/features/admin/settings-actions";

const FIXTURES = path.join(import.meta.dirname, "..", "fixtures");
const PNG = readFileSync(path.join(FIXTURES, "real.png"));
const HEIC = readFileSync(path.join(FIXTURES, "photo.heic"));
const BUCKET = "product-images";
const UNKNOWN_ID = "99999999-9999-4999-8999-999999999999";

let admin: TestUser;

beforeAll(async () => {
  await deleteTestUsers();
  admin = await createAdminUser();
  auth.userId = admin.id;
});

afterAll(async () => {
  await resetData();
  await deleteTestUsers();
  await restoreSettings();
});

beforeEach(async () => {
  await resetData();
  await restoreSettings();
});

async function restoreSettings() {
  const { error } = await adminClient()
    .from("store_settings")
    .update({ shipping_fee_satang: 5000, payment_window_minutes: 1440, contact_url: "" })
    .eq("id", 1);
  if (error) throw error;
}

const input = (overrides: Record<string, unknown> = {}) => ({
  slug: "ceramic-mug",
  name: "แก้วเซรามิก",
  description: "แก้วใบเล็ก <b>ไม่ใช่ HTML</b>",
  price: "120.50",
  stock: "5",
  ...overrides,
});

const png = (name = "a.png") => new File([PNG], name, { type: "image/png" });

type ProductRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  price_satang: number;
  stock_quantity: number;
  image_path: string | null;
  is_active: boolean;
};

async function productRow(id: string): Promise<ProductRow> {
  const { data, error } = await adminClient().from("products").select("*").eq("id", id).single();
  if (error) throw error;
  return data as ProductRow;
}

async function productCount(): Promise<number | null> {
  const { count } = await adminClient().from("products").select("id", { count: "exact", head: true });
  return count;
}

/** Every object under products/ (or under one product's folder). */
async function objectsOf(productId?: string): Promise<string[]> {
  const storage = adminClient().storage.from(BUCKET);
  const top = await storage.list("products", { limit: 1000 });
  if (top.error) throw top.error;
  const folders = (top.data ?? []).map((entry) => entry.name).filter((name) => !productId || name === productId);
  const out: string[] = [];
  for (const folder of folders) {
    const files = await storage.list(`products/${folder}`, { limit: 1000 });
    if (files.error) throw files.error;
    out.push(...(files.data ?? []).map((file) => `products/${folder}/${file.name}`));
  }
  return out;
}

async function create(overrides: Record<string, unknown> = {}, image?: File) {
  const result = await saveProductAction(input(overrides), image);
  if (!result.ok) throw new Error(`create failed: ${result.code}`);
  return result.data.id;
}

describe("saveProductAction", () => {
  it("creates a product with the price converted to satang and the text kept as text", async () => {
    const id = await create();
    expect(await productRow(id)).toMatchObject({
      slug: "ceramic-mug",
      name: "แก้วเซรามิก",
      description: "แก้วใบเล็ก <b>ไม่ใช่ HTML</b>",
      price_satang: 12050,
      stock_quantity: 5,
      image_path: null,
      is_active: true,
    });
  });

  it("rejects duplicate slug with a field error", async () => {
    await seedProduct({ slug: "taken" });
    const result = await saveProductAction(input({ slug: "taken" }));
    expect(result).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      fieldErrors: { slug: expect.stringMatching(/ซ้ำ/) },
    });
    expect(await productCount()).toBe(1);
  });

  it("rejects a slug another product holds when editing, but not the product's own", async () => {
    await seedProduct({ slug: "taken" });
    const id = await create({ slug: "mine" });
    expect(await saveProductAction({ ...input({ slug: "taken" }), id })).toMatchObject({
      ok: false,
      fieldErrors: { slug: expect.any(String) },
    });
    expect(await saveProductAction({ ...input({ slug: "mine", name: "ชื่อใหม่" }), id })).toMatchObject({ ok: true });
    expect((await productRow(id)).name).toBe("ชื่อใหม่");
  });

  it("rejects negative price and non-integer baht precision", async () => {
    for (const price of ["-1", "-0.01", "1.234", "10000000.01", "abc"]) {
      const result = await saveProductAction(input({ price }));
      expect(result, price).toMatchObject({ ok: false, fieldErrors: { price: expect.any(String) } });
    }
    expect(await productCount()).toBe(0);
  });

  it("edits fields without touching stock or visibility", async () => {
    const id = await create({ stock: "7" });
    await setProductActiveAction(id, false);
    const result = await saveProductAction({ ...input({ name: "ใหม่", price: "99.99", stock: "999" }), id });
    expect(result).toMatchObject({ ok: true });
    expect(await productRow(id)).toMatchObject({ name: "ใหม่", price_satang: 9999, stock_quantity: 7, is_active: false });
  });

  it("answers NOT_FOUND for an unknown product id", async () => {
    expect(await saveProductAction({ ...input(), id: UNKNOWN_ID })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await saveProductAction({ ...input(), id: "nope" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("stores an image under products/<id>/<random>.<ext>", async () => {
    const id = await create({}, png());
    const row = await productRow(id);
    expect(row.image_path).toMatch(new RegExp(`^products/${id}/[0-9a-f-]{36}\\.png$`));
    expect(await objectsOf(id)).toEqual([row.image_path]);
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${row.image_path}`;
    expect((await fetch(url)).status).toBe(200);
  });

  it("rejects images by content, not by name or declared type", async () => {
    const fake = new File(["not an image"], "evil.png", { type: "image/png" });
    expect(await saveProductAction(input(), fake)).toMatchObject({ ok: false, fieldErrors: { image: expect.any(String) } });
    const heic = new File([HEIC], "p.jpg", { type: "image/jpeg" });
    expect(await saveProductAction(input(), heic)).toMatchObject({ ok: false, fieldErrors: { image: expect.any(String) } });
    const big = new File([new Uint8Array(4_194_305)], "big.png", { type: "image/png" });
    expect(await saveProductAction(input(), big)).toMatchObject({ ok: false, fieldErrors: { image: expect.any(String) } });
    expect(await productCount()).toBe(0);
    expect(await objectsOf()).toEqual([]);
  });

  it("deletes the new upload when the database refuses a create", async () => {
    await seedProduct({ slug: "taken" });
    expect(await saveProductAction(input({ slug: "taken" }), png())).toMatchObject({ ok: false });
    expect(await objectsOf()).toEqual([]);
  });

  it("replaces an image and deletes the old object", async () => {
    const id = await create({}, png());
    const old = (await productRow(id)).image_path;
    expect(await saveProductAction({ ...input(), id }, png("b.png"))).toMatchObject({ ok: true });
    const next = (await productRow(id)).image_path;
    expect(next).not.toBe(old);
    expect(await objectsOf(id)).toEqual([next]);
  });

  it("keeps the old image and deletes the new upload when an edit fails", async () => {
    const id = await create({}, png());
    const old = (await productRow(id)).image_path;
    await seedProduct({ slug: "taken" });
    const result = await saveProductAction({ ...input({ slug: "taken" }), id }, png("b.png"));
    expect(result).toMatchObject({ ok: false, fieldErrors: { slug: expect.any(String) } });
    expect((await productRow(id)).image_path).toBe(old);
    expect(await objectsOf(id)).toEqual([old]);
  });

  it("keeps the image when an edit sends none", async () => {
    const id = await create({}, png());
    const old = (await productRow(id)).image_path;
    await saveProductAction({ ...input({ name: "เปลี่ยนชื่อ" }), id });
    expect((await productRow(id)).image_path).toBe(old);
    expect(await objectsOf(id)).toEqual([old]);
  });
});

describe("setProductActiveAction", () => {
  const visible = async (id: string) => (await anonClient().from("products").select("id").eq("id", id)).data?.length;

  it("hides and shows a product in the store", async () => {
    const id = await create();
    expect(await visible(id)).toBe(1);
    expect(await setProductActiveAction(id, false)).toEqual({ ok: true, data: { isActive: false } });
    expect(await visible(id)).toBe(0);
    expect(await setProductActiveAction(id, true)).toEqual({ ok: true, data: { isActive: true } });
    expect(await visible(id)).toBe(1);
  });

  it("hiding a sold product keeps order history", async () => {
    const product = await seedProduct({ name: "ขายแล้ว", price_satang: 4200 });
    const order = await seedOrder();
    const { error } = await adminClient().from("order_items").insert({
      order_id: order.id,
      product_id: product.id,
      product_name: product.name,
      unit_price_satang: 4200,
      quantity: 2,
    });
    if (error) throw error;

    expect(await setProductActiveAction(product.id, false)).toMatchObject({ ok: true });

    const items = await adminClient()
      .from("order_items")
      .select("product_name, unit_price_satang, quantity")
      .eq("order_id", order.id);
    expect(items.data).toEqual([{ product_name: "ขายแล้ว", unit_price_satang: 4200, quantity: 2 }]);
    expect((await productRow(product.id)).is_active).toBe(false);
  });

  it("rejects a bad id, a non-boolean and an unknown product", async () => {
    expect(await setProductActiveAction("nope", true)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await setProductActiveAction(UNKNOWN_ID, true)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    const id = await create();
    expect(await setProductActiveAction(id, "false" as unknown as boolean)).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect((await productRow(id)).is_active).toBe(true);
  });
});

describe("adjustStockAction", () => {
  it("adds and removes stock and returns the new stock", async () => {
    const product = await seedProduct({ stock_quantity: 10 });
    expect(await adjustStockAction(product.id, 5)).toEqual({ ok: true, data: { stock: 15 } });
    expect(await adjustStockAction(product.id, -15)).toEqual({ ok: true, data: { stock: 0 } });
    expect((await productRow(product.id)).stock_quantity).toBe(0);
  });

  it("refuses to go below zero and leaves the stock as it was", async () => {
    const product = await seedProduct({ stock_quantity: 3 });
    expect(await adjustStockAction(product.id, -4)).toMatchObject({ ok: false, code: "INSUFFICIENT_STOCK" });
    expect((await productRow(product.id)).stock_quantity).toBe(3);
  });

  it("adjustStock is atomic and cannot go below zero", async () => {
    const product = await seedProduct({ stock_quantity: 3 });
    const results = await Promise.all(Array.from({ length: 12 }, () => adjustStockAction(product.id, -1)));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(results.filter((r) => !r.ok && r.code === "INSUFFICIENT_STOCK")).toHaveLength(9);
    expect((await productRow(product.id)).stock_quantity).toBe(0);
  });

  it("does not lose concurrent additions", async () => {
    const product = await seedProduct({ stock_quantity: 0 });
    await Promise.all(Array.from({ length: 10 }, () => adjustStockAction(product.id, 7)));
    expect((await productRow(product.id)).stock_quantity).toBe(70);
  });

  it("rejects zero, non-integers and out of range deltas", async () => {
    const product = await seedProduct({ stock_quantity: 10 });
    for (const delta of [0, 1.5, 1001, -1001, Number.NaN, Number.POSITIVE_INFINITY, "5" as unknown as number]) {
      expect(await adjustStockAction(product.id, delta), String(delta)).toMatchObject({
        ok: false,
        code: "INVALID_INPUT",
      });
    }
    expect((await productRow(product.id)).stock_quantity).toBe(10);
  });

  it("accepts the limits", async () => {
    const product = await seedProduct({ stock_quantity: 1000 });
    expect(await adjustStockAction(product.id, 1000)).toEqual({ ok: true, data: { stock: 2000 } });
    expect(await adjustStockAction(product.id, -1000)).toEqual({ ok: true, data: { stock: 1000 } });
  });

  it("answers NOT_FOUND for unknown products and refuses to overflow", async () => {
    expect(await adjustStockAction(UNKNOWN_ID, 1)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await adjustStockAction("not-a-uuid", 1)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    const product = await seedProduct({ stock_quantity: 2_147_483_000 });
    expect(await adjustStockAction(product.id, 1000)).toMatchObject({ ok: false, code: "STOCK_LIMIT" });
    expect((await productRow(product.id)).stock_quantity).toBe(2_147_483_000);
  });

  it("cannot be called by the public roles", async () => {
    const product = await seedProduct({ stock_quantity: 3 });
    const viaAnon = await anonClient().rpc("adjust_product_stock", { p_product_id: product.id, p_delta: 100 });
    expect(viaAnon.error).not.toBeNull();
    expect((await productRow(product.id)).stock_quantity).toBe(3);
  });
});

async function settingsRow() {
  const { data, error } = await adminClient().from("store_settings").select("*").eq("id", 1).single();
  if (error) throw error;
  return data as { shipping_fee_satang: number; payment_window_minutes: number; contact_url: string };
}

describe("saveSettingsAction", () => {
  const settings = (overrides: Record<string, unknown> = {}) => ({
    shippingFee: "45.50",
    paymentWindowMinutes: "720",
    contactUrl: "https://line.me/ti/p/shop",
    ...overrides,
  });

  it("saves the fee in satang, the window and the contact URL", async () => {
    expect(await saveSettingsAction(settings())).toMatchObject({ ok: true });
    expect(await settingsRow()).toMatchObject({
      shipping_fee_satang: 4550,
      payment_window_minutes: 720,
      contact_url: "https://line.me/ti/p/shop",
    });
  });

  it("settings reject payment window below 1 minute", async () => {
    for (const paymentWindowMinutes of ["0", "-1", "10081", "1.5", ""]) {
      expect(await saveSettingsAction(settings({ paymentWindowMinutes })), paymentWindowMinutes).toMatchObject({
        ok: false,
        fieldErrors: { paymentWindowMinutes: expect.any(String) },
      });
    }
    expect(await settingsRow()).toMatchObject({ payment_window_minutes: 1440 });
  });

  it("settings accept only http, https contact URLs", async () => {
    for (const contactUrl of ["javascript:alert(1)", "data:text/html,x", "ftp://x.com", "line.me/x"]) {
      expect(await saveSettingsAction(settings({ contactUrl })), contactUrl).toMatchObject({
        ok: false,
        fieldErrors: { contactUrl: expect.any(String) },
      });
    }
    expect(await saveSettingsAction(settings({ contactUrl: "http://example.com" }))).toMatchObject({ ok: true });
    expect(await saveSettingsAction(settings({ contactUrl: "" }))).toMatchObject({ ok: true });
    expect((await settingsRow()).contact_url).toBe("");
  });

  it("rejects a negative or over-limit fee and leaves the row alone", async () => {
    for (const shippingFee of ["-1", "10000.01", "1.999"]) {
      expect(await saveSettingsAction(settings({ shippingFee })), shippingFee).toMatchObject({
        ok: false,
        fieldErrors: { shippingFee: expect.any(String) },
      });
    }
    expect(await settingsRow()).toMatchObject({ shipping_fee_satang: 5000, contact_url: "" });
  });
});
