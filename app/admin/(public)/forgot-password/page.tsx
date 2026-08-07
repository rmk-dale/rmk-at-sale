"use client";

import { useState } from "react";
import Link from "next/link";

export default function AdminForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/admin/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      setMessage(
        data.message ||
          "If that email is registered, a reset link has been sent.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm bg-surface border border-border rounded-2xl p-8">
        <h1 className="text-xl font-semibold text-zinc-900 mb-1">
          Reset admin password
        </h1>
        <p className="text-sm text-zinc-500 mb-6">
          We&apos;ll email you a link if the account exists.
        </p>

        {message ? (
          <p className="text-sm text-zinc-700">{message}</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full bg-white border border-border rounded-xl px-4 py-3 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900"
            />
            <button
              disabled={loading}
              type="submit"
              className="w-full bg-zinc-900 text-white py-3 rounded-xl font-medium disabled:opacity-50 disabled:pointer-events-none hover:bg-zinc-700 transition-colors"
            >
              {loading ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}

        <Link
          href="/admin/login"
          className="block text-center text-sm text-zinc-500 hover:text-zinc-900 mt-6"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
