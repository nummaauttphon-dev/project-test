import type { Metadata } from "next";
import Link from "next/link";
import { getStoreSettings } from "@/features/catalog/queries";
import { STORE_NAME } from "@/lib/store-config";
import { createAdminClient } from "@/lib/supabase/admin";

// The contact link is edited in the admin settings, so the page must not be prerendered.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "นโยบายความเป็นส่วนตัว" };

/** The notice still has to be readable if the settings cannot be loaded. */
async function loadContactUrl(): Promise<string> {
  try {
    return (await getStoreSettings(createAdminClient())).contactUrl;
  } catch {
    console.error("privacy: contact link unavailable");
    return "";
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-xl font-bold">{title}</h2>
      <div className="mt-2 space-y-2 leading-relaxed">{children}</div>
    </section>
  );
}

export default async function PrivacyPage() {
  const contactUrl = await loadContactUrl();

  return (
    <article className="max-w-2xl">
      <h1 className="text-2xl font-bold">นโยบายความเป็นส่วนตัว</h1>
      <p className="mt-2 text-ink-soft">
        {STORE_NAME} อธิบายว่าเราเก็บข้อมูลอะไรจากคุณเมื่อสั่งซื้อ เก็บไว้ทำไม และนานเท่าไร
      </p>

      <p
        data-testid="privacy-review-note"
        className="mt-4 rounded-card border border-notice-line bg-notice-bg p-4 text-notice-ink"
      >
        หมายเหตุสำหรับเจ้าของร้าน: ประกาศนี้เป็นร่างเริ่มต้นทางเทคนิค ไม่ใช่คำแนะนำทางกฎหมาย
        เจ้าของร้านต้องตรวจสอบและแก้ไขเนื้อหา ระยะเวลาการเก็บ และช่องทางติดต่อ
        ให้ตรงกับการดำเนินงานจริงและข้อกำหนดที่เกี่ยวข้อง (เช่น PDPA ภาษี และบัญชี) ก่อนเปิดรับออเดอร์จริง
      </p>

      <Section title="ข้อมูลที่เราเก็บ">
        <ul className="list-disc space-y-1 pl-6">
          <li>ชื่อผู้รับ เบอร์โทรศัพท์ และที่อยู่จัดส่ง ที่คุณกรอกตอนสั่งซื้อ</li>
          <li>รูปสลิปการโอนเงิน ที่คุณแนบเพื่อยืนยันการชำระเงิน</li>
          <li>รายการสินค้า ยอดเงิน และสถานะของคำสั่งซื้อ</li>
          <li>
            ค่าที่คำนวณจากที่อยู่ IP ของคุณ (เก็บเป็นรหัสแฮช ไม่เก็บที่อยู่ IP จริง)
            ใช้นับจำนวนครั้งที่สั่งซื้อเพื่อป้องกันการจองสินค้าซ้ำ ๆ และถูกลบอัตโนมัติภายในไม่กี่วัน
          </li>
        </ul>
        <p>ตะกร้าสินค้าถูกเก็บไว้ในเบราว์เซอร์ของคุณเอง ไม่ได้ส่งมาที่เซิร์ฟเวอร์จนกว่าคุณจะกดสั่งซื้อ</p>
      </Section>

      <Section title="วัตถุประสงค์ในการใช้ข้อมูล">
        <ul className="list-disc space-y-1 pl-6">
          <li>จัดส่งสินค้าและติดต่อคุณเรื่องคำสั่งซื้อ</li>
          <li>ตรวจสอบว่าคุณชำระเงินแล้ว</li>
          <li>เก็บเป็นหลักฐานทางบัญชีของร้าน</li>
          <li>ป้องกันการใช้งานระบบสั่งซื้อในทางที่ผิด</li>
        </ul>
        <p>เราไม่ขายข้อมูลของคุณ และไม่ใช้ข้อมูลนี้เพื่อการโฆษณา</p>
      </Section>

      <Section title="ระยะเวลาการเก็บ">
        <ul className="list-disc space-y-1 pl-6">
          <li>
            <strong>รูปสลิป:</strong> ลบไฟล์อัตโนมัติ 90 วันหลังคำสั่งซื้อสิ้นสุด
            คือจัดส่งแล้ว ถูกยกเลิก หรือหมดอายุ
          </li>
          <li>
            <strong>ข้อมูลคำสั่งซื้อ:</strong> เก็บไว้เพื่อการจัดส่งและบัญชีของร้าน
            ขณะนี้ยังไม่มีการลบอัตโนมัติ
          </li>
        </ul>
      </Section>

      <Section title="ผู้ประมวลผลข้อมูล">
        <p>ร้านใช้บริการของผู้ให้บริการต่อไปนี้ในการเก็บและประมวลผลข้อมูลแทนร้าน</p>
        <ul className="list-disc space-y-1 pl-6">
          <li>Supabase เก็บฐานข้อมูลคำสั่งซื้อและไฟล์รูปสลิป</li>
          <li>Vercel ให้บริการเว็บไซต์และระบบที่รับคำสั่งซื้อ</li>
        </ul>
        <p>ผู้ให้บริการเหล่านี้อาจเก็บข้อมูลบนเซิร์ฟเวอร์ที่อยู่นอกประเทศไทย</p>
      </Section>

      <Section title="สิทธิของคุณ">
        <p>
          ตามกฎหมายคุ้มครองข้อมูลส่วนบุคคล (PDPA) คุณขอสำเนาข้อมูลของคุณ ขอให้แก้ไขข้อมูลที่ไม่ถูกต้อง
          ขอให้ลบหรือจำกัดการใช้ข้อมูล หรือคัดค้านการใช้ข้อมูลได้
          ทั้งนี้ ข้อมูลบางอย่างร้านอาจต้องเก็บต่อเพื่อการบัญชีและภาษี
        </p>
        <p>
          {contactUrl ? (
            <>
              หากต้องการใช้สิทธิ์ ติดต่อร้านได้ที่{" "}
              <a
                href={contactUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center underline"
              >
                ช่องทางติดต่อร้าน
              </a>{" "}
              พร้อมแจ้งเลขที่คำสั่งซื้อของคุณ
            </>
          ) : (
            <>หากต้องการใช้สิทธิ์ ติดต่อร้านตามช่องทางที่แจ้งไว้ในคำสั่งซื้อ พร้อมแจ้งเลขที่คำสั่งซื้อของคุณ</>
          )}
        </p>
      </Section>

      <Link
        href="/"
        className="mt-10 inline-flex min-h-11 items-center rounded-full bg-brand px-6 font-semibold text-on-brand hover:bg-brand-hover"
      >
        กลับไปหน้าร้าน
      </Link>
    </article>
  );
}
