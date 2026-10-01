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

new MutationObserver(sync).observe(document.querySelector(".main") ?? document.body, { childList: true, subtree: true });
sync();
