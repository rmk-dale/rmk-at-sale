import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import StorefrontChrome from "@/components/StorefrontChrome";
import { Analytics } from '@vercel/analytics/next';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "rmk-at-sale | Premium Monolithic E-Commerce",
  description: "A secure, stateless e-commerce experience.",
  icons: {
    icon: "/r.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
    >
      <body className="min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)] flex flex-col">
        <StorefrontChrome>{children}</StorefrontChrome>
        <Analytics />
      </body>
    </html>
  );
}
