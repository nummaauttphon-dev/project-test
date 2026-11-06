# สถานะโปรเจกต์: เว็บร้านค้าทดสอบไอเดีย

- **อัปเดตล่าสุด:** 2026-11-06
- **Branch งาน:** `feat/web-store` ยังไม่ได้ push และยังไม่ได้ merge เข้า `main`
- **Commit ล่าสุดที่ผ่านการตรวจ:** `6891d50` (จบ Task 9)
- **เอกสารหลัก:** [spec](docs/superpowers/specs/2026-11-06-web-store-design.md) และ [แผนงาน](docs/superpowers/plans/2026-11-06-web-store.md)

## เป้าหมาย

เว็บขายสินค้าที่ต้องจัดส่ง เพื่อทดสอบว่ามีคนยอมจ่ายเงินจริงหรือไม่ ลูกค้าซื้อโดยไม่ต้องสมัครสมาชิก จ่ายผ่าน PromptPay แล้วแนบสลิป จากนั้นแอดมินตรวจสลิปและจัดส่ง ตัวชี้วัดหลักคือจำนวนออเดอร์ที่ชำระเงินแล้ว

## ความคืบหน้า

| Task | ส่วนงาน | สถานะ |
|---|---|---|
| 1 | ตั้งโปรเจกต์และเครื่องมือทดสอบ | เสร็จและผ่านการตรวจ |
| 2 | ไลบรารีเงิน token mask QR ตรวจไฟล์ และ schema | เสร็จและผ่านการตรวจ |
| 3 | Schema, RLS และ Storage | เสร็จและผ่านการตรวจ |
| 4 | `create_order` กันขายเกินสต็อก | เสร็จและผ่านการตรวจ |
| 5 | สถานะออเดอร์และการคืนสต็อก | เสร็จและผ่านการตรวจ |
| 6 | Rate limit และงานตามเวลา | เสร็จและผ่านการตรวจ |
| 7 | หน้าร้านและตะกร้า | เสร็จและผ่านการตรวจ |
| 8 | หน้าสั่งซื้อ | เสร็จและผ่านการตรวจ |
| 9 | หน้าติดตามออเดอร์และแนบสลิป | เสร็จและผ่านการตรวจ |
| 10 | Login และ MFA ของแอดมิน | **กำลังพัฒนา ยังไม่ commit และยังไม่ผ่านการตรวจ** |
| 11 | หลังบ้านจัดการออเดอร์และ dashboard | ยังไม่เริ่ม |
| 12 | หลังบ้านจัดการสินค้าและการตั้งค่า | ยังไม่เริ่ม |
| 13 | ลบสลิปตามกำหนดและหน้า `/privacy` | ยังไม่เริ่ม |
| 14 | E2E ทั้งระบบ, accessibility, performance และ security | ยังไม่เริ่ม |
| 15 | Deploy | ยังไม่เริ่ม และต้องได้รับอนุมัติจากเจ้าของทีละขั้น |

**ผล test ล่าสุดตอนจบ Task 9 ตามรายงานของ implementer:** unit 40, integration 225 และ E2E 36 ผ่านทั้งหมด ไม่ได้รันซ้ำตอนเขียนเอกสารนี้

### หมายเหตุเรื่องลิงก์ที่ยังไม่มีปลายทาง

ลิงก์ `/privacy` ในหน้าสั่งซื้อจะยังเป็น 404 จนกว่า Task 13 จะเสร็จ

## งานที่ค้างใน Task 10

ไฟล์ด้านล่างถูกสร้างก่อนที่งานจะถูกหยุดกลางคัน และยังไม่มีรายงานผลทดสอบ จึงยังเชื่อถือไม่ได้จนกว่าจะรัน test และผ่านการตรวจ

```text
แก้ไข:      src/lib/supabase/server.ts
สร้างใหม่:  src/proxy.ts
            src/lib/supabase/proxy.ts, cookie-options.ts
            src/features/admin/auth.ts, actions.ts, auth-messages.ts
            src/app/admin/login/page.tsx, mfa/page.tsx, not-admin/route.ts
            src/app/admin/(protected)/layout.tsx, page.tsx, [...rest]/page.tsx
            src/components/admin-login-form.tsx, admin-mfa-forms.tsx, admin-sign-out-button.tsx
            scripts/create-admin.mjs
            tests/e2e/admin-auth.spec.ts, tests/helpers/admin.ts
            tests/integration/admin-auth.test.ts, tests/unit/admin-auth-messages.test.ts
```

## เทคโนโลยี

| ส่วน | เครื่องมือ |
|---|---|
| Web | Next.js 16.4.5 (App Router, `proxy.ts`), React 19.3, TypeScript 5 |
| UI | Tailwind CSS 4, ฟอนต์ IBM Plex Sans Thai |
| Backend | Supabase: PostgreSQL, Storage, Auth (เฉพาะแอดมิน), pg_cron |
| Client ของ Supabase | `@supabase/supabase-js` 2.119, `@supabase/ssr` 0.12 |
| Validation | Zod 4 |
| QR และไฟล์ | `promptpay-qr`, `qrcode`, `file-type` |
| ทดสอบ | Vitest 5, Playwright 1.65, axe, `pg`, `otpauth` |
| Hosting ที่วางแผน | Vercel |

## โครงสร้างโปรเจกต์

```text
src/
  proxy.ts                  refresh session ของแอดมิน (Task 10)
  app/
    (store)/                หน้าร้าน ตะกร้า สั่งซื้อ และติดตามออเดอร์
    admin/                  หลังบ้าน (Task 10–12)
  components/               UI ฝั่ง client
  features/
    catalog/ cart/ checkout/ orders/ admin/
  lib/
    money result idempotency order-token mask promptpay slip-file rate-limit env
    supabase/admin.ts       client สิทธิ์สูง ใช้ฝั่ง server เท่านั้น
    supabase/server.ts      client ที่อยู่ภายใต้ RLS
supabase/
  migrations/0001_schema.sql            ตาราง RLS Storage และการปิดสิทธิ์เริ่มต้น
  migrations/0002_create_order.sql      สร้างออเดอร์แบบ atomic
  migrations/0003_order_lifecycle.sql   สลิป สถานะ คืนสต็อก และหมดอายุ
  migrations/0004_rate_limit_and_cron.sql
  seed.sql config.toml
scripts/                    test-env.mjs, create-admin.mjs
tests/                      unit/ integration/ e2e/ helpers/ fixtures/
docs/superpowers/           spec และแผนงาน
```

## วิธีรันและทดสอบ

ต้องเปิด Docker Desktop ก่อน

```bash
npm install
npm run db:start
node scripts/test-env.mjs
npm run db:reset
npm run test:unit
npm run test:integration
npm run test:e2e
```

ไฟล์ `.env.test.local` สร้างจาก `scripts/test-env.mjs` และไม่อยู่ใน Git

## การตัดสินใจระหว่างพัฒนา

| รหัส | การตัดสินใจ | ผลถ้าตัดสินใจผิด |
|---|---|---|
| R1 | Controller สร้าง Git repository และ branch เอง | ไม่มีผล |
| R2 | แยก `parseServerEnv` ไว้ใน `env-schema.ts` เพื่อให้ทดสอบได้ | มีไฟล์เพิ่ม 1 ไฟล์ |
| R3 | Vitest แทน `server-only` ด้วย stub | ข้อผิดพลาดบางแบบไปถูกจับตอน `next build` แทน |
| R4 | `.gitignore` คงรายการ `.superpowers/` | ไม่มีผล |
| R5 | ใช้รายการ `allAdminActions` รายการเดียวใน `admin-guards.test.ts` | เปลี่ยนชื่อเท่านั้น |
| R6 | งานอัตโนมัติหยุดหลังตรวจรวม และ Task 15 รออนุมัติ | เจ้าของอนุมัติเพื่อไปต่อ |
| R7 | เอา `cacheComponents` และ `partialPrefetching` ออก | หน้าเว็บอาจช้าลงเล็กน้อย และเปิดคืนได้ |
| R8 | เขียน test RLS ให้เข้มกว่าที่แผนกำหนด | test ผูกกับรหัส error ของ Postgres |
| R9 | ยกเว้นกฎ `server-only` ใน `tests/` | ไม่กระทบโค้ด production |
| R10 | ปิดสิทธิ์เริ่มต้นของ `anon` และ `authenticated` | Object ใหม่ต้อง grant เอง |
| R11 | เพิ่ม test การล็อกราคาแบบไม่ขึ้นกับเวลา | ใช้เวลาทดสอบเพิ่มเล็กน้อย |
| R12 | รอ API พร้อมก่อนเริ่ม integration test | เริ่มช้าลงเล็กน้อย |
| R13 | `transition_order` ไม่ให้ตั้ง `payment_review` และ `expired` เอง และการอนุมัติต้องมีสลิปรอตรวจ | ถ้าต้องการ override ต้องเพิ่มฟังก์ชัน |
| R14 | ยอมรับพฤติกรรมของฟังก์ชันสถานะที่แผนเปิดไว้ เช่น ยกเลิกไม่ต้องระบุเหตุผล | แก้ฟังก์ชันเล็กน้อย |
| R15 | ใช้โทนกลางจนกว่าจะมีข้อมูลแบรนด์ | ต้องปรับ design token ภายหลัง |
| R16 | ไม่มี `loading.tsx` ในหน้าสินค้า เพื่อคง HTTP 404 จริง | ไม่มี skeleton ตอนเปิดหน้าสินค้า |
| R17 | แจ้งเตือนเมื่อบันทึกตะกร้าไม่สำเร็จหรือตะกร้าเต็ม | เพิ่มงานเล็กน้อย |
| R18 | รวมรายการสินค้าซ้ำก่อนสั่งซื้อ และจำกัดขนาดข้อมูล | ปรับ schema |
| R19 | ตรวจข้อมูลผู้ติดต่อที่แก้หลังส่งซ้ำบน server และเก็บเฉพาะ `{fingerprint, key}` ใน browser | มีการอ่านฐานข้อมูลเพิ่มตอนส่งซ้ำ |
| R20 | แก้ข้อความหน้าสั่งซื้อที่อาจทำให้ลูกค้าเข้าใจผิด | เพิ่มงานเล็กน้อย |

ส่วนที่เพิ่มจาก spec และได้รับอนุมัติพร้อมแผน: หน้า `/admin/mfa`, `set_tracking_number`, `scripts/create-admin.mjs` และ `orders.terminal_at`

## ปัญหาที่ยังค้าง

### ต้องจัดการก่อนเปิดร้าน

- ทดสอบการเลือกรูปสลิปและการบันทึก QR บน iOS, Android และเบราว์เซอร์ในแอป LINE กับ Facebook
- สแกน QR ด้วยแอปธนาคารจริง เพื่อยืนยันบัญชีและยอดเงิน
- เช็กว่า log ของ Vercel เก็บ token ออเดอร์จาก URL หรือไม่
- ตรวจผลของ `npm audit` ซึ่งยังมีรายการค้าง
- ให้ผู้เชี่ยวชาญตรวจระยะเวลาเก็บข้อมูลและประกาศความเป็นส่วนตัวตาม PDPA ภาษี และบัญชี
- เปลี่ยนชื่อผู้ commit จาก `Web Store Dev <dev@example.invalid>` ถ้าต้องการผูกกับบัญชี GitHub

### ข้อมูลที่เจ้าของร้านต้องให้

ชื่อร้าน แบรนด์ และสินค้าจริง, PromptPay ID, ค่าส่งจริง, ช่องทางติดต่อร้าน, เป้าจำนวนออเดอร์และระยะเวลาทดสอบ และการอนุมัติค่าใช้จ่ายของ Vercel กับ Supabase

### ค่าใช้จ่าย

แพ็กเกจ Hobby ของ Vercel ไม่อนุญาตการรับชำระเงินจากผู้เข้าชม ส่วน Free ของ Supabase หยุดโปรเจกต์เมื่อใช้งานน้อยและไม่มี automatic backup ซึ่งแพ็กเกจ Pro ของ Supabase เริ่มต้นที่ 25 ดอลลาร์สหรัฐต่อเดือน ควรเช็กราคาอีกครั้งก่อนสมัคร

### ปัญหาย่อยที่รอคัดแยกในการตรวจรวม

| Task | ปัญหา |
|---|---|
| 1 | `turbopack.rules` ใน `next.config.ts` ยังไม่ได้ยืนยัน และ `AGENTS.md` กับ `README.md` ยังเป็นของ template |
| 3 | Test ไม่ครอบคลุมบทบาท `authenticated` และการเรียก `remove`, `move`, `createSignedUrl` ของ anon, รวมถึง `order_number` จะมีปัญหาหลัง 999,999 |
| 4 | `afterEach` ไม่รอ RPC ที่ค้าง ทำให้อ่านผล test ที่ล้มเหลวอยู่แล้วยากขึ้น |
| 5 | Test หลายตัวยังไม่แน่นพอ, `p_storage_path` ว่างถูกยอมรับ และเหตุผลที่มีแต่ NBSP อาจผ่าน |
| 6 | Test การทำงานพร้อมกันไม่รับประกันว่าคำขอทับกัน และ fixed window ยอมได้สูงสุด 20 ครั้งข้ามรอบเวลา |
| 7 | Query หน้าสินค้าซ้ำ 2 ครั้ง, การแก้ตะกร้าระหว่างโหลดอาจถูกทับ และไอคอน placeholder มี contrast ประมาณ 2.8:1 |
| 8 | การลองซ้ำใช้โควตา rate limit, การแก้ตะกร้าข้ามแท็บอาจตกหล่น และ IPv6 ยังไม่จัดกลุ่มตาม /64 |
| 9 | ข้อความ `RATE_LIMITED` บอกเวลารอไม่ตรง, อาจมีไฟล์ค้างเมื่อลบไม่สำเร็จ, RPC ที่ผลไม่แน่ชัดอาจลบไฟล์ของสลิปที่บันทึกแล้ว, ปุ่มเลือกไฟล์เป็นภาษาอังกฤษบนมือถือภาษาอังกฤษ และคำเตือนให้บันทึกลิงก์อยู่ต่ำเกินไป |

รายละเอียดเต็มอยู่ใน ledger ด้านล่าง

## การกลับมาทำงานต่อ

1. Ledger อยู่ที่ `.superpowers/sdd/2026-11-06-web-store/progress.md` ใช้บอกว่า Task ใดเสร็จแล้ว โฟลเดอร์นี้ไม่อยู่ใน Git จึงห้ามรัน `git clean -fdx`
2. รัน `git status` และ `git log --oneline main..HEAD`
3. ทำ Task 10 ให้เสร็จ แล้วตรวจแบบอิสระ
4. ทำ Task 11–14 ทีละ Task โดยตรวจอิสระทุก Task
5. ตรวจรวมทั้ง branch
6. หยุดรออนุมัติก่อน Task 15 ห้าม push, deploy, รัน migration บนโปรเจกต์จริง หรือสมัครบริการเสียเงินถ้ายังไม่ได้รับอนุญาตจากเจ้าของในขั้นนั้น
