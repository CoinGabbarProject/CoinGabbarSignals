import { tokens } from "../../../../shared/designTokens.js";
import type { DashStyle, Drawing } from "./model.js";

const k = tokens.color;

export type Shape =
  | { t: "line"; x1: number; y1: number; x2: number; y2: number; color: string; w: number; dash?: number[] }
  | { t: "path"; pts: Array<[number, number]>; color: string; w: number; dash?: number[] }
  | { t: "box"; x: number; y: number; w: number; h: number; color: string; alpha: number; stroke?: string }
  | { t: "poly"; pts: Array<[number, number]>; color: string; alpha: number }
  | { t: "ell"; cx: number; cy: number; rx: number; ry: number; color: string; alpha: number; w: number }
  | { t: "text"; x: number; y: number; text: string; color: string; align?: CanvasTextAlign; size?: number; bg?: string };

/** Pixel projection supplied by the primitive. x/y return NaN when the chart cannot map the value. */
export interface Proj { x(time: number): number; y(price: number): number; W: number; H: number; period: number }

export const RET_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;
export const EXT_LEVELS = [0, 0.618, 1, 1.272, 1.618, 2, 2.618] as const;
const TIME_ZONES = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55] as const;
const LVL_COLORS = [k.neutral.base, k.negative.base, k.warning.base, k.positive.base, k.accent.primary, k.accent.secondary, k.neutral.base, k.warning.base];
const DASH: Record<DashStyle, number[] | undefined> = { solid: undefined, dashed: [6, 4], dotted: [2, 3] };

export const fmtPrice = (p: number): string => (Math.abs(p) >= 100 ? p.toFixed(2) : Math.abs(p) >= 1 ? p.toFixed(4) : p.toFixed(6));
const pct = (a: number, b: number): string => (a === 0 ? "0.00" : (((b - a) / a) * 100).toFixed(2));
const fmtDur = (sec: number): string => {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
};

interface Pt { x: number; y: number; time: number; price: number }

function line(x1: number, y1: number, x2: number, y2: number, color: string, w = 1.5, dash?: number[]): Shape {
  return dash ? { t: "line", x1, y1, x2, y2, color, w, dash } : { t: "line", x1, y1, x2, y2, color, w };
}

/** Extend p1→p2 to the plot edges (one side, or both). */
function extend(p1: Pt, p2: Pt, W: number, both: boolean, color: string, w: number, dash?: number[]): Shape {
  const dx = p2.x - p1.x;
  if (Math.abs(dx) < 1e-6) return line(p1.x, both ? -1e4 : p1.y, p1.x, p2.y >= p1.y ? 1e4 : -1e4, color, w, dash);
  const slope = (p2.y - p1.y) / dx;
  const toX = dx > 0 ? W + 50 : -50;
  const fromX = both ? (dx > 0 ? -50 : W + 50) : p1.x;
  return line(fromX, p1.y + slope * (fromX - p1.x), toX, p1.y + slope * (toX - p1.x), color, w, dash);
}

function arrowHead(a: Pt, b: Pt, color: string, w: number): Shape[] {
  const th = Math.atan2(b.y - a.y, b.x - a.x), L = 9 + w * 2;
  return [-2.6, 2.6].map((d) => line(b.x, b.y, b.x + L * Math.cos(th + d), b.y + L * Math.sin(th + d), color, w));
}

function fibShapes(pts: Pt[], P: Proj, kind: "fib" | "fibext"): Shape[] {
  const out: Shape[] = [];
  const levels: readonly number[] = kind === "fib" ? RET_LEVELS : EXT_LEVELS;
  const [a, b, c] = pts;
  if (!a || !b || (kind === "fibext" && !c)) return out;
  let xl: number, xr: number, priceAt: (l: number) => number;
  if (kind === "fib") {
    xl = Math.min(a.x, b.x); xr = Math.max(Math.max(a.x, b.x), xl + 90);
    priceAt = (l) => b.price + (a.price - b.price) * l; // 0 at the end point, 1 at the start point
    out.push(line(a.x, a.y, b.x, b.y, k.neutral.base, 1, [4, 4]));
  } else {
    if (!c) return out;
    xl = c.x; xr = Math.max(P.W, c.x + 120);
    priceAt = (l) => c.price + (b.price - a.price) * l;
    out.push(line(a.x, a.y, b.x, b.y, k.neutral.base, 1, [4, 4]), line(b.x, b.y, c.x, c.y, k.neutral.base, 1, [4, 4]));
  }
  const ys = levels.map((l) => P.y(priceAt(l)));
  levels.forEach((l, i) => {
    const y = ys[i], color = LVL_COLORS[i % LVL_COLORS.length] ?? k.neutral.base;
    if (y === undefined || !Number.isFinite(y)) return;
    const next = ys[i + 1];
    if (next !== undefined && Number.isFinite(next)) out.push({ t: "box", x: xl, y: Math.min(y, next), w: xr - xl, h: Math.abs(next - y), color, alpha: 0.07 });
    out.push(line(xl, y, xr, y, color, 1));
    out.push({ t: "text", x: xl + 4, y: y - 5, text: `${l} (${fmtPrice(priceAt(l))})`, color });
  });
  return out;
}

export function shapesFor(d: Drawing, P: Proj): Shape[] {
  const pts: Pt[] = d.anchors.map((a) => ({ x: P.x(a.time), y: P.y(a.price), time: a.time, price: a.price }));
  if (pts.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return [];
  const [a, b, c] = pts;
  if (!a) return [];
  const col = d.style?.color ?? k.accent.primary;
  const w = d.style?.width ?? 2;
  const dash = DASH[d.style?.dash ?? "solid"];
  const up = (b?.price ?? 0) >= a.price;
  const dir = up ? k.positive.base : k.negative.base;

  switch (d.kind) {
    case "trend": return b ? [line(a.x, a.y, b.x, b.y, col, w, dash)] : [];
    case "ray": return b ? [extend(a, b, P.W, false, col, w, dash)] : [];
    case "extended": return b ? [extend(a, b, P.W, true, col, w, dash)] : [];
    case "arrow": return b ? [line(a.x, a.y, b.x, b.y, col, w, dash), ...arrowHead(a, b, col, w)] : [];
    case "info": {
      if (!b) return [];
      const bars = Math.round(Math.abs(b.time - a.time) / P.period);
      const ang = (Math.atan2(a.y - b.y, b.x - a.x) * 180) / Math.PI;
      return [line(a.x, a.y, b.x, b.y, col, w, dash), { t: "text", x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 8, align: "center", color: col, bg: k.bg.elevated,
        text: `${up ? "+" : ""}${fmtPrice(b.price - a.price)} (${up ? "+" : ""}${pct(a.price, b.price)}%) · ${bars} bars · ${ang.toFixed(0)}°` }];
    }
    case "angle": {
      if (!b) return [];
      const ang = (Math.atan2(a.y - b.y, b.x - a.x) * 180) / Math.PI;
      return [line(a.x, a.y, b.x, b.y, col, w, dash), line(a.x, a.y, b.x, a.y, k.neutral.base, 1, [4, 4]),
        { t: "text", x: a.x + 10, y: a.y - 6, text: `${ang.toFixed(1)}°`, color: col }];
    }
    case "hline": return [line(0, a.y, P.W, a.y, col, w, dash), { t: "text", x: P.W - 4, y: a.y - 5, text: fmtPrice(a.price), color: col, align: "right" }];
    case "hray": return [line(a.x, a.y, P.W, a.y, col, w, dash), { t: "text", x: P.W - 4, y: a.y - 5, text: fmtPrice(a.price), color: col, align: "right" }];
    case "vline": return [line(a.x, 0, a.x, P.H, col, Math.min(w, 2), dash ?? [6, 4])];
    case "cross": return [line(0, a.y, P.W, a.y, col, 1, dash ?? [4, 4]), line(a.x, 0, a.x, P.H, col, 1, dash ?? [4, 4])];
    case "fib": case "fibext": return fibShapes(pts, P, d.kind);
    case "fibtime": {
      if (!b || Math.abs(b.x - a.x) < 1) return [];
      const out: Shape[] = [];
      for (const n of TIME_ZONES) {
        const x = a.x + (b.x - a.x) * n;
        if (x < -50 || x > P.W + 50) continue;
        out.push(line(x, 0, x, P.H, n === 0 || n === 1 ? k.accent.primary : k.neutral.base, 1, [4, 4]), { t: "text", x: x + 3, y: 12, text: String(n), color: k.neutral.base });
      }
      return out;
    }
    case "channel": {
      if (!b || !c || Math.abs(b.x - a.x) < 1) return b ? [line(a.x, a.y, b.x, b.y, col, w, dash)] : [];
      const dy = c.y - (a.y + ((b.y - a.y) / (b.x - a.x)) * (c.x - a.x));
      return [
        { t: "poly", pts: [[a.x, a.y], [b.x, b.y], [b.x, b.y + dy], [a.x, a.y + dy]], color: col, alpha: 0.1 },
        line(a.x, a.y, b.x, b.y, col, w, dash), line(a.x, a.y + dy, b.x, b.y + dy, col, w, dash),
        line(a.x, a.y + dy / 2, b.x, b.y + dy / 2, k.neutral.base, 1, [4, 4]),
      ];
    }
    case "pitchfork": {
      if (!b || !c) return [];
      const vx = (b.x + c.x) / 2 - a.x, vy = (b.y + c.y) / 2 - a.y;
      if (Math.abs(vx) < 1e-6) return [line(b.x, b.y, c.x, c.y, col, w, dash)];
      const toX = vx > 0 ? P.W + 50 : -50;
      const end = (p: Pt): [number, number] => [toX, p.y + (vy / vx) * (toX - p.x)];
      const eb = end(b), ec = end(c);
      return [
        { t: "poly", pts: [[b.x, b.y], eb, ec, [c.x, c.y]], color: col, alpha: 0.08 },
        line(a.x, a.y, ...end(a), col, w, dash), line(b.x, b.y, eb[0], eb[1], col, w, dash), line(c.x, c.y, ec[0], ec[1], col, w, dash),
        line(b.x, b.y, c.x, c.y, k.neutral.base, 1, [4, 4]),
      ];
    }
    case "rect": return b ? [{ t: "box", x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y), color: col, alpha: 0.14, stroke: col }] : [];
    case "ellipse": return b ? [{ t: "ell", cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, rx: Math.abs(b.x - a.x) / 2, ry: Math.abs(b.y - a.y) / 2, color: col, alpha: 0.14, w }] : [];
    case "triangle": return b && c ? [
      { t: "poly", pts: [[a.x, a.y], [b.x, b.y], [c.x, c.y]], color: col, alpha: 0.14 },
      { t: "path", pts: [[a.x, a.y], [b.x, b.y], [c.x, c.y], [a.x, a.y]], color: col, w, ...(dash ? { dash } : {}) },
    ] : [];
    case "brush": return [{ t: "path", pts: pts.map((p): [number, number] => [p.x, p.y]), color: col, w, ...(dash ? { dash } : {}) }];
    case "measure": {
      if (!b) return [];
      const bars = Math.round(Math.abs(b.time - a.time) / P.period);
      return [
        { t: "box", x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y), color: dir, alpha: 0.12 },
        line(a.x, a.y, b.x, b.y, dir, 1.5), ...arrowHead(a, b, dir, 1.5),
        { t: "text", x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 6, color: dir, align: "center", bg: k.bg.elevated,
          text: `${up ? "+" : ""}${fmtPrice(b.price - a.price)} (${up ? "+" : ""}${pct(a.price, b.price)}%) · ${bars} bars` },
      ];
    }
    case "pricerange": {
      if (!b) return [];
      const mx = (a.x + b.x) / 2, tip: Pt = { ...b, x: mx }, from: Pt = { ...a, x: mx };
      return [
        { t: "box", x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y), color: dir, alpha: 0.12 },
        line(mx, a.y, mx, b.y, dir, 1.5), ...arrowHead(from, tip, dir, 1.5),
        { t: "text", x: mx, y: Math.min(a.y, b.y) - 6, color: dir, align: "center", bg: k.bg.elevated, text: `${up ? "+" : ""}${fmtPrice(b.price - a.price)} (${up ? "+" : ""}${pct(a.price, b.price)}%)` },
      ];
    }
    case "daterange": {
      if (!b) return [];
      const my = (a.y + b.y) / 2, from: Pt = { ...a, y: my }, tip: Pt = { ...b, y: my };
      const bars = Math.round(Math.abs(b.time - a.time) / P.period);
      return [
        { t: "box", x: Math.min(a.x, b.x), y: 0, w: Math.abs(b.x - a.x), h: P.H, color: k.accent.primary, alpha: 0.07 },
        line(a.x, 0, a.x, P.H, k.neutral.base, 1, [4, 4]), line(b.x, 0, b.x, P.H, k.neutral.base, 1, [4, 4]),
        line(a.x, my, b.x, my, k.accent.primary, 1.5), ...arrowHead(from, tip, k.accent.primary, 1.5),
        { t: "text", x: (a.x + b.x) / 2, y: my - 6, color: k.accent.primary, align: "center", bg: k.bg.elevated, text: `${bars} bars · ${fmtDur(Math.abs(b.time - a.time))}` },
      ];
    }
    case "long": case "short": {
      if (!b || !c) return [];
      const xr = Math.max(a.x + 60, b.x, c.x);
      const risk = Math.abs(a.price - c.price), reward = Math.abs(b.price - a.price);
      const rr = risk > 0 ? reward / risk : 0;
      return [
        { t: "box", x: a.x, y: Math.min(a.y, c.y), w: xr - a.x, h: Math.abs(c.y - a.y), color: k.negative.base, alpha: 0.18, stroke: k.negative.base },
        { t: "box", x: a.x, y: Math.min(a.y, b.y), w: xr - a.x, h: Math.abs(b.y - a.y), color: k.positive.base, alpha: 0.18, stroke: k.positive.base },
        line(a.x, a.y, xr, a.y, k.text.primary, 1.5),
        { t: "text", x: a.x + 4, y: a.y - 5, color: k.text.primary, text: `${d.kind === "long" ? "LONG" : "SHORT"} · R:R ${rr.toFixed(2)} · Entry ${fmtPrice(a.price)}` },
        { t: "text", x: a.x + 4, y: b.y + (b.y < a.y ? 12 : -5), color: k.positive.base, text: `TP ${fmtPrice(b.price)} (${pct(a.price, b.price)}%)` },
        { t: "text", x: a.x + 4, y: c.y + (c.y < a.y ? 12 : -5), color: k.negative.base, text: `SL ${fmtPrice(c.price)} (${pct(a.price, c.price)}%)` },
      ];
    }
    case "text": return [{ t: "text", x: a.x, y: a.y, text: d.text || "Text", color: col, size: 13 }];
    case "label": return [{ t: "text", x: a.x + 6, y: a.y + 4, text: d.text || fmtPrice(a.price), color: k.text.inverse, bg: col }];
    case "flag": return [{ t: "text", x: a.x - 3, y: a.y, text: "⚑", color: col, size: 20 }];
    case "arrowup": return [{ t: "text", x: a.x, y: a.y + 16, text: "▲", color: k.positive.base, size: 18, align: "center" }];
    case "arrowdown": return [{ t: "text", x: a.x, y: a.y - 4, text: "▼", color: k.negative.base, size: 18, align: "center" }];
  }
}

export function renderShapes(ctx: CanvasRenderingContext2D, shapes: readonly Shape[]): void {
  for (const s of shapes) {
    ctx.save();
    if (s.t === "line") {
      ctx.strokeStyle = s.color; ctx.lineWidth = s.w; ctx.setLineDash(s.dash ?? []);
      ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke();
    } else if (s.t === "path") {
      ctx.strokeStyle = s.color; ctx.lineWidth = s.w; ctx.setLineDash(s.dash ?? []); ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.beginPath(); s.pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y))); ctx.stroke();
    } else if (s.t === "box") {
      ctx.globalAlpha = s.alpha; ctx.fillStyle = s.color; ctx.fillRect(s.x, s.y, s.w, s.h);
      if (s.stroke) { ctx.globalAlpha = 1; ctx.strokeStyle = s.stroke; ctx.lineWidth = 1.5; ctx.strokeRect(s.x, s.y, s.w, s.h); }
    } else if (s.t === "poly") {
      ctx.globalAlpha = s.alpha; ctx.fillStyle = s.color; ctx.beginPath();
      s.pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.closePath(); ctx.fill();
    } else if (s.t === "ell") {
      ctx.beginPath(); ctx.ellipse(s.cx, s.cy, Math.max(s.rx, 0.5), Math.max(s.ry, 0.5), 0, 0, Math.PI * 2);
      ctx.globalAlpha = s.alpha; ctx.fillStyle = s.color; ctx.fill();
      ctx.globalAlpha = 1; ctx.strokeStyle = s.color; ctx.lineWidth = s.w; ctx.stroke();
    } else {
      const size = s.size ?? 11;
      ctx.font = `${size}px ${tokens.font.family.mono}`; ctx.textAlign = s.align ?? "left";
      if (s.bg) {
        const tw = ctx.measureText(s.text).width;
        const x0 = s.align === "right" ? s.x - tw : s.align === "center" ? s.x - tw / 2 : s.x;
        ctx.fillStyle = s.bg; ctx.globalAlpha = 0.85; ctx.fillRect(x0 - 3, s.y - size - 1, tw + 6, size + 6); ctx.globalAlpha = 1;
      }
      ctx.fillStyle = s.color; ctx.fillText(s.text, s.x, s.y);
    }
    ctx.restore();
  }
}

const distToSeg = (px: number, py: number, x1: number, y1: number, x2: number, y2: number): number => {
  const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
};

/** True when (x, y) is on a line/path, inside a stroked box or ellipse, or on a text label. */
export function hitShapes(shapes: readonly Shape[], x: number, y: number, tol = 9): boolean {
  return shapes.some((s) => {
    if (s.t === "line") return distToSeg(x, y, s.x1, s.y1, s.x2, s.y2) <= tol;
    if (s.t === "path") return s.pts.some((p, i) => { const q = s.pts[i + 1]; return !!q && distToSeg(x, y, p[0], p[1], q[0], q[1]) <= tol; });
    if (s.t === "box") return !!s.stroke && x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h;
    if (s.t === "ell") return s.rx > 0 && s.ry > 0 && ((x - s.cx) / s.rx) ** 2 + ((y - s.cy) / s.ry) ** 2 <= 1.1;
    if (s.t === "text") {
      const size = s.size ?? 11, tw = s.text.length * size * 0.62;
      const left = s.align === "right" ? s.x - tw : s.align === "center" ? s.x - tw / 2 : s.x;
      return x >= left - 4 && x <= left + tw + 4 && y >= s.y - size - 2 && y <= s.y + 6;
    }
    return false;
  });
}
