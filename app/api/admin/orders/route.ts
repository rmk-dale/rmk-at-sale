import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import {
  getOrdersCollection,
  isOrderStatus,
  type OrderDoc,
} from "@/lib/models/order";
import { escapeRegex } from "@/lib/validation";
import type { Filter } from "mongodb";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = req.nextUrl.searchParams;

  // Search params are always strings, so they cannot smuggle a Mongo
  // operator — but an unrecognised status would still be passed through as
  // a filter value, so it is checked against the known set.
  const statusParam = params.get("status");
  if (statusParam && !isOrderStatus(statusParam)) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }

  const filter: Filter<OrderDoc> = {};
  if (statusParam && isOrderStatus(statusParam)) filter.status = statusParam;

  // Buyer class. Checked against the two known values for the same reason
  // status is: a search param is always a string and cannot smuggle an
  // operator, but an unrecognised one would still reach the query as a
  // filter value and quietly return nothing.
  //
  // "internal" matches $ne rather than an equality, because orders placed
  // before outside buyers existed carry no buyerType at all and are
  // internal by construction — an equality filter would hide the entire
  // order book from this view.
  const buyerTypeParam = params.get("buyerType");
  if (buyerTypeParam === "external") {
    filter.buyerType = "external";
  } else if (buyerTypeParam === "internal") {
    filter.buyerType = { $ne: "external" };
  } else if (buyerTypeParam) {
    return NextResponse.json({ error: "Invalid buyer type." }, { status: 400 });
  }

  // Lookup by tracking reference or buyer, for support requests.
  const search = params.get("search")?.trim();
  if (search) {
    if (search.length > 128) {
      return NextResponse.json(
        { error: "Search term is too long." },
        { status: 400 },
      );
    }
    const safe = escapeRegex(search);
    filter.$or = [
      { orderNumber: { $regex: `^${safe}`, $options: "i" } },
      { buyerEmail: { $regex: `^${safe}`, $options: "i" } },
    ];
  }

  // The list used to return every order ever placed on each page load.
  // Bounded now so it stays a fixed cost as the order book grows.
  const rawLimit = Number(params.get("limit"));
  const limit =
    Number.isInteger(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, MAX_LIMIT)
      : DEFAULT_LIMIT;

  const rawSkip = Number(params.get("skip"));
  const skip = Number.isInteger(rawSkip) && rawSkip > 0 ? rawSkip : 0;

  const orders = await getOrdersCollection();
  const [items, total] = await Promise.all([
    orders.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
    orders.countDocuments(filter),
  ]);

  return NextResponse.json({ orders: items, total, limit, skip });
}
