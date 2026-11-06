import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  adminClient,
  anonClient,
  resetData,
  seedOrder,
  seedProduct,
  type Product,
} from "../helpers/supabase";

const SHIPPING = 5000;
const SIGNATURES = [
  "public.create_order(text,text,text,text,text,jsonb,bigint)",
  "public.create_order_existing_result(text)",
];

type Line = { product_id: string; quantity: number };
type Change = {
  product_id: string;
  reason: "insufficient_stock" | "unavailable" | "price_changed";
  available_quantity: number;
  current_price_satang: number | null;
};
type Placed = { order_id: string; order_number: string };
type PlaceResult =
  | ({ status: "created" } & Placed)
  | ({ status: "existing" } & Placed)
  | { status: "changed"; changes: Change[]; current_total_satang: number };

/** In production the token is HMAC-derived from the key, so repeats of a key share a token_hash. */
function tokenHashFor(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function args(items: unknown, expected: number | null, key: string = randomUUID()) {
  return {
    p_idempotency_key: key,
    p_token_hash: tokenHashFor(key),
    p_customer_name: "ลูกค้าทดสอบ",
    p_phone: "0812345678",
    p_shipping_address: "123 ถนนทดสอบ แขวงทดสอบ เขตทดสอบ กรุงเทพฯ 10100",
    p_items: items,
    p_expected_total_satang: expected,
  };
}

async function callRpc(rpcArgs: ReturnType<typeof args>): Promise<PlaceResult> {
  const { data, error } = await adminClient().rpc("create_order", rpcArgs);
  if (error) throw new Error(`create_order: ${error.code} ${error.message}`);
  return data as PlaceResult;
}

function place(items: Line[], expected: number, key?: string): Promise<PlaceResult> {
  return callRpc(args(items, expected, key));
}

/** Orders one unit of a product at its seeded price. */
function placeRpc(product: Product, key: string): Promise<PlaceResult> {
  return place([{ product_id: product.id, quantity: 1 }], product.price_satang + SHIPPING, key);
}

function expectStatus<S extends PlaceResult["status"]>(
  result: PlaceResult,
  ...statuses: S[]
): asserts result is Extract<PlaceResult, { status: S }> {
  expect(statuses as string[]).toContain(result.status);
}

async function stockOf(id: string): Promise<number> {
  const { data, error } = await adminClient()
    .from("products")
    .select("stock_quantity")
    .eq("id", id)
    .single();
  if (error || !data) throw new Error(`stockOf: ${error?.message}`);
  return data.stock_quantity as number;
}

async function orderCount(): Promise<number> {
  const { count, error } = await adminClient()
    .from("orders")
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(`orderCount: ${error.message}`);
  return count ?? 0;
}

async function itemCount(): Promise<number> {
  const { count, error } = await adminClient()
    .from("order_items")
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(`itemCount: ${error.message}`);
  return count ?? 0;
}

async function setSettings(values: { shipping_fee_satang?: number; payment_window_minutes?: number }) {
  const { error } = await adminClient().from("store_settings").update(values).eq("id", 1);
  if (error) throw new Error(`setSettings: ${error.message}`);
}

async function connect(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}

/** Inserts an order row inside an open transaction, invisible to other sessions until commit. */
async function insertOrderInTx(client: pg.Client, key: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into public.orders
       (customer_name, phone, shipping_address, subtotal_satang, shipping_fee_satang,
        total_satang, token_hash, idempotency_key, expires_at)
     values ('x', '0812345678', 'ที่อยู่ทดสอบ', 10000, 5000, 15000, $1, $2, now() + interval '1 day')
     returning id`,
    [tokenHashFor(key), key],
  );
  return rows[0].id;
}

/** Waits until the pending create_order call is parked on a heavyweight lock. */
async function waitUntilBlocked(observer: pg.Client, pending: Promise<PlaceResult>): Promise<void> {
  let settled = false;
  const finished = pending.then(
    () => {
      settled = true;
      throw new Error("create_order finished without blocking");
    },
    (error: unknown) => {
      settled = true;
      throw error;
    },
  );
  const poll = async () => {
    const deadline = Date.now() + 10000;
    while (!settled && Date.now() < deadline) {
      const { rows } = await observer.query<{ n: string }>(
        `select count(*) as n from pg_stat_activity
         where wait_event_type = 'Lock' and query ilike '%create_order%'`,
      );
      if (Number(rows[0].n) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!settled) throw new Error("create_order never blocked on a lock");
  };
  await Promise.race([poll(), finished]);
}

describe("create_order", () => {
  const clients: pg.Client[] = [];

  async function tracked(): Promise<pg.Client> {
    const client = await connect();
    clients.push(client);
    return client;
  }

  beforeEach(async () => {
    await resetData();
  });

  afterEach(async () => {
    // Ends any transaction a failed test left open, so blocked calls cannot hang the suite.
    await Promise.all(clients.splice(0).map((client) => client.end()));
    await setSettings({ shipping_fee_satang: SHIPPING, payment_window_minutes: 1440 });
  });

  describe("happy path", () => {
    it("creates order, snapshots price and deducts stock", async () => {
      const a = await seedProduct({ price_satang: 12000, stock_quantity: 5 });
      const b = await seedProduct({ price_satang: 3050, stock_quantity: 4 });
      const total = 12000 * 2 + 3050 * 3 + SHIPPING;

      const rpcArgs = args(
        [
          { product_id: a.id, quantity: 2 },
          { product_id: b.id, quantity: 3 },
        ],
        total,
      );
      const result = await callRpc(rpcArgs);

      expectStatus(result, "created");
      expect(Object.keys(result).sort()).toEqual(["order_id", "order_number", "status"]);
      expect(result.order_number).toMatch(/^ORD-\d{6}$/);
      expect(await stockOf(a.id)).toBe(3);
      expect(await stockOf(b.id)).toBe(1);

      const db = adminClient();
      const { data: order } = await db.from("orders").select("*").eq("id", result.order_id).single();
      expect(order).toMatchObject({
        order_number: result.order_number,
        status: "awaiting_payment",
        customer_name: rpcArgs.p_customer_name,
        phone: rpcArgs.p_phone,
        shipping_address: rpcArgs.p_shipping_address,
        subtotal_satang: 12000 * 2 + 3050 * 3,
        shipping_fee_satang: SHIPPING,
        total_satang: total,
        token_hash: rpcArgs.p_token_hash,
        idempotency_key: rpcArgs.p_idempotency_key,
      });

      // Later edits to the product must not touch the snapshot.
      await db.from("products").update({ price_satang: 1, name: "ชื่อใหม่" }).eq("id", a.id);
      const { data: items } = await db
        .from("order_items")
        .select("product_id, product_name, unit_price_satang, quantity")
        .eq("order_id", result.order_id);
      expect(items).toHaveLength(2);
      expect(items).toEqual(
        expect.arrayContaining([
          { product_id: a.id, product_name: a.name, unit_price_satang: 12000, quantity: 2 },
          { product_id: b.id, product_name: b.name, unit_price_satang: 3050, quantity: 3 },
        ]),
      );
    });

    it("sells exactly the remaining stock", async () => {
      const product = await seedProduct({ price_satang: 100, stock_quantity: 3 });
      const result = await place([{ product_id: product.id, quantity: 3 }], 300 + SHIPPING);
      expectStatus(result, "created");
      expect(await stockOf(product.id)).toBe(0);
    });

    it("takes the shipping fee from store_settings", async () => {
      await setSettings({ shipping_fee_satang: 7700 });
      const product = await seedProduct({ price_satang: 1000 });
      const result = await place([{ product_id: product.id, quantity: 1 }], 8700);
      expectStatus(result, "created");
      const { data } = await adminClient()
        .from("orders")
        .select("subtotal_satang, shipping_fee_satang, total_satang")
        .eq("id", result.order_id)
        .single();
      expect(data).toEqual({ subtotal_satang: 1000, shipping_fee_satang: 7700, total_satang: 8700 });
    });

    it("sets expires_at from payment_window_minutes", async () => {
      await setSettings({ payment_window_minutes: 90 });
      const product = await seedProduct();
      const result = await placeRpc(product, randomUUID());
      expectStatus(result, "created");
      const { data } = await adminClient()
        .from("orders")
        .select("created_at, expires_at")
        .eq("id", result.order_id)
        .single();
      const window = Date.parse(data?.expires_at) - Date.parse(data?.created_at);
      expect(window).toBe(90 * 60 * 1000);
    });
  });

  describe("idempotency", () => {
    it("returns existing order for repeated idempotency key", async () => {
      const product = await seedProduct({ stock_quantity: 5 });
      const key = randomUUID();
      const first = await placeRpc(product, key);
      const second = await placeRpc(product, key);
      expectStatus(first, "created");
      expectStatus(second, "existing");
      expect(second.order_id).toBe(first.order_id);
      expect(second.order_number).toBe(first.order_number);
      expect(await stockOf(product.id)).toBe(4);
      expect(await orderCount()).toBe(1);
    });

    it("returns existing even after price and stock moved on", async () => {
      const product = await seedProduct({ price_satang: 1000, stock_quantity: 1 });
      const key = randomUUID();
      const first = await placeRpc(product, key);
      expectStatus(first, "created");
      await adminClient().from("products").update({ price_satang: 2000 }).eq("id", product.id);
      const second = await placeRpc(product, key);
      expectStatus(second, "existing");
      expect(second.order_id).toBe(first.order_id);
    });

    it("gives one order when the same key races for the last item", async () => {
      const product = await seedProduct({ stock_quantity: 1 });
      const key = randomUUID();
      const results = await Promise.all(Array.from({ length: 10 }, () => placeRpc(product, key)));
      expect(results.filter((r) => r.status === "created")).toHaveLength(1);
      expect(results.filter((r) => r.status === "existing")).toHaveLength(9);
      expect(await stockOf(product.id)).toBe(0);
      expect(await orderCount()).toBe(1);
    });

    it("re-checks the key after waiting for product locks", async () => {
      // The loser of a same-key race waits on the product row, then finds no stock left.
      // It must report the winner's order, not a stock problem.
      const product = await seedProduct({ stock_quantity: 1 });
      const key = randomUUID();
      const holder = await tracked();
      const observer = await tracked();

      await holder.query("begin");
      await holder.query("select 1 from public.products where id = $1 for update", [product.id]);
      const orderId = await insertOrderInTx(holder, key);
      await holder.query("update public.products set stock_quantity = 0 where id = $1", [product.id]);

      const pending = placeRpc(product, key);
      await waitUntilBlocked(observer, pending);
      await holder.query("commit");

      const result = await pending;
      expectStatus(result, "existing");
      expect(result.order_id).toBe(orderId);
    });

    it("treats unique_violation on the key as existing and undoes its stock work", async () => {
      // The other transaction holds the key uncommitted, so both lookups miss it.
      const product = await seedProduct({ stock_quantity: 5 });
      const key = randomUUID();
      const holder = await tracked();
      const observer = await tracked();

      await holder.query("begin");
      const orderId = await insertOrderInTx(holder, key);

      const pending = placeRpc(product, key);
      await waitUntilBlocked(observer, pending);
      await holder.query("commit");

      const result = await pending;
      expectStatus(result, "existing");
      expect(result.order_id).toBe(orderId);
      expect(await stockOf(product.id)).toBe(5);
      expect(await itemCount()).toBe(0);
    });

    it("does not report a token_hash collision as existing", async () => {
      const product = await seedProduct({ stock_quantity: 5 });
      await seedOrder({ token_hash: "taken-token-hash" });
      const rpcArgs = {
        ...args([{ product_id: product.id, quantity: 1 }], product.price_satang + SHIPPING),
        p_token_hash: "taken-token-hash",
      };
      const { data, error } = await adminClient().rpc("create_order", rpcArgs);
      expect(data).toBeNull();
      expect(error?.code).toBe("23505");
      expect(await stockOf(product.id)).toBe(5);
      expect(await itemCount()).toBe(0);
      expect(await orderCount()).toBe(1);
    });
  });

  describe("changed", () => {
    it("uses DB price, ignoring client expectation mismatch", async () => {
      const a = await seedProduct({ price_satang: 12000, stock_quantity: 5 });
      const b = await seedProduct({ price_satang: 3000, stock_quantity: 7 });
      const result = await place(
        [
          { product_id: a.id, quantity: 2 },
          { product_id: b.id, quantity: 1 },
        ],
        100,
      );
      expectStatus(result, "changed");
      expect(result.current_total_satang).toBe(12000 * 2 + 3000 + SHIPPING);
      expect(result.changes).toHaveLength(2);
      expect(result.changes).toEqual(
        expect.arrayContaining([
          {
            product_id: a.id,
            reason: "price_changed",
            available_quantity: 5,
            current_price_satang: 12000,
          },
          {
            product_id: b.id,
            reason: "price_changed",
            available_quantity: 7,
            current_price_satang: 3000,
          },
        ]),
      );
      expect(await orderCount()).toBe(0);
      expect(await stockOf(a.id)).toBe(5);
      expect(await stockOf(b.id)).toBe(7);
    });

    it("reports price_changed when only the shipping fee moved", async () => {
      const product = await seedProduct({ price_satang: 1000 });
      await setSettings({ shipping_fee_satang: 6000 });
      const result = await place([{ product_id: product.id, quantity: 1 }], 1000 + SHIPPING);
      expectStatus(result, "changed");
      expect(result.current_total_satang).toBe(7000);
      expect(result.changes.map((c) => c.reason)).toEqual(["price_changed"]);
      expect(await orderCount()).toBe(0);
    });

    it("does not treat a null expected total as a match", async () => {
      const product = await seedProduct({ stock_quantity: 5 });
      const result = await callRpc(args([{ product_id: product.id, quantity: 1 }], null));
      expectStatus(result, "changed");
      expect(await orderCount()).toBe(0);
      expect(await stockOf(product.id)).toBe(5);
    });

    it("rolls back all items when one is short", async () => {
      const ok = await seedProduct({ price_satang: 1000, stock_quantity: 5 });
      const short = await seedProduct({ price_satang: 200, stock_quantity: 2 });
      const result = await place(
        [
          { product_id: ok.id, quantity: 1 },
          { product_id: short.id, quantity: 3 },
        ],
        1000 + 600 + SHIPPING,
      );
      expectStatus(result, "changed");
      // Stock problems list only the affected line, not every line.
      expect(result.changes).toEqual([
        {
          product_id: short.id,
          reason: "insufficient_stock",
          available_quantity: 2,
          current_price_satang: 200,
        },
      ]);
      expect(result.current_total_satang).toBe(1000 + 200 * 2 + SHIPPING);
      expect(await stockOf(ok.id)).toBe(5);
      expect(await stockOf(short.id)).toBe(2);
      expect(await orderCount()).toBe(0);
      expect(await itemCount()).toBe(0);
    });

    it("reports unavailable for hidden product", async () => {
      const visible = await seedProduct({ price_satang: 1000, stock_quantity: 5 });
      const hidden = await seedProduct({ price_satang: 300, stock_quantity: 9, is_active: false });
      const result = await place(
        [
          { product_id: visible.id, quantity: 1 },
          { product_id: hidden.id, quantity: 1 },
        ],
        1000 + 300 + SHIPPING,
      );
      expectStatus(result, "changed");
      expect(result.changes).toEqual([
        {
          product_id: hidden.id,
          reason: "unavailable",
          available_quantity: 0,
          current_price_satang: 300,
        },
      ]);
      expect(result.current_total_satang).toBe(1000 + SHIPPING);
      expect(await stockOf(hidden.id)).toBe(9);
      expect(await orderCount()).toBe(0);
    });

    it("reports unavailable for a product that does not exist", async () => {
      const missing = randomUUID();
      const result = await place([{ product_id: missing, quantity: 1 }], 1000 + SHIPPING);
      expectStatus(result, "changed");
      expect(result.changes).toEqual([
        {
          product_id: missing,
          reason: "unavailable",
          available_quantity: 0,
          current_price_satang: null,
        },
      ]);
      expect(result.current_total_satang).toBe(SHIPPING);
    });

    it("totals shipping only when nothing is purchasable", async () => {
      const soldOut = await seedProduct({ price_satang: 1000, stock_quantity: 0 });
      const hidden = await seedProduct({ price_satang: 2000, is_active: false });
      const result = await place(
        [
          { product_id: soldOut.id, quantity: 1 },
          { product_id: hidden.id, quantity: 1 },
        ],
        3000 + SHIPPING,
      );
      expectStatus(result, "changed");
      expect(result.current_total_satang).toBe(SHIPPING);
      expect(result.changes).toHaveLength(2);
    });

    it("merges duplicate product lines before checking stock", async () => {
      const product = await seedProduct({ price_satang: 1000, stock_quantity: 5 });
      const line = (quantity: number) => ({ product_id: product.id, quantity });

      const short = await place([line(3), line(3)], 6000 + SHIPPING);
      expectStatus(short, "changed");
      expect(short.changes).toEqual([
        {
          product_id: product.id,
          reason: "insufficient_stock",
          available_quantity: 5,
          current_price_satang: 1000,
        },
      ]);
      expect(short.current_total_satang).toBe(5000 + SHIPPING);
      expect(await stockOf(product.id)).toBe(5);

      const fits = await place([line(3), line(2)], 5000 + SHIPPING);
      expectStatus(fits, "created");
      expect(await stockOf(product.id)).toBe(0);
      const { data: items } = await adminClient()
        .from("order_items")
        .select("quantity")
        .eq("order_id", fits.order_id);
      expect(items).toEqual([{ quantity: 5 }]);
    });
  });

  describe("malformed p_items", () => {
    const ok = "11111111-1111-4111-8111-111111111111";
    const cases: [string, unknown][] = [
      ["SQL null", null],
      ["JSON object", { product_id: ok, quantity: 1 }],
      ["JSON string", "items"],
      ["empty array", []],
      ["non-object element", [1]],
      ["null element", [null]],
      ["missing product_id", [{ quantity: 1 }]],
      ["missing quantity", [{ product_id: ok }]],
      ["null quantity", [{ product_id: ok, quantity: null }]],
      ["null product_id", [{ product_id: null, quantity: 1 }]],
      ["non-string product_id", [{ product_id: 5, quantity: 1 }]],
      ["invalid uuid", [{ product_id: "not-a-uuid", quantity: 1 }]],
      ["uuid without hyphens", [{ product_id: ok.replaceAll("-", ""), quantity: 1 }]],
      ["quantity 0", [{ product_id: ok, quantity: 0 }]],
      ["negative quantity", [{ product_id: ok, quantity: -1 }]],
      ["quantity 11", [{ product_id: ok, quantity: 11 }]],
      ["fractional quantity", [{ product_id: ok, quantity: 1.5 }]],
      ["string quantity", [{ product_id: ok, quantity: "2" }]],
      ["huge quantity", [{ product_id: ok, quantity: 1e30 }]],
      ["one bad line among good", [{ product_id: ok, quantity: 1 }, { product_id: ok, quantity: 0 }]],
      [
        "merged quantity over 10",
        [
          { product_id: ok, quantity: 6 },
          { product_id: ok, quantity: 5 },
        ],
      ],
    ];

    it.each(cases)("raises on %s", async (_name, items) => {
      const { data, error } = await adminClient().rpc("create_order", args(items, 15000));
      expect(data).toBeNull();
      expect(error?.code).toBe("22023");
      expect(await orderCount()).toBe(0);
    });

    it("accepts the boundary quantities 1 and 10", async () => {
      const product = await seedProduct({ price_satang: 100, stock_quantity: 11 });
      const one = await place([{ product_id: product.id, quantity: 1 }], 100 + SHIPPING);
      const ten = await place([{ product_id: product.id, quantity: 10 }], 1000 + SHIPPING);
      expectStatus(one, "created");
      expectStatus(ten, "created");
      expect(await stockOf(product.id)).toBe(0);
    });

    it("reports malformed input even when the key already has an order", async () => {
      const product = await seedProduct();
      const key = randomUUID();
      expectStatus(await placeRpc(product, key), "created");
      const { error } = await adminClient().rpc("create_order", args([], 15000, key));
      expect(error?.code).toBe("22023");
    });
  });

  describe("concurrency", () => {
    it("does not oversell the last item under concurrency", async () => {
      const product = await seedProduct({ stock_quantity: 1 });
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) => placeRpc(product, `key-${i}`)),
      );
      expect(results.filter((r) => r.status === "created")).toHaveLength(1);
      const losers = results.filter((r) => r.status === "changed");
      expect(losers).toHaveLength(9);
      for (const loser of losers) {
        expect(loser.changes).toEqual([
          {
            product_id: product.id,
            reason: "insufficient_stock",
            available_quantity: 0,
            current_price_satang: product.price_satang,
          },
        ]);
      }
      expect(await stockOf(product.id)).toBe(0);
      expect(await orderCount()).toBe(1);
    });

    it("never oversells a partly sufficient stock", async () => {
      const product = await seedProduct({ price_satang: 100, stock_quantity: 7 });
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          place([{ product_id: product.id, quantity: 2 }], 200 + SHIPPING),
        ),
      );
      expect(results.filter((r) => r.status === "created")).toHaveLength(3);
      expect(await stockOf(product.id)).toBe(1);
    });

    it("does not deadlock with opposite item order", { timeout: 20000 }, async () => {
      const a = await seedProduct({ price_satang: 100, stock_quantity: 50 });
      const b = await seedProduct({ price_satang: 100, stock_quantity: 50 });
      const pairs = 10;
      const lineA = { product_id: a.id, quantity: 1 };
      const lineB = { product_id: b.id, quantity: 1 };
      const total = 200 + SHIPPING;

      // A deadlock surfaces as a 40P01 error, which placeRpc-style callers throw.
      const results = await Promise.all(
        Array.from({ length: pairs }, () => [
          place([lineA, lineB], total),
          place([lineB, lineA], total),
        ]).flat(),
      );

      expect(results.filter((r) => r.status === "created")).toHaveLength(pairs * 2);
      expect(await stockOf(a.id)).toBe(50 - pairs * 2);
      expect(await stockOf(b.id)).toBe(50 - pairs * 2);
    });

    it("prices from the row it locked, not from a stale read", async () => {
      const product = await seedProduct({ price_satang: 1000, stock_quantity: 5 });
      const holder = await tracked();
      const observer = await tracked();

      await holder.query("begin");
      await holder.query("select 1 from public.products where id = $1 for update", [product.id]);
      await holder.query("update public.products set price_satang = 2000 where id = $1", [product.id]);

      // The expectation matches the old price, which is still the committed one at this point.
      const pending = place([{ product_id: product.id, quantity: 1 }], 1000 + SHIPPING);
      await waitUntilBlocked(observer, pending);
      await holder.query("commit");

      const result = await pending;
      expectStatus(result, "changed");
      expect(result.changes).toEqual([
        {
          product_id: product.id,
          reason: "price_changed",
          available_quantity: 5,
          current_price_satang: 2000,
        },
      ]);
      expect(result.current_total_satang).toBe(2000 + SHIPPING);
      expect(await orderCount()).toBe(0);
      expect(await stockOf(product.id)).toBe(5);
    });

    it("takes product locks in id order whatever the input order", async () => {
      const first = await seedProduct();
      const second = await seedProduct();
      const [low, high] = [first, second].sort((x, y) => (x.id < y.id ? -1 : 1));
      const holder = await tracked();
      const observer = await tracked();

      await holder.query("begin");
      await holder.query("select 1 from public.products where id = $1 for update", [high.id]);

      // Input lists the row we hold first. Id-ordered locking must still take the lower id,
      // then park on the held row.
      const pending = place(
        [
          { product_id: high.id, quantity: 1 },
          { product_id: low.id, quantity: 1 },
        ],
        high.price_satang + low.price_satang + SHIPPING,
      );
      await waitUntilBlocked(observer, pending);

      const { rowCount } = await observer.query(
        "select 1 from public.products where id = $1 for update skip locked",
        [low.id],
      );
      expect(rowCount).toBe(0);

      await holder.query("commit");
      expectStatus(await pending, "created");
    });
  });

  describe("privileges", () => {
    it("cannot be executed by anon", async () => {
      const product = await seedProduct();
      const rpcArgs = args(
        [{ product_id: product.id, quantity: 1 }],
        product.price_satang + SHIPPING,
      );
      const { error } = await anonClient().rpc("create_order", rpcArgs);
      expect(error?.code).toBe("42501");
      expect(await orderCount()).toBe(0);
      expect(await stockOf(product.id)).toBe(product.stock_quantity);

      const key = randomUUID();
      expectStatus(await placeRpc(product, key), "created");
      const helper = await anonClient().rpc("create_order_existing_result", {
        p_idempotency_key: key,
      });
      expect(helper.error?.code).toBe("42501");
      expect(helper.data).toBeNull();
    });

    it.each(SIGNATURES)("grants EXECUTE to service_role only and pins search_path: %s", async (signature) => {
      const client = await tracked();
      const { rows } = await client.query<Record<string, unknown>>(
        `select
           has_function_privilege('public', $1::regprocedure, 'execute') as public_exec,
           has_function_privilege('anon', $1::regprocedure, 'execute') as anon_exec,
           has_function_privilege('authenticated', $1::regprocedure, 'execute') as auth_exec,
           has_function_privilege('service_role', $1::regprocedure, 'execute') as service_exec,
           (select p.proconfig from pg_proc p where p.oid = $1::regprocedure) as config,
           (select p.prosecdef from pg_proc p where p.oid = $1::regprocedure) as definer`,
        [signature],
      );
      expect(rows[0]).toEqual({
        public_exec: false,
        anon_exec: false,
        auth_exec: false,
        service_exec: true,
        config: ['search_path=""'],
        definer: false,
      });
    });
  });
});
