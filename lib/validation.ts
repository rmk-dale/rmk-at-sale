/**
 * Input guards for values that came out of `req.json()`.
 *
 * `Request.json()` is typed `any`, so destructuring it hands you values
 * TypeScript believes are strings but which are, at runtime, whatever the
 * client sent — including objects. When such a value reaches a MongoDB
 * filter, `{ _id: id }` silently becomes `{ _id: { $gt: "" } }` and the
 * query matches documents the caller never named. Every value pulled off a
 * request body must therefore be narrowed here before it is used, and
 * especially before it touches a query.
 */

/** Narrows to a non-empty string. Rejects objects, arrays, numbers, null. */
export function asString(value: unknown, maxLength = 512): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

/** Narrows to a whole number within an inclusive range. */
export function asInteger(
  value: unknown,
  min: number,
  max: number,
): number | null {
  if (typeof value !== "number") return null;
  if (!Number.isInteger(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

/**
 * Defence in depth for anywhere a dynamic value must reach a query filter.
 * A plain string can never carry a Mongo operator; this catches the case
 * where a future refactor lets an object through anyway.
 */
export function isQuerySafe(value: unknown): value is string {
  return typeof value === "string" && !value.startsWith("$");
}

/**
 * Practical email check: one @, no whitespace, no angle brackets or
 * newlines (which is what would matter if a value ever reached a mail
 * header), sane length. Deliberately not RFC 5322 — the only real proof an
 * address is valid is that the code we send to it comes back.
 */
const EMAIL_PATTERN = /^[^\s@<>",;:\\]{1,64}@[^\s@<>",;:\\]{1,190}\.[a-zA-Z]{2,24}$/;

export function asEmail(value: unknown): string | null {
  const str = asString(value, 254);
  if (!str) return null;
  const lowered = str.toLowerCase();
  if (!EMAIL_PATTERN.test(lowered)) return null;
  if (lowered.includes("..")) return null;
  return lowered;
}

// ---------------------------------------------------------------------------
// Cart validation
// ---------------------------------------------------------------------------

/** Item codes are admin-authored SKUs like "AT88G01001". */
const ITEM_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const MAX_CART_LINES = 50;
export const MAX_QUANTITY_PER_LINE = 99;
export const MAX_TOTAL_QUANTITY = 500;

export interface ValidatedCartItem {
  id: string;
  quantity: number;
  color?: string;
  size?: string;
}

export type CartValidation =
  | { ok: true; items: ValidatedCartItem[] }
  | { ok: false; error: string };

/**
 * Validates a checkout payload into values that are safe to put in a query.
 *
 * Enforces, in order: the payload is a non-empty array of plain objects;
 * every `id` is a string matching the item-code shape (never an object, so
 * never a Mongo operator); every `quantity` is a whole number inside a
 * sane range (a fractional quantity would otherwise produce fractional
 * stock and a near-zero order total); optional `color`/`size` are short
 * strings; and no line is repeated, so the same variant cannot be
 * decremented twice in one order.
 */
export function validateCartItems(input: unknown): CartValidation {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, error: "Your cart is empty." };
  }

  if (input.length > MAX_CART_LINES) {
    return {
      ok: false,
      error: `A single order can contain at most ${MAX_CART_LINES} different items.`,
    };
  }

  const items: ValidatedCartItem[] = [];
  const seen = new Set<string>();
  let totalQuantity = 0;

  for (const raw of input) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { ok: false, error: "Invalid cart item." };
    }

    const { id, quantity, color, size } = raw as Record<string, unknown>;

    // The important line: `id` must be a string. Anything else — an object
    // carrying `$gt`, `$ne`, `$where` — is rejected before it can reach the
    // product filter in the checkout route.
    if (typeof id !== "string" || !ITEM_CODE_PATTERN.test(id)) {
      return { ok: false, error: "Invalid cart item." };
    }

    const parsedQuantity = asInteger(quantity, 1, MAX_QUANTITY_PER_LINE);
    if (parsedQuantity === null) {
      return {
        ok: false,
        error: `Quantity must be a whole number between 1 and ${MAX_QUANTITY_PER_LINE}.`,
      };
    }

    let parsedColor: string | undefined;
    if (color !== undefined && color !== null && color !== "") {
      const value = asString(color, 64);
      if (!value) return { ok: false, error: "Invalid colour selection." };
      parsedColor = value;
    }

    let parsedSize: string | undefined;
    if (size !== undefined && size !== null && size !== "") {
      const value = asString(size, 32);
      if (!value) return { ok: false, error: "Invalid size selection." };
      parsedSize = value;
    }

    const lineKey = `${id}|${parsedColor ?? ""}|${parsedSize ?? ""}`;
    if (seen.has(lineKey)) {
      return {
        ok: false,
        error: "That cart contains the same item twice. Please refresh and try again.",
      };
    }
    seen.add(lineKey);

    totalQuantity += parsedQuantity;
    if (totalQuantity > MAX_TOTAL_QUANTITY) {
      return {
        ok: false,
        error: `An order can contain at most ${MAX_TOTAL_QUANTITY} units. Please contact us for bulk orders.`,
      };
    }

    items.push({
      id,
      quantity: parsedQuantity,
      color: parsedColor,
      size: parsedSize,
    });
  }

  return { ok: true, items };
}

// ---------------------------------------------------------------------------
// Bundle rules
// ---------------------------------------------------------------------------

/**
 * The store does not sell single units. Every product on an order must
 * appear at least this many times.
 *
 * The count is per *product*, not per cart line: a shopper who wants one
 * bag in Sporty Blue at 55cm and one in Deep Red at 67cm has satisfied the
 * minimum, because both lines carry the same product id. That is the whole
 * point of counting here rather than in `validateCartItems`, which sees
 * lines and deliberately treats each colour × size as distinct.
 */
export const MIN_UNITS_PER_PRODUCT = 2;

/** A "bundle" is exactly this many units of one product. */
export const BUNDLE_SIZE = 3;

/** What a bundle takes off that product's subtotal. */
export const BUNDLE_DISCOUNT_RATE = 0.05;

/**
 * Money is accumulated in centavos, as integers, and converted back once.
 *
 * Peso amounts here are products of a variant price and a quantity, summed
 * across lines and then multiplied by 0.05 — four chances for binary
 * floating point to leave a total like 2849.9999999999995, which
 * `toFixed(2)` hides on the receipt and the stored `total` does not. Doing
 * the arithmetic in the smallest unit the currency actually has means the
 * only rounding is the one deliberate one, on the discount itself.
 */
const toCentavos = (pesos: number) => Math.round(pesos * 100);

export interface BundleLine {
  id: string;
  quantity: number;
  /**
   * Unit price in pesos.
   *
   * Optional because the quantity rules are meaningful before prices are
   * known — only the money fields of the result depend on it.
   */
  price?: number;
}

export interface BundleGroup {
  /** The product id every line in this group shares. */
  id: string;
  /** Units of this product across every line, whatever the colour or size. */
  quantity: number;
  /** How many cart lines make up those units. */
  lines: number;
  subtotal: number;
  discount: number;
  total: number;
  /** True when the group sits at exactly `BUNDLE_SIZE` and earned the 5%. */
  discounted: boolean;
  meetsMinimum: boolean;
  /** Units still needed to reach the minimum; 0 once it is met. */
  shortfall: number;
  /**
   * Units that would take this group to exactly `BUNDLE_SIZE`; 0 if it is
   * already there, and 0 past it — a group of 4 cannot reach a bundle by
   * adding, only by removing, and the UI does not push shoppers to buy less.
   */
  toBundle: number;
}

export interface BundleEvaluation {
  /** One entry per product, in order of first appearance in the cart. */
  groups: BundleGroup[];
  byProduct: Map<string, BundleGroup>;
  subtotal: number;
  discount: number;
  total: number;
  /** Groups below `MIN_UNITS_PER_PRODUCT`. Non-empty means checkout is blocked. */
  shortGroups: BundleGroup[];
  ok: boolean;
}

/**
 * Applies the bundle rules to a set of cart lines.
 *
 * Pure, and free of any import that touches a database or the DOM, so the
 * cart page, the drawer and the checkout route can all run the same
 * implementation. That shared implementation is the point: the client copy
 * is an affordance and the server copy is the trust boundary, and the two
 * disagreeing is how a shopper gets shown one total and charged another.
 *
 * The rules, in full:
 *   - Lines are grouped by product id. Colour and size never split a group.
 *   - A group below `MIN_UNITS_PER_PRODUCT` blocks the order.
 *   - A group of *exactly* `BUNDLE_SIZE` takes `BUNDLE_DISCOUNT_RATE` off
 *     that group's subtotal. Two, four, five — nothing. The discount is a
 *     spike, not a floor, and that is deliberate.
 *   - Groups are independent: two products at three units each earn two
 *     separate discounts.
 */
export function evaluateBundles(
  lines: readonly BundleLine[],
): BundleEvaluation {
  const accumulated = new Map<
    string,
    { id: string; quantity: number; lines: number; centavos: number }
  >();

  for (const line of lines) {
    // Tolerant of junk rather than throwing: this runs on localStorage
    // content on the client, where a hand-edited or half-migrated cart is
    // a real possibility, and the server has already narrowed its own
    // input through `validateCartItems` before it gets here.
    const quantity = Math.floor(Number(line?.quantity) || 0);
    if (!line?.id || quantity <= 0) continue;

    const unit = toCentavos(Math.max(0, Number(line.price) || 0));
    const group = accumulated.get(line.id);

    if (group) {
      group.quantity += quantity;
      group.lines += 1;
      group.centavos += unit * quantity;
    } else {
      accumulated.set(line.id, {
        id: line.id,
        quantity,
        lines: 1,
        centavos: unit * quantity,
      });
    }
  }

  const groups: BundleGroup[] = [];
  const byProduct = new Map<string, BundleGroup>();
  const shortGroups: BundleGroup[] = [];
  let subtotalCentavos = 0;
  let discountCentavos = 0;

  for (const entry of accumulated.values()) {
    const discounted = entry.quantity === BUNDLE_SIZE;
    const groupDiscount = discounted
      ? Math.round(entry.centavos * BUNDLE_DISCOUNT_RATE)
      : 0;
    const meetsMinimum = entry.quantity >= MIN_UNITS_PER_PRODUCT;

    const group: BundleGroup = {
      id: entry.id,
      quantity: entry.quantity,
      lines: entry.lines,
      subtotal: entry.centavos / 100,
      discount: groupDiscount / 100,
      total: (entry.centavos - groupDiscount) / 100,
      discounted,
      meetsMinimum,
      shortfall: meetsMinimum ? 0 : MIN_UNITS_PER_PRODUCT - entry.quantity,
      toBundle: entry.quantity < BUNDLE_SIZE ? BUNDLE_SIZE - entry.quantity : 0,
    };

    subtotalCentavos += entry.centavos;
    discountCentavos += groupDiscount;

    groups.push(group);
    byProduct.set(group.id, group);
    if (!meetsMinimum) shortGroups.push(group);
  }

  return {
    groups,
    byProduct,
    subtotal: subtotalCentavos / 100,
    discount: discountCentavos / 100,
    total: (subtotalCentavos - discountCentavos) / 100,
    shortGroups,
    ok: shortGroups.length === 0,
  };
}

/**
 * The message a shopper sees when a product is below the minimum.
 *
 * Takes display names rather than ids because an id is an ObjectId hex and
 * tells the shopper nothing about which thing in their cart is the
 * problem. The caller resolves them — the checkout route from the product
 * documents it has already loaded, the cart from the line itself.
 */
export function bundleMinimumMessage(names: readonly string[]): string {
  const listed = names.filter(Boolean);
  const subject =
    listed.length === 0
      ? "One item in your cart"
      : listed.length === 1
        ? `"${listed[0]}"`
        : `${listed
            .slice(0, -1)
            .map((n) => `"${n}"`)
            .join(", ")} and "${listed[listed.length - 1]}"`;
  const verb = listed.length > 1 ? "each need" : "needs";

  return `${subject} ${verb} at least ${MIN_UNITS_PER_PRODUCT} pieces. You can mix sizes or colours of the same item to get there.`;
}

/**
 * Escapes a string for safe interpolation into HTML.
 *
 * Used on customer-supplied variant names before they go into the receipt
 * email, which is assembled as an HTML string rather than rendered by
 * React and so has none of React's automatic escaping.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escapes a string for literal use inside a RegExp. */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
