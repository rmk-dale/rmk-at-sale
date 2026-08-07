"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Lock } from "lucide-react";

export default function AdminLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<"CREDENTIALS" | "TWO_FACTOR">("CREDENTIALS");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");
      setStep("TWO_FACTOR");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleTwoFactor = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const body = useBackupCode ? { backupCode: code } : { code };
      const res = await fetch("/api/admin/auth/verify-2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invalid code");
      router.push("/admin");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm bg-surface border border-border rounded-2xl p-8">
        <h1 className="text-xl font-semibold text-zinc-900 mb-1">
          Admin sign in
        </h1>
        <p className="text-sm text-zinc-500 mb-6">
          rmk-at-sale inventory &amp; orders
        </p>

        {step === "CREDENTIALS" && (
          <form onSubmit={handleCredentials} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-600 mb-2">
                Username or email
              </label>
              <input
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="w-full bg-white border border-border rounded-xl px-4 py-3 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-600 mb-2">
                Password
              </label>
              <input
                required
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white border border-border rounded-xl px-4 py-3 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900"
              />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button
              disabled={loading}
              type="submit"
              className="w-full flex items-center justify-center gap-2 bg-zinc-900 text-white py-3 rounded-xl font-medium disabled:opacity-50 hover:bg-zinc-700 transition-colors"
            >
              {loading ? "Checking…" : "Continue"}
            </button>
            <Link
              href="/admin/forgot-password"
              className="block text-center text-sm text-zinc-500 hover:text-zinc-900"
            >
              Forgot password?
            </Link>
          </form>
        )}

        {step === "TWO_FACTOR" && (
          <form onSubmit={handleTwoFactor} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-600 mb-2">
                {useBackupCode ? "Backup code" : "6-digit authenticator code"}
              </label>
              <input
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={useBackupCode ? 11 : 6}
                placeholder={useBackupCode ? "XXXXX-XXXXX" : "000000"}
                className="w-full bg-white border border-border rounded-xl px-4 py-3 text-zinc-900 tracking-widest font-mono text-center text-lg focus:outline-none focus:ring-2 focus:ring-zinc-900"
              />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button
              disabled={loading}
              type="submit"
              className="w-full flex items-center justify-center gap-2 bg-zinc-900 text-white py-3 rounded-xl font-medium disabled:opacity-50 hover:bg-zinc-700 transition-colors"
            >
              {loading ? "Verifying…" : "Verify & sign in"}
              {!loading && <Lock className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => {
                setUseBackupCode((v) => !v);
                setCode("");
                setError("");
              }}
              className="block w-full text-center text-sm text-zinc-500 hover:text-zinc-900"
            >
              {useBackupCode
                ? "Use authenticator code instead"
                : "Lost your device? Use a backup code"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
