import { z } from "zod";
import { AppError, db } from "./server";
export type Candle={time:number;open:number;high:number;low:number;close:number;volume:number};
type MarketData={candles:Candle[];source:"GeckoTerminal";updatedAt:number;pool?:string;unavailable?:boolean;stale?:boolean};
const candle=z.tuple([z.number().int().positive(),z.number().nonnegative(),z.number().nonnegative(),z.number().nonnegative(),z.number().nonnegative(),z.number().nonnegative()]);
async function marketFetch(path:string){const r=await fetch("https://api.geckoterminal.com/api/v2"+path,{headers:{Accept:"application/json;version=20230203"},signal:AbortSignal.timeout(12000)});if(!r.ok)throw new AppError(r.status===429?429:502,"Market data is temporarily unavailable.");return await r.json() as Record<string,any>}
export async function marketData(address:string):Promise<MarketData>{
 if(!/^0x[a-fA-F0-9]{40}$/.test(address))throw new AppError(400,"Invalid token address");
 const token=address.toLowerCase(),now=Date.now();const cached=await db().prepare("SELECT body,expires_at FROM market_cache WHERE token_address=?").bind(token).first<{body:string;expires_at:number}>();
 if(cached&&cached.expires_at>now)return JSON.parse(cached.body);
 // Shared database throttle: at most two calls per 15 seconds across instances.
 const gate=await db().prepare("INSERT INTO provider_limits (id,next_at) VALUES ('geckoterminal',?) ON CONFLICT(id) DO UPDATE SET next_at=excluded.next_at WHERE provider_limits.next_at<=? RETURNING id").bind(now+15000,now).first();
 if(!gate){if(cached)return {...JSON.parse(cached.body),stale:true};throw new AppError(429,"Market feed is refreshing. Try again shortly.")}
 try{
  const pools=await marketFetch(`/networks/bsc/tokens/${token}/pools?include=base_token,quote_token,dex&page=1`);
  const pool=Array.isArray(pools.data)?pools.data.find((p:any)=>/^0x[a-fA-F0-9]{40}$/.test(p.attributes?.address)&&[p.relationships?.base_token?.data?.id,p.relationships?.quote_token?.data?.id].some(id=>String(id).toLowerCase()==="bsc_"+token)):undefined;
  const result:MarketData={candles:[],source:"GeckoTerminal",updatedAt:now};
  if(!pool)result.unavailable=true;
  else{result.pool=pool.attributes.address;const ohlcv=await marketFetch(`/networks/bsc/pools/${result.pool}/ohlcv/minute?aggregate=5&limit=100&currency=usd&token=${token}&include_empty_intervals=false`);result.candles=z.array(candle).max(1000).parse(ohlcv.data?.attributes?.ohlcv_list).filter(([time,o,h,l,c])=>time<=Math.ceil(now/1000)&&h>=Math.max(o,c)&&l<=Math.min(o,c)).map(([time,open,high,low,close,volume])=>({time,open,high,low,close,volume})).sort((a,b)=>a.time-b.time);}
  await db().prepare("INSERT INTO market_cache (token_address,body,expires_at) VALUES (?,?,?) ON CONFLICT(token_address) DO UPDATE SET body=excluded.body,expires_at=excluded.expires_at").bind(token,JSON.stringify(result),now+120000).run();return result;
 }catch(e){if(cached)return {...JSON.parse(cached.body),stale:true};throw e}
}
