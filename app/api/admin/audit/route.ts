import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/adminGuard";
import {
  getAuditLogCollection,
  type AuditLogDoc,
  type AuditTargetType,
} from "@/lib/models/auditLog";
import type { Filter } from "mongodb";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

const TARGET_TYPES: AuditTargetType[] = ["product", "brand", "admin", "order"];

/**
 * Owner-only, deliberately.
 *
 * The log exists to hold staff accountable for changes to prices, stock
 * and orders. Letting the people it covers read it — and so see exactly
 * what is recorded about them — weakens that without adding much. Owners
 * are the ones who need it to answer "who did this".
 */
export async function GET(req: NextRequest) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = req.nextUrl.searchParams;
  const filter: Filter<AuditLogDoc> = {};

  const targetType = params.get("targetType");
  if (targetType) {
    if (!TARGET_TYPES.includes(targetType as AuditTargetType)) {
      return NextResponse.json(
        { error: "Invalid target type." },
        { status: 400 },
      );
    }
    filter.targetType = targetType as AuditTargetType;
  }

  // Search params are always strings, so they cannot carry a Mongo
  // operator — but they are still checked against known values rather than
  // passed through.
  const targetId = params.get("targetId");
  if (targetId) {
    if (targetId.length > 128) {
      return NextResponse.json(
        { error: "Target id is too long." },
        { status: 400 },
      );
    }
    filter.targetId = targetId;
  }

  const rawLimit = Number(params.get("limit"));
  const limit =
    Number.isInteger(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, MAX_LIMIT)
      : DEFAULT_LIMIT;

  const rawSkip = Number(params.get("skip"));
  const skip = Number.isInteger(rawSkip) && rawSkip > 0 ? rawSkip : 0;

  const collection = await getAuditLogCollection();
  const [entries, total] = await Promise.all([
    collection.find(filter).sort({ at: -1 }).skip(skip).limit(limit).toArray(),
    collection.countDocuments(filter),
  ]);

  return NextResponse.json({ entries, total, limit, skip });
}
