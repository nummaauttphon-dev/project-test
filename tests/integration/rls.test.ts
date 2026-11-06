import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  adminClient,
  anonClient,
  resetData,
  seedOrder,
  seedProduct,
  seedProductRaw,
} from "../helpers/supabase";

const png = readFileSync("tests/fixtures/real.png");

beforeEach(async () => {
  await resetData();
});

describe("RLS and storage", () => {
  it("anon reads only active products", async () => {
    const active = await seedProduct();
    const hidden = await seedProduct({ is_active: false });
    const { data } = await anonClient().from("products").select("id");
    expect(data?.map((p) => p.id)).toContain(active.id);
    expect(data?.map((p) => p.id)).not.toContain(hidden.id);
  });

  it.each(["orders", "order_items", "payment_slips", "store_settings", "admins", "rate_limits"])(
    "anon cannot read or write %s",
    async (table) => {
      if (table === "orders") await seedOrder();
      const read = await anonClient().from(table).select("*");
      expect(read.data ?? []).toEqual([]);
      const write = await anonClient().from(table).insert({});
      expect(write.error).not.toBeNull();
    },
  );

  it("anon cannot write products", async () => {
    const product = await seedProduct({ price_satang: 10000 });
    await anonClient().from("products").update({ price_satang: 1 }).eq("id", product.id);
    const insert = await anonClient()
      .from("products")
      .insert({ slug: "x", name: "x", price_satang: 1, stock_quantity: 1 });
    expect(insert.error).not.toBeNull();
    await anonClient().from("products").delete().eq("id", product.id);
    const { data } = await adminClient()
      .from("products")
      .select("price_satang")
      .eq("id", product.id)
      .single();
    expect(data?.price_satang).toBe(10000);
  });

  it("anon cannot read or upload slips", async () => {
    const up = await adminClient()
      .storage.from("payment-slips")
      .upload("o/a.png", png, { contentType: "image/png" });
    expect(up.error).toBeNull();
    const download = await anonClient().storage.from("payment-slips").download("o/a.png");
    expect(download.error).not.toBeNull();
    expect(download.data).toBeNull();
    const listed = await anonClient().storage.from("payment-slips").list("o");
    expect(listed.data ?? []).toEqual([]);
    const upload = await anonClient()
      .storage.from("payment-slips")
      .upload("o/b.png", png, { contentType: "image/png" });
    expect(upload.error).not.toBeNull();
    const listAfter = await adminClient().storage.from("payment-slips").list("o");
    expect(listAfter.data?.map((f) => f.name)).toEqual(["a.png"]);
  });

  it("anon cannot upload product images but can read public ones", async () => {
    const upload = await anonClient()
      .storage.from("product-images")
      .upload("x.png", png, { contentType: "image/png" });
    expect(upload.error).not.toBeNull();
    const none = await adminClient().storage.from("product-images").list("");
    expect(none.data?.map((f) => f.name) ?? []).not.toContain("x.png");

    const put = await adminClient()
      .storage.from("product-images")
      .upload("pub.png", png, { contentType: "image/png", upsert: true });
    expect(put.error).toBeNull();
    const { data } = anonClient().storage.from("product-images").getPublicUrl("pub.png");
    const res = await fetch(data.publicUrl);
    expect(res.status).toBe(200);
    await adminClient().storage.from("product-images").remove(["pub.png"]);
  });

  it("slip bucket rejects oversize and non-image uploads even for the server", async () => {
    const big = await adminClient()
      .storage.from("payment-slips")
      .upload("o/big.png", Buffer.alloc(4194305), { contentType: "image/png" });
    expect(big.error).not.toBeNull();
    const text = await adminClient()
      .storage.from("payment-slips")
      .upload("o/a.txt", Buffer.from("hi"), { contentType: "text/plain" });
    expect(text.error).not.toBeNull();
  });

  it("rejects negative stock and non-integer money", async () => {
    expect((await seedProductRaw({ stock_quantity: -1 })).error).not.toBeNull();
    expect((await seedProductRaw({ price_satang: -1 })).error).not.toBeNull();
    expect((await seedProductRaw({ price_satang: 10.5 })).error).not.toBeNull();
  });

  it("enforces order and slip rules", async () => {
    const order = await seedOrder();
    expect(order.order_number).toMatch(/^ORD-\d{6}$/);
    const db = adminClient();
    const bad = await db
      .from("payment_slips")
      .insert({ order_id: order.id, storage_path: "o/r.png", review_status: "rejected" });
    expect(bad.error).not.toBeNull();
    const first = await db
      .from("payment_slips")
      .insert({ order_id: order.id, storage_path: "o/1.png" });
    expect(first.error).toBeNull();
    const second = await db
      .from("payment_slips")
      .insert({ order_id: order.id, storage_path: "o/2.png" });
    expect(second.error).not.toBeNull();
    const del = await db.from("orders").delete().eq("id", order.id);
    expect(del.error).not.toBeNull();
  });

  it("keeps default store settings", async () => {
    const { data } = await adminClient().from("store_settings").select("*").single();
    expect(data).toMatchObject({
      id: 1,
      shipping_fee_satang: 5000,
      payment_window_minutes: 1440,
      contact_url: "",
    });
    const second = await adminClient().from("store_settings").insert({ id: 2 });
    expect(second.error).not.toBeNull();
  });
});
