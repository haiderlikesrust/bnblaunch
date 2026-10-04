import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
register('./runtime-loader.mjs',import.meta.url);
const env=globalThis.__shenTestEnv={BNB_RPC_URL:'https://rpc.invalid'};
const {GET}=await import('../app/api/coins/[id]/balance/route.ts');
const address='0x'+'a'.repeat(40);

test('public treasury reads confirmed BNB without worker/provider readiness and coalesces viewers',async()=>{
 const original=globalThis.fetch;let reads=0;const value=16632794145599999n;
 env.DB={prepare(query){assert.match(query,/token_address IS NOT NULL/);return {bind(id){return {first:async()=>id==='live'?{treasury_address:address}:null}}}}};
 globalThis.fetch=async(input,init)=>{
  const body=JSON.parse(input instanceof Request?await input.text():init.body);
  const results={eth_chainId:'0x38',eth_blockNumber:'0x100',eth_getBalance:'0x'+value.toString(16)};
  if(body.method==='eth_getBalance'){reads++;assert.deepEqual(body.params,[address,'0xfd'])}
  assert.ok(Object.hasOwn(results,body.method));return Response.json({jsonrpc:'2.0',id:body.id,result:results[body.method]});
 };
 const read=id=>GET(new Request('https://shen.now/api/coins/'+id+'/balance'),{params:Promise.resolve({id})});
 try{
  const missing=await read('draft');assert.equal(missing.status,404);assert.equal(reads,0);
  const results=await Promise.all([read('live'),read('live')]);
  for(const response of results){assert.equal(response.status,200);const data=await response.json();assert.equal(data.balanceWei,value.toString());assert.equal(data.balance,0.016632794145599999);assert.equal(data.block,'253');assert.ok(data.observedAt>0)}
  assert.equal(reads,1);
 }finally{globalThis.fetch=original}
});
test('wrong-chain RPC fails visibly instead of reporting or caching zero',async()=>{
 const original=globalThis.fetch;let chain='0x1';
 env.DB={prepare(){return {bind(){return {first:async()=>({treasury_address:'0x'+'b'.repeat(40)})}}}}};
 globalThis.fetch=async(input,init)=>{
  const body=JSON.parse(input instanceof Request?await input.text():init.body);
  const results={eth_chainId:chain,eth_blockNumber:'0x100',eth_getBalance:'0x0'};
  return Response.json({jsonrpc:'2.0',id:body.id,result:results[body.method]});
 };
 const read=()=>GET(new Request('https://shen.now/api/coins/live/balance'),{params:Promise.resolve({id:'live'})});
 try{const failed=await read();assert.equal(failed.status,503);assert.equal((await failed.json()).balance,undefined);chain='0x38';const recovered=await read();assert.equal(recovered.status,200);assert.equal((await recovered.json()).balance,0)}finally{globalThis.fetch=original}
});
