"use client";

import { useEffect, useState } from "react";
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
import { classifyBuyer, refusedDomainReason } from "@/lib/orderPolicy";

/*
  lib/orderPolicy.ts imports nothing, so it is safe to pull into a client
  component — see the note on lib/models/product.ts for the module that is
  not. Only the domain lists are used here, and only to tell the shopper
  what will happen before they wait for a round trip. The server decides:
  env-configured additions to those lists are not present in the client
  bundle, so a domain the server refuses may still look fine here, and that
  is the right way round.
*/

/*
  TODO(before launch): these three have to be real before external ordering
  is switched on, and the retention line is a promise that needs
  scripts/scrub-buyer-details.ts actually being run.
*/
const RUSTAN_CONNECTION_EXAMPLES =
  "[Rustan Group of Companies]";
const DPO_CONTACT = "[ctescalo@rgoc.com.ph]";
const DPO_RESPONSE_DAYS = "3-5 business days";
const RETENTION_AFTER_SALE = "6 months";

/** What the address in the box looks like, as far as the browser can tell. */
type EmailClass =
  | "unknown"
  | "internal"
  | "external"
  | "refused-personal"
  | "refused-disposable";

/**
 * Classify what has been typed so far.
 *
 * Returns "unknown" until the value actually looks like a finished address.
 * Without that, the extra fields flash open and shut while someone types
 * their way through "juan@a", "juan@ac", "juan@acme." — which reads as the
 * form malfunctioning.
 */
function classifyTypedEmail(value: string): EmailClass {
  const trimmed = value.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return "unknown";

  const domain = trimmed.slice(at + 1);
  if (!/\.[a-z]{2,}$/.test(domain)) return "unknown";

  const refusal = refusedDomainReason(trimmed);
  if (refusal) {
    return refusal === "personal" ? "refused-personal" : "refused-disposable";
  }

  return classifyBuyer(trimmed);
}

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

  // Collected only from buyers outside RGOC.
  const [buyerName, setBuyerName] = useState("");
  const [buyerCompany, setBuyerCompany] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [declared, setDeclared] = useState(false);
  const [emailClass, setEmailClass] = useState<EmailClass>("unknown");

  const isExternal = emailClass === "external";
  const isRefused =
    emailClass === "refused-personal" || emailClass === "refused-disposable";

  /*
    Reclassify the address, and clear the outside-buyer fields the moment it
    stops being an outside address.

    Clearing here rather than in an effect keyed on the classification is
    deliberate on two counts. It is one transition rather than a render in
    between, so the fields can never be briefly hidden while still holding
    values; and "clear, do not merely hide" is the actual requirement.
    Someone can type an outside address, fill all three fields, tick the
    declaration, then realise they meant to use their RGOC address — if the
    values only stopped being rendered they would still be posted, recording
    a declaration against an order that never needed one. That is precisely
    the record that must not exist.
  */
  const applyEmailClass = (value: string) => {
    const next = classifyTypedEmail(value);
    setEmailClass(next);

    if (next !== "external") {
      setBuyerName("");
      setBuyerCompany("");
      setBuyerPhone("");
      setDeclared(false);
    }
  };

  /*
    Debounced rather than per-keystroke: 300ms is long enough that the block
    opens once, when the address is finished, instead of tracking the typing
    through "juan@a", "juan@ac", "juan@acme.". The blur handler on the field
    re-runs it immediately, so tabbing away never leaves a stale state.
  */
  useEffect(() => {
    const handle = setTimeout(() => applyEmailClass(email), 300);
    return () => clearTimeout(handle);
  }, [email]);

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
        body: JSON.stringify(
          // The extra fields are sent only when they are actually being
          // asked for. The server ignores them otherwise, but not sending
          // them at all is what makes that easy to verify from the network
          // tab rather than by reading the route.
          isExternal
            ? {
                email,
                name: buyerName,
                company: buyerCompany,
                phone: buyerPhone,
                declared,
              }
            : { email },
        ),
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
                      Payment Method: Online payment only via GCash or Bank
                      Transfer.
                    </li>
                    <li>
                      Pick-up location: RMK Head Office, 3/F Midland Buendia
                      Bldg., Sen. Gil J. Puyat Ave., Makati City.
                    </li>
                  </ul>
                  <p>
                    <strong>Orders from outside RGOC.</strong> This sale is for
                    the Rustan Group. If you are ordering from a company email
                    address that is not @rgoc.com.ph, you are confirming that
                    your company is part of, or works with, the Rustan Group —{" "}
                    {RUSTAN_CONNECTION_EXAMPLES}.
                  </p>
                  <p>
                    Our team checks this before an order is handed over. If we
                    cannot establish the connection, we may cancel your order at
                    any point before handover — including after it has been
                    confirmed — and we will email you to say so. Cancelled
                    orders return the items to stock; nothing is charged at any
                    stage of this sale.
                  </p>
                  <p>
                    By submitting this form, you confirm that you have read and
                    agreed to the terms and conditions above.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    <strong>What we collect.</strong> When you order from this
                    store we collect your email address and the contents of your
                    order. If you are ordering from outside RGOC, we also
                    collect your full name, the company you are ordering for, a
                    contact number, and a record that you confirmed your
                    company&apos;s connection to the Rustan Group.
                  </p>
                  <p>
                    <strong>Why we collect it.</strong> To send you a checkout
                    code, confirm the items you ordered are available, check
                    that this sale is open to you, issue your receipt, and
                    arrange payment and pick-up. We do not use any of it for
                    marketing.
                  </p>
                  <p>
                    <strong>Who sees it.</strong> Staff of Rustan Marketing
                    Corporation handling this sale. Your order is emailed to the
                    assigned staff and your receipt is emailed to you. We will
                    never ask for your password, OTP, credit card details, or
                    other sensitive account information. We do not sell or
                    disclose your information to anyone else, except where the
                    law requires it.
                  </p>
                  <p>
                    <strong>How long we keep it.</strong> Order records are kept
                    for the duration of the sale and for {RETENTION_AFTER_SALE}{" "}
                    after it closes, so we can answer questions about an order.
                    After that we remove your name, company and contact number
                    from the record.
                  </p>
                  <p>
                    <strong>Your rights.</strong> Under the Data Privacy Act of
                    2012 you may ask to see what we hold about you, have it
                    corrected, or have it deleted. Write to {DPO_CONTACT} and we
                    will respond within {DPO_RESPONSE_DAYS} days.
                  </p>
                  <p>
                    By submitting this form, you confirm that you have read and
                    agreed to the Data Privacy Policy above.
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
                    <label
                      htmlFor="checkout-email"
                      className="block text-sm font-medium text-muted mb-2"
                    >
                      Work email address
                    </label>
                    <input
                      id="checkout-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      // Re-runs the check immediately on tab-out, so the
                      // debounce above never leaves a stale state on screen.
                      onBlur={() => applyEmailClass(email)}
                      className={`w-full bg-white border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all ${
                        isRefused ? "border-primary" : "border-border"
                      }`}
                      placeholder="you@rgoc.com.ph"
                    />

                    {/* Stated up front so someone using a personal address
                        finds out here rather than after submitting. The
                        server is still the authority — see
                        lib/orderPolicy.ts. */}
                    {!isRefused && (
                      <p className="mt-2 text-xs text-muted">
                        Company email addresses only — RGOC or a partner
                        company.
                      </p>
                    )}

                    {/* Named a way forward rather than only saying no. This
                        is the message most likely to produce a support
                        question, so it is worth the extra clause. */}
                    {isRefused && (
                      <p className="mt-2 text-xs text-primary leading-relaxed">
                        {emailClass === "refused-disposable"
                          ? "We can't send checkout codes to that email provider. Please use your work address."
                          : "This sale takes orders from company email addresses. Please use your work address — or ask your RGOC contact to order for you."}
                      </p>
                    )}
                  </div>

                  {/*
                    Everything here exists for one reason — this buyer is
                    outside RGOC — so it is grouped into one block rather
                    than scattered among the standard fields, where it would
                    read as three unexplained extra questions.
                  */}
                  {isExternal && (
                    <div className="rounded-xl border border-accent/60 bg-accent/5 p-4 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                      <p className="text-xs text-foreground leading-relaxed">
                        Ordering from outside RGOC — we just need someone to
                        contact about the handover.
                      </p>

                      <div>
                        <label
                          htmlFor="buyer-name"
                          className="block text-sm font-medium text-muted mb-2"
                        >
                          Full name
                        </label>
                        <input
                          id="buyer-name"
                          type="text"
                          required
                          value={buyerName}
                          onChange={(e) => setBuyerName(e.target.value)}
                          className="w-full bg-white border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                          placeholder="Juan Dela Cruz"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="buyer-company"
                          className="block text-sm font-medium text-muted mb-2"
                        >
                          Company
                        </label>
                        <input
                          id="buyer-company"
                          type="text"
                          required
                          value={buyerCompany}
                          onChange={(e) => setBuyerCompany(e.target.value)}
                          className="w-full bg-white border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                          placeholder="Acme Retail, Inc."
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="buyer-phone"
                          className="block text-sm font-medium text-muted mb-2"
                        >
                          Contact number
                        </label>
                        <input
                          id="buyer-phone"
                          type="tel"
                          inputMode="tel"
                          required
                          value={buyerPhone}
                          onChange={(e) => setBuyerPhone(e.target.value)}
                          className="w-full bg-white border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                          placeholder="0917 123 4567"
                        />
                        <p className="mt-2 text-xs text-muted">
                          Used only to confirm your order and arrange pickup.
                        </p>
                      </div>

                      {/*
                        A declaration, not a consent — which is why it
                        toggles directly instead of opening a document the
                        way Terms and Privacy do. The clause it summarises
                        is in the Terms modal linked just below.
                      */}
                      <label
                        htmlFor="buyer-declared"
                        className={`flex items-start gap-3 cursor-pointer p-4 border rounded-xl transition-colors ${
                          declared
                            ? "border-primary/50 bg-primary/5"
                            : "border-border bg-white hover:bg-surface"
                        }`}
                      >
                        <div className="flex items-center h-5 mt-0.5">
                          <input
                            id="buyer-declared"
                            type="checkbox"
                            required
                            checked={declared}
                            onChange={(e) => setDeclared(e.target.checked)}
                            className="w-4 h-4 rounded border-border text-primary focus:ring-primary focus:ring-offset-background bg-background cursor-pointer"
                          />
                        </div>
                        <span className="text-sm text-muted leading-relaxed">
                          I confirm my company is part of or works with the
                          Rustan Group. Orders we can&apos;t verify may be
                          cancelled.
                        </span>
                      </label>
                    </div>
                  )}

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
                    disabled={
                      loading ||
                      !acceptedTerms ||
                      !acceptedPrivacy ||
                      isRefused ||
                      (isExternal && !declared)
                    }
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
