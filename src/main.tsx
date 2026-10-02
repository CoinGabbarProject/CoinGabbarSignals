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

function calculatePerformance(
  signals: DashboardSignal[],
) {
  const active = signals.filter(
    (s) => s.status === "ACTIVE",
  );

  const closed = signals.filter(
    (s) => s.status === "CLOSED",
  );

  /*
   * Planned R is calculated from TP1.
   *
   * Risk  = |Entry - Stop|
   * Reward = |TP1 - Entry|
   * Planned R = Reward / Risk
   */
  const plannedRs = active
    .map(plannedRR)
    .filter(
      (r): r is number =>
        r !== null &&
        Number.isFinite(r) &&
        r >= 0,
    );

  const averagePlannedR =
    plannedRs.length > 0
      ? plannedRs.reduce(
          (sum, r) => sum + r,
          0,
        ) / plannedRs.length
      : null;

  const maxPlannedR =
    plannedRs.length > 0
      ? Math.max(...plannedRs)
      : null;

  const minPlannedR =
    plannedRs.length > 0
      ? Math.min(...plannedRs)
      : null;

  /*
   * Risk exposure:
   *
   * Every active setup represents one initial
   * stop-distance unit of risk.
   *
   * This is NOT monetary risk because account
   * balance/position size is not available here.
   */
  const riskExposureR = active.length;

  const scores = signals
    .map((s) => dashboardNumber(s.score))
    .filter(
      (score): score is number =>
        score !== null &&
        score >= 0 &&
        score <= 100,
    );

  const averageScore =
    scores.length > 0
      ? scores.reduce(
          (sum, score) => sum + score,
          0,
        ) / scores.length
      : null;

  const strongSetups = scores.filter(
    (score) => score >= 70,
  ).length;

  const realized = closed
    .map(realizedR)
    .filter(
      (r): r is number =>
        r !== null &&
        Number.isFinite(r),
    );

  const wins = realized.filter(
    (r) => r > 0,
  );

  const losses = realized.filter(
    (r) => r < 0,
  );

  const totalR = realized.reduce(
    (sum, r) => sum + r,
    0,
  );

  const averageR =
    realized.length > 0
      ? totalR / realized.length
      : null;

  const winRate =
    realized.length > 0
      ? wins.length / realized.length
      : null;

  const grossProfit = wins.reduce(
    (sum, r) => sum + r,
    0,
  );

  const grossLoss = Math.abs(
    losses.reduce(
      (sum, r) => sum + r,
      0,
    ),
  );

  const profitFactor =
    grossLoss > 0
      ? grossProfit / grossLoss
      : grossProfit > 0
        ? Infinity
        : null;

  /*
   * Equity curve in R-space.
   * No fake dollar P&L is created.
   */
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (const r of realized) {
    equity += r;

    peak = Math.max(
      peak,
      equity,
    );

    const drawdown =
      equity - peak;

    maxDrawdown = Math.min(
      maxDrawdown,
      drawdown,
    );
  }

  const recoveryFactor =
    maxDrawdown < 0
      ? totalR /
        Math.abs(maxDrawdown)
      : null;

  const averageWin =
    wins.length > 0
      ? grossProfit / wins.length
      : null;

  const averageLoss =
    losses.length > 0
      ? grossLoss / losses.length
      : null;

  const breakEvenWinRate =
    averageWin !== null &&
    averageLoss !== null &&
    averageWin + averageLoss > 0
      ? averageLoss /
        (averageWin + averageLoss)
      : null;

  const durations = closed
    .map((s) => {
      const start =
        dashboardDate(
          s.createdAt,
        );

      const end =
        dashboardDate(
          s.closedAt,
        );

      if (
        start === null ||
        end === null ||
        end < start
      ) {
        return null;
      }

      return end - start;
    })
    .filter(
      (d): d is number =>
        d !== null &&
        Number.isFinite(d),
    );

  const averageDuration =
    durations.length > 0
      ? durations.reduce(
          (sum, d) => sum + d,
          0,
        ) / durations.length
      : null;

  return {
    total: signals.length,

    active: active.length,
    closed: closed.length,

    realizedCount:
      realized.length,

    wins: wins.length,
    losses: losses.length,

    plannedRs,
    averagePlannedR,
    minPlannedR,
    maxPlannedR,

    riskExposureR,

    averageScore,
    strongSetups,

    totalR,
    averageR,
    winRate,

    grossProfit,
    grossLoss,

    profitFactor,
    breakEvenWinRate,

    maxDrawdown,
    recoveryFactor,

    averageDuration,
  };
}

  
  

function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) {
    return "N/A";
  }

  const minutes = Math.max(
    0,
    Math.round(ms / 60000),
  );

  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(
    (minutes % 1440) / 60,
  );
  const mins = minutes % 60;

  if (days > 0) {
    return `${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }

  return `${mins}m`;
}

function setPerformanceCard(
  card: Element,
  label: string,
  value: string,
  detail: string,
  meter: number,
  className = "",
): void {
  const labelEl = card.querySelector("label");
  const valueEl = card.querySelector("strong");
  const smallEl = card.querySelector("small");
  const meterEl = card.querySelector(
    ".perf-meter i",
  );

  if (labelEl) {
    labelEl.textContent = label;
  }

  if (valueEl) {
    valueEl.textContent = value;
    valueEl.className = className;
  }

  if (smallEl) {
    smallEl.textContent = detail;
  }

  if (meterEl instanceof HTMLElement) {
    meterEl.style.width =
      `${Math.max(0, Math.min(100, meter))}%`;
  }
}

function renderPerformanceSummary(
  signals: DashboardSignal[],
): void {
  const section = document.querySelector(
    ".performance-summary",
  );

  if (!section) return;

  const cards = [
    ...section.querySelectorAll(".perf-card"),
  ];

  if (cards.length < 6) return;

  const p = calculatePerformance(signals);

  const closedRatio =
    p.total > 0
      ? (p.closed / p.total) * 100
      : 0;

  const winRatePct =
    p.winRate === null
      ? null
      : p.winRate * 100;

  const avgMeter =
    p.averageR === null
      ? 0
      : Math.min(
          100,
          Math.abs(p.averageR) * 25,
        );

  const totalMeter =
    p.totalR === 0
      ? 0
      : Math.min(
          100,
          Math.abs(p.totalR) * 3,
        );

  const pfMeter =
    p.profitFactor === null
      ? 0
      : Number.isFinite(p.profitFactor)
        ? Math.min(
            100,
            p.profitFactor * 35,
          )
        : 100;

  const ddMeter =
    p.maxDrawdown === 0
      ? 0
      : Math.min(
          100,
          Math.abs(p.maxDrawdown) * 20,
        );

  setPerformanceCard(
    cards[0],
    "Closed Signals",
    String(p.closed),
    `${p.total > 0 ? closedRatio.toFixed(1) : "0.0"}% of loaded signals`,
    closedRatio,
    "",
  );

  setPerformanceCard(
    cards[1],
    "Win Rate",
    winRatePct === null
      ? "N/A"
      : `${winRatePct.toFixed(1)}%`,
    p.realizedCount > 0
      ? `${p.wins} wins / ${p.losses} losses · ${p.realizedCount} realized`
      : "Requires realized exit / R data",
    winRatePct ?? 0,
    winRatePct !== null && winRatePct >= 50
      ? "up"
      : winRatePct !== null
        ? "down"
        : "",
  );

  setPerformanceCard(
    cards[2],
    "Average R",
    p.averageR === null
      ? "N/A"
      : `${p.averageR >= 0 ? "+" : ""}${p.averageR.toFixed(2)}R`,
    p.expectancy === null
      ? "No realized R available"
      : `Expectancy · BE win ${p.breakEvenWinRate === null ? "N/A" : `${(p.breakEvenWinRate * 100).toFixed(1)}%`}`,
    avgMeter,
    p.averageR === null
      ? ""
      : p.averageR >= 0
        ? "up"
        : "down",
  );

  setPerformanceCard(
    cards[3],
    "Total R",
    p.realizedCount === 0
      ? "N/A"
      : `${p.totalR >= 0 ? "+" : ""}${p.totalR.toFixed(2)}R`,
    p.recoveryFactor === null
      ? "Realized closed-trade R"
      : `Recovery factor ${p.recoveryFactor.toFixed(2)}`,
    totalMeter,
    p.realizedCount === 0
      ? ""
      : p.totalR >= 0
        ? "up"
        : "down",
  );

  setPerformanceCard(
    cards[4],
    "Profit Factor",
    p.profitFactor === null
      ? "N/A"
      : Number.isFinite(p.profitFactor)
        ? p.profitFactor.toFixed(2)
        : "∞",
    p.profitFactor === null
      ? "Requires realized wins/losses"
      : `Gross +${p.grossProfit.toFixed(2)}R / -${p.grossLoss.toFixed(2)}R`,
    pfMeter,
    p.profitFactor === null
      ? ""
      : p.profitFactor >= 1
        ? "up"
        : "down",
  );

  setPerformanceCard(
    cards[5],
    "Max Drawdown",
    p.realizedCount === 0
      ? "N/A"
      : `${p.maxDrawdown.toFixed(2)}R`,
    p.averageDuration === null
      ? "Peak-to-trough · duration N/A"
      : `Peak-to-trough · avg ${formatDuration(p.averageDuration)}`,
    ddMeter,
    p.maxDrawdown < 0
      ? "down"
      : "up",
  );

  const heading = section.querySelector(
    ".section-head span",
  );

  if (heading) {
    heading.textContent =
      `${p.total} signals · ${p.realizedCount} realized · LIVE DATA`;
  }
}

async function refreshDashboardAnalytics(): Promise<void> {
  const recent = document.querySelector(
    ".panel.recent",
  );

  const performance = document.querySelector(
    ".performance-summary",
  );

  if (!recent && !performance) return;

  try {
    const signals = await loadDashboardSignals();

    renderRecentSignals(signals);
    renderPerformanceSummary(signals);
  } catch (error) {
    console.error(
      "CoinGabbarSignals dashboard analytics:",
      error,
    );
  }
}

let dashboardAnalyticsTimer: number | null = null;

function startDashboardAnalytics(): void {
  if (dashboardAnalyticsTimer !== null) {
    window.clearInterval(
      dashboardAnalyticsTimer,
    );
  }

  void refreshDashboardAnalytics();

  dashboardAnalyticsTimer =
    window.setInterval(() => {
      void refreshDashboardAnalytics();
    }, 15000);
}

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

  if (
    mounted &&
    mounted.el !== el
  ) {
    mounted.root.unmount();
    mounted = null;
  }

  if (
    el &&
    !mounted
  ) {
    const root = createRoot(el);

    root.render(
      <MarketSymbolApp />,
    );

    mounted = {
      el,
      root,
    };
  }

  // Existing index.html dashboard remains untouched.
  // This updates Recent Signals + Performance Summary
  // through the TypeScript application layer only.
  startDashboardAnalytics();
}

// index.html swaps <main>'s direct children wholesale, so watching direct children is enough
// (subtree would also fire for every React/chart DOM update inside our own root).
const host = document.querySelector(".main");
new MutationObserver(sync).observe(host ?? document.body, host ? { childList: true } : { childList: true, subtree: true });
sync();

window.addEventListener(
  "visibilitychange",
  () => {
    if (!document.hidden) {
      void refreshDashboardAnalytics();
    }
  },
);
