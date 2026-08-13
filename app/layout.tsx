import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import StorefrontChrome from "@/components/StorefrontChrome";
import WebVitals from "@/components/WebVitals";

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
        <WebVitals />
        {/*
          Vercel Web Analytics: page views and visitors, which the Performance
          tab reads back through Vercel's API. It measures *who* is visiting;
          <WebVitals /> above measures *how fast* it loads for them. The two
          are deliberately separate systems — see lib/vercelAnalytics.ts.
        */}
        <Analytics />
        <StorefrontChrome>{children}</StorefrontChrome>
      </body>
    </html>
  );
}
