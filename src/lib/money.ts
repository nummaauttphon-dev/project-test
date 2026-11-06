/** Formats an integer amount in satang as Thai baht, e.g. 12350 -> "฿123.50". */
export function formatBaht(satang: number): string {
  const negative = satang < 0;
  const abs = Math.abs(Math.trunc(satang));
  const baht = Math.floor(abs / 100).toLocaleString("en-US");
  const cents = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}฿${baht}.${cents}`;
}
