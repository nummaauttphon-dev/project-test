# ร้านค้าทดสอบ (Web Store)

เว็บขายสินค้าที่ต้องจัดส่ง สำหรับทดสอบว่ามีคนยอมจ่ายเงินจริงหรือไม่ ลูกค้าสั่งซื้อโดยไม่ต้องสมัครสมาชิก ชำระด้วย PromptPay แล้วแนบสลิป ส่วนแอดมินตรวจสลิป กรอกเลขพัสดุ และจัดการสินค้าที่ `/admin`

- **Stack:** Next.js 16 (App Router, Server Actions), React 19, TypeScript, Tailwind CSS 4, Supabase (PostgreSQL, Storage, Auth), Vercel
- **เอกสารออกแบบ:** `docs/superpowers/specs/2026-11-06-web-store-design.md`
- Next.js รุ่นนี้มีการเปลี่ยนแปลงที่ไม่เข้ากับรุ่นเก่า อ่านคู่มือใน `node_modules/next/dist/docs/` ก่อนแก้โค้ด (ดู `AGENTS.md`)

## สิ่งที่ต้องมี

- Node.js 22 ขึ้นไป และ npm
- Docker Desktop (สำหรับ Supabase ในเครื่อง)
- Supabase CLI ติดตั้งมากับ `devDependencies` แล้ว เรียกผ่าน `npx supabase` หรือสคริปต์ `npm run db:*`

## ติดตั้งและรันในเครื่อง

```bash
npm install
npm run db:start              # เปิด Supabase ในเครื่อง (Postgres, Storage, Auth) ผ่าน Docker
npm run db:reset              # สร้างฐานข้อมูลใหม่จาก supabase/migrations และใส่สินค้าตัวอย่างจาก supabase/seed.sql
node scripts/test-env.mjs     # เขียน .env.test.local จาก `supabase status` และสุ่ม secret ให้
```

สำหรับ `npm run dev` ให้สร้าง `.env.local` โดยคัดลอกจาก `.env.example` แล้วกรอกค่า (ใช้ค่าชุดเดียวกับ `.env.test.local` ได้ในเครื่อง)

```bash
cp .env.example .env.local    # แล้วกรอกค่าเอง ห้าม commit ไฟล์ .env ใด ๆ
npm run dev                   # http://localhost:3000
```

หยุด Supabase ในเครื่องด้วย `npx supabase stop` ดูค่า URL และ key ของเครื่องด้วย `npx supabase status`

## Environment variables

ใส่เฉพาะชื่อและหน้าที่ไว้ที่นี่ ห้ามเขียนค่าจริงลงในไฟล์ที่ commit แต่ละ environment (local, preview, production) ต้องใช้ค่าแยกกัน

| ชื่อ | ใช้ที่ | หน้าที่ |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser และ server | URL ของโปรเจกต์ Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser และ server | publishable key ของ Supabase ใช้กับการอ่านที่ผ่าน Row Level Security และการ login ของแอดมิน |
| `SUPABASE_SECRET_KEY` | server เท่านั้น | secret key ของ Supabase (ข้าม RLS) ใช้ในไฟล์ที่มี `import "server-only"` เท่านั้น |
| `PROMPTPAY_ID` | server เท่านั้น | เบอร์หรือเลขประจำตัวที่ใช้สร้าง QR พร้อมเพย์ เก็บใน env เพื่อไม่ให้แก้ได้จากหน้าแอดมิน |
| `ORDER_TOKEN_SECRET` | server เท่านั้น | กุญแจ HMAC สำหรับสร้าง token ของลิงก์ออเดอร์ ถ้าเปลี่ยนค่า ลิงก์ที่สร้างซ้ำจากการกดสั่งซื้อซ้ำจะไม่ตรงของเดิม |
| `RATE_LIMIT_SALT` | server เท่านั้น | salt สำหรับ hash IP และรหัสออเดอร์ก่อนนับ rate limit |
| `CRON_SECRET` | server เท่านั้น | secret ที่ Vercel Cron ส่งมาใน `Authorization: Bearer ...` เพื่อเรียก `/api/cron/purge-slips` |

ตัวแปรที่ไม่ต้องใส่ในโปรเจกต์ Vercel:

- `DATABASE_URL`: connection string ของ Postgres ใช้เฉพาะ test (integration และตัวช่วยใน `tests/helpers`) `scripts/test-env.mjs` เขียนให้ใน `.env.test.local` ตัวแอปไม่อ่านค่านี้ จึงไม่ต้องเก็บ connection string ของฐานข้อมูลไว้บน Vercel
- `ADMIN_EMAIL` และ `ADMIN_PASSWORD`: ใช้กับสคริปต์สร้างแอดมินเท่านั้น

สร้างค่าสุ่มสำหรับ secret ได้ด้วย

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

## สร้างบัญชีแอดมิน

ระบบไม่มีหน้าสมัครสมาชิก และปิดการสมัครสาธารณะของ Supabase Auth (`enable_signup = false`) แอดมินสร้างได้จากสคริปต์เท่านั้น สคริปต์ไม่รับค่าทาง command line เพื่อไม่ให้รหัสผ่านไปอยู่ใน shell history ให้ใส่ใน environment แทน

```bash
# เพิ่ม ADMIN_EMAIL และ ADMIN_PASSWORD (อย่างน้อย 12 ตัวอักษร) ลงใน .env.local ชั่วคราว แล้วรัน
node --env-file=.env.local scripts/create-admin.mjs
# เสร็จแล้วลบ ADMIN_PASSWORD ออกจากไฟล์
```

- รันซ้ำได้อย่างปลอดภัย ถ้ามีบัญชีอีเมลนี้อยู่แล้ว สคริปต์จะให้สิทธิ์แอดมินโดยไม่เปลี่ยนรหัสผ่าน
- ครั้งแรกที่ login ที่ `/admin/login` ระบบบังคับตั้งค่า MFA แบบ TOTP ด้วยแอปยืนยันตัวตน และทุกครั้งต่อไปต้องกรอกรหัส 6 หลัก

## การทดสอบ

ทุกชุดยกเว้น unit ต้องเปิด Supabase ในเครื่องและมี `.env.test.local` ก่อน (`npm run db:start` แล้ว `node scripts/test-env.mjs`) test จะล้างข้อมูลออเดอร์และสินค้าในฐานข้อมูลเครื่อง จึงห้ามชี้ไปที่โปรเจกต์จริง

```bash
npx tsc --noEmit              # ตรวจ type
npm run lint                  # ESLint
npm run test:unit             # Vitest: คำนวณเงิน, schema, ไฟล์สลิป, QR, token
npm run test:integration      # Vitest + Supabase ในเครื่อง: Server Actions, ฟังก์ชัน SQL, RLS, concurrency
npm run test:e2e              # Playwright (มือถือ Pixel 7): build แล้วเปิด production server ที่พอร์ต 3100
npx playwright test tests/e2e/a11y.spec.ts   # รันเฉพาะไฟล์เดียว
```

- E2E ครอบคลุมเส้นทางเต็ม (`full-journey.spec.ts`: สั่งซื้อ แนบสลิป แอดมินยืนยัน จัดส่ง, สลิปไม่ผ่านแล้วแนบใหม่, ออเดอร์หมดอายุแล้วคืนสต็อก) และ accessibility (`a11y.spec.ts`: axe ทุกหน้าร้านและหลังบ้านรวมทุกสถานะออเดอร์ และการใช้คีย์บอร์ดอย่างเดียว)
- หลัง `npm run db:reset` ให้รอสักครู่ก่อนรัน test ตัวช่วยใน `tests/helpers/ready.ts` จะรอให้ API พร้อมเอง
- ตรวจประสิทธิภาพในเครื่อง: `npm run build` แล้ว `npm start` จากนั้น `npx lighthouse http://localhost:3000 --preset=desktop` และรันอีกครั้งโดยไม่ใส่ `--preset` สำหรับมือถือ ห้าม commit ผลของ Lighthouse
- ตรวจ dependency: `npm audit --omit=dev` (อย่าใช้ `npm audit fix --force`)

## การ deploy (ต้องได้รับอนุมัติจากเจ้าของโปรเจกต์ทุกขั้น)

ห้ามสมัครบริการที่มีค่าใช้จ่าย รัน migration กับโปรเจกต์จริง หรือ deploy production จนกว่าเจ้าของโปรเจกต์อนุมัติขั้นนั้น การรับเงินจากลูกค้าจริงต้องใช้แพ็กเกจ Vercel ที่อนุญาตการใช้งานเชิงพาณิชย์ (เช่น Pro) และควรใช้ Supabase Pro เพื่อให้มี backup และไม่ถูกหยุดโปรเจกต์

1. รัน `npx tsc --noEmit`, `npm run lint`, test ทุกชุด และ `npm run build` ให้ผ่าน
2. **(อนุมัติ)** สร้างโปรเจกต์ Supabase สองชุด: preview และ production
3. ตั้งค่าใน Supabase Dashboard ของแต่ละโปรเจกต์: ปิด "Allow new users to sign up", เปิด MFA แบบ TOTP, ตั้งความยาวรหัสผ่านขั้นต่ำให้สูงกว่าค่าในเครื่อง และตรวจว่า extension `pg_cron` เปิดใช้ได้
4. **(อนุมัติ)** รัน migration: `npx supabase link --project-ref <ref>` แล้ว `npx supabase db push` (ห้ามใส่ `supabase/seed.sql` ลง production เพราะเป็นสินค้าตัวอย่าง)
5. **(อนุมัติ)** สร้างโปรเจกต์ Vercel เชื่อมกับ repository แล้วใส่ environment variables ตามตารางด้านบนแยกตาม Preview และ Production รวมถึง `CRON_SECRET`
6. Deploy Preview แล้วทดสอบตั้งแต่สั่งซื้อจนจัดส่งกับโปรเจกต์ Supabase ของ preview บนมือถือจริง (iOS, Android และเบราว์เซอร์ในแอป LINE/Facebook) รวมถึงการบันทึกรูป QR และเลือกสลิปจากแกลเลอรี
7. **(อนุมัติ)** สร้างแอดมินบน production ด้วย `scripts/create-admin.mjs` โดยใช้ env ของ production ในเครื่องของเจ้าของ แล้ว deploy Production
8. ลองสั่งซื้อจริงบน production ด้วยออเดอร์ทดสอบ ตรวจ log ว่าไม่มี token ที่อยู่ หรือเบอร์โทร แล้วลบข้อมูลทดสอบเมื่อได้รับอนุญาต

## หมายเหตุสำหรับผู้ดูแลระบบ

- **ถอดสิทธิ์แอดมิน:** ลบแถวของผู้ใช้นั้นในตาราง `admins` และถ้าต้องการให้ login ไม่ได้อีก ให้ ban ผู้ใช้ใน Supabase Auth ห้ามลบผู้ใช้ใน Auth เพราะ `payment_slips.reviewed_by` อ้างอิงผู้ใช้แบบ `ON DELETE RESTRICT` การลบจะล้มเหลวหรือทำให้ประวัติการตรวจสลิปขาด
- **การลบไฟล์สลิป:** ระบบลบไฟล์สลิปออกจาก Storage อัตโนมัติ 90 วันหลังออเดอร์เป็น `shipped`, `cancelled` หรือ `expired` โดยเก็บแถว `payment_slips` ไว้พร้อม `file_deleted_at` งานนี้รันผ่าน Vercel Cron วันละครั้ง (`vercel.json`, 02:00 น. เวลาไทย) ที่ `/api/cron/purge-slips`
- **Vercel Cron ต้องมี `CRON_SECRET`:** ต้องตั้ง `CRON_SECRET` ในโปรเจกต์ Vercel เพราะ Vercel ส่ง header `Authorization` ให้ cron เฉพาะเมื่อมีตัวแปรนี้ ถ้าไม่มีหรือค่าไม่ตรง endpoint จะตอบ 401 และไฟล์สลิปจะไม่ถูกลบ แอปไม่ได้ตรวจตัวแปรตอนเริ่มทำงาน แต่อ่านและตรวจ environment variables ฝั่ง server ครั้งแรกที่มีการใช้งาน ดังนั้นการตั้งค่าผิดจะเห็นตอนเรียก endpoint หรือหน้าที่ใช้ตัวแปรเหล่านั้น ไม่ใช่ตอน deploy
- **ออเดอร์หมดอายุ:** `pg_cron` ใน Supabase เรียก `expire_orders` ทุก 5 นาที และล้างตาราง `rate_limits` วันละครั้ง หน้าออเดอร์และการแนบสลิปตรวจเวลาหมดอายุเองด้วย
- **การตรวจสลิป:** เทียบยอดกับแอปธนาคารทุกครั้งก่อนกดยืนยัน รูปสลิปอย่างเดียวปลอมได้
- **ลิงก์ออเดอร์:** เป็นทางเดียวที่ลูกค้าดูสถานะได้ ระบบเก็บเฉพาะ hash ของ token จึงสร้างลิงก์เดิมคืนให้ไม่ได้ ถ้าลูกค้าทำลิงก์หาย ให้คุยกับลูกค้าด้วยเลขคำสั่งซื้อและดูสถานะจากหน้าแอดมินแทน
- ตัวเลข 90 วันและเนื้อหาหน้า `/privacy` เป็นค่าเริ่มต้นทางเทคนิค ไม่ใช่คำแนะนำทางกฎหมาย ควรตรวจกับข้อกำหนด PDPA ภาษี และบัญชีก่อนเปิดรับออเดอร์จริง
