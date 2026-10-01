import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { MarketSymbolApp } from "./market/MarketSymbolApp.js";

/**
 * index.html rebuilds <main> via innerHTML on every page switch, so the React root is mounted
 * when #market-symbol-root appears and unmounted (chart.remove + abort) when it disappears.
 */
const ROOT_ID = "market-symbol-root";
let mounted: { el: HTMLElement; root: Root } | null = null;

function sync(): void {
  const el = document.getElementById(ROOT_ID);
  if (mounted && mounted.el !== el) { mounted.root.unmount(); mounted = null; }
  if (el && !mounted) {
    const root = createRoot(el);
    root.render(<MarketSymbolApp />);
    mounted = { el, root };
  }
}

// index.html swaps <main>'s direct children wholesale, so watching direct children is enough
// (subtree would also fire for every React/chart DOM update inside our own root).
const host = document.querySelector(".main");
new MutationObserver(sync).observe(host ?? document.body, host ? { childList: true } : { childList: true, subtree: true });
sync();
