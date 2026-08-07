"use client";

import { useState, useEffect } from "react";
import { useCartStore } from "@/lib/store";
import {
  Minus,
  Plus,
  Trash2,
  ArrowRight,
  CheckCircle2,
  Lock,
  ShoppingBag,
  X,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";

export default function CartPage() {
  const { items, updateQuantity, removeItem, getTotal, clearCart } =
    useCartStore();
  const [mounted, setMounted] = useState(false);
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

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

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
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyAndCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
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
    } catch (err: any) {
      setError(err.message || "Checkout failed");
    } finally {
      setLoading(false);
    }
  };

  if (step === "SUCCESS") {
    return (
      <div className="max-w-2xl mx-auto px-6 py-24 text-center">
        <div className="bg-surface border border-border p-12 rounded-2xl animate-in zoom-in slide-in-from-bottom-8 duration-500">
          <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto mb-6" />
          <h1 className="text-3xl font-semibold mb-4 text-zinc-900">
            Order confirmed
          </h1>
          <p className="text-zinc-500 text-lg mb-6">
            Your receipt has been sent to{" "}
            <span className="text-zinc-900 font-medium">{email}</span>. Thank
            you for your purchase.
          </p>
          {orderNumber && (
            <div className="mb-8 inline-block px-5 py-3 rounded-xl bg-zinc-100 border border-border">
              <p className="text-xs uppercase tracking-wide text-zinc-500 mb-1">
                Order reference
              </p>
              <p className="font-mono text-lg font-semibold text-zinc-900">
                {orderNumber}
              </p>
              <p className="text-xs text-zinc-500 mt-1">
                Quote this if you contact us about your order.
              </p>
            </div>
          )}
          <Link
            href="/"
            className="inline-flex bg-zinc-900 text-white px-8 py-3 rounded-xl font-medium hover:bg-zinc-700 transition-colors"
          >
            Continue shopping
          </Link>
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
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-zinc-100 transition-colors"
            >
              <X className="w-5 h-5 text-zinc-500" />
            </button>
            <h2 className="text-xl font-semibold mb-4 text-zinc-900">
              {modalContent === "TERMS" ? "Terms and Conditions" : "Data Privacy Policy"}
            </h2>
            <div className="space-y-4 text-sm text-zinc-600">
              {modalContent === "TERMS" ? (
                <>
                  <p>Placeholder for Terms and Conditions...</p>
                  <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>
                </>
              ) : (
                <>
                  <p>Placeholder for Data Privacy Policy...</p>
                  <p>We only collect your email address for tracking orders. Someone from our team will contact you to finalize and confirm the sale. Your data will not be shared with third parties.</p>
                </>
              )}
            </div>
            <div className="mt-8">
              <button
                onClick={() => setModalContent(null)}
                className="w-full bg-zinc-900 text-white py-3 rounded-xl font-medium hover:bg-zinc-700 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <h1 className="text-3xl font-semibold mb-10 text-zinc-900">Your cart</h1>

      {items.length === 0 ? (
        <div className="text-center py-24 bg-surface rounded-2xl border border-border">
          <p className="text-zinc-500 text-lg mb-6">Your cart is empty.</p>
          <Link
            href="/"
            className="inline-flex bg-zinc-900 text-white px-6 py-3 rounded-xl font-medium hover:bg-zinc-700 transition-colors"
          >
            Start shopping
          </Link>
        </div>
      ) : (
        <div className="grid lg:grid-cols-3 gap-10">
          {/* Cart Items */}
          <div className="lg:col-span-2 space-y-4">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex flex-col sm:flex-row items-center gap-6 bg-surface p-5 rounded-2xl border border-border relative"
              >
                <div className="w-20 h-20 bg-zinc-50 rounded-xl flex-shrink-0 border border-border relative overflow-hidden flex items-center justify-center">
                  {item.image ? (
                    <Image
                      src={item.image}
                      alt={item.name}
                      fill
                      sizes="80px"
                      className="object-cover"
                    />
                  ) : (
                    <ShoppingBag className="w-8 h-8 text-zinc-300" />
                  )}
                </div>
                <div className="flex-grow">
                  <h3 className="text-base font-medium text-zinc-900 mb-1">
                    {item.name}
                  </h3>
                  <p className="text-zinc-500 font-medium text-sm">
                    ₱{item.price.toFixed(2)}
                  </p>
                </div>

                <div className="flex items-center gap-4 bg-zinc-50 rounded-full px-4 py-2 border border-border">
                  <button
                    onClick={() => updateQuantity(item.id, item.quantity - 1)}
                    className="p-1 text-zinc-600 hover:text-zinc-900 transition-colors"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="w-4 text-center font-medium text-zinc-900">
                    {item.quantity}
                  </span>
                  <button
                    onClick={() => updateQuantity(item.id, item.quantity + 1)}
                    className="p-1 text-zinc-600 hover:text-zinc-900 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                <button
                  onClick={() => removeItem(item.id)}
                  className="p-3 text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-all"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            ))}
          </div>

          {/* Checkout Panel */}
          <div className="lg:col-span-1">
            <div className="bg-surface border border-border rounded-2xl p-8 sticky top-24">
              <h2 className="text-xl font-semibold mb-6 text-zinc-900">
                Order summary
              </h2>

              <div className="flex justify-between items-center mb-6">
                <span className="text-zinc-500">Total</span>
                <span className="text-zinc-900 font-semibold text-2xl">
                  ₱{getTotal().toFixed(2)}
                </span>
              </div>

              <div className="w-full h-px bg-border mb-8" />

              {step === "CART" && (
                <button
                  onClick={() => setStep("EMAIL")}
                  className="w-full flex items-center justify-center gap-2 bg-zinc-900 text-white py-3.5 rounded-xl font-medium hover:bg-zinc-700 transition-all transform active:scale-95"
                >
                  Secure checkout
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}

              {step === "EMAIL" && (
                <form
                  onSubmit={handleRequestOTP}
                  className="space-y-4 animate-in slide-in-from-right-4 duration-300"
                >
                  <div>
                    <label className="block text-sm font-medium text-zinc-600 mb-2">
                      Work email address
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-white border border-border rounded-xl px-4 py-3 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent transition-all"
                      placeholder="you@rgoc.com.ph"
                    />
                    {/* Stated up front so an employee using a personal
                        address finds out here rather than after submitting.
                        The server is still the authority — see
                        lib/orderPolicy.ts. */}
                    <p className="mt-2 text-xs text-zinc-500">
                      Ordering is limited to company email addresses.
                    </p>
                  </div>

                  <div className="space-y-3 pt-2">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        required
                        checked={acceptedTerms}
                        onChange={(e) => setAcceptedTerms(e.target.checked)}
                        className="mt-1 rounded border-border text-zinc-900 focus:ring-zinc-900"
                      />
                      <span className="text-sm text-zinc-600 leading-relaxed">
                        I agree to the{" "}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            setModalContent("TERMS");
                          }}
                          className="text-zinc-900 underline hover:text-zinc-700 font-medium"
                        >
                          Terms and Conditions
                        </button>.
                      </span>
                    </label>
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        required
                        checked={acceptedPrivacy}
                        onChange={(e) => setAcceptedPrivacy(e.target.checked)}
                        className="mt-1 rounded border-border text-zinc-900 focus:ring-zinc-900 flex-shrink-0"
                      />
                      <span className="text-sm text-zinc-600 leading-relaxed">
                        I accept the{" "}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            setModalContent("PRIVACY");
                          }}
                          className="text-zinc-900 underline hover:text-zinc-700 font-medium"
                        >
                          Data Privacy Policy
                        </button>. We only collect your email address for tracking orders. Someone from our team will contact you to finalize and confirm the sale.
                      </span>
                    </label>
                  </div>

                  {error && <p className="text-red-500 text-sm">{error}</p>}
                  <button
                    disabled={loading || !acceptedTerms || !acceptedPrivacy}
                    type="submit"
                    className="w-full flex items-center justify-center gap-2 bg-zinc-900 text-white py-3.5 rounded-xl font-medium disabled:opacity-50 hover:bg-zinc-700 transition-colors mt-2"
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
                    <label className="block text-sm font-medium text-zinc-600 mb-2">
                      6-digit code sent to {email}
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={6}
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                      className="w-full bg-white border border-border rounded-xl px-4 py-3 text-zinc-900 tracking-widest font-mono text-center text-xl focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent transition-all"
                      placeholder="000000"
                    />
                  </div>
                  {error && <p className="text-red-500 text-sm">{error}</p>}
                  <button
                    disabled={loading}
                    type="submit"
                    className="w-full flex items-center justify-center gap-2 bg-zinc-900 text-white py-3.5 rounded-xl font-medium disabled:opacity-50 hover:bg-zinc-700 transition-colors"
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
