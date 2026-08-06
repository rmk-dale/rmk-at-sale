import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ObjectId } from 'mongodb';
import { getAdminsCollection } from '@/lib/models/admin';
import {
  ADMIN_CHALLENGE_COOKIE,
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_MS,
  matchBackupCode,
  signAdminSession,
  verifyChallenge,
  verifyTotpCode,
} from '@/lib/adminAuth';

export async function POST(req: NextRequest) {
  try {
    const { code, backupCode } = await req.json();

    if (!code && !backupCode) {
      return NextResponse.json({ error: 'A 2FA code or backup code is required.' }, { status: 400 });
    }

    const cookieStore = await cookies();
    const challenge = verifyChallenge(cookieStore.get(ADMIN_CHALLENGE_COOKIE)?.value);

    if (!challenge) {
      return NextResponse.json({ error: 'Your login attempt expired. Please sign in again.' }, { status: 401 });
    }

    const admins = await getAdminsCollection();
    const admin = await admins.findOne({ _id: new ObjectId(challenge.adminId) });

    if (!admin || admin.status !== 'active' || !admin.twoFactorEnabled || !admin.twoFactorSecret) {
      return NextResponse.json({ error: 'Two-factor authentication is not set up for this account.' }, { status: 403 });
    }

    let verified = false;

    if (typeof code === 'string') {
      verified = verifyTotpCode(admin.twoFactorSecret, admin.email, code);
    } else if (typeof backupCode === 'string' && admin.backupCodeHashes?.length) {
      const matchedIndex = await matchBackupCode(backupCode.trim().toUpperCase(), admin.backupCodeHashes);
      if (matchedIndex !== -1) {
        verified = true;
        const remaining = admin.backupCodeHashes.filter((_, i) => i !== matchedIndex);
        await admins.updateOne({ _id: admin._id }, { $set: { backupCodeHashes: remaining, updatedAt: new Date() } });
      }
    }

    if (!verified) {
      return NextResponse.json({ error: 'Invalid code.' }, { status: 401 });
    }

    cookieStore.delete(ADMIN_CHALLENGE_COOKIE);
    cookieStore.set(ADMIN_SESSION_COOKIE, signAdminSession(admin._id.toString(), admin.role), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: ADMIN_SESSION_TTL_MS / 1000,
      path: '/',
    });

    return NextResponse.json({ success: true, role: admin.role });
  } catch (error) {
    console.error('Error verifying admin 2FA:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
