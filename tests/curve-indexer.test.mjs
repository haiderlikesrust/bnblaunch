import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync,readFileSync } from 'node:fs';
import { encodeAbiParameters,encodeEventTopics } from 'viem';
register('./planner-loader.mjs',import.meta.url);
const env=globalThis.__shenTestEnv={};
const {curveEvents,decodeCurveLog,curveCandles}=await import('../lib/curve-candles.ts');
const {runCurveTick,curveMarket}=await import('../lib/curve-indexer.ts');
const token='0x1111111111111111111111111111111111117777',buyer='0x2222222222222222222222222222222222222222',portal='0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0',hash='0x'+'a'.repeat(64),launch='0x'+'b'.repeat(64);
function log(price,index=0,time=1700000100){return {address:portal,topics:encodeEventTopics({abi:curveEvents,eventName:'TokenBought'}),data:encodeAbiParameters([{type:'uint256'},{type:'address'},{type:'address'},{type:'uint256'},{type:'uint256'},{type:'uint256'},{type:'uint256'}],[BigInt(time),token,buyer,100n*10n**18n,BigInt(price)*10n**18n,0n,0n]),blockNumber:100n,blockHash:hash,transactionHash:launch,logIndex:index,removed:false};}
test('official unindexed Portal events produce real five-minute BNB OHLC with no synthetic intervals',()=>{
 const trades=[decodeCurveLog(log(2,0),token),decodeCurveLog(log(4,1),token),decodeCurveLog(log(1,2),token),decodeCurveLog(log(3,3),token),decodeCurveLog(log(5,4,1700000700),token)];
 assert.deepEqual(curveCandles(trades),[{time:1700000100,open:.02,high:.04,low:.01,close:.03,volume:10},{time:1700000700,open:.05,high:.05,low:.05,close:.05,volume:5}]);
 assert.equal(decodeCurveLog(log(2),buyer),null);assert.throws(()=>decodeCurveLog({...log(2),removed:true},token));
});
function fixture(){
 const sql=new DatabaseSync(':memory:');for(const name of readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+name,'utf8'));
 function prepare(query,values=[]){return {bind(...v){return prepare(query,v)},async run(){return {meta:{changes:Number(sql.prepare(query).run(...values).changes)}}},async all(){return {results:sql.prepare(query).all(...values)}},async first(){return sql.prepare(query).get(...values)??null;}};}
 env.DB={prepare,async batch(statements){sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 sql.prepare("INSERT INTO coins(id,owner,config,token_address,created_at,updated_at) VALUES('coin','owner','{}',?,'now','now')").run(token);
 sql.prepare("INSERT INTO prepared_launches(id,coin_id,creator,treasury,calldata,predicted_address,cid,created_at,tx_hash) VALUES('launch','coin',?,?,'0x',?,'cid','now',?)").run(buyer,buyer,token,launch);
 const state={canonical:hash,head:112n,logs:[log(2),log(3,1)],fail:false};
 globalThis.__plannerChain={getChainId:async()=>56,getBlock:async({blockNumber}={})=>{if(state.fail)throw Error('RPC offline');return {number:blockNumber??state.head,hash:state.canonical,timestamp:BigInt(Math.floor(Date.now()/1000))};},getTransactionReceipt:async()=>({status:'success',blockNumber:100n,blockHash:hash}),readContract:async()=>18,getLogs:async()=>state.logs};
 return {sql,state,due(){sql.prepare('UPDATE curve_cursors SET checked_at=0').run();},close(){sql.close();}};
}
test('curve index commits trades/cursor together, deduplicates replay, and resets on canonical hash change',async()=>{
 const f=fixture();try{
  assert.equal((await runCurveTick()).processed,true);let c=f.sql.prepare('SELECT * FROM curve_cursors').get();assert.equal(c.next_block,101);assert.equal(c.caught_up,1);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM curve_trades').get().n,2);
  f.due();await runCurveTick();assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM curve_trades').get().n,2);
  const market=await curveMarket(token);assert.equal(market.currency,'BNB');assert.equal(market.source,'Flap');assert.equal(market.candles[0].close,.03);
  f.due();f.state.canonical='0x'+'c'.repeat(64);assert.equal((await runCurveTick()).reindexed,true);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM curve_trades').get().n,0);assert.equal(f.sql.prepare('SELECT next_block FROM curve_cursors').get().next_block,100);
 }finally{f.close();}
});
test('RPC failure never refreshes the timestamp of indexed market data',async()=>{
 const f=fixture();try{await runCurveTick();const before=f.sql.prepare('SELECT indexed_at FROM curve_cursors').get().indexed_at;f.due();f.state.fail=true;await assert.rejects(runCurveTick());assert.equal(f.sql.prepare('SELECT indexed_at FROM curve_cursors').get().indexed_at,before);}finally{f.close();}
});
