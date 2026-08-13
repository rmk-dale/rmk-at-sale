"use client";

import { useEffect, useState } from "react";
import { CAMPAIGN, formatRemaining } from "@/lib/campaign";

/**
 * The campaign bar that sits between the navbar and the page content.
 *
 * This is the only place the offer exists as *text*. The banner artwork
 * says the same thing, but it says it in pixels — so a screen reader, a
 * crawler, and anyone whose images failed to load all learn about the
 * sale from here or not at all. That is why it is markup and not another
 * image, and why it lives in the chrome rather than on the listing page:
 * someone landing directly on a product URL should still see the offer.
 *
 * Colour note: the gradient's light end is the constraint, not its dark
 * end. White has to clear 4.5:1 against the *lightest* pixel in the bar,
 * which is what pinned the start at #cc3f1b (4.9:1) rather than the
 * brighter orange it began as (3.5:1 — failed).
 *
 * Beacon appears here only as the ribbon's fill. Yellow type on these
 * reds is 3.3–3.7:1 and does not pass at any size, which is exactly the
 * rule stated at the top of globals.css.
 */
export default function SaleStrip() {
  /**
   * `null` until the first client tick.
   *
   * The server has no useful "now" to render — whatever it computed would
   * be stale by the time it reached the browser, and a mismatched string
   * is a hydration error. So the server renders the bar without a
   * countdown and the client fills it in, which means the server and the
   * first client render are byte-identical. The bar itself never shifts;
   * only the digits arrive late.
   */
  const [remaining, setRemaining] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    const tick = () => {
      const ms = CAMPAIGN.end - Date.now();
      if (ms <= 0) {
        setEnded(true);
        return;
      }
      setRemaining(formatRemaining(ms));
    };

    tick();
    // Once a minute: the display's smallest unit is minutes, so anything
    // faster is a wasted render. See formatRemaining.
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  // Self-retiring. When the window closes the bar removes itself without
  // anyone needing to ship a deploy on the day.
  if (ended) return null;

  return (
    <aside
      aria-label={`${CAMPAIGN.name} promotion`}
      className="bg-gradient-to-r from-[#cc3f1b] to-[#c7261c]"
    >
      <div className="max-w-7xl mx-auto px-6 py-2.5 flex items-center gap-3 sm:gap-4">
        <span className="ribbon-flag flex-shrink-0 bg-beacon text-[#8a1109] text-[10px] sm:text-xs font-extrabold tracking-[0.08em] px-3 sm:px-4 py-1">
          {CAMPAIGN.name.toUpperCase()}
        </span>

        <span className="text-white text-xs sm:text-sm font-semibold truncate">
          {CAMPAIGN.offer}
        </span>

        {/*
          `min-w` reserves the digits' footprint before they arrive, so the
          bar doesn't reflow a moment after paint. Tabular figures keep it
          from twitching as the numbers change.
        */}
        <span className="ml-auto hidden sm:block min-w-[9.5rem] text-right font-mono text-[11px] font-bold tracking-wide text-white tabular-nums">
          {remaining ? (
            <>
              <span className="sr-only">Time remaining: </span>
              ENDS IN {remaining}
            </>
          ) : null}
        </span>
      </div>
    </aside>
  );
}
