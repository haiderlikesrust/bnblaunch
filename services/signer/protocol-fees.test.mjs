import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { WalletStore } from './store.mjs';
import { SigningEngine } from './engine.mjs';
import { Campaigns } from './campaigns.mjs';
import { ProtocolFees,protocolAllocation } from './protocol-fees.mjs';
const token='0x1111111111111111111111111111111111117777',shen='0x2222222222222222222222222222222222227777',processor='0x3333333333333333333333333333333333333333';
function fixture(){
 const store=new WalletStore(':memory:',randomBytes(32).toString('hex')),coinId=randomUUID();store.provision(coinId);store.bindLaunch(coinId,token,'0x'+'a'.repeat(64));const wallet=store.wallet(coinId);
 const state={total:1000000000000000000n,changed:false,reorg:false,head:200n},calls=[];
 const client={getChainId:async()=>56,getBlock:async({blockNumber}={})=>({number:blockNumber??state.head,hash:'0x'+(state.reorg?'f':Number(blockNumber??state.head).toString(16)).padStart(64,'0'),timestamp:BigInt(Math.floor(Date.now()/1000))}),getTransactionReceipt:async()=>({status:'success',blockNumber:100n}),getBalance:async()=>10n**20n,
 getLogs:async(args)=>{calls.push(args);return state.changed?[{}]:[]},readContract:async({functionName})=>({taxProcessor:processor,taxToken:token,marketAddress:wallet.address,weth:'0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',feeConfigV2:{isWeth:true,marketBps:10000,lpBps:0,dividendBps:0,deflationBps:0},totalQuoteSentToMarketing:state.total})[functionName]};
 const engine=new SigningEngine(store,client,{shenTokenAddress:shen,buybacksEnabled:true,gasReserveWei:1000n});engine.bindLaunch=async()=>{};
 const campaigns=new Campaigns(store,engine),fees=new ProtocolFees(store,engine,campaigns);engine.protocolFees=fees;
 return {store,coinId,wallet,engine,campaigns,fees,state,calls};
}
test('15% uses exact cumulative integer accounting and rejects over-spend',()=>{
 assert.deepEqual(protocolAllocation(101n,10n),{accrued:15n,due:5n});assert.throws(()=>protocolAllocation(100n,16n));
});
test('confirmed marketing fees accrue once; wallet deposits are never classified as fees',async()=>{
 const f=fixture();try{
  const first=await f.fees.quote(f.wallet);assert.equal(first.reserveWei,'150000000000000000');
  assert.equal((await f.fees.quote(f.wallet)).reserveWei,first.reserveWei);
  f.state.total+=100n;f.state.head++;assert.equal((await f.fees.quote(f.wallet)).reserveWei,'150000000000000015');
  f.state.total=1n;await assert.rejects(f.fees.quote(f.wallet),/counter changed/);
 }finally{f.store.close()}
});
test('routing changes and reorganizations fail closed; long history advances in bounded chunks',async()=>{
 const f=fixture();try{
  f.state.head=12000n;await assert.rejects(f.fees.quote(f.wallet),/catching up/);assert.ok(f.calls.every(c=>c.toBlock-c.fromBlock<5000n));
  await assert.rejects(f.fees.quote(f.wallet),/catching up/);await f.fees.quote(f.wallet);
  f.state.reorg=true;await assert.rejects(f.fees.quote(f.wallet),/reorganized/);
 }finally{f.store.close()}
 const changed=fixture();try{changed.state.changed=true;await assert.rejects(changed.fees.quote(changed.wallet),/beneficiary history changed/);}finally{changed.store.close()}
});
test('system batches a fixed SHEN target; external campaign requests cannot request protocol authority',async()=>{
 const f=fixture();try{
  assert.throws(()=>f.campaigns.start({id:randomUUID(),coinId:f.coinId,kind:'shen_buyback_burn',amountWei:'1',expiresAt:Date.now()+60000}),/Invalid campaign/);
  const result=await f.fees.tick();assert.equal(result.campaign.kind,'shen_buyback_burn');assert.equal(result.campaign.amountWei,'100000000000000000');
  const row=f.campaigns.row(result.campaign.id);assert.equal(JSON.parse(row.record).targetToken,shen);
  await f.campaigns.tick(row.id);
  f.campaigns.addLeg(row,0,'buyback',row.amount_wei);
  const leg=f.campaigns.legs(row.id)[0];assert.equal(f.engine.transactionToken(leg,f.wallet),shen);
  f.store.createIntent({id:leg.id,coinId:f.coinId,kind:'buyback',amountWei:row.amount_wei,expiresAt:Date.now()+60000});
  assert.equal((await f.fees.quote(f.wallet)).reserveWei,'150000000000000000','unsigned or pending buys do not settle allocation');
  f.store.db.prepare("UPDATE intents SET status='confirmed',receipt_block=190,receipt_hash=? WHERE id=?").run('0x'+(190).toString(16).padStart(64,'0'),leg.id);
  assert.equal((await f.fees.quote(f.wallet)).reserveWei,'50000000000000000');
  assert.equal((await f.fees.quote(f.wallet)).reserveWei,'50000000000000000','confirmed purchase counted once');
  f.engine.policy.shenTokenAddress=token;assert.throws(()=>f.engine.transactionToken(leg,f.wallet),/configuration changed/);
 }finally{f.store.close()}
});
test('unconfigured SHEN and small batches retain the full allocation without buying',async()=>{
 const f=fixture();try{
  f.engine.policy.shenTokenAddress=null;assert.equal((await f.fees.tick()).processed,false);assert.equal((await f.fees.quote(f.wallet)).reserveWei,'150000000000000000');
  f.engine.policy.shenTokenAddress=shen;f.engine.policy.buybacksEnabled=false;assert.equal((await f.fees.tick()).processed,false);
 }finally{f.store.close()}
});
