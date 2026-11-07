import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { adminClient, resetData, seedProduct } from "../helpers/supabase";

test.beforeEach(async () => {
  await resetData();
});

async function setContactUrl(value: string) {
  const { error } = await adminClient()
    .from("store_settings")
    .update({ contact_url: value })
    .eq("id", 1);
  if (error) throw error;
}

test("privacy page is linked from checkout and readable", async ({ page }) => {
  await setContactUrl("https://line.me/R/ti/p/@teststore");
  const product = await seedProduct({ stock_quantity: 5 });
  await page.addInitScript(
    (value) => window.localStorage.setItem("cart.v1", value),
    JSON.stringify([{ productId: product.id, quantity: 1 }]),
  );
  await page.goto("/checkout");
  await page.getByRole("link", { name: "นโยบายความเป็นส่วนตัว" }).click();

  await expect(page).toHaveURL(/\/privacy$/);
  await expect(
    page.getByRole("heading", { level: 1, name: /ความเป็นส่วนตัว/ }),
  ).toBeVisible();
  for (const topic of [
    "ข้อมูลที่เราเก็บ",
    "วัตถุประสงค์",
    "ระยะเวลาการเก็บ",
    "ผู้ประมวลผลข้อมูล",
    "สิทธิของคุณ",
  ]) {
    await expect(page.getByRole("heading", { name: topic })).toBeVisible();
  }
  await expect(page.getByText("90 วัน").first()).toBeVisible();
  await expect(page.getByText("Supabase").first()).toBeVisible();
  await expect(page.getByText("Vercel").first()).toBeVisible();
  await expect(page.getByTestId("privacy-review-note")).toContainText(
    "เจ้าของร้าน",
  );
  await expect(
    page.getByRole("link", { name: "ช่องทางติดต่อร้าน" }),
  ).toHaveAttribute("href", "https://line.me/R/ti/p/@teststore");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);

  await page.getByRole("link", { name: "กลับไปหน้าร้าน" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("privacy page without a contact link points to the channel on the order", async ({
  page,
}) => {
  await setContactUrl("");
  await page.goto("/privacy");
  await expect(
    page.getByRole("link", { name: "ช่องทางติดต่อร้าน" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("ติดต่อร้านตามช่องทางที่แจ้งไว้ในคำสั่งซื้อ"),
  ).toBeVisible();
});
