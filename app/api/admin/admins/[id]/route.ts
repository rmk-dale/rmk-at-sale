import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireOwner } from '@/lib/adminGuard';
import { getAdminsCollection, toPublicAdmin, type AdminRole, type AdminStatus } from '@/lib/models/admin';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const { id } = await params;
    const { role, status } = (await req.json()) as { role?: AdminRole; status?: AdminStatus };

    if (!role && !status) {
      return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
    }

    const admins = await getAdminsCollection();
    const target = await admins.findOne({ _id: new ObjectId(id) });
    if (!target) return NextResponse.json({ error: 'Admin not found.' }, { status: 404 });

    // Guardrail: never leave the store with zero active owners.
    const demotingOrDisablingOwner =
      target.role === 'owner' && ((role && role !== 'owner') || status === 'disabled');

    if (demotingOrDisablingOwner) {
      const otherActiveOwners = await admins.countDocuments({
        _id: { $ne: target._id },
        role: 'owner',
        status: 'active',
      });
      if (otherActiveOwners === 0) {
        return NextResponse.json(
          { error: 'Cannot remove the last remaining owner. Promote another admin first.' },
          { status: 400 }
        );
      }
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (role) update.role = role;
    if (status) update.status = status;

    await admins.updateOne({ _id: target._id }, { $set: update });
    const updated = await admins.findOne({ _id: target._id });

    return NextResponse.json({ success: true, admin: updated ? toPublicAdmin(updated) : null });
  } catch (error) {
    console.error('Error updating admin:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
