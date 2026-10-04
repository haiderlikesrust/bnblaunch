// Cadence is a work target, never spending authority. Volume is only a demand
// signal; confirmed fee dispatch and already-funded credit support paid work.
type Flow={status:string;observedAt?:number;windows:{requestedMinutes:number;observedMinutes:number;averageWeiPerHour:string|null}[]};
type Market={stale:boolean;observedAt:number|null;lastCandles:{time:number;volume:number}[]};
export function activityCadence(flow:Flow,market:Market,credit:number,cycleCost:number,now=Date.now()){
 const window=flow.windows.find(w=>w.requestedMinutes===60&&w.observedMinutes>=5);
 const fresh=flow.status==='observed'&&typeof flow.observedAt==='number'&&now-flow.observedAt>=0&&now-flow.observedAt<300000;
 const fees=fresh&&window?.averageWeiPerHour&&/^\d+$/.test(window.averageWeiPerHour)?Number(window.averageWeiPerHour)/1e18:null;
 const candles=market.lastCandles.filter(c=>Number.isFinite(c.volume)&&c.volume>=0&&c.time*1000<=now&&c.time*1000>now-3600000);
 const recent=candles.filter(c=>c.time*1000>now-1800000).reduce((n,c)=>n+c.volume,0);
 const prior=candles.filter(c=>c.time*1000<=now-1800000).reduce((n,c)=>n+c.volume,0);
 const marketFresh=!market.stale&&market.observedAt!==null&&now-market.observedAt>=0&&now-market.observedAt<300000;
 const trend=marketFresh&&candles.length>=2?(prior>0?Math.max(.5,Math.min(2,recent/prior)):recent>0?2:1):1;
 // Smoothly scale around 0.001 BNB/hour; no fixed hourly or daily post quota.
 // Unknown fee history uses a moderate pace, rather than pretending income is zero.
 const base=fees===null?20:60/(1+2*Math.sqrt(Math.max(0,fees)/.001));
 const cost=Number.isFinite(cycleCost)&&cycleCost>0?cycleCost:10000;
 const runway=Number.isFinite(credit)&&credit>0?credit/cost:0;
 const creditFloor=runway<12?60:runway<60?20:5;
 const publicationMinutes=Math.max(creditFloor,Math.min(60,Math.ceil(base/(fees!==null&&fees>0?trend:1))));
 return {publicationMinutes,planningMinutes:publicationMinutes<=10?1:publicationMinutes<=30?3:5,
  feeBnbPerHour:fees,volumeTrend:marketFresh?trend:null,
  reason:runway<12?'low_credit':fees===null?'fee_history_unavailable':fees===0?'quiet_fees':trend<1?'slowing_volume':'confirmed_fee_activity'};
}
