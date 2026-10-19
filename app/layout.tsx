import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./prompt.css";

const geist = localFont({
  src: "./fonts/Geist.woff2",
  variable: "--font-geist",
  display: "swap",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "MiniMax Campaign Studio — Powered by eve",
  description:
    "Decode a social campaign. Direct an original MiniMax M3.1 launch film with H3 and eve.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={geist.variable}>
      <body>{children}</body>
    </html>
  );
}
