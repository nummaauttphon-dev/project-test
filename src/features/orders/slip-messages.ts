/** Customer-facing slip messages. Kept free of server-only code so the upload form can reuse them. */
export const SLIP_MESSAGES = {
  NOT_FOUND: "ไม่พบคำสั่งซื้อนี้ กรุณาตรวจสอบลิงก์อีกครั้ง",
  EXPIRED:
    "คำสั่งซื้อนี้หมดเวลาชำระเงินแล้ว หากคุณโอนเงินไปแล้ว กรุณาติดต่อร้านพร้อมแจ้งเลขคำสั่งซื้อและแนบสลิปให้ร้านโดยตรง",
  INVALID_STATUS: "คำสั่งซื้อนี้ไม่ได้อยู่ในขั้นตอนรอแนบสลิป กรุณากดรีเฟรชเพื่อดูสถานะล่าสุด",
  RATE_LIMITED: "แนบสลิปบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง",
  TOO_LARGE: "ไฟล์ใหญ่เกิน 4 MB กรุณาเลือกไฟล์ที่เล็กกว่านี้ หรือแคปหน้าจอสลิปแทน",
  UNSUPPORTED_TYPE: "รองรับเฉพาะไฟล์ภาพ JPEG, PNG หรือ WebP ที่เปิดดูได้ กรุณาเลือกไฟล์ใหม่",
  HEIC: "ยังไม่รองรับไฟล์ HEIC/HEIF กรุณาแคปหน้าจอสลิปแล้วส่งภาพหน้าจอ หรือบันทึกรูปเป็น JPEG ก่อนแนบ",
  UPLOAD_FAILED: "แนบสลิปไม่สำเร็จ สถานะคำสั่งซื้อยังไม่เปลี่ยน กรุณาลองใหม่อีกครั้ง",
} as const;

export type SlipFailureCode = keyof typeof SLIP_MESSAGES;
