"use client";

import { useSyncExternalStore } from "react";

/** Nothing to subscribe to: the answer changes once, at hydration. */
const noopSubscribe = () => () => {};

/**
 * False during the server render and the first client render, true after.
 *
 * Anything derived from `localStorage` — the cart, above all — has to wait
 * for this, because the server has no localStorage and rendering the
 * hydrated value straight away is a mismatch.
 *
 * The obvious implementation is `useState(false)` plus an effect that sets
 * it to true, and that is what this replaces. It works, but it puts a
 * `setState` in an effect body, which schedules a second render pass on
 * every mount and trips `react-hooks/set-state-in-effect`.
 * `useSyncExternalStore` expresses the same thing as what it actually is:
 * a value with one snapshot on the server and another on the client, which
 * React already knows how to switch between.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
