import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { MarketSymbolApp } from "./market/MarketSymbolApp.js";

type DashboardSignal = {
  id?: string;
  symbol?: string;
  side?: "LONG" | "SHORT" | "NO_TRADE";
  status?: "ACTIVE" | "CLOSED" | "CANCELLED" | "EXPIRED";
  timeframe?: string;
  score?: number;
  entry?: number;
  stop?: number;
  targets?: number[];
  createdAt?: number | string;
  closedAt?: number | string;
  exit?: number;
  pnlR?: number;
  realizedR?: number;
  rMultiple?: number;
};

type SignalsResponse = {
  success?: boolean;
  count?: number;
  signals?: DashboardSignal[];
};

const SIGNAL_API =
  "https://coingabbarsignals.onrender.com/api/v1";

const dashboardNumber = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const dashboardDate = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }

  return null;
};

const dashboardEscape = (value: unknown): string =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c] ?? c);

const dashboardPrice = (value: unknown): string => {
  const n = dashboardNumber(value);

  if (n === null) return "—";

  const digits =
    Math.abs(n) >= 1000 ? 2 :
    Math.abs(n) >= 1 ? 4 :
    Math.abs(n) >= 0.01 ? 6 : 8;

  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
};

const dashboardPercent = (value: number): string =>
  `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

const plannedRR = (signal: DashboardSignal): number | null => {
  const entry = dashboardNumber(signal.entry);
  const stop = dashboardNumber(signal.stop);
  const target = dashboardNumber(signal.targets?.[0]);

  if (entry === null || stop === null || target === null) return null;

  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);

  if (risk <= 0 || reward < 0) return null;

  return reward / risk;
};

const realizedR = (signal: DashboardSignal): number | null => {
  const direct =
    dashboardNumber(signal.pnlR) ??
    dashboardNumber(signal.realizedR) ??
    dashboardNumber(signal.rMultiple);

  if (direct !== null) return direct;

  const entry = dashboardNumber(signal.entry);
  const stop = dashboardNumber(signal.stop);
  const exit = dashboardNumber(signal.exit);

  if (entry === null || stop === null || exit === null) return null;

  const risk = Math.abs(entry - stop);

  if (risk <= 0) return null;

  if (signal.side === "LONG") {
    return (exit - entry) / risk;
  }

  if (signal.side === "SHORT") {
    return (entry - exit) / risk;
  }

  return null;
};

const formatCreated = (value: unknown): string => {
  const t = dashboardDate(value);

  if (t === null) return "—";

  return new Date(t).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

async function loadDashboardSignals(): Promise<DashboardSignal[]> {
  const controller = new AbortController();

  const timeout = window.setTimeout(
    () => controller.abort(),
    8000,
  );

  try {
    const response = await fetch(
      `${SIGNAL_API}/signals?limit=100`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw new Error(`Signals API HTTP ${response.status}`);
    }

    const data = (await response.json()) as SignalsResponse;

    return Array.isArray(data.signals)
      ? data.signals
      : [];
  } finally {
    window.clearTimeout(timeout);
  }
}

function renderRecentSignals(signals: DashboardSignal[]): void {
  const section = document.querySelector(".panel.recent");

  if (!section) return;

  const tbody = section.querySelector("table tbody");

  if (!(tbody instanceof HTMLTableSectionElement)) return;

  const rows = signals
    .slice()
    .sort(
      (a, b) =>
        (dashboardDate(b.createdAt) ?? 0) -
        (dashboardDate(a.createdAt) ?? 0),
    )
    .slice(0, 8)
    .map((signal) => {
      const side = signal.side ?? "NO_TRADE";
      const sideClass =
        side === "LONG"
          ? "up"
          : side === "SHORT"
            ? "down"
            : "";

      const rr = plannedRR(signal);

      const status = signal.status ?? "UNKNOWN";

      const statusClass =
        status === "ACTIVE"
          ? "up"
          : status === "CLOSED"
            ? "up"
            : status === "CANCELLED" || status === "EXPIRED"
              ? "down"
              : "";

      const symbol = (signal.symbol ?? "")
        .replace(/USDT$/i, "/USDT")
        .replace(/USDC$/i, "/USDC");

      const targets = Array.isArray(signal.targets)
        ? signal.targets
        : [];

      return `
        <tr>
          <td>
            <strong>${dashboardEscape(symbol || "—")}</strong>
            <small style="display:block;opacity:.55">
              ${dashboardEscape(signal.timeframe ?? "—")}
            </small>
          </td>

          <td class="${sideClass}">
            ${dashboardEscape(side)}
          </td>

          <td>
            ${dashboardEscape(dashboardPrice(signal.entry))}
          </td>

          <td>
            ${dashboardEscape(dashboardPrice(signal.stop))}
          </td>

          <td>
            ${dashboardEscape(dashboardPrice(targets[0]))}
          </td>

          <td>
            ${dashboardEscape(dashboardPrice(targets[1]))}
          </td>

          <td>
            ${dashboardEscape(dashboardPrice(targets[2]))}
          </td>

          <td class="${statusClass}">
            ${dashboardEscape(status)}
          </td>

          <td>
            ${rr === null ? "—" : `1:${rr.toFixed(2)}`}
          </td>

          <td>
            ${dashboardEscape(formatCreated(signal.createdAt))}
          </td>
        </tr>
      `;
    })
    .join("");

  tbody.innerHTML =
    rows ||
    `
      <tr>
        <td colspan="10" style="text-align:center;opacity:.65">
          No signals available
        </td>
      </tr>
    `;

  const heading = section.querySelector("h3");

  if (heading) {
    const oldMeta = heading.querySelector(
      "[data-live-signal-meta]",
    );

    const meta =
      oldMeta ??
      (() => {
        const el = document.createElement("span");
        el.setAttribute("data-live-signal-meta", "true");
        el.style.cssText =
          "float:right;color:#7c92a9;font-weight:400;font-size:7px;margin-left:8px";
        heading.appendChild(el);
        return el;
      })();

    const active = signals.filter(
      (s) => s.status === "ACTIVE",
    ).length;

    const closed = signals.filter(
      (s) => s.status === "CLOSED",
    ).length;

    meta.textContent =
      `LIVE · ${signals.length} loaded · ${active} active · ${closed} closed`;
  }
}

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
