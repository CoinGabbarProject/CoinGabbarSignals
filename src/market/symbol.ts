/**
 * Route symbol -> exchange symbol, e.g. "btc-usdt" | "BTC/USDT" | "BTC" -> "BTCUSDT".
 * Output matches the server's SYMBOL_RE (/^[A-Z0-9]{5,20}$/ in server/config/env.ts);
 * the frontend may not import server code, so the rule is mirrored here.
 * Returns null when the input cannot be a tradable pair (the UI then shows the empty state).
 */
const SYMBOL_RE = /^[A-Z0-9]{5,20}$/;
const QUOTE = "USDT";

export function normalizeSymbol(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().toUpperCase().replace(/[-/_\s]/g, "");
  if (s === "" || s === QUOTE) return null; // "USDT" alone is the quote asset, not a USDT pair
  const pair = s.endsWith(QUOTE) ? s : s + QUOTE;
  return SYMBOL_RE.test(pair) ? pair : null;
}

/** "BTCUSDT" -> "BTC/USDT" for display only. */
export const displaySymbol = (s: string): string => (s.endsWith(QUOTE) && s.length > QUOTE.length ? `${s.slice(0, -QUOTE.length)}/${QUOTE}` : s);
