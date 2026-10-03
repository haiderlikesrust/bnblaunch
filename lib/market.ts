import { z } from 'zod';
import { AppError, db } from './server';
export type Candle={time:number;open:number;high:number;low:number;close:number;volume:number};
export type MarketData={candles:Candle[];source:'GeckoTerminal';updatedAt:number;pool?:string;lastTradeAt?:number|null;unavailable?:boolean;stale?:boolean;valuation?:{priceUsd:number|null;marketCapUsd:number|null;fullyDilutedValuationUsd:number|null;tokenLiquidityUsd:number|null;volume24hUsd:number|null}};
const candle=z.tuple([z.number().int().positive(),z.number().nonnegative(),z.number().nonnegative(),z.number().nonnegative(),z.number().nonnegative(),z.number().nonnegative()]);
export function marketNumber(value:unknown):number|null{if(typeof value!=='string'||!/^\d+(\.\d+)?$/.test(value))return null;const n=Number(value);return Number.isFinite(n)&&n<=Number.MAX_SAFE_INTEGER?n:null;}
export function tokenMarket(payload:any,token:string,now:number):MarketData{
 if(payload?.data?.id?.toLowerCase()!=='bsc_'+token.toLowerCase()||payload?.data?.attributes?.address?.toLowerCase()!==token.toLowerCase())throw Error('Market token identity mismatch');
 const a=payload.data.attributes,ids=payload.data.relationships?.top_pools?.data;
 const pool=Array.isArray(payload.included)&&Array.isArray(ids)?ids.map((i:any)=>payload.included.find((p:any)=>p.id===i.id)).find((p:any)=>p?.type==='pool'&&/^0x[a-fA-F0-9]{40}$/.test(p.attributes?.address)&&[p.relationships?.base_token?.data?.id,p.relationships?.quote_token?.data?.id].some(id=>String(id).toLowerCase()==='bsc_'+token.toLowerCase())):null;
 return {candles:[],source:'GeckoTerminal',updatedAt:now,lastTradeAt:typeof a.last_trade_timestamp==='number'&&Number.isSafeInteger(a.last_trade_timestamp)&&a.last_trade_timestamp>0&&a.last_trade_timestamp*1000<=now?a.last_trade_timestamp*1000:null,...(pool?{pool:pool.attributes.address}:{unavailable:true}),valuation:{priceUsd:marketNumber(a.price_usd),marketCapUsd:marketNumber(a.market_cap_usd),fullyDilutedValuationUsd:marketNumber(a.fdv_usd),tokenLiquidityUsd:marketNumber(a.total_reserve_in_usd),volume24hUsd:marketNumber(a.volume_usd?.h24)}};
}
async function marketFetch(path:string){const r=await fetch('https://api.geckoterminal.com/api/v2'+path,{headers:{Accept:'application/json;version=20230203'},signal:AbortSignal.timeout(12000)});if(!r.ok)throw new AppError(r.status===429?429:502,'Market data is temporarily unavailable.');return await r.json();}
export async function marketData(address:string):Promise<MarketData>{
 if(!/^0x[a-fA-F0-9]{40}$/.test(address))throw new AppError(400,'Invalid token address');
 const token=address.toLowerCase(),now=Date.now(),cached=await db().prepare('SELECT body,expires_at FROM market_cache WHERE token_address=?').bind(token).first<{body:string;expires_at:number}>();
 if(cached&&cached.expires_at>now)return JSON.parse(cached.body);
 // Token valuation + pool candles: at most two requests per 15 seconds.
 const gate=await db().prepare("INSERT INTO provider_limits(id,next_at) VALUES('geckoterminal',?) ON CONFLICT(id) DO UPDATE SET next_at=excluded.next_at WHERE provider_limits.next_at<=? RETURNING id").bind(now+15000,now).first();
 if(!gate){if(cached)return {...JSON.parse(cached.body),stale:true};throw new AppError(429,'Market feed is refreshing.');}
 try{
  const result=tokenMarket(await marketFetch(`/networks/bsc/tokens/${token}?include=top_pools`),token,now);
  if(result.pool){try{const ohlcv:any=await marketFetch(`/networks/bsc/pools/${result.pool}/ohlcv/minute?aggregate=5&limit=100&currency=usd&token=${token}&include_empty_intervals=false`);result.candles=z.array(candle).max(1000).parse(ohlcv.data?.attributes?.ohlcv_list).filter(([time,o,h,l,c])=>time<=Math.ceil(now/1000)&&h>=Math.max(o,c)&&l<=Math.min(o,c)).map(([time,open,high,low,close,volume])=>({time,open,high,low,close,volume})).sort((a,b)=>a.time-b.time);}catch{result.unavailable=true;}}
  await db().prepare('INSERT INTO market_cache(token_address,body,expires_at) VALUES(?,?,?) ON CONFLICT(token_address) DO UPDATE SET body=excluded.body,expires_at=excluded.expires_at').bind(token,JSON.stringify(result),now+120000).run();return result;
 }catch(e){if(cached)return {...JSON.parse(cached.body),stale:true};throw e;}
}
export async function marketContext(address:string){try{const data=await marketData(address);return {source:data.source,observedAt:data.updatedAt,stale:!!data.stale||Date.now()-data.updatedAt>300000,valuation:data.valuation??null,available:!!data.valuation&&Object.values(data.valuation).some(v=>v!==null),lastTradeAt:data.lastTradeAt??null,lastCandleAt:data.candles.at(-1)?.time??null,lastCandles:data.candles.slice(-12)};}catch{return {source:'GeckoTerminal',observedAt:null,stale:true,valuation:null,available:false,lastCandles:[]};}}
