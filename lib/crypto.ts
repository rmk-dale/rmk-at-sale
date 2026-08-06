import crypto from 'crypto';

/**
 * Generates an HMAC-SHA256 hash for a given string using the server's secret.
 * @param payload - The string data to hash.
 * @returns The hex representation of the hash.
 */
export function generateHash(payload: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not defined in environment variables.');
  }

  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}

/**
 * Validates if the provided hash matches the payload.
 * @param payload - The original data.
 * @param hash - The hash to verify against.
 * @returns boolean indicating if the hash is valid.
 */
export function verifyHash(payload: string, hash: string): boolean {
  const expectedHash = generateHash(payload);
  
  // Use timingSafeEqual to prevent timing attacks.
  // Both strings must be the same length, so we ensure they are buffers of equal size.
  const expectedBuffer = Buffer.from(expectedHash, 'hex');
  const actualBuffer = Buffer.from(hash, 'hex');

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

/**
 * Generates a 6-digit numeric OTP.
 */
export function generateOTP(): string {
  // Generate a random number between 100000 and 999999
  return crypto.randomInt(100000, 1000000).toString();
}
