import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import type { Timeframe } from "../../shared/market.js";
import { DEFAULT_TIMEFRAME, isTimeframe } from "./timeframes.js";
import { normalizeSymbol } from "./symbol.js";
import { MarketSymbolView } from "./MarketSymbolView.js";

/** URL contract (docs/routes.md: `/market/:symbol?tf=`): here `?page=market&symbol=BTC-USDT&tf=1H`. */
const readUrl = (): { raw: string | null; tf: Timeframe } => {
  const p = new URLSearchParams(window.location.search);
  const tf = p.get("tf");
  return { raw: p.get("symbol") || document.getElementById("liveSymbol")?.textContent?.trim() || "BTC-USDT"", tf: isTimeframe(tf) ? tf : DEFAULT_TIMEFRAME };
};

export function MarketSymbolApp(): ReactElement | null {
  const [url, setUrl] = useState(readUrl);

  useEffect(() => {
    const on = (): void => setUrl(readUrl());
    window.addEventListener("popstate", on);
    const live = document.getElementById("liveSymbol");
    const mo = live ? new MutationObserver(on) : null;
    if (live && mo) mo.observe(live, { childList: true, characterData: true, subtree: true });
    return () => { window.removeEventListener("popstate", on); mo?.disconnect(); };
  }, []);

  const onTimeframeChange = useCallback((tf: Timeframe) => {
    const u = new URL(window.location.href);
    u.searchParams.set("tf", tf);
    window.history.replaceState(window.history.state, "", u); // no reload, no extra history entry
    setUrl((prev) => ({ ...prev, tf }));
  }, []);

  if (!url.raw) return null; // no symbol in the URL: the existing market page is left exactly as it was
  return <MarketSymbolView symbol={normalizeSymbol(url.raw)} rawSymbol={url.raw} timeframe={url.tf} onTimeframeChange={onTimeframeChange} />;
}
