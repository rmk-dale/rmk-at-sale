import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getAdminsCollection } from '@/lib/models/admin';
import { hashPassword, verifyOpaqueToken } from '@/lib/adminAuth';

const MIN_PASSWORD_LENGTH = 10;

export async function POST(req: NextRequest) {
  try {
    const { id, token, password } = await req.json();

    if (!id || !token || !password) {
      return NextResponse.json({ error: 'Missing reset details.' }, { status: 400 });
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
      admin.status !== 'active' ||
      !admin.inviteTokenExpires ||
      admin.inviteTokenExpires.getTime() < Date.now() ||
      !verifyOpaqueToken(token, admin.inviteTokenHash)
    ) {
      return NextResponse.json({ error: 'This reset link is invalid or has expired.' }, { status: 400 });
    }

    const passwordHash = await hashPassword(password);

    await admins.updateOne(
      { _id: admin._id },
      {
        $set: { passwordHash, failedLoginAttempts: 0, updatedAt: new Date() },
        $unset: { inviteTokenHash: '', inviteTokenExpires: '', lockedUntil: '' },
      }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error resetting admin password:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
