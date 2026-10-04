import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {readdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {createDatabase,migratePostgres} from '../server/postgres.mjs';
register('./planner-loader.mjs',import.meta.url);
const address='0x2222222222222222222222222222222222222222';
const merchant='0x4ed72eb56621de657d62007bc7a798d314d9765b';
const env=globalThis.__shenTestEnv={OPENROUTER_MANAGEMENT_KEY:'test',SIGNER_SETTLEMENT_ADDRESS:merchant};
const {settleComputePayment}=await import('../lib/funding.ts');
const originalFetch=globalThis.fetch;

async function fixture(postgres=false){
 let sql,pg;
 if(postgres){
  pg=new PGlite();const client={query:(q,v)=>v?pg.query(q,v):pg.exec(q).then(r=>r[0]??{rows:[]}),release(){}};
  await migratePostgres(client,resolve('drizzle'));
  let tail=Promise.resolve();
  env.DB=createDatabase({async connect(){const prior=tail;let release;tail=new Promise(r=>{release=r});await prior;return {async query(q,v){const r=await pg.query(q,v);return {...r,rowCount:r.affectedRows??r.rows.length}},release}}});
 }else{
  sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
  for(const n of readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+n,'utf8'));
  function prepare(q,v=[]){return {bind(...args){return prepare(q,args)},async run(){return {meta:{changes:Number(sql.prepare(q).run(...v).changes)}}},async first(){return sql.prepare(q).get(...v)??null}}}
  env.DB={prepare,async batch(ss){sql.exec('BEGIN');try{const out=[];for(const s of ss)out.push(await s.run());sql.exec('COMMIT');return out}catch(e){sql.exec('ROLLBACK');throw e}}};
 }
 const write=(q,...v)=>env.DB.prepare(q).bind(...v).run(),one=(q,...v)=>env.DB.prepare(q).bind(...v).first();
 const now=Date.now(),blockHash='0x'+'a'.repeat(64);let dollars=0,fail=false,valid=true;
 globalThis.fetch=async()=>{if(fail)throw Error('Network unavailable');return new Response(JSON.stringify({data:{total_credits:dollars,total_usage:0}}))};
 globalThis.__plannerChain={getChainId:async()=>56,getBlockNumber:async()=>104n,
  getTransaction:async()=>({from:address,to:valid?merchant:address,value:10000000000000000n,input:'0x'}),
  getTransactionReceipt:async()=>({status:'success',blockNumber:100n,blockHash}),
  getBlock:async()=>({number:100n,hash:blockHash,timestamp:BigInt(Math.floor(now/1000))}),
  readContract:async({functionName})=>functionName==='decimals'?8:[1n,60000000000n,0n,BigInt(Math.floor(now/1000)),1n]};
 async function add(id){
  await write('INSERT INTO coins(id,owner,config,created_at,updated_at) VALUES(?,?,?,?,?)',id,'owner',JSON.stringify({name:id}),new Date(now).toISOString(),new Date(now).toISOString());
  await write('INSERT INTO agent_wallets(coin_id,address,created_at) VALUES(?,?,?)',id,address,now);
  await write('INSERT INTO runtime_leases(coin_id,next_run_at,next_plan_at) VALUES(?,?,?)',id,now+999999,now+999999);
  await write("INSERT INTO agent_operations(id,coin_id,kind,amount_wei,status,expires_at,created_at,reason,reserved_microusd) VALUES(?,?,'compute',?,'broadcast',?,?,'Service refill',7200000)",'pay-'+id,id,'10000000000000000',now+300000,now);
  return {id:'pay-'+id,coin_id:id,amount_wei:'10000000000000000',created_at:now};
 }
 return {add,one,write,balance(v){dollars=v},fail(v){fail=v},valid(v){valid=v},async close(){globalThis.fetch=originalFetch;sql?.close();await pg?.close()}};
}

for(const postgres of [false,true])test(`confirmed deposit funds credit exactly once without querying OpenRouter (${postgres?'Postgres':'SQLite'})`,async()=>{
 const f=await fixture(postgres);try{
  const op=await f.add('one'),hash='0x'+'1'.repeat(64);
  globalThis.fetch=async()=>{throw Error('Settlement must not contact OpenRouter')};
  assert.equal((await settleComputePayment(op,hash)).status,'confirmed');
  const saved=await f.one('SELECT status,tx_hash,details FROM agent_operations');
  assert.equal(saved.status,'confirmed');assert.equal(saved.tx_hash,hash);assert.equal(JSON.parse(saved.details).creditMicrousd,6000000);
  assert.equal((await settleComputePayment(op,hash)).status,'confirmed');
  assert.equal((await f.one('SELECT ai_credit_microusd AS credit FROM coins')).credit,6000000);
  assert.equal((await f.one('SELECT COUNT(*) AS n FROM compute_funding')).n,1);
  assert.equal((await f.one('SELECT COUNT(*) AS n FROM events')).n,1);
  assert.equal((await f.one('SELECT next_run_at,next_plan_at FROM runtime_leases')).next_plan_at,0);
 }finally{await f.close()}
});

test('a crash after deposit confirmation resumes ledger allocation, not another transfer',async()=>{
 const f=await fixture();try{
  const op=await f.add('one'),hash='0x'+'2'.repeat(64);
  const database=env.DB;env.DB={...database,batch:async()=>{throw Error('Simulated database outage')}};
  await assert.rejects(settleComputePayment(op,hash),/Simulated/);
  assert.equal((await f.one('SELECT status,tx_hash FROM agent_operations')).status,'awaiting_credit');
  assert.equal((await f.one('SELECT ai_credit_microusd AS credit FROM coins')).credit,0);
  env.DB=database;assert.equal((await settleComputePayment(op,hash)).status,'confirmed');
  assert.equal((await f.one('SELECT ai_credit_microusd AS credit FROM coins')).credit,6000000);
  assert.equal((await f.one('SELECT COUNT(*) AS n FROM agent_operations')).n,1);
 }finally{await f.close()}
});

test('wrong-recipient receipt grants no credit and pending deposit uniqueness survives restart',async()=>{
 const f=await fixture();try{
  const op=await f.add('one');f.balance(100);f.valid(false);
  await assert.rejects(settleComputePayment(op,'0x'+'4'.repeat(64)),/does not match/);
  assert.equal((await f.one('SELECT ai_credit_microusd AS credit FROM coins')).credit,0);
  await f.write("UPDATE agent_operations SET status='awaiting_credit'");
  await assert.rejects(f.write("INSERT INTO agent_operations(id,coin_id,kind,amount_wei,status,expires_at,created_at,reason) VALUES('duplicate','one','compute','1','queued',0,0,'duplicate')"),/UNIQUE/);
 }finally{await f.close()}
});

test('simultaneous PostgreSQL reconciliations allocate a deposit once',async()=>{
 const f=await fixture(true);try{
  const op=await f.add('one'),hash='0x'+'5'.repeat(64);
  const results=await Promise.all([settleComputePayment(op,hash),settleComputePayment(op,hash),settleComputePayment(op,hash)]);
  assert.ok(results.every(r=>r.status==='confirmed'));
  assert.equal((await f.one('SELECT ai_credit_microusd AS credit FROM coins')).credit,6000000);
  assert.equal((await f.one('SELECT COUNT(*) AS n FROM compute_funding')).n,1);
 }finally{await f.close()}
});
