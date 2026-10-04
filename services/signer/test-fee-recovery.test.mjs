import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { parseTransaction } from 'viem';
import { WalletStore } from './store.mjs';
import { SigningEngine } from './engine.mjs';
import { Campaigns } from './campaigns.mjs';
import { recoverTestFees } from './test-fee-recovery.mjs';

function fixture(){
 const store=new WalletStore(':memory:',randomBytes(32).toString('hex')),coinId=randomUUID(),wallet=store.provision(coinId);
 const authority={id:randomUUID(),coinId,address:wallet.address,token:'0x1111111111111111111111111111111111117777',recipient:'0x4a41ee912283966be446514af39e1e3322bb7840',maximumWei:'30000000000000000'};
 store.bindLaunch(coinId,authority.token,'0x'+'a'.repeat(64));
 let balance=32827144145600000n,reserve=5000000000000000n,receipt=null;const sent=[];
 const blockHash='0x'+'b'.repeat(64);
 const client={getChainId:async()=>56,getBlock:async()=>({number:100n,hash:blockHash,timestamp:BigInt(Math.floor(Date.now()/1000))}),getBalance:async()=>balance,getTransactionCount:async()=>0,getGasPrice:async()=>1000000000n,getCode:async()=>'0x',estimateGas:async()=>21000n,getTransactionReceipt:async()=>{if(receipt)return receipt;const e=Error();e.name='TransactionReceiptNotFoundError';throw e;},sendRawTransaction:async({serializedTransaction})=>{sent.push(serializedTransaction);throw Error('Ambiguous broadcast acknowledgement');}};
 const engine=new SigningEngine(store,client,{gasReserveWei:2000000000000000n,maxGasPriceWei:3000000000n});
 engine.bindLaunch=async()=>{};engine.protocolFees={quote:async()=>({reserveWei:reserve.toString()})};new Campaigns(store,engine);
 return {store,engine,authority,client,sent,setBalance:n=>balance=n,setReserve:n=>reserve=n,confirm:()=>receipt={status:'success',blockNumber:90n,blockHash},run:execute=>recoverTestFees(store,engine,authority,{execute})};
}

test('recovery preview preserves protocol and gas allocations without signing',async()=>{
 const f=fixture();try{
  const result=await f.run(false);assert.equal(result.amountWei,'25801944145600000');assert.equal(result.recipient,f.authority.recipient);
  assert.equal(f.store.intent(f.authority.id),undefined);assert.deepEqual(f.sent,[]);
  assert.equal(f.store.wallet(f.authority.coinId).lock_id,null);
 }finally{f.store.close();}
});
test('recovery signs only authorized BNB and repeated execution resumes identical bytes',async()=>{
 const f=fixture();try{
  const first=await f.run(true),second=await f.run(true);
  assert.equal(first.hash,second.hash);assert.equal(f.sent.length,2);assert.equal(f.sent[0],f.sent[1]);
  const tx=parseTransaction(f.sent[0]);assert.equal(tx.to.toLowerCase(),f.authority.recipient);assert.equal(tx.chainId,56);assert.equal(tx.value,25801944145600000n);assert.equal(tx.data??'0x','0x');
  f.confirm();assert.equal((await f.run(true)).status,'confirmed');await f.run(true);assert.equal(f.sent.length,2);
 }finally{f.store.close();}
});
test('recovery never exceeds the authorized 0.03 BNB and rejects other wallets',async()=>{
 const f=fixture();try{
  f.setBalance(1000000000000000000n);assert.equal((await f.run(false)).amountWei,f.authority.maximumWei);
  await assert.rejects(recoverTestFees(f.store,f.engine,{...f.authority,address:'0x3333333333333333333333333333333333333333'}),/does not match/);
  await assert.rejects(recoverTestFees(f.store,f.engine,{...f.authority,token:f.authority.recipient}),/does not match/);
 }finally{f.store.close();}
});
for(const mode of ['nonce','reserve','insufficient','gas','contract','queued','campaign','domain','lease'])test('recovery blocks unsafe or competing state: '+mode,async()=>{
 const f=fixture();try{
  if(mode==='nonce')f.client.getTransactionCount=async({blockTag})=>blockTag==='pending'?1:0;
  if(mode==='reserve')f.engine.protocolFees.quote=async()=>({reserveWei:null});
  if(mode==='insufficient')f.setReserve(40000000000000000n);
  if(mode==='gas')f.client.getGasPrice=async()=>5000000000n;
  if(mode==='contract')f.client.getCode=async()=>'0x1234';
  if(mode==='queued')f.store.createIntent({id:randomUUID(),coinId:f.authority.coinId,kind:'compute',amountWei:'100',expiresAt:Date.now()+60000});
  if(mode==='campaign')f.store.db.prepare("INSERT INTO campaigns(id,coin_id,kind,amount_wei,request,status,record,created_at) VALUES('pending',?,'rewards','1','{}','running','{}',0)").run(f.authority.coinId);
  if(mode==='domain'){f.store.db.exec('CREATE TABLE domain_funding_jobs(id TEXT,coin_id TEXT,status TEXT)');f.store.db.prepare("INSERT INTO domain_funding_jobs VALUES('pending',?,'funding')").run(f.authority.coinId);}
  if(mode==='lease')f.store.acquire(f.authority.coinId);
  await assert.rejects(f.run(true));assert.equal(f.store.intent(f.authority.id),undefined);assert.deepEqual(f.sent,[]);
 }finally{f.store.close();}
});
test('a signed recovery blocks other signing and preview never rebroadcasts it',async()=>{
 const f=fixture();try{
  await f.run(true);assert.equal(f.store.pending(f.authority.coinId).id,f.authority.id);
  assert.equal((await f.run(false)).status,'signed');assert.equal(f.sent.length,1);
  await assert.rejects(recoverTestFees(f.store,f.engine,{...f.authority,recipient:'0x2222222222222222222222222222222222222222'},{execute:true}),/journal/);
  assert.throws(()=>f.store.createIntent({id:randomUUID(),coinId:f.authority.coinId,kind:'test_recovery',amountWei:'1',expiresAt:Date.now()+60000}),/Invalid intent/);
 }finally{f.store.close();}
});
test('expired wallet fence prevents recording or broadcasting a recovery signature',async()=>{
 const f=fixture();try{
  const account=f.store.account.bind(f.store);f.store.account=id=>{const a=account(id);return {signTransaction:async tx=>{f.store.db.prepare('UPDATE wallets SET lock_until=0').run();return a.signTransaction(tx);}};};
  await assert.rejects(f.run(true),/lease/);assert.equal(f.store.signedBytes(f.authority.id),null);assert.deepEqual(f.sent,[]);
  f.store.account=account;await f.run(true);assert.equal(f.sent.length,1,'unsigned attempt can be requoted safely');
 }finally{f.store.close();}
});
