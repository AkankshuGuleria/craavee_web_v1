import type { Metadata } from "next";
import { Outfit, Geist, Geist_Mono } from "next/font/google";
import "../styles/globals.css";

const display = Outfit({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600", "700", "800"],
});
const body = Geist({ subsets: ["latin"], variable: "--font-body" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Craavee Store",
  description: "Packer/store operational surface — pick, pack, and hand off orders.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${display.variable} ${body.variable} ${mono.variable} font-body antialiased bg-[#0a0c10] text-slate-100 min-h-[100dvh]`}
      >
        {children}
      </body>
    </html>
  );
}
