"use client";

import { usePathname } from "next/navigation";
import Navbar from "@/components/Navbar";
import CartDrawer from "@/components/CartDrawer";
import SaleStrip from "@/components/SaleStrip";

/**
 * Wraps the page content. The admin side has its own nav and its own
 * layout rhythm, so the customer navbar/cart drawer (and the top padding
 * that makes room for the fixed navbar) only apply outside /admin.
 */
export default function StorefrontChrome({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith("/admin");

  if (isAdmin) {
    return <main className="flex-grow">{children}</main>;
  }

  return (
    <>
      <Navbar />
      <CartDrawer />
      {/*
        The strip sits inside the padded region rather than in the fixed
        navbar: it scrolls away with the page. Pinning both would cost 6rem
        of a phone screen permanently, and the offer only needs to be seen,
        not followed down the page.
      */}
      <main className="flex-grow pt-16">
        <SaleStrip />
        {children}
      </main>
    </>
  );
}
