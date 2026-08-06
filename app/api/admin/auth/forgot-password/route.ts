import { NextRequest, NextResponse } from 'next/server';
import { getAdminsCollection } from '@/lib/models/admin';
import { generateOpaqueToken } from '@/lib/adminAuth';
import { sendAdminPasswordResetEmail } from '@/lib/email';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    const genericResponse = NextResponse.json({
      success: true,
      message: 'If that email is registered, a reset link has been sent.',
    });

    if (!email || typeof email !== 'string') return genericResponse;

    const admins = await getAdminsCollection();
    const admin = await admins.findOne({ email: email.toLowerCase(), status: 'active' });

    // Deliberately return the same response whether or not the account
    // exists — a different message here would let someone enumerate admins.
    if (!admin) return genericResponse;

    const { token, tokenHash } = generateOpaqueToken();
    await admins.updateOne(
      { _id: admin._id },
      {
        $set: {
          inviteTokenHash: tokenHash,
          inviteTokenExpires: new Date(Date.now() + RESET_TOKEN_TTL_MS),
          updatedAt: new Date(),
        },
      }
    );

    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const resetUrl = `${appUrl}/admin/reset-password?id=${admin._id.toString()}&token=${token}`;
    await sendAdminPasswordResetEmail(admin.email, resetUrl);

    return genericResponse;
  } catch (error) {
    console.error('Error requesting admin password reset:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
