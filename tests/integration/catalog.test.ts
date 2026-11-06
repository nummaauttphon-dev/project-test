import { beforeEach, describe, expect, it } from "vitest";
import { adminClient, anonClient, resetData, seedProduct } from "../helpers/supabase";
import {
  getProductBySlug,
  getProductsByIds,
  getStoreSettings,
  listProducts,
} from "@/features/catalog/queries";

beforeEach(resetData);

describe("catalog queries", () => {
  it("lists only active products, newest first, with public fields only", async () => {
    const older = await seedProduct({ name: "เก่า" });
    const newer = await seedProduct({ name: "ใหม่" });
    await seedProduct({ name: "ซ่อน", is_active: false });

    const products = await listProducts(anonClient());
    expect(products.map((p) => p.id)).toEqual([newer.id, older.id]);
    expect(Object.keys(products[0]).sort()).toEqual(
      ["id", "image_path", "name", "price_satang", "slug", "stock_quantity"].sort(),
    );
  });

  it("returns an active product by slug and null for hidden or unknown slugs", async () => {
    const shown = await seedProduct();
    const hidden = await seedProduct({ is_active: false });
    const client = anonClient();

    expect((await getProductBySlug(shown.slug, client))?.id).toBe(shown.id);
    expect(await getProductBySlug(hidden.slug, client)).toBeNull();
    expect(await getProductBySlug("no-such-slug", client)).toBeNull();
  });

  it("omits hidden and unknown ids from getProductsByIds", async () => {
    const shown = await seedProduct();
    const hidden = await seedProduct({ is_active: false });
    const unknown = "99999999-9999-4999-8999-999999999999";

    const found = await getProductsByIds([shown.id, hidden.id, unknown], anonClient());
    expect(found.map((p) => p.id)).toEqual([shown.id]);
    expect(await getProductsByIds([], anonClient())).toEqual([]);
  });

  it("reads store settings with the admin client", async () => {
    const settings = await getStoreSettings(adminClient());
    expect(settings).toEqual({
      shippingFeeSatang: 5000,
      paymentWindowMinutes: 1440,
      contactUrl: "",
    });
  });
});
