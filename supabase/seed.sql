-- Development sample products only.
insert into public.products (slug, name, description, price_satang, stock_quantity, is_active) values
  ('sample-tote-bag', 'กระเป๋าผ้าแคนวาส', 'กระเป๋าผ้าแคนวาสใบใหญ่ ใส่ของได้เยอะ', 29000, 25, true),
  ('sample-ceramic-mug', 'แก้วเซรามิก', 'แก้วเซรามิกเคลือบเงา ความจุ 350 มล.', 19000, 40, true),
  ('sample-notebook', 'สมุดโน้ตปกแข็ง', 'สมุดโน้ตปกแข็ง 120 หน้า กระดาษถนอมสายตา', 12000, 60, true),
  ('sample-last-piece', 'โคมไฟตั้งโต๊ะ (เหลือชิ้นสุดท้าย)', 'ใช้ทดสอบกรณีสต็อกเหลือ 1 ชิ้น', 89000, 1, true),
  ('sample-sold-out', 'ที่วางโทรศัพท์ (สินค้าหมด)', 'ใช้ทดสอบป้ายสินค้าหมด', 15000, 0, true),
  ('sample-hidden', 'สินค้าที่ซ่อนอยู่', 'ใช้ทดสอบว่าสินค้าที่เลิกขายไม่แสดงหน้าร้าน', 9900, 5, false);
