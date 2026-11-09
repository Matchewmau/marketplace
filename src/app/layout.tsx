import type { Metadata } from "next";

import { Header } from "@/components/layout/header";

import "./globals.css";

export const metadata: Metadata = {
  title: "Marketplace",
  description: "Buy and sell items in your community",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#F0F2F5] font-sans text-[#1c1e21] antialiased">
        <Header />
        <main className="mx-auto max-w-7xl px-4 py-5 sm:py-6">{children}</main>
      </body>
    </html>
  );
}
