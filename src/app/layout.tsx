import type { Metadata } from "next";
import Link from "next/link";
import { Inter, Lora } from "next/font/google";
import { AppToaster } from "@/components/AppToaster";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const lora = Lora({ subsets: ["latin"], variable: "--font-lora" });

export const metadata: Metadata = {
  title: "Lion's Roar Talk Publisher",
  description: "Zoom to YouTube publishing workflow",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${lora.variable}`}>
      <body className="min-h-screen bg-[#FAFAF8] text-[#1C1C1A]">
        <header className="border-b border-zinc-200 bg-white/70">
          <nav className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-4 text-sm">
            <Link href="/" className="font-semibold">
              Dashboard
            </Link>
            <Link href="/settings">Settings</Link>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-6xl px-6 py-8">{children}</main>
        <AppToaster />
      </body>
    </html>
  );
}
