import { parseAbi,type Address,type Hex } from 'viem';
import { db } from './server';
import { chainClient } from './providers';
import { PORTAL } from './flap';
import { curveEvents,decodeCurveLog,curveCandles,type CurveTrade } from './curve-candles';
import type { MarketData } from './market';
import { bnbPrice } from './funding';
type Cursor={coin_id:string;token_address:string;launch_hash:string;next_block:number;last_hash:string|null;lease_id:string|null;lease_until:number;checked_at:number;indexed_at:number;migrated:number;caught_up:number;start_block:number;range_size:number};
export async function runCurveTick(){
 const now=Date.now(),id=crypto.randomUUID();
 await db().prepare(`INSERT INTO curve_cursors(coin_id,token_address,launch_hash,next_block,start_block,lease_until,checked_at,migrated,caught_up,range_size)
 SELECT c.id,c.token_address,p.tx_hash,0,0,0,0,0,0,2000 FROM coins c JOIN prepared_launches p ON p.coin_id=c.id AND lower(p.predicted_address)=c.token_address WHERE c.token_address IS NOT NULL AND p.tx_hash IS NOT NULL ON CONFLICT(coin_id) DO NOTHING`).run();
 const c=await db().prepare('SELECT * FROM curve_cursors WHERE lease_until<? AND checked_at<? ORDER BY checked_at,coin_id LIMIT 1').bind(now,now-15000).first<Cursor>();
 if(!c)return {processed:false};
 if(!(await db().prepare('UPDATE curve_cursors SET lease_id=?,lease_until=? WHERE coin_id=? AND lease_until<?').bind(id,now+120000,c.coin_id,now).run()).meta.changes)return {processed:false};
 const client=chainClient();
 try{
  if(await client.getChainId()!==56)throw Error('Incorrect curve chain');
  const head=await client.getBlock();if(Date.now()/1000-Number(head.timestamp)>90)throw Error('Curve RPC head is stale');const confirmed=head.number-12n;
  if(!c.next_block){
   const launch=await client.getTransactionReceipt({hash:c.launch_hash as Hex});
   if(launch.status!=='success'||confirmed<launch.blockNumber)return {processed:false};
   const [canonical,decimals]=await Promise.all([client.getBlock({blockNumber:launch.blockNumber}),client.readContract({address:c.token_address as Address,abi:parseAbi(['function decimals() view returns(uint8)']),functionName:'decimals',blockNumber:launch.blockNumber})]);
   if(canonical.hash!==launch.blockHash||decimals!==18)throw Error('Curve launch or decimals mismatch');
   c.start_block=Number(launch.blockNumber);c.next_block=c.start_block;
  }else if(c.last_hash){
   const block=await client.getBlock({blockNumber:BigInt(c.next_block-1)});
   if(block.hash!==c.last_hash){
    await db().batch([db().prepare('DELETE FROM curve_trades WHERE coin_id=? AND EXISTS(SELECT 1 FROM curve_cursors WHERE coin_id=? AND lease_id=? AND lease_until>?)').bind(c.coin_id,c.coin_id,id,Date.now()),db().prepare('UPDATE curve_cursors SET next_block=start_block,last_hash=NULL,migrated=0,caught_up=0 WHERE coin_id=? AND lease_id=? AND lease_until>?').bind(c.coin_id,id,Date.now())]);return {processed:true,reindexed:true};
   }
  }
  if(c.migrated)return {processed:true};
  for(let batch=0;batch<4&&BigInt(c.next_block)<=confirmed;batch++){
   const from=BigInt(c.next_block),to=from+BigInt(c.range_size)-1n<confirmed?from+BigInt(c.range_size)-1n:confirmed;
   const end=await client.getBlock({blockNumber:to});let logs;
   try{logs=await client.getLogs({address:PORTAL,events:curveEvents,fromBlock:from,toBlock:to,strict:true});if(logs.length>=5000)throw Error('Log batch too large');}
   catch(error){if(c.range_size<=1)throw error;c.range_size=Math.max(1,Math.floor(c.range_size/2));await db().prepare('UPDATE curve_cursors SET range_size=? WHERE coin_id=? AND lease_id=? AND lease_until>?').bind(c.range_size,c.coin_id,id,Date.now()).run();return {processed:true,retrySmallerRange:true};}
   const trades:CurveTrade[]=[];let migrated=false;
   for(const log of logs){const trade=decodeCurveLog(log,c.token_address);if(trade==='migration')migrated=true;else if(trade)trades.push(trade);}
   const hashes=new Map(trades.map(t=>[t.block,t.blockHash]));
   for(const [number,hash] of hashes)if((await client.getBlock({blockNumber:BigInt(number)})).hash!==hash)throw Error('Curve trade reorganized');
   if((await client.getBlock({blockNumber:to})).hash!==end.hash)throw Error('Curve range reorganized');
   const time=Date.now();
   await db().batch([
    ...trades.map(t=>db().prepare(`INSERT INTO curve_trades(id,coin_id,block_number,block_hash,time,log_index,token_wei,quote_wei,side,tx_hash) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM curve_cursors WHERE coin_id=? AND lease_id=? AND lease_until>?) ON CONFLICT(id) DO NOTHING`).bind(t.id,c.coin_id,t.block,t.blockHash,t.time,t.logIndex,t.tokenWei,t.quoteWei,t.side,t.hash,c.coin_id,id,time)),
    db().prepare('UPDATE curve_cursors SET start_block=?,next_block=?,last_hash=?,migrated=?,caught_up=?,checked_at=?,indexed_at=? WHERE coin_id=? AND lease_id=? AND lease_until>?').bind(c.start_block,Number(to+1n),end.hash,migrated?1:0,to===confirmed?1:0,time,time,c.coin_id,id,time),
   ]);
   c.next_block=Number(to+1n);if(migrated)break;
  }return {processed:true};
 }finally{await db().prepare('UPDATE curve_cursors SET lease_id=NULL,lease_until=0,checked_at=? WHERE coin_id=? AND lease_id=?').bind(Date.now(),c.coin_id,id).run();}
}
export async function curveMarket(token:string):Promise<(MarketData&{migrated:boolean})|null>{
 const c=await db().prepare('SELECT * FROM curve_cursors WHERE token_address=?').bind(token.toLowerCase()).first<Cursor>();if(!c)return null;
 // Limit by 5-minute buckets, not individual trades (which could truncate the
 // open/high/low of a busy interval).
 const times=await db().prepare('SELECT MAX(time) AS latest FROM curve_trades WHERE coin_id=?').bind(c.coin_id).first<{latest:number|null}>();
 const lower=times?.latest?Math.floor(times.latest/300)*300-99*300:0;
 const rows=await db().prepare('SELECT id,block_number AS block,block_hash AS blockHash,time,log_index AS logIndex,token_wei AS tokenWei,quote_wei AS quoteWei,side,tx_hash AS hash FROM curve_trades WHERE coin_id=? AND time>=? ORDER BY block_number,log_index').bind(c.coin_id,lower).all<CurveTrade>();
 const candles=curveCandles(rows.results),price=await bnbPrice().catch(()=>null),native=candles.at(-1)?.close;
 return {candles,source:'Flap',currency:'BNB',migrated:!!c.migrated,updatedAt:c.indexed_at,stale:!c.caught_up||Date.now()-c.indexed_at>300000,indexing:!c.caught_up,indexedThrough:c.next_block?c.next_block-1:null,lastTradeAt:times?.latest?times.latest*1000:null,
  valuation:{priceUsd:native!==undefined&&price?native*Number(price.answer)/1e8:null,marketCapUsd:null,fullyDilutedValuationUsd:null,tokenLiquidityUsd:null,volume24hUsd:null}};
}
