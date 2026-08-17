/**
 * Campaign configuration.
 *
 * The storefront palette is permanent, but the sale strip is not — it is
 * scoped to one promo window. Everything that has to change when the next
 * campaign runs lives here, so switching it over is an edit to this file
 * rather than a hunt through components.
 *
 * Times are pinned to +08:00 (Asia/Manila) because the store prices in
 * pesos and the promo ends at close of business local time. Without the
 * offset, `new Date("2026-09-18")` parses as UTC midnight and the sale
 * would quietly end eight hours early for the people it is aimed at.
 */
export const CAMPAIGN = {
  name: "Mega Bundeals",
  offer: "Extra 5% off 3-piece bundles",
  note: "NOTE: Items are sold in bundles only, with a minimum purchase of 2 pieces.",

  /** Human-readable window, used in the accessible page heading. */
  window: "August 19 – September 18, 2026",

  start: new Date("2026-08-19T00:00:00+08:00").getTime(),
  end: new Date("2026-09-18T23:59:59+08:00").getTime(),
} as const;

/**
 * `12d 04h 31m` — deliberately coarse.
 *
 * A per-second countdown on a 30-day promo is noise: it re-renders sixty
 * times more often than the display actually changes, and a ticking
 * seconds digit reads as manufactured urgency rather than information.
 * Minutes are the smallest unit worth showing, which also means the
 * caller only needs to tick once a minute.
 */
export function formatRemaining(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  const pad = (n: number) => String(n).padStart(2, "0");
  return `${days}d ${pad(hours)}h ${pad(minutes)}m`;
}
