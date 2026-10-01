import { tokens } from "../../../../shared/designTokens.js";
import type { Drawing } from "./model.js";

const k = tokens.color;

export type Shape =
  | { t: "line"; x1: number; y1: number; x2: number; y2: number; color: string; w: number; dash?: number[] }
  | { t: "box"; x: number; y: number; w: number; h: number; color: string; alpha: number; stroke?: string }
  | { t: "poly"; pts: Array<[number, number]>; color: string; alpha: number }
  | { t: "text"; x: number; y: number; text: string; color: string; align?: CanvasTextAlign };

/** Pixel projection supplied by the primitive. x/y return NaN when the chart cannot map the value. */
export interface Proj { x(time: number): number; y(price: number): number; W: number; H: number; period: number }

export const RET_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;
export const EXT_LEVELS = [0, 0.618, 1, 1.272, 1.618, 2, 2.618] as const;
const LVL_COLORS = [k.neutral.base, k.negative.base, k.warning.base, k.positive.base, k.accent.primary, k.accent.secondary, k.neutral.base, k.warning.base];

export const fmtPrice = (p: number): string => (Math.abs(p) >= 100 ? p.toFixed(2) : Math.abs(p) >= 1 ? p.toFixed(4) : p.toFixed(6));
const pct = (a: number, b: number): string => (a === 0 ? "0.00" : (((b - a) / a) * 100).toFixed(2));

interface Pt { x: number; y: number; time: number; price: number }

function line(x1: number, y1: number, x2: number, y2: number, color: string, w = 1.5, dash?: number[]): Shape {
  return dash ? { t: "line", x1, y1, x2, y2, color, w, dash } : { t: "line", x1, y1, x2, y2, color, w };
}

/** Extend p1→p2 to the plot edges. */
function extend(p1: Pt, p2: Pt, W: number, both: boolean, color: string): Shape {
  const dx = p2.x - p1.x;
  if (Math.abs(dx) < 1e-6) return line(p1.x, both ? -1e4 : p1.y, p1.x, p2.y >= p1.y ? 1e4 : -1e4, color);
  const slope = (p2.y - p1.y) / dx;
  const toX = dx > 0 ? W + 50 : -50;
  const fromX = both ? (dx > 0 ? -50 : W + 50) : p1.x;
  return line(fromX, p1.y + slope * (fromX - p1.x), toX, p1.y + slope * (toX - p1.x), color);
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
  const accent = k.accent.primary;

  switch (d.kind) {
    case "trend": return b ? [line(a.x, a.y, b.x, b.y, accent, 2)] : [];
    case "ray": return b ? [extend(a, b, P.W, false, accent)] : [];
    case "extended": return b ? [extend(a, b, P.W, true, accent)] : [];
    case "hline": return [line(0, a.y, P.W, a.y, k.warning.base, 1.5), { t: "text", x: P.W - 4, y: a.y - 5, text: fmtPrice(a.price), color: k.warning.base, align: "right" }];
    case "vline": return [line(a.x, 0, a.x, P.H, k.neutral.base, 1.5, [6, 4])];
    case "fib": case "fibext": return fibShapes(pts, P, d.kind);
    case "rect": return b ? [{ t: "box", x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y), color: accent, alpha: 0.14, stroke: accent }] : [];
    case "channel": {
      if (!b || !c || Math.abs(b.x - a.x) < 1) return b ? [line(a.x, a.y, b.x, b.y, accent, 2)] : [];
      const dy = c.y - (a.y + ((b.y - a.y) / (b.x - a.x)) * (c.x - a.x));
      return [
        { t: "poly", pts: [[a.x, a.y], [b.x, b.y], [b.x, b.y + dy], [a.x, a.y + dy]], color: accent, alpha: 0.1 },
        line(a.x, a.y, b.x, b.y, accent, 2), line(a.x, a.y + dy, b.x, b.y + dy, accent, 2),
        line(a.x, a.y + dy / 2, b.x, b.y + dy / 2, k.neutral.base, 1, [4, 4]),
      ];
    }
    case "measure": {
      if (!b) return [];
      const up = b.price >= a.price, color = up ? k.positive.base : k.negative.base;
      const bars = Math.round(Math.abs(b.time - a.time) / P.period);
      return [
        { t: "box", x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y), color, alpha: 0.12 },
        line(a.x, a.y, b.x, b.y, color, 1.5),
        { t: "text", x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 6, color, align: "center", text: `${up ? "+" : ""}${fmtPrice(b.price - a.price)} (${up ? "+" : ""}${pct(a.price, b.price)}%) · ${bars} bars` },
      ];
    }
    case "position": {
      if (!b || !c) return [];
      const xr = Math.max(a.x + 60, Math.max(a.x, b.x));
      const risk = Math.abs(a.price - b.price), reward = Math.abs(c.price - a.price);
      const rr = risk > 0 ? reward / risk : 0;
      const side = c.price >= a.price ? "LONG" : "SHORT";
      return [
        { t: "box", x: a.x, y: Math.min(a.y, b.y), w: xr - a.x, h: Math.abs(b.y - a.y), color: k.negative.base, alpha: 0.18, stroke: k.negative.base },
        { t: "box", x: a.x, y: Math.min(a.y, c.y), w: xr - a.x, h: Math.abs(c.y - a.y), color: k.positive.base, alpha: 0.18, stroke: k.positive.base },
        line(a.x, a.y, xr, a.y, k.text.primary, 1.5),
        { t: "text", x: a.x + 4, y: a.y - 5, color: k.text.primary, text: `${side} · R:R ${rr.toFixed(2)} · Entry ${fmtPrice(a.price)}` },
        { t: "text", x: a.x + 4, y: c.y + (c.y < a.y ? 12 : -5), color: k.positive.base, text: `TP ${fmtPrice(c.price)} (${pct(a.price, c.price)}%)` },
        { t: "text", x: a.x + 4, y: b.y + (b.y < a.y ? 12 : -5), color: k.negative.base, text: `SL ${fmtPrice(b.price)} (${pct(a.price, b.price)}%)` },
      ];
    }
    case "text": return [{ t: "text", x: a.x, y: a.y, text: d.text || "Text", color: k.text.primary }];
  }
}

export function renderShapes(ctx: CanvasRenderingContext2D, shapes: readonly Shape[]): void {
  for (const s of shapes) {
    ctx.save();
    if (s.t === "line") {
      ctx.strokeStyle = s.color; ctx.lineWidth = s.w; ctx.setLineDash(s.dash ?? []);
      ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke();
    } else if (s.t === "box") {
      ctx.globalAlpha = s.alpha; ctx.fillStyle = s.color; ctx.fillRect(s.x, s.y, s.w, s.h);
      if (s.stroke) { ctx.globalAlpha = 1; ctx.strokeStyle = s.stroke; ctx.lineWidth = 1.5; ctx.strokeRect(s.x, s.y, s.w, s.h); }
    } else if (s.t === "poly") {
      ctx.globalAlpha = s.alpha; ctx.fillStyle = s.color; ctx.beginPath();
      s.pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.closePath(); ctx.fill();
    } else {
      ctx.font = `11px ${tokens.font.family.mono}`; ctx.textAlign = s.align ?? "left"; ctx.fillStyle = s.color;
      ctx.fillText(s.text, s.x, s.y);
    }
    ctx.restore();
  }
}

const distToSeg = (px: number, py: number, x1: number, y1: number, x2: number, y2: number): number => {
  const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
};

/** True when (x, y) is on a line, inside a stroked box, or on a text label. */
export function hitShapes(shapes: readonly Shape[], x: number, y: number, tol = 9): boolean {
  return shapes.some((s) => {
    if (s.t === "line") return distToSeg(x, y, s.x1, s.y1, s.x2, s.y2) <= tol;
    if (s.t === "box") return !!s.stroke && x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h;
    if (s.t === "text") {
      const w = s.text.length * 6.6, left = s.align === "right" ? s.x - w : s.align === "center" ? s.x - w / 2 : s.x;
      return x >= left && x <= left + w && y >= s.y - 12 && y <= s.y + 4;
    }
    return false;
  });
}
