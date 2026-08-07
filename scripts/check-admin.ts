/**
 * Read-only diagnostic: prints admin accounts (or one, by username/email)
 * without ever printing the password hash, 2FA secret, or backup codes.
 * Useful when a login is failing and you want to confirm what's actually
 * stored — e.g. whether the username/email matches what you're typing,
 * whether a password was ever set, whether 2FA finished enrollment, or
 * whether the account got locked out after failed attempts.
 *
 * Usage:
 *   npm run check:admin                 (lists every admin)
 *   npm run check:admin -- <identifier> (username or email, one admin)
 */

import { MongoClient } from "mongodb";
import dns from "dns";
try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch (e) {}
import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");

function loadEnvLocal() {
  const envPath = path.join(ROOT, ".env.local");
  if (!existsSync(envPath)) return;
  const contents = readFileSync(envPath, "utf8");
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function main() {
  loadEnvLocal();

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set in .env.local");

  const [, , identifier] = process.argv;

  const client = new MongoClient(uri);
  await client.connect();

  try {
    const admins = client.db().collection("admins");
    const filter = identifier
      ? { $or: [{ username: identifier }, { email: identifier.toLowerCase() }] }
      : {};
    const results = await admins.find(filter).toArray();

    if (results.length === 0) {
      console.log(
        identifier
          ? `No admin found matching "${identifier}".`
          : "No admin accounts exist yet.",
      );
      return;
    }

    for (const admin of results) {
      console.log("---");
      console.log("username:            ", admin.username);
      console.log("email:               ", admin.email);
      console.log("role:                ", admin.role);
      console.log("status:              ", admin.status);
      console.log("passwordHash set:    ", Boolean(admin.passwordHash));
      console.log("twoFactorEnabled:    ", Boolean(admin.twoFactorEnabled));
      console.log("twoFactorSecret set: ", Boolean(admin.twoFactorSecret));
      console.log("backupCodes left:    ", admin.backupCodeHashes?.length ?? 0);
      console.log("failedLoginAttempts: ", admin.failedLoginAttempts ?? 0);
      console.log("lockedUntil:         ", admin.lockedUntil ?? "—");
      console.log("inviteToken pending: ", Boolean(admin.inviteTokenHash));
      console.log("inviteTokenExpires:  ", admin.inviteTokenExpires ?? "—");
      console.log("createdAt:           ", admin.createdAt);
    }
    console.log("---");
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("check-admin failed:", err.message ?? err);
  process.exit(1);
});
