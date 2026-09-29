export type Timeframe = "1m"|"5m"|"15m"|"30m"|"1H"|"4H"|"1D";
export interface Candle { timestamp:number; open:number; high:number; low:number; close:number; volume:number; }
export interface DataQuality { status:"fresh"|"stale"|"invalid"; ageMs:number; reason?:string; }
export interface ProviderMeta { sourceExchange:string; symbol:string; timestamp:number; timeframe?:Timeframe; dataQuality:DataQuality; latencyMs:number; }
export interface ProviderResponse<T> { data:T; meta:ProviderMeta; }
export interface OrderBook { bids:Array<[number,number]>; asks:Array<[number,number]>; }
export interface Liquidation { timestamp:number; side:"long"|"short"; price:number; quantity:number; }
export interface MarketSnapshot {
  symbol:string; exchange:string; timestamp:number; price:number; volume:number;
  fundingRate:number|null; openInterest:number|null; longShortRatio:number|null;
}
export interface MarketDataProvider {
  getTicker(symbol:string):Promise<ProviderResponse<{price:number;volume:number}>>;
  getOHLCV(symbol:string,timeframe:Timeframe,limit?:number):Promise<ProviderResponse<Candle[]>>;
  getOrderBook(symbol:string):Promise<ProviderResponse<OrderBook>>;
  getFundingRate(symbol:string):Promise<ProviderResponse<number>>;
  getOpenInterest(symbol:string):Promise<ProviderResponse<number>>;
  getLiquidations(symbol:string):Promise<ProviderResponse<Liquidation[]>>;
  getLongShortRatio(symbol:string):Promise<ProviderResponse<number>>;
}
