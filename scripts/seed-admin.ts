/**
 * Bootstraps the first owner admin account. There's a chicken-and-egg
 * problem otherwise: inviting an admin requires an existing owner, and the
 * very first owner has no one to invite them. This creates that first
 * account directly and prints an invite link to the terminal (rather than
 * emailing it, since SMTP may not be configured yet at this point) — open
 * it in a browser to choose a password and enroll 2FA, same as any other
 * invite.
 *
 * Refuses to run if an owner already exists, so it can't be used to create
 * a second one by accident — use the in-app "Invite an admin" screen for that.
 *
 * Usage: npm run seed:admin -- <username> <email>
 */

import { MongoClient } from "mongodb";
import dns from "dns";
try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch (e) {}
import crypto from "crypto";
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

function generateHash(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

async function main() {
  loadEnvLocal();

  const [, , username, email] = process.argv;
  if (!username || !email) {
    throw new Error("Usage: npm run seed:admin -- <username> <email>");
  }

  const uri = process.env.MONGODB_URI;
  const jwtSecret = process.env.JWT_SECRET;
  if (!uri) throw new Error("MONGODB_URI is not set in .env.local");
  if (!jwtSecret) throw new Error("JWT_SECRET is not set in .env.local");

  const client = new MongoClient(uri);
  await client.connect();

  try {
    const admins = client.db().collection("admins");

    const existingOwner = await admins.findOne({
      role: "owner",
      status: { $ne: "disabled" },
    });
    if (existingOwner) {
      throw new Error(
        `An owner already exists (${existingOwner.email}). Use the in-app "Invite an admin" screen instead.`,
      );
    }

    const existing = await admins.findOne({
      $or: [{ username }, { email: email.toLowerCase() }],
    });
    if (existing) {
      throw new Error("An admin with that username or email already exists.");
    }

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = generateHash(`token|${token}`, jwtSecret);
    const now = new Date();

    const result = await admins.insertOne({
      username,
      email: email.toLowerCase(),
      role: "owner",
      status: "invited",
      twoFactorEnabled: false,
      failedLoginAttempts: 0,
      inviteTokenHash: tokenHash,
      inviteTokenExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    });

    const appUrl = process.env.APP_URL || "http://localhost:3000";
    const inviteUrl = `${appUrl}/admin/accept-invite?id=${result.insertedId.toString()}&token=${token}`;

    console.log("\nFirst owner account created.");
    console.log(
      `Open this link to set a password and enroll 2FA (expires in 24 hours):\n`,
    );
    console.log(inviteUrl);
    console.log("");
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("Failed to seed admin:", err.message ?? err);
  process.exit(1);
});
