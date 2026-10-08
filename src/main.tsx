import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { MarketSymbolApp } from "./market/MarketSymbolApp.js";
import {
  CandlestickSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
} from "lightweight-charts";
import type { AutoscaleInfo, IChartApi, IPriceLine, ISeriesApi, UTCTimestamp } from "lightweight-charts";
type DashboardSignal = {
  id?: string;
  symbol?: string;
  side?: "LONG" | "SHORT" | "NO_TRADE";
  status?:
    | "ACTIVE"
    | "CLOSED"
    | "CANCELLED"
    | "EXPIRED"
    | "TP1_HIT"
    | "TP2_HIT"
    | "TP3_HIT"
    | "SL_HIT"
    | "BE_HIT";
    outcomeClosed?: boolean;
  entered?: boolean;
  outcomeAt?: number;
  trailStop?: number;
  hits?: { tp1?: number; tp2?: number; tp3?: number; sl?: number };
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
  "https://coingabbarsignals-1.onrender.com/api/v1";

const isClosedSignal = (s: DashboardSignal): boolean =>
  s.status === "CLOSED" ||
  s.status === "TP3_HIT" ||
  s.status === "SL_HIT" ||
  s.status === "BE_HIT" ||
  ((s.status === "TP1_HIT" || s.status === "TP2_HIT") &&
    s.outcomeClosed === true);

const STATUS_LABEL: Record<string, string> = {
  EXPIRED: "EXPIRED",
    TP1_HIT: "TP1 Hit",
  TP2_HIT: "TP2 Hit",
  TP3_HIT: "TP3 Hit",
  SL_HIT: "SL Hit",
  BE_HIT: "BE",
};

function calculatePerformance(
  signals: DashboardSignal[],
) {
  const active = signals.filter(
    (s) => s.status === "ACTIVE",
  );

  const closed = signals.filter(isClosedSignal);

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
  card: Element | undefined,
  label: string,
  value: string,
  detail: string,
  meter: number,
  className = "",
): void {
  if (!card) return;
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

  
    /*
   * CARD 1
   * Closed trade count.
   */
  setPerformanceCard(
    cards[0],
    "Closed Signals",
    String(p.closed),
    p.closed > 0
      ? `${p.realizedCount} with realized R data`
      : `${p.active} active · awaiting closure`,
    p.total > 0
      ? (p.closed / p.total) * 100
      : 0,
    "",
  );

  /*
   * CARD 2
   * Active exposure.
   *
   * This updates immediately even when there are
   * no closed trades.
   */
  setPerformanceCard(
    cards[1],
    "Active Signals",
    String(p.active),
    p.active > 0
      ? `${p.riskExposureR.toFixed(0)}R initial risk exposure`
      : "No active setups",
    Math.min(
      100,
      p.active * 20,
    ),
    p.active > 0
      ? "up"
      : "",
  );

  /*
   * CARD 3
   * Planned reward/risk based on TP1.
   */
  setPerformanceCard(
    cards[2],
    "Avg Planned R",
    p.averagePlannedR === null
      ? "N/A"
      : `1:${p.averagePlannedR.toFixed(2)}`,
    p.averagePlannedR === null
      ? "No valid active setup"
      : `Range 1:${p.minPlannedR!.toFixed(2)}–1:${p.maxPlannedR!.toFixed(2)}`,
    p.averagePlannedR === null
      ? 0
      : Math.min(
          100,
          p.averagePlannedR * 25,
        ),
    p.averagePlannedR !== null
      ? "up"
      : "",
  );

  /*
   * CARD 4
   *
   * Realized R when closed trades exist.
   * Otherwise show average signal quality.
   *
   * This avoids inventing P&L.
   */
  if (p.realizedCount > 0) {
    setPerformanceCard(
      cards[3],
      "Total R",
      `${p.totalR >= 0 ? "+" : ""}${p.totalR.toFixed(2)}R`,
      `Avg ${p.averageR === null ? "N/A" : `${p.averageR >= 0 ? "+" : ""}${p.averageR.toFixed(2)}R`} · ${p.wins}W / ${p.losses}L`,
      Math.min(
        100,
        Math.abs(p.totalR) * 3,
      ),
      p.totalR >= 0
        ? "up"
        : "down",
    );
  } else {
    setPerformanceCard(
      cards[3],
      "Avg Setup Score",
      p.averageScore === null
        ? "N/A"
        : `${p.averageScore.toFixed(1)}/100`,
      p.averageScore === null
        ? "No score data"
        : `${p.strongSetups} strong setups ≥70`,
      p.averageScore ?? 0,
      p.averageScore !== null &&
      p.averageScore >= 70
        ? "up"
        : "",
    );
  }

  /*
   * CARD 5
   *
   * Realized Profit Factor if enough data exists.
   * Otherwise show active setup quality.
   */
  if (p.realizedCount > 0) {
    setPerformanceCard(
      cards[4],
      "Profit Factor",
      p.profitFactor === null
        ? "N/A"
        : Number.isFinite(
            p.profitFactor,
          )
          ? p.profitFactor.toFixed(2)
          : "∞",
      p.profitFactor === null
        ? "Waiting for realized wins/losses"
        : `Gross +${p.grossProfit.toFixed(2)}R / -${p.grossLoss.toFixed(2)}R`,
      p.profitFactor === null
        ? 0
        : Number.isFinite(
            p.profitFactor,
          )
          ? Math.min(
              100,
              p.profitFactor * 35,
            )
          : 100,
      p.profitFactor !== null &&
      p.profitFactor >= 1
        ? "up"
        : "down",
    );
  } else {
    setPerformanceCard(
      cards[4],
      "Risk Exposure",
      `${p.riskExposureR.toFixed(0)}R`,
      "Initial stop-distance exposure",
      Math.min(
        100,
        p.riskExposureR * 20,
      ),
      p.riskExposureR > 0
        ? "down"
        : "",
    );
  }

  /*
   * CARD 6
   *
   * Realized drawdown when available.
   * Otherwise explicitly show that the equity curve
   * has not started because no trade has closed.
   */
  if (p.realizedCount > 0) {
    setPerformanceCard(
      cards[5],
      "Max Drawdown",
      `${p.maxDrawdown.toFixed(2)}R`,
      p.averageDuration === null
        ? "Realized peak-to-trough"
        : `Peak-to-trough · avg ${formatDuration(p.averageDuration)}`,
      Math.min(
        100,
        Math.abs(p.maxDrawdown) * 20,
      ),
      p.maxDrawdown < 0
        ? "down"
        : "up",
    );
  } else {
    setPerformanceCard(
      cards[5],
      "Realized Performance",
      "PENDING",
      "Requires first closed signal",
      0,
      "",
    );
  }
  

  const heading = section.querySelector(
    ".section-head span",
  );

    if (heading) {
    heading.textContent =
      `${p.total} total · ${p.active} active · ${p.closed} closed · LIVE DATA`;
  }
}

async function refreshDashboardAnalytics(): Promise<void> {
  const recent = document.querySelector(
    ".panel.recent",
  );

  const performance = document.querySelector(
    ".performance-summary",
  );

  const perfPage = Array.from(
    document.querySelectorAll(".panel > h3"),
  ).some((h) => h.textContent?.trim() === "Win Rate");

  if (!recent && !performance && !perfPage) return;

  try {
    const signals = await loadDashboardSignals();

    await loadLivePrices(signals);

    renderRecentSignals(signals);
    renderPerformanceSummary(signals);
    renderPerformancePage(signals);
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
      if (!document.hidden) {
        void refreshDashboardAnalytics();
      }
    }, 5000);
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
    timeZone: "Asia/Kolkata",
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
      `${SIGNAL_API}/signals?limit=2000`,
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

/* ---------- Live price + Change % (vs entry) ---------- */
const livePrices: Record<string, number> = {};

const okxSymbol = (raw: unknown): string => {
  const s = String(raw ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  if (!s) return "";

  return /(USDT|USDC|BUSD|FDUSD)$/.test(s) ? s : `${s}USDT`;
};



  async function loadLivePrices(signals: DashboardSignal[]): Promise<void> {
  const want = new Set(signals.map((s) => okxSymbol(s.symbol)).filter(Boolean));
    if (want.size === 0) return;

  // 1) Ask our own server first (works on every network).
  const fresh = new Set<string>();
  try {
    const r = await fetch(`${SIGNAL_API}/prices?symbols=${[...want].join(",")}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (r.ok) {
      const body = (await r.json()) as { data?: Record<string, number> };
      for (const [k, v] of Object.entries(body.data ?? {})) {
        if (Number.isFinite(v) && v > 0) {
          livePrices[k] = v;
          fresh.add(k);
        }
      }
    }
  } catch {
    // fall back to OKX directly below
  }
  if ([...want].every((s) => fresh.has(s))) return;

  const pull = async (type: "SWAP" | "SPOT"): Promise<Record<string, number>> => {
    const out: Record<string, number> = {};
    try {
      const res = await fetch(`https://www.okx.com/api/v5/market/tickers?instType=${type}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return out;
      const body = (await res.json()) as { data?: { instId?: string; last?: string }[] };
      for (const r of body.data ?? []) {
        const m = /^(.+)-USDT(-SWAP)?$/.exec(r.instId ?? "");
        const p = Number(r.last);
        if (m && Number.isFinite(p) && p > 0) out[`${m[1]}USDT`] = p;
      }
    } catch {
      // keep the last known prices
    }
    return out;
  };

  const swap = await pull("SWAP");
  const spot = [...want].some((s) => swap[s] === undefined) ? await pull("SPOT") : {};
  for (const s of want) {
    const p = swap[s] ?? spot[s];
    if (p !== undefined) livePrices[s] = p;
  }
}

/** % move from entry. LONG: price up = +. SHORT: price down = +. */
const changePct = (signal: DashboardSignal): number | null => {
  const entry = dashboardNumber(signal.entry);
  const price = livePrices[okxSymbol(signal.symbol)];

  if (entry === null || entry <= 0 || price === undefined) {
    return null;
  }

  const raw = ((price - entry) / entry) * 100;

  return signal.side === "SHORT" ? -raw : raw;
};

const hitTimeLines = (signal: DashboardSignal): string => {
  const st = String(signal.status ?? "");
  if (!/_HIT$/.test(st)) return "";
  const hits = (signal.hits ?? {}) as Record<string, number | undefined>;
  const line = (txt: string): string =>
    `<small style="display:block;font-weight:500;opacity:.8">${dashboardEscape(txt)}</small>`;

  let out = "";

  if (st === "TP1_HIT" || st === "TP2_HIT" || st === "TP3_HIT") {
        const cur = st.slice(0, 3).toLowerCase();
    const curTime = hits[cur];
    if (typeof curTime === "number") out += line(formatCreated(curTime));
    for (const k of ["tp1", "tp2", "tp3"] as const) {
      const ht = hits[k];
      if (k !== cur && typeof ht === "number") {
        out += line(`${k.toUpperCase()} · ${formatCreated(ht)}`);
      }
    }
  } else {
    const t = hits[st.replace("_HIT", "").toLowerCase()] ?? signal.outcomeAt;
    if (typeof t === "number") out += line(formatCreated(t));
  }

  return out;
};

const isTrailHit = (signal: DashboardSignal): boolean => {
  const st = String(signal.status ?? "");
  return (
    signal.outcomeClosed === true &&
    (st === "TP1_HIT" || st === "TP2_HIT") &&
    typeof signal.trailStop === "number"
  );
};

const trailHitLine = (signal: DashboardSignal): string => {
  if (!isTrailHit(signal)) return "";
  const at = Number(signal.outcomeAt);
  const txt = Number.isFinite(at) && at > 0 ? formatCreated(at) : "";
  if (txt === "") return "";
  return `<small style="display:block;font-weight:500;opacity:.8">${dashboardEscape(txt)}</small>`;
};

function renderPerformancePage(signals: DashboardSignal[]): void {
  const panels = Array.from(
    document.querySelectorAll<HTMLElement>(".panel"),
  );

  const byTitle = (re: RegExp): HTMLElement | undefined =>
    panels.find((p) => {
      const h = p.querySelector(":scope > h3");
      return !!h && re.test(h.textContent?.trim() ?? "");
    });

  const winPanel = byTitle(/^Win Rate$/i);
  if (!winPanel) return;

  const avgPanel = byTitle(/^Average (R|Risk Reward)/i);
  const ddPanel = byTitle(/^Drawdown/i);
  const sumPanel = panels.find(
    (p) =>
      p.querySelector(":scope > h3")?.textContent?.trim() ===
        "Performance Summary" && !p.classList.contains("performance-summary"),
  );

  if (!document.getElementById("cg-perf-live-style")) {
    const st = document.createElement("style");
    st.id = "cg-perf-live-style";
    st.textContent = `
      .score-circle[data-perf]{--perf-track:#17314b;background:conic-gradient(var(--perf-col) 0 var(--perf-pct),var(--perf-track) var(--perf-pct))!important}
      html[data-theme=light] .score-circle[data-perf]{--perf-track:#d3deeb}
    `;
    document.head.appendChild(st);
  }

  const p = calculatePerformance(signals);

  // Same definition as the Accuracy card: any TP hit = win, SL hit = loss
  const winCount = signals.filter((s) =>
    ["TP1_HIT", "TP2_HIT", "TP3_HIT"].includes(s.status ?? ""),
  ).length;
  const lossCount = signals.filter((s) => s.status === "SL_HIT").length;
  const winRateByStatus =
    winCount + lossCount > 0 ? winCount / (winCount + lossCount) : null;

  const realizedList = signals
    .filter(isClosedSignal)
    .map(realizedR)
    .filter((r): r is number => r !== null && Number.isFinite(r));

  const best = realizedList.length ? Math.max(...realizedList) : null;

  const fmt = (n: number | null, d = 2): string =>
    n === null || !Number.isFinite(n)
      ? "—"
      : `${n >= 0 ? "+" : ""}${n.toFixed(d)} Risk Reward`;

  const num = (n: number | null, d = 2): string =>
    n === null || !Number.isFinite(n)
      ? "—"
      : `${n >= 0 ? "+" : ""}${n.toFixed(d)}`;

  const setText = (el: Element | null | undefined, t: string, cls?: string) => {
    if (!el) return;
    if (el.textContent !== t) el.textContent = t;
    if (cls !== undefined) {
      el.classList.remove("up", "down");
      if (cls) el.classList.add(cls);
    }
  };

  // 1) Win Rate circle
  const circle = winPanel.querySelector<HTMLElement>(".score-circle");
  if (circle) {
    const pct =
      winRateByStatus === null ? null : Math.round(winRateByStatus * 100);
    const col =
      pct === null
        ? "#71869d"
        : pct >= 60
          ? "#1bdd90"
          : pct >= 45
            ? "#f2c94c"
            : "#ff5266";
    circle.setAttribute("data-perf", "true");
    circle.style.setProperty("--perf-col", col);
    circle.style.setProperty("--perf-pct", `${pct ?? 0}%`);
    setText(circle.querySelector("span"), pct === null ? "—" : `${pct}%`);
  }

  // 2) Average Risk Reward + Best Trade
  if (avgPanel) {
    const big = avgPanel.querySelector<HTMLElement>("div[style*='font-size']");
    if (big) {
      setText(big, num(p.averageR));
      big.style.color =
        p.averageR === null ? "" : p.averageR >= 0 ? "#19df91" : "#ff5266";
    }
    setText(
      avgPanel.querySelector(".mini-row b"),
      fmt(best, 1),
      best !== null && best < 0 ? "down" : "up",
    );
  }

  // 3) Drawdown (peak-to-trough in Risk Reward) + status
  if (ddPanel) {
    const big = ddPanel.querySelector<HTMLElement>("div[style*='font-size']");
    setText(big, p.realizedCount ? p.maxDrawdown.toFixed(2) : "—");

    const dd = Math.abs(p.maxDrawdown);
    const label = !p.realizedCount
      ? "No data"
      : dd <= 3
        ? "Healthy"
        : dd <= 6
          ? "Caution"
          : "High";
    setText(
      ddPanel.querySelector(".mini-row b"),
      label,
      label === "Healthy" ? "up" : label === "No data" ? "" : "down",
    );
  }

  // 4) Performance Summary rows
  if (sumPanel) {
    const rows = Array.from(sumPanel.querySelectorAll(".mini-row"));
    const rowVal = (re: RegExp): Element | null => {
      const r = rows.find((x) => re.test(x.querySelector("span")?.textContent?.trim() ?? ""));
      return r?.querySelector("b") ?? null;
    };

    setText(rowVal(/^Total Signals$/i), String(p.total));
    setText(rowVal(/^Winning Signals$/i), String(winCount));
    setText(rowVal(/^Losing Signals$/i), String(lossCount));
    
    setText(
      rowVal(/^Total (R|Risk Reward)$/i),
      fmt(p.realizedCount ? p.totalR : null),
      p.totalR < 0 ? "down" : "up",
    );
  }
}

let accRange: "7d" | "30d" | "all" = "all";

function recentAccuracy(signals: DashboardSignal[]) {
  const days = accRange === "7d" ? 7 : accRange === "30d" ? 30 : 0;
  const cutoff = days ? Date.now() - days * 86400000 : 0;
  const last20 = signals.filter(
    (s) => (dashboardDate(s.createdAt) ?? 0) >= cutoff,
  );
  let wins = 0;
  let losses = 0;
  let open = 0;
  let skipped = 0;

  for (const s of last20) {
    if (
      s.status === "TP1_HIT" ||
      s.status === "TP2_HIT" ||
      s.status === "TP3_HIT"
    ) wins++;
    else if (s.status === "SL_HIT") losses++;
    else if (s.status === "ACTIVE") open++;
    else skipped++; // EXPIRED / CANCELLED / unknown
  }

  const resolved = wins + losses;
  return {
    wins,
    losses,
    open,
    skipped,
    total: last20.length,
    pct: resolved > 0 ? (wins / resolved) * 100 : null,
  };
}

function renderAccuracy(
  section: Element,
  signals: DashboardSignal[],
): void {
  if (!document.getElementById("cg-acc-style")) {
    const st = document.createElement("style");
    st.id = "cg-acc-style";
    st.textContent = `
      .acc-card{display:flex;align-items:center;gap:14px;margin:4px 0 10px;padding:10px;border:1px solid #18314e;border-radius:6px;background:#07182b;--acc-track:#17314b}
      .acc-circle{width:74px;height:74px;border-radius:50%;display:grid;place-items:center;position:relative;flex:0 0 auto}
      .acc-circle:after{content:"";position:absolute;inset:7px;background:#061326;border-radius:50%}
      .acc-circle span{position:relative;z-index:1;font-size:17px;font-weight:800;color:#dce9f4}
      .acc-info{font-size:10px;color:#8ea3b9;line-height:1.7}
      .acc-info b{display:block;color:#dce9f4;font-size:12px}
      .acc-win{color:#1bdd90;font-weight:600}
      .acc-loss{color:#ff5266;font-weight:600}
      html[data-theme=light] .acc-card{background:#f7fafd;border-color:#d9e2ec;--acc-track:#d3deeb}
      html[data-theme=light] .acc-circle:after{background:#fff}
      html[data-theme=light] .acc-circle span,html[data-theme=light] .acc-info b{color:#142235}
      html[data-theme=light] .acc-info{color:#5b6b80}
    `;
    document.head.appendChild(st);
  }

  const a = recentAccuracy(signals);

  let card = section.querySelector<HTMLElement>("[data-accuracy-card]");
  if (!card) {
    card = document.createElement("div");
    card.setAttribute("data-accuracy-card", "true");
    const table = section.querySelector("table");
    table?.parentNode?.insertBefore(card, table);
  }

  const pct = a.pct;
  const shown = pct === null ? "—" : `${Math.round(pct)}%`;
  const deg = pct === null ? 0 : Math.round(pct);
  const col =
    pct === null
      ? "#71869d"
      : pct >= 70
        ? "#1bdd90"
        : pct >= 50
          ? "#f2c94c"
          : "#ff5266";

  card.className = "acc-card";
  card.innerHTML = `
    <div class="acc-circle"
         style="background:conic-gradient(${col} 0 ${deg}%,var(--acc-track) ${deg}%)">
      <span>${shown}</span>
    </div>
    <div class="acc-info">
            <b>Accuracy · ${accRange === "all" ? "all time" : "last " + accRange} · ${a.total} signals</b>
      <span class="acc-win">${a.wins} win</span> ·
      <span class="acc-loss">${a.losses} loss</span><br>
      ${a.open} active · ${a.skipped} expired/cancelled
      <div style="margin-top:6px;display:flex;gap:6px">
        ${(["7d", "30d", "all"] as const)
          .map(
            (r) =>
              `<button data-acc-range="${r}" style="padding:2px 10px;border-radius:12px;border:1px solid #18314e;font-size:10px;cursor:pointer;background:${r === accRange ? "#1bdd90" : "transparent"};color:${r === accRange ? "#04101f" : "inherit"}">${r === "all" ? "All" : r}</button>`,
          )
          .join("")}
      </div>
    </div>
  `;

  card.querySelectorAll<HTMLButtonElement>("[data-acc-range]").forEach((btn) => {
    btn.onclick = () => {
      accRange = btn.dataset.accRange as "7d" | "30d" | "all";
      renderAccuracy(section, signals);
    };
  });
}

/* ================= Signal mini charts ================= */
type MiniChart = {
  id: string;
  box: HTMLDivElement;
  chart: IChartApi;
  series: ISeriesApi<"Candlestick">;
  lines: IPriceLine[];
    lineKey: string;
  levels: number[];
    markerSet: boolean;
  gutter: HTMLDivElement;
  tags: { price: number; el: HTMLDivElement }[];
  symbol: string;
  tf: string;
  busy: boolean;
  lastFetch: number;
};

const miniCharts = new Map<string, MiniChart>();
let openId = ""; // the one extra chart (besides the latest) that is open
let latestSignalId = "";

const chartTf = (tf?: string): string => {
  const t = String(tf ?? "15m").trim();
  const m = t.match(/^(\d+)\s*([mhdMHD])$/);
  if (!m) return "15m";
  const n = m[1];
  const u = m[2].toLowerCase();
  return u === "m" ? `${n}m` : u === "h" ? `${n}H` : `${n}D`;
};

const isChartOpen = (id: string): boolean =>
  id === latestSignalId || id === openId;

function destroyMiniChart(id: string): void {
  const m = miniCharts.get(id);
  if (!m) return;
  try { m.chart.remove(); } catch { /* ignore */ }
  m.box.remove();
  miniCharts.delete(id);
}

function createMiniChart(signal: DashboardSignal): MiniChart {
  const id = String(signal.id);
  const box = document.createElement("div");
    box.style.cssText = "width:100%;height:250px;position:relative;display:flex";
  const gutter = document.createElement("div");
  const host = document.createElement("div");
  host.style.cssText = "flex:1 1 auto;min-width:0;height:250px";
  box.append(gutter, host);

  const light = document.documentElement.dataset.theme === "light";
    gutter.style.cssText =
    "flex:0 0 53px;position:relative;overflow:hidden;" +
    `background:${light ? "#F4F8FC" : "#0a2036"}`;

  const chart = createChart(host, {
    autoSize: true,
    height:250,
    layout: {
      background: { color: light ? "#FFFFFF" : "#07182b" },
      textColor: light ? "#5B6B80" : "#8ea3b9",
      fontSize: 10,
    },
    grid: {
      vertLines: { color: light ? "#E6EDF5" : "#10243b" },
      horzLines: { color: light ? "#E6EDF5" : "#10243b" },
    },
    rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.08 } },
    timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
    // view-only: no scroll, zoom, drag or drawing
    handleScroll: false,
    handleScale: false,
    crosshair: { mode: 0 },
  });

    const levels: number[] = [];
  const ref = Number(signal.entry) || 1;
  const precision = Math.min(8, Math.max(2, Math.ceil(-Math.log10(ref)) + 3));

  const series = chart.addSeries(CandlestickSeries, {
    priceFormat: { type: "price", precision, minMove: Math.pow(10, -precision) },
    // keep Entry / SL / TP1-3 inside the visible price range
    autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
      const r = original();
      if (!r || !levels.length) return r;
      return {
        ...r,
        priceRange: {
          minValue: Math.min(r.priceRange.minValue, ...levels),
          maxValue: Math.max(r.priceRange.maxValue, ...levels),
        },
      };
    },
    upColor: "#3be39a",
    downColor: "#ff5c7c",
    wickUpColor: "#3be39a",
    wickDownColor: "#ff5c7c",
    borderVisible: false,
    priceLineVisible: false,
  });

  return {
    id,
    box,
    chart,
    series,
        lines: [],
    lineKey: "",
        levels,
    gutter,
    tags: [],
    markerSet: false,
    symbol: String(signal.symbol ?? ""),
    tf: chartTf(signal.timeframe),
    busy: false,
    lastFetch: 0,
  };
}

/** Puts each left chip (SL / Entry / TP1-3) at its line's height. */
function positionTags(m: MiniChart): void {
  const pts: { el: HTMLDivElement; y: number }[] = [];
  m.tags.forEach((t) => {
    const y = m.series.priceToCoordinate(t.price);
    if (y === null) {
      t.el.style.display = "none";
      return;
    }
    t.el.style.display = "block";
    pts.push({ el: t.el, y: y as number });
  });
  pts.sort((a, b) => a.y - b.y);
  let last = -Infinity;
  pts.forEach((p) => {
    const y = Math.max(p.y, last + 16); // chips overlap na karein
    last = y;
    p.el.style.top = `${Math.round(y - 8)}px`;
  });
}

function drawSignalLines(m: MiniChart, signal: DashboardSignal): void {
  const t = Array.isArray(signal.targets) ? signal.targets : [];
  const stop =
    typeof signal.trailStop === "number" ? signal.trailStop : signal.stop;
  const key = [signal.entry, stop, t[0], t[1], t[2]].join("|");
  if (key === m.lineKey) return;
  m.lineKey = key;

    m.lines.forEach((l) => m.series.removePriceLine(l));
  m.lines = [];
  m.levels.length = 0;

  const add = (price: unknown, color: string, title: string, dashed = false) => {
    const p = Number(price);
        if (!Number.isFinite(p) || p <= 0) return;
    m.levels.push(p);
    m.lines.push(
      m.series.createPriceLine({
        price: p,
        color,
        lineWidth: 1,
        lineStyle: dashed ? LineStyle.Dashed : LineStyle.Solid,
        axisLabelVisible: true,
        title,
      }),
    );
  };

  add(signal.entry, "#3b9cff", "Entry");
  add(stop, "#ff5c7c", "SL");
  add(t[0], "#7ef0b8", "TP1", true);
  add(t[1], "#3be39a", "TP2", true);
  add(t[2], "#13b36d", "TP3", true);
}

async function refreshMiniChart(m: MiniChart, signal: DashboardSignal): Promise<void> {
  if (m.busy) return;
  m.busy = true;
  try {
    const url =
      `${SIGNAL_API}/candles?symbol=${encodeURIComponent(m.symbol)}` +
      `&timeframe=${encodeURIComponent(m.tf)}&limit=150`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as {
      data?: Array<{ timestamp: number; open: number; high: number; low: number; close: number }>;
    };

    const seen = new Set<number>();
    const data = (body.data ?? [])
      .filter((c) => Number.isFinite(c.timestamp) && Number.isFinite(c.close))
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((c) => ({
        time: Math.floor(c.timestamp / 1000) as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
      .filter((c) => (seen.has(c.time) ? false : (seen.add(c.time), true)));

        if (!data.length) return;

    // show at least the last 60 bars, and always include the signal candle
    const createdMs = dashboardDate(signal.createdAt);
    const createdSec = createdMs !== null ? Math.floor(createdMs / 1000) : 0;
    let sigIdx = 0;
    data.forEach((c, i) => {
      if (c.time <= createdSec) sigIdx = i;
    });
    const start = Math.max(0, Math.min(data.length - 60, sigIdx - 15));
    const view = data.slice(start);

    const first = m.lastFetch === 0;
    m.series.setData(view);
    m.lastFetch = Date.now();
    drawSignalLines(m, signal);
    m.series.priceScale().applyOptions({ autoScale: true });

    if (!m.markerSet) {
      const created = dashboardDate(signal.createdAt);
      if (created !== null) {
        const sec = Math.floor(created / 1000);
        let bar = data[0].time;
        for (const c of data) if (c.time <= sec) bar = c.time;
        const long = signal.side === "LONG";
        createSeriesMarkers(m.series, [
          {
            time: bar,
            position: long ? "belowBar" : "aboveBar",
            shape: long ? "arrowUp" : "arrowDown",
            color: long ? "#3be39a" : "#ff5c7c",
            text: "Signal",
          },
        ]);
        m.markerSet = true;
      }
    }

    if (first) m.chart.timeScale().fitContent();
  } catch (e) {
    console.error("signal chart:", e);
  } finally {
    m.busy = false;
  }
}

/** Called after every table rebuild: re-attaches live charts into the fresh slots. */
function syncSignalCharts(signals: DashboardSignal[]): void {
  const ids = new Set(signals.map((s) => String(s.id)));

  // drop charts whose card no longer exists or was closed
  for (const id of [...miniCharts.keys()]) {
    if (!ids.has(id) || !isChartOpen(id)) destroyMiniChart(id);
  }

  document.querySelectorAll<HTMLElement>("[data-chart-slot]").forEach((slot) => {
    const id = slot.dataset.chartSlot ?? "";
    const signal = signals.find((s) => String(s.id) === id);
        const cell = slot.parentElement as HTMLElement | null;

    if (!signal || !isChartOpen(id)) {
      if (cell) cell.style.display = "none";
      return;
    }

    if (cell) cell.style.display = "block";
    let m = miniCharts.get(id);
    if (!m) {
      m = createMiniChart(signal);
      miniCharts.set(id, m);
    }

    // move the SAME chart element into the new slot (no re-create, no flicker)
    if (m.box.parentElement !== slot) slot.appendChild(m.box);

    void refreshMiniChart(m, signal);
  });

  document.querySelectorAll<HTMLButtonElement>("[data-chart-btn]").forEach((btn) => {
    const id = btn.dataset.chartBtn ?? "";
        btn.textContent = isChartOpen(id) ? "Hide chart" : "Chart";
    const btnCell = btn.closest("td") as HTMLElement | null;
    if (btnCell) btnCell.style.display = id === latestSignalId ? "none" : "";
  });
}

// one click handler for all Chart buttons (survives table rebuilds)
document.addEventListener("click", (ev) => {
  const btn = (ev.target as HTMLElement | null)?.closest<HTMLButtonElement>("[data-chart-btn]");
  if (!btn) return;
  const id = btn.dataset.chartBtn ?? "";
  if (id === latestSignalId) return; // latest chart always stays open
  openId = openId === id ? "" : id; // opening one closes the previous one
  void refreshDashboardAnalytics();
});

function renderRecentSignals(signals: DashboardSignal[]): void {
  const section = document.querySelector(".panel.recent");

  if (!section) return;

  const tbody = section.querySelector("table tbody");

  if (!(tbody instanceof HTMLTableSectionElement)) return;

    const sortedSignals = signals
    .slice()
    .sort(
      (a, b) =>
        (dashboardDate(b.createdAt) ?? 0) -
        (dashboardDate(a.createdAt) ?? 0),
    )
    .slice(0, section.closest(".page-body") ? 20 : 10);

  latestSignalId = sortedSignals[0]?.id ? String(sortedSignals[0].id) : "";

  const rows = sortedSignals
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
        status === "ACTIVE" ||
        status === "CLOSED" ||
        status === "TP1_HIT" ||
        status === "TP2_HIT" ||
        status === "TP3_HIT"
          ? "up"
          : status === "CANCELLED" ||
              status === "EXPIRED" ||
              status === "SL_HIT"
            ? "down"
            : "";

      const symbol = (signal.symbol ?? "")
        .replace(/USDT$/i, "/USDT")
        .replace(/USDC$/i, "/USDC");

      const targets = Array.isArray(signal.targets)
        ? signal.targets
        : [];

            const chg =
        status === "ACTIVE" && !signal.entered ? null : changePct(signal);

            const chgClass =
        chg === null ? "" : chg >= 0 ? "up" : "down";

      const trailClass =
        typeof signal.trailStop === "number"
          ? isTrailHit(signal)
            ? ' class="trail-sl trail-hit"'
            : ' class="trail-sl"'
          : "";

      return `
        <tr>
          <td>
            <strong>${dashboardEscape(symbol || "—")}</strong>
            <small style="display:block;opacity:.55">
              ${dashboardEscape(signal.timeframe ?? "—")}
            </small>
          </td>

          <td>
            <strong>${dashboardEscape(dashboardPrice(livePrices[okxSymbol(signal.symbol)]))}</strong>
          </td>

          <td class="${sideClass}">
            ${dashboardEscape(side)}
          </td>

          <td>
            ${dashboardEscape(dashboardPrice(signal.entry))}
          </td>

          <td${trailClass}>
                        ${dashboardEscape(dashboardPrice(typeof signal.trailStop === "number" ? signal.trailStop : signal.stop))}
            ${trailHitLine(signal)}
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
            ${dashboardEscape(
              status === "ACTIVE" && !signal.entered
                ? "PENDING"
                : (STATUS_LABEL[status] ?? status),
            )}
            ${hitTimeLines(signal)}
          </td>

          <td>
            ${rr === null ? "—" : `1:${rr.toFixed(2)}`}
          </td>

          <td class="${chgClass}">
            ${chg === null ? "—" : dashboardPercent(chg)}
          </td>

  <td>
            ${dashboardEscape(formatCreated(signal.createdAt))}
          </td>

                    <td class="sig-chart-cell" style="display:none">
            <div class="sig-chart-slot" data-chart-slot="${dashboardEscape(signal.id)}"></div>
          </td>

          <td class="sig-btn-cell">
            <button type="button" class="sig-chart-btn" data-chart-btn="${dashboardEscape(signal.id)}">Chart</button>
          </td>
        </tr>
      `;
    })
    .join("");

  tbody.innerHTML =
    rows ||
    `
      <tr>
        <td colspan="12" style="text-align:center;opacity:.65">
          No signals available
        </td>
      </tr>
    `;

    syncSignalCharts(sortedSignals);

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

    const closed = signals.filter(isClosedSignal).length;

    meta.textContent =
      `LIVE · ${signals.length} loaded · ${active} active · ${closed} closed`;
  }

  renderAccuracy(section, signals);
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
