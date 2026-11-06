import "server-only";
import { createHash, createHmac } from "node:crypto";

export function deriveOrderToken(key: string, secret: string): string {
  return createHmac("sha256", secret).update(key).digest("base64url");
}

export function hashOrderToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
