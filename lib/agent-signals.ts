import { db } from './server';
type Observation={price:number|null;volume24h:number|null;at:number;currency?:string};
export function marketSignals(previous:Observation,current:Observation){
  if(current.currency!==previous.currency||current.at<=previous.at||current.at-previous.at>3600000)return [];
  const minutes=Math.max(1,Math.round((current.at-previous.at)/60000));
  const signals:{kind:string;message:string}[]=[];
  for(const [key,threshold,label] of [['price',5,'Price'],['volume24h',25,'Reported 24-hour volume']] as const){
    const a=previous[key],b=current[key];
    if(a===null||b===null||!Number.isFinite(a)||!Number.isFinite(b)||a<=0||b<0)continue;
    const change=(b-a)/a*100;
    if(Math.abs(change)>=threshold)signals.push({kind:key,message:`${label}${key==='price'&&current.currency?' ('+current.currency+')':''} ${change>=0?'up':'down'} ${Math.abs(change).toFixed(1)}% since the previous observation (${minutes} min).`});
  }
  return signals;
}
export async function recordMarketSignals(lease:{coinId:string;id:string},market:{stale:boolean;indexing?:boolean;candleCurrency?:string;lastCandles?:{close:number}[];observedAt:number|null;valuation:{priceUsd:number|null;volume24hUsd:number|null}|null}){
  if(market.stale||market.indexing||!market.observedAt)return;
  const usd=market.valuation?.priceUsd;
  const current:Observation={price:usd??market.lastCandles?.at(-1)?.close??null,volume24h:market.valuation?.volume24hUsd??null,at:market.observedAt,currency:usd!==null&&usd!==undefined?'USD':market.candleCurrency??'USD'};
  if(current.price===null&&current.volume24h===null)return;
  const old=await db().prepare('SELECT body FROM agent_observations WHERE coin_id=?').bind(lease.coinId).first<{body:string}>();
  const signals=old?marketSignals(JSON.parse(old.body),current):[];
  const fence='EXISTS(SELECT 1 FROM runtime_leases WHERE coin_id=? AND lease_id=? AND lease_until>?)';
  await db().batch([
    db().prepare(`INSERT INTO agent_observations(coin_id,body,observed_at) SELECT ?,?,? WHERE ${fence} ON CONFLICT(coin_id) DO UPDATE SET body=excluded.body,observed_at=excluded.observed_at WHERE agent_observations.observed_at<excluded.observed_at`).bind(lease.coinId,JSON.stringify(current),current.at,lease.coinId,lease.id,Date.now()),
    ...signals.map(s=>db().prepare(`INSERT INTO agent_signals(id,coin_id,kind,message,observed_at) SELECT ?,?,?,?,? WHERE ${fence} ON CONFLICT(id) DO NOTHING`).bind(`${lease.coinId}:${current.at}:${s.kind}`,lease.coinId,s.kind,s.message,Date.now(),lease.coinId,lease.id,Date.now())),
    db().prepare('DELETE FROM agent_signals WHERE coin_id=? AND id NOT IN (SELECT id FROM agent_signals WHERE coin_id=? ORDER BY observed_at DESC,id DESC LIMIT 50)').bind(lease.coinId,lease.coinId),
  ]);
}
export async function signalHistory(coinId:string){return (await db().prepare('SELECT id,kind,message,observed_at AS observedAt FROM agent_signals WHERE coin_id=? ORDER BY observed_at DESC,id DESC LIMIT 10').bind(coinId).all<{id:string;kind:string;message:string;observedAt:number}>()).results;}
