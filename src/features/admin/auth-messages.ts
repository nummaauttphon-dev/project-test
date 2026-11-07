export const ADMIN_MESSAGES = {
  // One text for a wrong password, an unknown email and a non-admin account.
  LOGIN_FAILED: "อีเมลหรือรหัสผ่านไม่ถูกต้อง หรือบัญชีนี้ไม่มีสิทธิ์เข้าใช้งาน",
  RATE_LIMITED: "มีการพยายามหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่",
  SERVICE_UNAVAILABLE: "ระบบไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่อีกครั้ง",
  UNAUTHORIZED: "กรุณาเข้าสู่ระบบอีกครั้ง",
  MFA_INVALID_CODE: "รหัสไม่ถูกต้องหรือหมดอายุ กรุณาลองใหม่อีกครั้ง",
  MFA_CODE_FORMAT: "กรุณากรอกรหัสตัวเลข 6 หลักจากแอปยืนยันตัวตน",
  MFA_RESTART: "ไม่พบการตั้งค่าที่รอยืนยัน กรุณาโหลดหน้านี้แล้วเริ่มตั้งค่าใหม่",
} as const;

type AuthErrorLike = { status?: number; code?: string };
type Failure = { code: string; message: string };

const RATE_LIMITED: Failure = { code: "RATE_LIMITED", message: ADMIN_MESSAGES.RATE_LIMITED };
const UNAVAILABLE: Failure = { code: "SERVICE_UNAVAILABLE", message: ADMIN_MESSAGES.SERVICE_UNAVAILABLE };

function commonFailure({ status, code }: AuthErrorLike): Failure | null {
  if (status === 429 || code?.startsWith("over_")) return RATE_LIMITED;
  // A fetch failure has no status or status 0; 5xx is the service itself.
  if (!status || status >= 500) return UNAVAILABLE;
  return null;
}

export function loginFailure(error: AuthErrorLike): Failure {
  return commonFailure(error) ?? { code: "INVALID_CREDENTIALS", message: ADMIN_MESSAGES.LOGIN_FAILED };
}

export function mfaFailure(error: AuthErrorLike): Failure {
  return commonFailure(error) ?? { code: "INVALID_CODE", message: ADMIN_MESSAGES.MFA_INVALID_CODE };
}
