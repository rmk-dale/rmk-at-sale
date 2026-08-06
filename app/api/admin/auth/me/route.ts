import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminGuard';
import { toPublicAdmin } from '@/lib/models/admin';

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  return NextResponse.json({ authenticated: true, admin: toPublicAdmin(admin) });
}
