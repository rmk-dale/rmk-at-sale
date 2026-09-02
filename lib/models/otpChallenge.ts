import crypto from "crypto";
import { getDb } from "@/lib/mongodb";
import { generateHash, verifyHash } from "@/lib/crypto";
import type { CustomerBuyerProfile } from "@/lib/customerSession";

/**
 * Server-side store for checkout OTP challenges.
 *
 * The previous design kept the whole challenge in a signed cookie:
 * `{email, expires, hash}` where `hash = HMAC(email|expires|otp)`. The
 * signature meant the client could not forge a challenge — but it also
 * meant the server held no state, so there was nowhere to record how many
 * codes had already been guessed. A wrong guess left the cookie intact and
 * still valid, so the same challenge could be attacked for its full
 * ten-minute lifetime, and the client could always replay an earlier copy
 * of the cookie to undo any counter we tried to keep there.
 *
 * An attempt counter therefore has to live somewhere the client cannot
 * rewind. Here the cookie holds nothing but an opaque, unguessable
 * challenge id; everything that matters — the email, the code's hash, the
 * attempts used — lives in Mongo, where the count is incremented in the
 * same atomic operation that reads the challenge.
 *
 * The code itself is never stored, only its HMAC, so a database read alone
 * never reveals a usable code. Documents are removed automatically by a
 * TTL index once they expire.
 */

/**
 * The challenge carries the buyer profile as well as the code.
 *
 * It is captured here, at the moment the address is, rather than posted
 * with the order two requests later. That is what lets the profile be
 * validated once and then bound by the session signature — and for the
 * affiliation declaration it is the whole point: a declaration recorded
 * against the address it was made for is evidence, while a boolean posted
 * at checkout is something anyone can send.
 */
export interface OtpChallengeDoc extends CustomerBuyerProfile {
  _id: string; // opaque challenge id — this is what goes in the cookie
  email: string;
  otpHash: string;
  attempts: number;
  createdAt: Date;
  expiresAt: Date; // TTL index target
  consumedAt?: Date;
}

export const OTP_TTL_MS = 10 * 60 * 1000;
export const MAX_OTP_ATTEMPTS = 5;

/**
 * How many live challenges one email may have at a time. Without this, an
 * attacker could keep requesting fresh challenges to sidestep the
 * per-challenge attempt cap; the rate limiter is the first line against
 * that, and this is the second.
 */
const MAX_ACTIVE_CHALLENGES_PER_EMAIL = 3;

let indexesEnsured = false;

export async function getOtpChallengesCollection() {
  const db = await getDb();
  const collection = db.collection<OtpChallengeDoc>("otpChallenges");

  if (!indexesEnsured) {
    indexesEnsured = true;
    await Promise.all([
      // expireAfterSeconds: 0 means "delete once `expiresAt` is in the
      // past", so expired challenges clean themselves up.
      collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      collection.createIndex({ email: 1, createdAt: -1 }),
    ]).catch((err) =>
      console.error("Failed to ensure OTP challenge indexes:", err),
    );
  }

  return collection;
}

/**
 * Creates a challenge for `email` and returns the id to put in the cookie
 * plus the plaintext code to email. The code is not persisted.
 */
export async function createOtpChallenge(
  email: string,
  otp: string,
  profile: CustomerBuyerProfile,
): Promise<{ challengeId: string; expiresAt: Date }> {
  const challenges = await getOtpChallengesCollection();
  const now = new Date();

  // Requesting a new code invalidates any earlier outstanding ones for the
  // same address, so there is only ever one live target per mailbox.
  await challenges.deleteMany({ email, consumedAt: { $exists: false } });

  const activeCount = await challenges.countDocuments({
    email,
    expiresAt: { $gt: now },
  });
  if (activeCount >= MAX_ACTIVE_CHALLENGES_PER_EMAIL) {
    throw new Error("Too many active OTP challenges for this address.");
  }

  const challengeId = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(now.getTime() + OTP_TTL_MS);

  await challenges.insertOne({
    ...profile,
    _id: challengeId,
    email,
    otpHash: generateHash(`otp|${email}|${otp}`),
    attempts: 0,
    createdAt: now,
    expiresAt,
  });

  return { challengeId, expiresAt };
}

export type ConsumeResult =
  | { status: "ok"; email: string; profile: CustomerBuyerProfile }
  | { status: "invalid"; attemptsRemaining: number }
  | { status: "expired" }
  | { status: "locked" };

/**
 * Verifies `otp` against the challenge and, on success, marks it used.
 *
 * The attempt is counted by the same `findOneAndUpdate` that fetches the
 * document, so concurrent guesses cannot share one increment: the filter
 * requires `attempts < MAX`, meaning the (MAX+1)-th request finds nothing
 * to update and is refused no matter how many run at once.
 *
 * Marking the challenge consumed is likewise conditional on it not already
 * being consumed, which makes a correct code single-use even if two
 * requests carrying it arrive simultaneously.
 */
export async function consumeOtpChallenge(
  challengeId: unknown,
  otp: unknown,
): Promise<ConsumeResult> {
  // Both values come from client input. A non-string id would otherwise be
  // interpolated into the `_id` filter as a Mongo operator.
  if (typeof challengeId !== "string" || typeof otp !== "string") {
    return { status: "expired" };
  }
  if (!/^[a-f0-9]{64}$/.test(challengeId)) {
    return { status: "expired" };
  }

  const challenges = await getOtpChallengesCollection();
  const now = new Date();

  const challenge = await challenges.findOneAndUpdate(
    {
      _id: challengeId,
      consumedAt: { $exists: false },
      expiresAt: { $gt: now },
      attempts: { $lt: MAX_OTP_ATTEMPTS },
    },
    { $inc: { attempts: 1 } },
    { returnDocument: "after" },
  );

  if (!challenge) {
    // Distinguish "used up" from "gone" only so the shopper gets a useful
    // message; neither reveals anything about the code itself.
    const existing = await challenges.findOne({ _id: challengeId });
    if (existing && existing.attempts >= MAX_OTP_ATTEMPTS) {
      return { status: "locked" };
    }
    return { status: "expired" };
  }

  if (!verifyHash(`otp|${challenge.email}|${otp}`, challenge.otpHash)) {
    const attemptsRemaining = Math.max(
      0,
      MAX_OTP_ATTEMPTS - challenge.attempts,
    );
    if (attemptsRemaining === 0) {
      // Burn it immediately rather than leaving a spent challenge around.
      await challenges.deleteOne({ _id: challengeId });
      return { status: "locked" };
    }
    return { status: "invalid", attemptsRemaining };
  }

  const consumed = await challenges.findOneAndUpdate(
    { _id: challengeId, consumedAt: { $exists: false } },
    { $set: { consumedAt: now } },
  );

  if (!consumed) {
    // Another request got there first with the same code.
    return { status: "expired" };
  }

  return {
    status: "ok",
    email: challenge.email,
    // Read back off the challenge rather than trusted from the verify
    // request, which carries nothing but a six-digit code. Whatever the
    // buyer typed on the email step is what reaches the order.
    profile: {
      buyerType: challenge.buyerType,
      buyerName: challenge.buyerName,
      buyerCompany: challenge.buyerCompany,
      buyerPhone: challenge.buyerPhone,
      affiliationDeclaredAt: challenge.affiliationDeclaredAt,
      affiliationVersion: challenge.affiliationVersion,
    },
  };
}

/** Drops a challenge outright, e.g. once a session has been issued. */
export async function deleteOtpChallenge(challengeId: string): Promise<void> {
  const challenges = await getOtpChallengesCollection();
  await challenges
    .deleteOne({ _id: challengeId })
    .catch((err) => console.error("Failed to delete OTP challenge:", err));
}
