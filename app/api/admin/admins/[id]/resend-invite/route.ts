import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { requireOwner } from "@/lib/adminGuard";
import { getAdminsCollection } from "@/lib/models/admin";
import { generateOpaqueToken } from "@/lib/adminAuth";
import { sendAdminInviteEmail } from "@/lib/email";
import { recordAudit } from "@/lib/models/auditLog";

const INVITE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id } = await params;

    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid admin ID." }, { status: 400 });
    }

    const admins = await getAdminsCollection();
    const target = await admins.findOne({ _id: new ObjectId(id) });
    
    if (!target) {
      return NextResponse.json({ error: "Admin not found." }, { status: 404 });
    }

    if (target.status !== "invited") {
      return NextResponse.json(
        { error: "Cannot resend invite to an active or disabled admin." },
        { status: 400 },
      );
    }

    const { token, tokenHash } = generateOpaqueToken();
    const expires = new Date(Date.now() + INVITE_TOKEN_TTL_MS);

    await admins.updateOne(
      { _id: target._id },
      {
        $set: {
          inviteTokenHash: tokenHash,
          inviteTokenExpires: expires,
          updatedAt: new Date(),
        },
      }
    );

    const appUrl = process.env.APP_URL || "https://rmk-at-sale.vercel.app";
    const inviteUrl = `${appUrl}/admin/accept-invite?id=${target._id.toString()}&token=${token}`;
    await sendAdminInviteEmail(target.email, inviteUrl, owner.email);

    await recordAudit({
      admin: owner,
      action: "admin.invite",
      targetType: "admin",
      targetId: target._id.toString(),
      targetLabel: target.username,
      changes: [
        { field: "inviteToken", old: "[REDACTED]", new: "[REDACTED]" },
      ],
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Resend invite error:", err);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
