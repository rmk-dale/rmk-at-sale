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
