import { create } from "zustand";
import { persist } from "zustand/middleware";

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
}

interface CartState {
  items: CartItem[];
  isOpen: boolean;
  addItem: (item: CartItem) => void;
  removeItem: (cartItemId: string) => void;
  updateQuantity: (cartItemId: string, quantity: number) => void;
  clearCart: () => void;
  getTotal: () => number;
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

      addItem: (item) =>
        set((state) => {
          const cartItemId = item.cartItemId || `${item.id}-${item.color || "no-color"}-${item.size || "no-size"}`;
          const existingItem = state.items.find((i) => i.cartItemId === cartItemId);
          if (existingItem) {
            return {
              isOpen: true,
              items: state.items.map((i) =>
                i.cartItemId === cartItemId ? { ...i, quantity: i.quantity + 1 } : i,
              ),
            };
          }
          return {
            isOpen: true,
            items: [...state.items, { ...item, cartItemId, quantity: 1 }],
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
              i.cartItemId === cartItemId ? { ...i, quantity } : i,
            ),
          };
        }),

      clearCart: () => set({ items: [] }),

      getTotal: () => {
        const { items } = get();
        return items.reduce(
          (total, item) => total + item.price * item.quantity,
          0,
        );
      },

      getTotalItems: () => {
        const { items } = get();
        return items.reduce((total, item) => total + item.quantity, 0);
      },
    }),
    {
      name: "rmk-cart-storage", // name of the item in localStorage
      partialize: (state) => ({ items: state.items }),
    },
  ),
);
