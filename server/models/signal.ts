
export interface FinalSignal {
 id:string; symbol:string; exchange:string; marketType:string; direction:"LONG"|"SHORT"|"WAIT"|"NO_TRADE"; status:string;
 outcome?:{status:string;exit:number;closed:boolean;at:string};
 timeframe:{primary:string;confirmation:string;execution:string};
 market:{currentPrice:number;["24hChange"]:number;volume:number;volatility:number};
 entry:{min:number;max:number;ideal:number;trigger:string;expiry:string};
 stopLoss:{price:number|null;method:string;reason:string};
 takeProfit:{tp1:number|null;tp2:number|null;tp3:number|null};
 riskReward:{tp1:number;tp2:number;tp3:number;weighted:number};
 score:{total:number;marketContext:number;trendMTF:number;structure:number;liquiditySR:number;volumeMomentum:number;derivativesOrderbook:number;newsFundamentals:number;riskExecution:number};
 technical:Record<string,unknown>;structure:Record<string,unknown>;liquidity:Record<string,unknown>;derivatives:Record<string,unknown>;marketContext:Record<string,unknown>;
 reasoning:{primaryReason:string;confirmations:string[];conflicts:string[];warnings:string[];invalidation:string};
 dataQuality:{status:"FRESH"|"DELAYED"|"UNAVAILABLE"|"PARTIAL";timestamp:string;sources:string[]};
 events:unknown[];timestamps:{createdAt:string;updatedAt:string;closedAt:string|null};
}
