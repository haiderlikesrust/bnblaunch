import { decodeEventLog, parseAbi, type Log } from 'viem';
import { PORTAL } from '../shared/flap-contract.mjs';
import type { Candle } from './market';
export const curveEvents=parseAbi([
 'event TokenBought(uint256 ts,address token,address buyer,uint256 amount,uint256 eth,uint256 fee,uint256 postPrice)',
 'event TokenSold(uint256 ts,address token,address seller,uint256 amount,uint256 eth,uint256 fee,uint256 postPrice)',
 'event LaunchedToDEX(address token,address pool,uint256 amount,uint256 eth)',
]);
export type CurveTrade={id:string;block:number;blockHash:string;time:number;logIndex:number;tokenWei:string;quoteWei:string;side:string;hash:string};
export function decodeCurveLog(log:Log,token:string):CurveTrade|'migration'|null{
 if(log.address.toLowerCase()!==PORTAL.toLowerCase()||log.removed||log.blockNumber===null||log.logIndex===null||!log.blockHash||!log.transactionHash)throw Error('Unconfirmed curve log');
 const event=decodeEventLog({abi:curveEvents,data:log.data,topics:log.topics,strict:true});
 if(event.args.token.toLowerCase()!==token.toLowerCase())return null;
 if(event.eventName==='LaunchedToDEX')return 'migration';
 // A zero-amount or mistimed trade is skipped rather than thrown: a throw here
 // would stop the cursor on that range forever and freeze the coin's chart.
 if(event.args.amount<=0n||event.args.eth<=0n||event.args.ts<=0n||event.args.ts>BigInt(Math.floor(Date.now()/1000)+60))return null;
 return {id:log.transactionHash+':'+log.logIndex,block:Number(log.blockNumber),blockHash:log.blockHash,time:Number(event.args.ts),logIndex:log.logIndex,tokenWei:event.args.amount.toString(),quoteWei:event.args.eth.toString(),side:event.eventName==='TokenBought'?'buy':'sell',hash:log.transactionHash};
}
export function curveCandles(trades:CurveTrade[]):Candle[]{
 const groups=new Map<number,Candle>();
 for(const t of [...trades].sort((a,b)=>a.block-b.block||a.logIndex-b.logIndex)){
  // SHEN's independently verified Flap V6 token and native BNB both have 18
  // decimals. Prices are actual quote/token execution ratios, never invented
  // historical USD conversions or interpolated empty intervals.
  const price=Number(t.quoteWei)/Number(t.tokenWei),volume=Number(t.quoteWei)/1e18,time=Math.floor(t.time/300)*300;
  if(!Number.isFinite(price)||price<=0||!Number.isFinite(volume)||volume<=0)continue;
  const c=groups.get(time);if(c){c.high=Math.max(c.high,price);c.low=Math.min(c.low,price);c.close=price;c.volume+=volume;}else groups.set(time,{time,open:price,high:price,low:price,close:price,volume});
 }return [...groups.values()].sort((a,b)=>a.time-b.time).slice(-100);
}
