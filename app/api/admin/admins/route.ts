import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/lib/adminGuard';
import { getAdminsCollection, toPublicAdmin, type AdminRole } from '@/lib/models/admin';
import { generateOpaqueToken } from '@/lib/adminAuth';
import { sendAdminInviteEmail } from '@/lib/email';

const INVITE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function GET() {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const admins = await getAdminsCollection();
  const all = await admins.find().sort({ createdAt: -1 }).toArray();
  return NextResponse.json(all.map(toPublicAdmin));
}

export async function POST(req: NextRequest) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const { username, email, role } = await req.json();

    if (!username || !email || typeof username !== 'string' || typeof email !== 'string') {
      return NextResponse.json({ error: 'Username and email are required.' }, { status: 400 });
    }

    const normalizedRole: AdminRole = role === 'owner' ? 'owner' : 'staff';
    const admins = await getAdminsCollection();

    const existing = await admins.findOne({ $or: [{ username }, { email: email.toLowerCase() }] });
    if (existing) {
      return NextResponse.json({ error: 'An admin with that username or email already exists.' }, { status: 409 });
    }

    const { token, tokenHash } = generateOpaqueToken();
    const now = new Date();

    const result = await admins.insertOne({
      username,
      email: email.toLowerCase(),
      role: normalizedRole,
      status: 'invited',
      twoFactorEnabled: false,
      failedLoginAttempts: 0,
      invitedBy: owner._id,
      inviteTokenHash: tokenHash,
      inviteTokenExpires: new Date(Date.now() + INVITE_TOKEN_TTL_MS),
      createdAt: now,
      updatedAt: now,
    });

    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const inviteUrl = `${appUrl}/admin/accept-invite?id=${result.insertedId.toString()}&token=${token}`;
    await sendAdminInviteEmail(email, inviteUrl, owner.email);

    return NextResponse.json({ success: true, id: result.insertedId.toString() });
  } catch (error) {
    console.error('Error inviting admin:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
