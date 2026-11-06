import type { Metadata } from "next";
import { IBM_Plex_Sans_Thai } from "next/font/google";
import { STORE_NAME } from "@/lib/store-config";
import "./globals.css";

const thaiSans = IBM_Plex_Sans_Thai({
  variable: "--font-thai",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: STORE_NAME, template: `%s | ${STORE_NAME}` },
  description: `${STORE_NAME} จำหน่ายสินค้าออนไลน์ ชำระเงินด้วยพร้อมเพย์`,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="th" className={`${thaiSans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-paper text-ink">{children}</body>
    </html>
  );
}
