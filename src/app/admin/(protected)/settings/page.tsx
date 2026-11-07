import type { Metadata } from "next";
import { SettingsForm } from "@/components/admin-settings-form";
import { requireAdminPage } from "@/features/admin/auth";
import { satangToBahtInput } from "@/features/admin/validation";
import { getStoreSettings } from "@/features/catalog/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "ตั้งค่าร้าน" };

export default async function AdminSettingsPage() {
  await requireAdminPage();
  const settings = await getStoreSettings(createAdminClient());

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-2 text-2xl font-bold">ตั้งค่าร้าน</h1>
      <p className="mb-4 text-sm text-ink-soft">
        บัญชี PromptPay ที่รับเงินตั้งค่าที่เซิร์ฟเวอร์เท่านั้น จึงแก้จากหน้านี้ไม่ได้
      </p>
      <SettingsForm
        initial={{
          shippingFee: satangToBahtInput(settings.shippingFeeSatang),
          paymentWindowMinutes: String(settings.paymentWindowMinutes),
          contactUrl: settings.contactUrl,
        }}
      />
    </div>
  );
}
