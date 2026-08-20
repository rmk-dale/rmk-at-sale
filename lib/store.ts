import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  MAX_QUANTITY_PER_LINE,
  evaluateBundles,
  groupLinesByProduct,
  type BundleEvaluation,
} from "@/lib/validation";

export interface CartItem {
  cartItemId?: string;
  id: string;
  name: string;
  price: number;
  originalPrice?: number;
  image: string;
  quantity: number;
  color?: string;
  size?: string;
  /**
   * Stock of the specific variant this line refers to, captured when the
   * line was added.
   *
   * It is a UX hint and nothing more: it lets the steppers stop at a number
   * the shopper can actually buy instead of letting them build a cart that
   * checkout will reject. It is deliberately NOT a trust boundary — the
   * real check is the atomic, transactional stock decrement in
   * /api/checkout, which runs against live data and is unaffected by
   * whatever a client has in localStorage.
   */
  variantStock?: number;
}

/**
 * The identity of a cart line.
 *
 * Same shape as the `lineKey` that `validateCartItems` builds server-side.
 * Keeping the two in the same format is the point: a line that is distinct
 * here must be distinct there, or the duplicate-line guard at checkout
 * fires on carts the UI considers valid.
 */
export function cartLineKey(id: string, color?: string, size?: string) {
  return `${id}|${color ?? ""}|${size ?? ""}`;
}

/**
 * A line's identity, tolerating lines that predate `cartItemId`.
 *
 * One definition, used by every caller that needs to name a line — the
 * React key, the quantity handlers, and the set of lines that render a
 * group notice. When those were computed independently they disagreed for
 * exactly the lines that had no `cartItemId`, and the disagreement was
 * invisible until a notice silently failed to render.
 */
export function cartLineId(item: CartItem): string {
  return item.cartItemId ?? cartLineKey(item.id, item.color, item.size);
}

/** Most a single line may hold: the variant's stock, capped by the server's limit. */
function lineCeiling(variantStock?: number) {
  return Math.min(MAX_QUANTITY_PER_LINE, variantStock ?? MAX_QUANTITY_PER_LINE);
}

/**
 * Runs the bundle rules over a cart.
 *
 * The same `evaluateBundles` the checkout route uses, fed from cart lines
 * instead of validated order items. Everything the shopper is told about
 * the minimum and the 5% comes through here, so the cart and the server
 * can only disagree if the *prices* have drifted — which `CartLine`
 * already detects and says so — never because two implementations of the
 * rule diverged.
 */
export function evaluateCart(items: readonly CartItem[]): BundleEvaluation {
  return evaluateBundles(
    items.map(({ id, quantity, price }) => ({ id, quantity, price })),
  );
}

/** One product's lines, ready to render as a single block. */
export interface CartGrouping {
  /** The product id every line here shares — the bundle group's key. */
  id: string;
  /**
   * A label for the group, taken from the first line.
   *
   * The catalogue's name is better when it has loaded — a product can be
   * renamed after a cart is persisted — so callers that hold a
   * `PublicProduct` should prefer it and fall back to this.
   */
  name: string;
  /** Every line of this product, in the order the cart holds them. */
  lines: CartItem[];
  /** Units across those lines. Matches the bundle group's `quantity`. */
  quantity: number;
}

/**
 * The cart's lines, gathered one block per product.
 *
 * The bundle rules count by product id while the cart stores one line per
 * colour × size, so three pieces of one bag can sit at three separate
 * places in the list with two other products interleaved. Nothing on
 * screen then says those three lines are the thing earning the 5%.
 *
 * Grouping here rather than in the page means the drawer and the cart page
 * order lines identically, and it replaces the old `groupLeadLineIds`
 * trick of nominating one line per product to carry the group's notice —
 * with a real container, the notice has somewhere to live.
 *
 * Groups appear in order of each product's first line, and lines keep
 * their relative order inside a group, so adding a second size moves
 * nothing that was already on screen except to pull the new line up beside
 * its siblings.
 */
export function groupCartLines(items: readonly CartItem[]): CartGrouping[] {
  // `groupLinesByProduct` sits next to `evaluateBundles` in the same
  // module, so the blocks on screen and the groups the money is computed
  // over cannot be keyed differently. All this adds is a display name.
  return groupLinesByProduct(items).map((group) => ({
    id: group.id,
    name: group.lines[0]?.name ?? "",
    lines: group.lines,
    quantity: group.quantity,
  }));
}

interface CartState {
  items: CartItem[];
  isOpen: boolean;
  addItem: (item: CartItem) => void;
  removeItem: (cartItemId: string) => void;
  updateQuantity: (cartItemId: string, quantity: number) => void;
  clearCart: () => void;
  /** Line total before the bundle rules. */
  getTotal: () => number;
  /** What the bundle rules take off. Zero when nothing qualifies. */
  getBundleDiscount: () => number;
  /** What the shopper actually pays: `getTotal() - getBundleDiscount()`. */
  getPayableTotal: () => number;
  /** True when every product in the cart meets the minimum. */
  canCheckout: () => boolean;
  getTotalItems: () => number;
  openCart: () => void;
  closeCart: () => void;
  toggleCart: () => void;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      isOpen: false,

      openCart: () => set({ isOpen: true }),
      closeCart: () => set({ isOpen: false }),
      toggleCart: () => set((state) => ({ isOpen: !state.isOpen })),

      /**
       * Adds `item.quantity` units in one write.
       *
       * This used to ignore `item.quantity` entirely — it always inserted
       * at 1 and merged with +1 — so callers wanting N units called it N
       * times in a loop. That was N zustand writes, N localStorage
       * serializations and N renders for one click, and the drawer's
       * `isOpen: true` fired on every pass.
       */
      addItem: (item) =>
        set((state) => {
          const requested = Math.max(1, Math.floor(item.quantity ?? 1));
          const cartItemId =
            item.cartItemId ?? cartLineKey(item.id, item.color, item.size);
          const existing = state.items.find((i) => i.cartItemId === cartItemId);

          // A fresh add carries current stock; a repeat add without one
          // keeps whatever the line already knew.
          const stock = item.variantStock ?? existing?.variantStock;
          const ceiling = lineCeiling(stock);

          if (existing) {
            return {
              isOpen: true,
              items: state.items.map((i) =>
                i.cartItemId === cartItemId
                  ? {
                      ...i,
                      variantStock: stock,
                      quantity: Math.min(i.quantity + requested, ceiling),
                    }
                  : i,
              ),
            };
          }

          return {
            isOpen: true,
            items: [
              ...state.items,
              {
                ...item,
                cartItemId,
                variantStock: stock,
                quantity: Math.min(requested, ceiling),
              },
            ],
          };
        }),

      removeItem: (cartItemId) =>
        set((state) => ({
          items: state.items.filter((i) => i.cartItemId !== cartItemId),
        })),

      updateQuantity: (cartItemId, quantity) =>
        set((state) => {
          if (quantity <= 0) {
            return {
              items: state.items.filter((i) => i.cartItemId !== cartItemId),
            };
          }
          return {
            items: state.items.map((i) =>
              i.cartItemId === cartItemId
                ? { ...i, quantity: Math.min(quantity, lineCeiling(i.variantStock)) }
                : i,
            ),
          };
        }),

      clearCart: () => set({ items: [] }),

      // All four read through `evaluateCart` rather than summing here.
      // The old inline `reduce` was a float sum of `price * quantity`,
      // which is fine until a discount is taken off it; the shared
      // evaluator does the arithmetic in centavos, so the number shown in
      // the cart is the same number the server stores on the order.
      getTotal: () => evaluateCart(get().items).subtotal,

      getBundleDiscount: () => evaluateCart(get().items).discount,

      getPayableTotal: () => evaluateCart(get().items).total,

      canCheckout: () => {
        const { items } = get();
        return items.length > 0 && evaluateCart(items).ok;
      },

      getTotalItems: () => {
        const { items } = get();
        return items.reduce((total, item) => total + item.quantity, 0);
      },
    }),
    {
      name: "rmk-cart-storage", // name of the item in localStorage
      partialize: (state) => ({ items: state.items }),

      /**
       * v0 keyed lines as `${id}-${color|"no-color"}-${size|"no-size"}`.
       * v1 uses `cartLineKey`, which matches the server's format.
       *
       * Without this, a shopper with a cart already in localStorage would
       * keep their old keys, and re-adding the same variant would miss the
       * `existing` lookup and append a second line for the same thing. The
       * old key was derived from the same three fields, so re-deriving is
       * enough — it cannot collide two previously-distinct lines.
       */
      version: 1,
      migrate: (persisted, version) => {
        const state = persisted as { items?: CartItem[] } | undefined;
        if (!state?.items) return { items: [] };
        if (version >= 1) return state;
        return {
          items: state.items.map((i) => ({
            ...i,
            cartItemId: cartLineKey(i.id, i.color, i.size),
          })),
        };
      },
    },
  ),
);
