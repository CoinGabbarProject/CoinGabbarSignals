import type { Candle } from "./market.js";
export type Direction = "up"|"down"|"flat";
export interface IndicatorResult<T=number> { value:T; slope:Direction; direction:Direction; relationship?:string; }
export interface RSIResult extends IndicatorResult { zone:"oversold"|"neutral"|"overbought"; momentum:"weakening"|"neutral"|"strengthening"; }
export interface MACDResult { macd:number; signal:number; histogram:number; crossover:"bullish"|"bearish"|"none"; histogramState:"expanding"|"contracting"|"flat"; zeroLine:"above"|"below"; momentum:Direction; }
export interface BollingerResult { middle:number; upper:number; lower:number; bandwidth:number; direction:Direction; context:"inside"|"upper-band"|"lower-band"|"breakout"; }
export interface ATRResult extends IndicatorResult { }
export interface VWAPResult extends IndicatorResult { }
