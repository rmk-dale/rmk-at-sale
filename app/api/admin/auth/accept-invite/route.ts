import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ObjectId } from 'mongodb';
import { getAdminsCollection } from '@/lib/models/admin';
import {
  ADMIN_CHALLENGE_COOKIE,
  CHALLENGE_TTL_MS,
  generateTotpSecret,
  getOtpAuthUrl,
  getQrCodeDataUrl,
  hashPassword,
  signChallenge,
  verifyOpaqueToken,
} from '@/lib/adminAuth';

const MIN_PASSWORD_LENGTH = 10;

export async function POST(req: NextRequest) {
  try {
    const { id, token, password } = await req.json();

    if (!id || !token || !password) {
      return NextResponse.json({ error: 'Missing invite details.' }, { status: 400 });
    }

    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
        { status: 400 }
      );
    }

    const admins = await getAdminsCollection();
    const admin = await admins.findOne({ _id: new ObjectId(id) });

    if (
      !admin ||
      admin.status !== 'invited' ||
      !admin.inviteTokenExpires ||
      admin.inviteTokenExpires.getTime() < Date.now() ||
      !verifyOpaqueToken(token, admin.inviteTokenHash)
    ) {
      return NextResponse.json({ error: 'This invite link is invalid or has expired.' }, { status: 400 });
    }

    const passwordHash = await hashPassword(password);
    const twoFactorSecret = generateTotpSecret();

    await admins.updateOne(
      { _id: admin._id },
      {
        $set: { passwordHash, twoFactorSecret, updatedAt: new Date() },
        $unset: { inviteTokenHash: '', inviteTokenExpires: '' },
      }
    );

    // Password is set, but the account stays 'invited' — and therefore unable
    // to log in — until 2FA enrollment is confirmed via /confirm-2fa.
    const otpAuthUrl = getOtpAuthUrl(twoFactorSecret, admin.email);
    const qrCodeDataUrl = await getQrCodeDataUrl(otpAuthUrl);

    const cookieStore = await cookies();
    cookieStore.set(ADMIN_CHALLENGE_COOKIE, signChallenge(admin._id.toString()), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: CHALLENGE_TTL_MS / 1000,
      path: '/',
    });

    return NextResponse.json({ success: true, otpAuthUrl, qrCodeDataUrl });
  } catch (error) {
    console.error('Error accepting admin invite:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
