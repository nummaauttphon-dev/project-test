import generatePayload from "promptpay-qr";
import QRCode from "qrcode";

export function createPromptPayPayload(id: string, totalSatang: number): string {
  return generatePayload(id, { amount: totalSatang / 100 });
}

export function renderQrDataUrl(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, { errorCorrectionLevel: "M", margin: 2, width: 320 });
}
