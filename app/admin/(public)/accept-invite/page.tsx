"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";

function AcceptInviteForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get("id") || "";
  const token = searchParams.get("token") || "";

  const [step, setStep] = useState<"PASSWORD" | "ENROLL_2FA" | "BACKUP_CODES">(
    "PASSWORD",
  );
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState("");
  const [otpAuthUrl, setOtpAuthUrl] = useState("");
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (!id || !token) {
    return (
      <p className="text-zinc-500 text-sm">
        This invite link is missing its id or token.
      </p>
    );
  }

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/admin/auth/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, token, password }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error || "Could not set up your account");
      setQrCodeDataUrl(data.qrCodeDataUrl);
      setOtpAuthUrl(data.otpAuthUrl);
      setStep("ENROLL_2FA");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/auth/confirm-2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invalid code");
      setBackupCodes(data.backupCodes);
      setStep("BACKUP_CODES");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md bg-surface border border-border rounded-2xl p-8">
        <h1 className="text-xl font-semibold text-zinc-900 mb-1">
          Set up your admin account
        </h1>

        {step === "PASSWORD" && (
          <form onSubmit={handleSetPassword} className="space-y-4 mt-6">
            <p className="text-sm text-zinc-500 mb-2">
              Choose a password (at least 10 characters).
            </p>
            <div>
              <label className="block text-sm font-medium text-zinc-600 mb-2">
                Password
              </label>
              <input
                required
                type="password"
                minLength={10}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white border border-border rounded-xl px-4 py-3 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-600 mb-2">
                Confirm password
              </label>
              <input
                required
                type="password"
                minLength={10}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full bg-white border border-border rounded-xl px-4 py-3 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900"
              />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button
              disabled={loading}
              type="submit"
              className="w-full bg-zinc-900 text-white py-3 rounded-xl font-medium disabled:opacity-50 hover:bg-zinc-700 transition-colors"
            >
              {loading ? "Saving…" : "Continue to 2FA setup"}
            </button>
          </form>
        )}

        {step === "ENROLL_2FA" && (
          <form onSubmit={handleConfirmCode} className="space-y-4 mt-6">
            <p className="text-sm text-zinc-500">
              Scan this QR code with an authenticator app (Google Authenticator,
              Authy, 1Password, etc.), then enter the 6-digit code it shows.
            </p>
            {qrCodeDataUrl && (
              <div className="flex justify-center py-2">
                <Image
                  src={qrCodeDataUrl}
                  alt="Two-factor QR code"
                  width={180}
                  height={180}
                  unoptimized
                />
              </div>
            )}
            <details className="text-xs text-zinc-400">
              <summary className="cursor-pointer">
                Can&apos;t scan? Enter this URL manually
              </summary>
              <p className="break-all mt-1">{otpAuthUrl}</p>
            </details>
            <div>
              <label className="block text-sm font-medium text-zinc-600 mb-2">
                6-digit code
              </label>
              <input
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={6}
                placeholder="000000"
                className="w-full bg-white border border-border rounded-xl px-4 py-3 text-zinc-900 tracking-widest font-mono text-center text-lg focus:outline-none focus:ring-2 focus:ring-zinc-900"
              />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button
              disabled={loading}
              type="submit"
              className="w-full bg-zinc-900 text-white py-3 rounded-xl font-medium disabled:opacity-50 hover:bg-zinc-700 transition-colors"
            >
              {loading ? "Confirming…" : "Confirm & activate account"}
            </button>
          </form>
        )}

        {step === "BACKUP_CODES" && (
          <div className="space-y-4 mt-6">
            <p className="text-sm text-zinc-500">
              Save these one-time backup codes somewhere safe. Each one can be
              used once to sign in if you lose access to your authenticator app
              — they won&apos;t be shown again.
            </p>
            <div className="grid grid-cols-2 gap-2 bg-zinc-50 border border-border rounded-xl p-4 font-mono text-sm text-zinc-900">
              {backupCodes.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
            <button
              onClick={() => router.push("/admin")}
              className="w-full bg-zinc-900 text-white py-3 rounded-xl font-medium hover:bg-zinc-700 transition-colors"
            >
              I&apos;ve saved these — go to admin
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInviteForm />
    </Suspense>
  );
}
