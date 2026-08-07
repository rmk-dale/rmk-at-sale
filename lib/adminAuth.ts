import crypto from "crypto";
import bcrypt from "bcryptjs";
import * as QRCode from "qrcode";
import { Secret, TOTP } from "otpauth";
import { generateHash, verifyHash } from "@/lib/crypto";
import type { AdminRole } from "@/lib/models/admin";

// ---------------------------------------------------------------------------
// Session + 2FA-challenge cookies
//
// Admin auth is deliberately separate from the customer `session` cookie
// (see app/api/auth/*). Same HMAC-signing primitive (lib/crypto.ts), a
// different cookie name and a shorter lifetime, since this cookie guards
// inventory, pricing, and order data rather than a single checkout.
// ---------------------------------------------------------------------------

export const ADMIN_SESSION_COOKIE = "admin_session";
export const ADMIN_CHALLENGE_COOKIE = "admin_2fa_challenge";

export const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
export const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes to complete 2FA after a correct password

export interface AdminSessionPayload {
  adminId: string;
  role: AdminRole;
  expires: number;
  /** Value of the account's `sessionEpoch` when this cookie was issued. */
  epoch: number;
}

/**
 * The epoch is what makes these sessions revocable.
 *
 * The cookie is signed rather than stored, so before this there was no
 * way to invalidate one early: resetting a compromised admin's password
 * did not evict whoever was already signed in as them — they kept working
 * for up to eight hours. Binding the cookie to a counter on the account,
 * and checking it on every request, means bumping that counter logs out
 * every existing session for that admin immediately.
 *
 * It is inside the HMAC payload, so it cannot be edited client-side.
 */
export function signAdminSession(
  adminId: string,
  role: AdminRole,
  epoch: number,
): string {
  const expires = Date.now() + ADMIN_SESSION_TTL_MS;
  const hash = generateHash(`admin|${adminId}|${role}|${expires}|${epoch}`);
  return JSON.stringify({ adminId, role, expires, epoch, hash });
}

export function verifyAdminSession(
  cookieValue: string | undefined,
): AdminSessionPayload | null {
  if (!cookieValue) return null;
  try {
    const { adminId, role, expires, epoch, hash } = JSON.parse(cookieValue);
    if (
      typeof adminId !== "string" ||
      typeof role !== "string" ||
      typeof expires !== "number" ||
      typeof epoch !== "number"
    )
      return null;
    if (Date.now() > expires) return null;
    if (!verifyHash(`admin|${adminId}|${role}|${expires}|${epoch}`, hash))
      return null;
    return { adminId, role: role as AdminRole, expires, epoch };
  } catch {
    return null;
  }
}

/** Issued right after a correct password, before 2FA is confirmed. Not a real session. */
export function signChallenge(adminId: string): string {
  const expires = Date.now() + CHALLENGE_TTL_MS;
  const hash = generateHash(`admin-2fa|${adminId}|${expires}`);
  return JSON.stringify({ adminId, expires, hash });
}

export function verifyChallenge(
  cookieValue: string | undefined,
): { adminId: string } | null {
  if (!cookieValue) return null;
  try {
    const { adminId, expires, hash } = JSON.parse(cookieValue);
    if (typeof adminId !== "string" || typeof expires !== "number") return null;
    if (Date.now() > expires) return null;
    if (!verifyHash(`admin-2fa|${adminId}|${expires}`, hash)) return null;
    return { adminId };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

const PASSWORD_SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, PASSWORD_SALT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ---------------------------------------------------------------------------
// Login lockout
// ---------------------------------------------------------------------------

export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export function isLockedOut(lockedUntil: Date | undefined): boolean {
  return !!lockedUntil && lockedUntil.getTime() > Date.now();
}

// ---------------------------------------------------------------------------
// TOTP two-factor
// ---------------------------------------------------------------------------

const TOTP_ISSUER = "rmk-at-sale";

export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

function buildTotp(secretBase32: string, label: string): TOTP {
  return new TOTP({
    issuer: TOTP_ISSUER,
    label,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  });
}

export function getOtpAuthUrl(secretBase32: string, label: string): string {
  return buildTotp(secretBase32, label).toString();
}

export async function getQrCodeDataUrl(otpAuthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpAuthUrl);
}

/**
 * Verifies a TOTP code, allowing one 30s step of clock drift either way.
 *
 * Returns the absolute time step the code belongs to, or null if it does
 * not verify. The caller needs the step — not just a yes/no — to stop
 * replay: a TOTP code stays valid for its whole window, so a code observed
 * over the shoulder or lifted from a phished form can be submitted a
 * second time within the same ~90 seconds. Recording the highest step an
 * account has already used, and refusing anything at or below it, makes
 * each code usable exactly once.
 */
export function verifyTotpCode(
  secretBase32: string,
  label: string,
  token: string,
): { step: number } | null {
  if (typeof token !== "string" || !/^\d{6}$/.test(token)) return null;

  const totp = buildTotp(secretBase32, label);
  const delta = totp.validate({ token, window: 1 });
  if (delta === null) return null;

  const currentStep = Math.floor(Date.now() / 1000 / 30);
  return { step: currentStep + delta };
}

// ---------------------------------------------------------------------------
// Backup codes — self-service 2FA recovery if the authenticator device is lost
// ---------------------------------------------------------------------------

export function generateBackupCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = crypto.randomBytes(5).toString("hex").toUpperCase(); // 10 hex chars
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

export async function hashBackupCodes(codes: string[]): Promise<string[]> {
  return Promise.all(
    codes.map((code) => bcrypt.hash(code, PASSWORD_SALT_ROUNDS)),
  );
}

/** Returns the index of the matching hash (to remove it, since each code is single-use), or -1. */
export async function matchBackupCode(
  code: string,
  hashes: string[],
): Promise<number> {
  for (let i = 0; i < hashes.length; i++) {
    if (await bcrypt.compare(code, hashes[i])) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Invite / password-reset tokens
//
// Same idea as the customer OTP challenge: a high-entropy random value goes
// out in the email, only its HMAC hash is stored, so a database read alone
// never reveals a usable token.
// ---------------------------------------------------------------------------

export function generateOpaqueToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = generateHash(`token|${token}`);
  return { token, tokenHash };
}

export function verifyOpaqueToken(
  token: string,
  storedHash: string | undefined,
): boolean {
  if (!storedHash) return false;
  return verifyHash(`token|${token}`, storedHash);
}
