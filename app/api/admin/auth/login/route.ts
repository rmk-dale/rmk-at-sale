import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getAdminsCollection } from '@/lib/models/admin';
import {
  ADMIN_CHALLENGE_COOKIE,
  CHALLENGE_TTL_MS,
  LOCKOUT_DURATION_MS,
  MAX_FAILED_LOGIN_ATTEMPTS,
  isLockedOut,
  signChallenge,
  verifyPassword,
} from '@/lib/adminAuth';

export async function POST(req: NextRequest) {
  try {
    const { identifier, password } = await req.json();

    if (!identifier || !password || typeof identifier !== 'string' || typeof password !== 'string') {
      return NextResponse.json({ error: 'Username/email and password are required.' }, { status: 400 });
    }

    const admins = await getAdminsCollection();
    const admin = await admins.findOne({
      $or: [{ username: identifier }, { email: identifier.toLowerCase() }],
    });

    // Generic error for "not found" and "wrong password" alike — never reveal which.
    const invalidCredentials = () =>
      NextResponse.json({ error: 'Invalid username/email or password.' }, { status: 401 });

    if (!admin) return invalidCredentials();

    if (isLockedOut(admin.lockedUntil)) {
      return NextResponse.json(
        { error: 'This account is temporarily locked due to repeated failed attempts. Try again later.' },
        { status: 423 }
      );
    }

    if (admin.status === 'disabled') {
      return NextResponse.json({ error: 'This admin account has been disabled.' }, { status: 403 });
    }

    if (!admin.passwordHash) {
      return NextResponse.json(
        { error: 'This account has not finished setup. Check your invite email.' },
        { status: 403 }
      );
    }

    const validPassword = await verifyPassword(password, admin.passwordHash);

    if (!validPassword) {
      const failedLoginAttempts = (admin.failedLoginAttempts ?? 0) + 1;
      const update: Record<string, unknown> = { failedLoginAttempts, updatedAt: new Date() };
      if (failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
        update.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
      }
      await admins.updateOne({ _id: admin._id }, { $set: update });
      return invalidCredentials();
    }

    // Correct password. Reset the failure counter, but do NOT log in yet —
    // 2FA is mandatory for every admin account.
    await admins.updateOne(
      { _id: admin._id },
      { $set: { failedLoginAttempts: 0, updatedAt: new Date() }, $unset: { lockedUntil: '' } }
    );

    if (!admin.twoFactorEnabled || !admin.twoFactorSecret) {
      return NextResponse.json(
        { error: 'This account has not finished two-factor setup. Check your invite email.' },
        { status: 403 }
      );
    }

    const cookieStore = await cookies();
    cookieStore.set(ADMIN_CHALLENGE_COOKIE, signChallenge(admin._id.toString()), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: CHALLENGE_TTL_MS / 1000,
      path: '/',
    });

    return NextResponse.json({ success: true, requiresTwoFactor: true });
  } catch (error) {
    console.error('Error during admin login:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
