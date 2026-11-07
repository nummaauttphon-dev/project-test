import { randomUUID } from "node:crypto";
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
import { connect } from "../helpers/pg";

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
      const admin = adminClient();
      const product = await seedProduct();
      const order = await seedOrder();
      const created = await admin.auth.admin.createUser({
        email: `rls-${randomUUID()}@example.test`,
        password: randomUUID(),
        email_confirm: true,
      });
      if (created.error || !created.data.user) throw new Error("createUser failed");
      const userId = created.data.user.id;
      try {
        const rows: Record<string, Record<string, unknown>> = {
          orders: {
            customer_name: "x",
            phone: "0812345678",
            shipping_address: "ที่อยู่ทดสอบ 1234567890",
            subtotal_satang: 1,
            shipping_fee_satang: 0,
            total_satang: 1,
            token_hash: randomUUID(),
            idempotency_key: randomUUID(),
            expires_at: new Date(Date.now() + 3600000).toISOString(),
          },
          order_items: {
            order_id: order.id,
            product_id: product.id,
            product_name: "x",
            unit_price_satang: 1,
            quantity: 1,
          },
          payment_slips: { order_id: order.id, storage_path: `${order.id}/anon.png` },
          store_settings: {
            id: 1,
            shipping_fee_satang: 1,
            payment_window_minutes: 1,
            contact_url: "",
          },
          admins: { user_id: userId },
          rate_limits: {
            key_hash: "anon",
            action: "x",
            window_start: new Date().toISOString(),
            count: 1,
          },
        };
        // Seed one real row in the table (store_settings already has its row).
        if (table !== "store_settings" && table !== "orders") {
          const seeded = await admin.from(table).insert(rows[table]);
          expect(seeded.error).toBeNull();
        }
        const server = await admin.from(table).select("*");
        expect(server.data?.length).toBeGreaterThan(0);

        const read = await anonClient().from(table).select("*");
        expect(read.error?.code).toBe("42501");
        expect(read.data).toBeNull();

        const write = await anonClient().from(table).insert(rows[table]);
        expect(write.error?.code).toBe("42501");
      } finally {
        await resetData();
        await admin.from("admins").delete().eq("user_id", userId);
        await admin.auth.admin.deleteUser(userId);
      }
    },
  );

  it("objects created later in public are closed to anon by default", async () => {
    const client = await connect();
    try {
      await client.query("begin");
      await client.query("create table public.zz_future (id int)");
      await client.query("create function public.zz_future_fn() returns int language sql as 'select 1'");
      const { rows } = await client.query<Record<string, boolean>>(
        `select
           has_table_privilege('anon', 'public.zz_future', 'select') as anon_select,
           has_table_privilege('authenticated', 'public.zz_future', 'insert') as auth_insert,
           has_function_privilege('anon', 'public.zz_future_fn()', 'execute') as anon_exec,
           has_function_privilege('authenticated', 'public.zz_future_fn()', 'execute') as auth_exec,
           has_table_privilege('anon', 'public.products', 'select') as products_select`,
      );
      expect(rows[0]).toEqual({
        anon_select: false,
        auth_insert: false,
        anon_exec: false,
        auth_exec: false,
        products_select: true,
      });
    } finally {
      await client.query("rollback");
      await client.end();
    }
  });

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
    const second = await adminClient().from("store_settings").insert({
      id: 2,
      shipping_fee_satang: 5000,
      payment_window_minutes: 1440,
      contact_url: "",
    });
    expect(second.error?.code).toBe("23514");
  });
});
