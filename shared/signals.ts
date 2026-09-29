import type { Timeframe } from "./market.js";
export type SignalSide = "LONG"|"SHORT"|"NO_TRADE";
export type SignalStatus = "ACTIVE"|"CLOSED"|"CANCELLED"|"EXPIRED";
export interface SignalLevel { label:"ENTRY"|"STOP"|"TP1"|"TP2"|"TP3"; price:number; }
export interface Signal {
  id:string; symbol:string; side:SignalSide; status:SignalStatus; timeframe:Timeframe;
  score:number; entry:number; stop:number; targets:number[]; createdAt:number; closedAt?:number;
  rationale:string; levels?:SignalLevel[];
}
