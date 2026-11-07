"use client";

import { useId, useState, type FormEvent } from "react";
import { saveSettingsAction } from "@/features/admin/settings-actions";
import { ActionError, FIELD, FormField, PRIMARY, useAdminAction } from "./admin-ui";

export type SettingsFormValues = {
  /** Baht as an input shows it, e.g. "50" or "49.50". */
  shippingFee: string;
  paymentWindowMinutes: string;
  contactUrl: string;
};

export function SettingsForm({ initial }: { initial: SettingsFormValues }) {
  const { pending, failure, run } = useAdminAction();
  const formId = useId();
  const [shippingFee, setShippingFee] = useState(initial.shippingFee);
  const [paymentWindowMinutes, setPaymentWindowMinutes] = useState(initial.paymentWindowMinutes);
  const [contactUrl, setContactUrl] = useState(initial.contactUrl);
  const [saved, setSaved] = useState(false);
  const errors = failure?.fields ?? {};

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    run(
      () => saveSettingsAction({ shippingFee, paymentWindowMinutes, contactUrl }),
      () => setSaved(true),
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <FormField
        id={`${formId}-fee`}
        label="ค่าจัดส่ง (บาท)"
        hint="0-10,000 บาท ทศนิยมไม่เกิน 2 ตำแหน่ง ใช้กับคำสั่งซื้อใหม่เท่านั้น"
        error={errors.shippingFee}
        errorTestId="shipping-fee-error"
      >
        {(control) => (
          <input
            {...control}
            name="shippingFee"
            type="text"
            inputMode="decimal"
            value={shippingFee}
            onChange={(event) => setShippingFee(event.target.value)}
            autoComplete="off"
            className={`${FIELD} min-h-12`}
          />
        )}
      </FormField>

      <FormField
        id={`${formId}-window`}
        label="เวลาให้แนบสลิป (นาที)"
        hint="1-10,080 นาที (สูงสุด 7 วัน) นับจากเวลาที่ลูกค้าสั่งซื้อ ใช้กับคำสั่งซื้อใหม่เท่านั้น"
        error={errors.paymentWindowMinutes}
        errorTestId="payment-window-error"
      >
        {(control) => (
          <input
            {...control}
            name="paymentWindowMinutes"
            type="text"
            inputMode="numeric"
            value={paymentWindowMinutes}
            onChange={(event) => setPaymentWindowMinutes(event.target.value)}
            autoComplete="off"
            className={`${FIELD} min-h-12`}
          />
        )}
      </FormField>

      <FormField
        id={`${formId}-contact`}
        label="ช่องทางติดต่อร้าน (ลิงก์)"
        hint="เว้นว่างได้ หรือใส่ลิงก์ที่ขึ้นต้นด้วย http:// หรือ https:// ไม่เกิน 500 ตัวอักษร ลูกค้าเห็นในหน้าคำสั่งซื้อ"
        error={errors.contactUrl}
        errorTestId="contact-url-error"
      >
        {(control) => (
          <input
            {...control}
            name="contactUrl"
            type="text"
            inputMode="url"
            value={contactUrl}
            onChange={(event) => setContactUrl(event.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            className={`${FIELD} min-h-12`}
          />
        )}
      </FormField>

      <ActionError failure={failure} always />
      <div role="status">
        {saved ? (
          <p data-testid="saved" className="rounded-lg border border-line-strong bg-sunken p-3">
            บันทึกการตั้งค่าแล้ว
          </p>
        ) : null}
      </div>

      <button type="submit" disabled={pending} className={PRIMARY}>
        {pending ? "กำลังบันทึก…" : "บันทึกการตั้งค่า"}
      </button>
    </form>
  );
}
