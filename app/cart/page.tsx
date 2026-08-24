"use client";

import { useState } from "react";
import { useCartStore, evaluateCart, groupCartLines } from "@/lib/store";
import { useCatalog } from "@/lib/useCatalog";
import { useHydrated } from "@/lib/useHydrated";
import CartGroup from "@/components/CartGroup";
import {
  BUNDLE_SIZE,
  MIN_UNITS_PER_PRODUCT,
  bundleMinimumMessage,
} from "@/lib/validation";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Lock,
  X,
} from "lucide-react";
import Link from "next/link";

export default function CartPage() {
  // The money comes from `bundles` below rather than `getTotal()`: the
  // summary needs the subtotal, the discount and the payable total
  // together, and one evaluation produces all three consistently.
  const { items, getTotalItems, clearCart } = useCartStore();
  /*
    Whether the persisted cart has been read out of localStorage yet. The
    server has no localStorage, so it must render the pre-hydration state
    or React reports a mismatch.
  */
  const hydrated = useHydrated();
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"CART" | "EMAIL" | "OTP" | "SUCCESS">(
    "CART",
  );
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [modalContent, setModalContent] = useState<"TERMS" | "PRIVACY" | null>(null);
  const [loading, setLoading] = useState(false);
  const [orderNumber, setOrderNumber] = useState("");
  const [error, setError] = useState("");

  // Held so each line can check itself against current prices and stock:
  // the cart persists to localStorage and can outlive what it points at.
  const catalog = useCatalog(items.length > 0);

  // This is a sale campaign, so what the shopper is saving is worth stating
  // rather than leaving implied by a row of strikethroughs.
  const totalSavings = items.reduce(
    (sum, i) =>
      i.originalPrice !== undefined && i.originalPrice > i.price
        ? sum + (i.originalPrice - i.price) * i.quantity
        : sum,
    0,
  );

  /*
    The bundle rules, from the same function the checkout route runs. Two
    things come out of it: the money shown in the summary, and whether the
    order can be placed at all.

    Blocking here is a courtesy, not a control — the server re-derives all
    of this from variant prices inside the checkout transaction and will
    refuse the same cart on its own. What it buys is that a shopper finds
    out while they can still fix it, rather than after entering an email
    and waiting for a one-time code.
  */
  const bundles = evaluateCart(items);
  // One block per product, so the pieces that share a bundle sit together
  // and the group's standing has a header to live in.
  const groupings = groupCartLines(items);
  const blockingNames = bundles.shortGroups.map(
    (group) => items.find((i) => i.id === group.id)?.name ?? "",
  );

  if (!hydrated) return null;

  const handleRequestOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error);

      setStep("OTP");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyAndCheckout = async (e: React.FormEvent) => {
    e.preventDefault();

    // Re-checked at submit, not only when the button was rendered. The
    // drawer stays reachable from the navbar during the email and code
    // steps, so a cart that satisfied the rules a minute ago may not now.
    if (!bundles.ok) {
      setError(bundleMinimumMessage(blockingNames));
      setStep("CART");
      return;
    }

    setLoading(true);
    setError("");

    try {
      // 1. Verify OTP
      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otp }),
      });

      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verifyData.error);

      // 2. Process Checkout
      const checkoutRes = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });

      const checkoutData = await checkoutRes.json();
      if (!checkoutRes.ok) throw new Error(checkoutData.error);

      setOrderNumber(checkoutData.orderNumber ?? "");
      clearCart();
      setStep("SUCCESS");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setLoading(false);
    }
  };

  if (step === "SUCCESS") {
    return (
      <div className="max-w-2xl mx-auto px-6 py-24 text-center">
        <div className="bg-surface border border-border p-12 rounded-2xl animate-in zoom-in slide-in-from-bottom-8 duration-500">
          <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto mb-6" />
          <h1 className="text-3xl font-semibold mb-4 text-foreground">
            Order confirmed
          </h1>
          <p className="text-muted text-lg mb-6">
            Your receipt has been sent to{" "}
            <span className="text-foreground font-medium">{email}</span>. Thank
            you for your purchase.
          </p>
          <div className="flex flex-col items-center gap-8">
            {orderNumber && (
              <div className="px-5 py-3 rounded-xl bg-background border border-border">
                <p className="text-xs uppercase tracking-wide text-muted mb-1">
                  Order reference
                </p>
                <p className="font-mono text-lg font-semibold text-foreground">
                  {orderNumber}
                </p>
                <p className="text-xs text-muted mt-1">
                  Quote this if you contact us about your order.
                </p>
              </div>
            )}
            <Link
              href="/"
              className="inline-flex items-center justify-center bg-primary text-white px-8 py-3 rounded-xl font-medium hover:bg-primary-hover transition-colors"
            >
              Continue shopping
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-12">
      {/* Modal */}
      {modalContent && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <div
            className="absolute inset-0 bg-black/40 animate-in fade-in duration-200"
            onClick={() => setModalContent(null)}
          />
          <div className="relative bg-surface rounded-2xl p-8 max-w-lg w-full max-h-[80vh] overflow-y-auto animate-in zoom-in-95 duration-200 shadow-2xl">
            <button
              onClick={() => setModalContent(null)}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-background transition-colors"
            >
              <X className="w-5 h-5 text-muted" />
            </button>
            <h2 className="text-xl font-semibold mb-4 text-foreground">
              {modalContent === "TERMS" ? "Terms & Conditions" : "Data Privacy Policy"}
            </h2>
            <div className="space-y-4 text-sm text-foreground/90 leading-relaxed">
              {modalContent === "TERMS" ? (
                <>
                  <p>Welcome to the RMK American Tourister Sale!</p>
                  <p>
                    Please note that submitting this form{" "}
                    <strong>does not confirm your purchase</strong>. This form
                    is for order placement only.
                  </p>
                  <ul className="list-disc pl-5 space-y-2">
                    <li>
                      Our team will check the availability of the items in your
                      order and send you an order confirmation once all items
                      are confirmed to be available.
                    </li>
                    <li>
                      In an instance wherein an item is unavailable or the
                      stocks are insufficient, our representative will contact
                      you with alternative options for the bundle.
                    </li>
                    <li>
                      Once your order is confirmed, a representative will
                      contact you regarding payment and pick-up details.
                    </li>
                    <li>
                      Pick-up location: RMK Head Office, 3/F Midland Buendia
                      Bldg., Sen. Gil J. Puyat Ave., Makati City.
                    </li>
                  </ul>
                  <p>
                    By submitting this form, you confirm that you have read and
                    agreed to the terms and conditions above.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    <strong>We only collect your email address for tracking orders.</strong>
                  </p>
                  <p>
                    Someone from our team will contact you to finalize and confirm the sale. 
                    Your data will be kept strictly confidential and will not be shared with any third parties.
                  </p>
                </>
              )}
            </div>
            <div className="mt-8 flex gap-3">
              <button
                onClick={() => setModalContent(null)}
                className="flex-1 border border-border text-foreground py-3 rounded-xl font-medium hover:bg-surface transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (modalContent === "TERMS") setAcceptedTerms(true);
                  if (modalContent === "PRIVACY") setAcceptedPrivacy(true);
                  setModalContent(null);
                }}
                className="flex-1 bg-primary text-white py-3 rounded-xl font-medium hover:bg-primary-hover transition-colors"
              >
                I Agree
              </button>
            </div>
          </div>
        </div>
      )}

      <h1 className="text-3xl font-semibold mb-10 text-foreground">Your cart</h1>

      {items.length === 0 ? (
        <div className="text-center py-24 bg-surface rounded-2xl border border-border">
          <p className="text-muted text-lg mb-6">Your cart is empty.</p>
          <Link
            href="/"
            className="inline-flex bg-primary text-white px-6 py-3 rounded-xl font-medium hover:bg-primary-hover transition-colors"
          >
            Start shopping
          </Link>
        </div>
      ) : (
        <div className="grid lg:grid-cols-3 gap-10">
          {/* Cart Items */}
          <div className="lg:col-span-2 space-y-4">
            {/* Same components the drawer renders, so the two views cannot
                disagree about what a group says or what a line lets you do. */}
            {groupings.map((grouping) => (
              <CartGroup
                key={grouping.id}
                grouping={grouping}
                group={bundles.byProduct.get(grouping.id)}
                product={catalog?.find((p) => p.id === grouping.id)}
                variant="full"
              />
            ))}
          </div>

          {/* Checkout Panel */}
          <div className="lg:col-span-1">
            <div className="bg-surface border border-border rounded-2xl p-8 sticky top-24">
              <h2 className="text-xl font-semibold mb-6 text-foreground">
                Order summary
              </h2>

              <div className="flex justify-between items-baseline mb-2 text-sm">
                <span className="text-muted">
                  {getTotalItems()} item{getTotalItems() === 1 ? "" : "s"}
                </span>
                {totalSavings > 0 && (
                  <span className="text-emerald-700 tabular-nums">
                    You save ₱{totalSavings.toFixed(2)}
                  </span>
                )}
              </div>

              {/*
                Subtotal and total are separate rows only once a bundle has
                actually fired. On an order with nothing qualifying they
                would be the same number printed twice, and a "Bundle
                discount ₱0.00" line reads as a discount that failed rather
                than one that was never earned.
              */}
              {bundles.discount > 0 && (
                <>
                  <div className="flex justify-between items-center mb-2 text-sm">
                    <span className="text-muted">Subtotal</span>
                    <span className="text-muted tabular-nums">
                      ₱{bundles.subtotal.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center mb-2 text-sm">
                    <span className="text-emerald-700">
                      Bundle discount (5%)
                    </span>
                    <span className="text-emerald-700 tabular-nums">
                      −₱{bundles.discount.toFixed(2)}
                    </span>
                  </div>
                </>
              )}

              <div className="flex justify-between items-center mb-6">
                <span className="text-muted">Total</span>
                <span className="text-foreground font-semibold text-2xl tabular-nums">
                  ₱{bundles.total.toFixed(2)}
                </span>
              </div>

              {!bundles.ok && (
                <div className="flex items-start gap-2 mb-6 p-3 rounded-xl bg-primary/5 border border-primary/20">
                  <AlertTriangle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  <p className="text-xs text-foreground leading-relaxed">
                    {bundleMinimumMessage(blockingNames)}
                  </p>
                </div>
              )}

              {bundles.ok && bundles.discount === 0 && items.length > 0 && (
                <p className="text-xs text-muted mb-6 leading-relaxed">
                  Take {BUNDLE_SIZE} or more pieces of the same item and get 5%
                  off that bundle. Mix and match colours and sizes!
                </p>
              )}

              <div className="w-full h-px bg-border mb-8" />

              {step === "CART" && (
                <button
                  onClick={() => setStep("EMAIL")}
                  disabled={!bundles.ok}
                  className="w-full flex items-center justify-center gap-2 bg-primary text-white py-3.5 rounded-xl font-medium hover:bg-primary-hover transition-all transform active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-primary disabled:active:scale-100"
                >
                  {bundles.ok
                    ? "Secure checkout"
                    : `Minimum ${MIN_UNITS_PER_PRODUCT} per item`}
                  {bundles.ok && <ArrowRight className="w-4 h-4" />}
                </button>
              )}

              {step === "EMAIL" && (
                <form
                  onSubmit={handleRequestOTP}
                  className="space-y-4 animate-in slide-in-from-right-4 duration-300"
                >
                  <div>
                    <label className="block text-sm font-medium text-muted mb-2">
                      Work email address
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-white border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                      placeholder="you@rgoc.com.ph"
                    />
                    {/* Stated up front so an employee using a personal
                        address finds out here rather than after submitting.
                        The server is still the authority — see
                        lib/orderPolicy.ts. */}
                    <p className="mt-2 text-xs text-muted">
                      Ordering is limited to company email addresses.
                    </p>
                  </div>

                  <div className="space-y-3 pt-4">
                    <label 
                      onClick={(e) => {
                        e.preventDefault();
                        if (!acceptedTerms) setModalContent("TERMS");
                        else setAcceptedTerms(false);
                      }}
                      className={`flex items-start gap-3 cursor-pointer p-4 border rounded-xl transition-colors ${acceptedTerms ? 'border-primary/50 bg-primary/5' : 'border-border hover:bg-surface'}`}
                    >
                      <div className="flex items-center h-5 mt-0.5">
                        <input
                          type="checkbox"
                          required
                          checked={acceptedTerms}
                          readOnly
                          className="w-4 h-4 rounded border-border text-primary focus:ring-primary focus:ring-offset-background bg-background cursor-pointer"
                        />
                      </div>
                      <span className="text-sm text-muted leading-relaxed">
                        I agree to the{" "}
                        <button
                          type="button"
                          className="text-foreground underline hover:text-primary transition-colors font-medium"
                        >
                          Terms &amp; Conditions
                        </button>.
                      </span>
                    </label>

                    <label 
                      onClick={(e) => {
                        e.preventDefault();
                        if (!acceptedPrivacy) setModalContent("PRIVACY");
                        else setAcceptedPrivacy(false);
                      }}
                      className={`flex items-start gap-3 cursor-pointer p-4 border rounded-xl transition-colors ${acceptedPrivacy ? 'border-primary/50 bg-primary/5' : 'border-border hover:bg-surface'}`}
                    >
                      <div className="flex items-center h-5 mt-0.5">
                        <input
                          type="checkbox"
                          required
                          checked={acceptedPrivacy}
                          readOnly
                          className="w-4 h-4 rounded border-border text-primary focus:ring-primary focus:ring-offset-background bg-background cursor-pointer flex-shrink-0"
                        />
                      </div>
                      <span className="text-sm text-muted leading-relaxed">
                        I accept the{" "}
                        <button
                          type="button"
                          className="text-foreground underline hover:text-primary transition-colors font-medium"
                        >
                          Data Privacy Policy
                        </button>.
                      </span>
                    </label>
                  </div>

                  {error && <p className="text-red-500 text-sm">{error}</p>}
                  <button
                    disabled={loading || !acceptedTerms || !acceptedPrivacy}
                    type="submit"
                    className="w-full flex items-center justify-center gap-2 bg-primary text-white py-3.5 rounded-xl font-medium disabled:opacity-50 disabled:pointer-events-none hover:bg-primary-hover transition-colors mt-2"
                  >
                    {loading ? "Sending code..." : "Send checkout code"}
                  </button>
                </form>
              )}

              {step === "OTP" && (
                <form
                  onSubmit={handleVerifyAndCheckout}
                  className="space-y-4 animate-in slide-in-from-right-4 duration-300"
                >
                  <div>
                    <label className="block text-sm font-medium text-muted mb-2">
                      6-digit code sent to {email}
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={6}
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                      className="w-full bg-white border border-border rounded-xl px-4 py-3 text-foreground tracking-widest font-mono text-center text-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                      placeholder="000000"
                    />
                  </div>
                  {error && <p className="text-red-500 text-sm">{error}</p>}
                  <button
                    disabled={loading}
                    type="submit"
                    className="w-full flex items-center justify-center gap-2 bg-primary text-white py-3.5 rounded-xl font-medium disabled:opacity-50 disabled:pointer-events-none hover:bg-primary-hover transition-colors"
                  >
                    {loading ? "Verifying..." : "Verify & pay securely"}
                    {!loading && <Lock className="w-4 h-4" />}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
