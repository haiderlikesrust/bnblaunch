import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,randomBytes } from 'node:crypto';
import { decodeFunctionData,encodeAbiParameters,encodeEventTopics,keccak256,parseAbi,parseTransaction,zeroAddress } from 'viem';
import { WalletStore } from './store.mjs';
import { SigningEngine } from './engine.mjs';
import { Campaigns,allocateRewards,applyTransfers,DEAD,netReceived } from './campaigns.mjs';
import { PORTAL } from '../../shared/flap-contract.mjs';
const token='0x1111111111111111111111111111111111117777',a='0x2222222222222222222222222222222222222222',b='0x3333333333333333333333333333333333333333',contract='0x4444444444444444444444444444444444444444';
const hash='0x'+'a'.repeat(64),launch='0x'+'b'.repeat(64),event=parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']);
function log(from,to,value,index=0){return {address:token,topics:encodeEventTopics({abi:event,eventName:'Transfer',args:{from,to}}),data:encodeAbiParameters([{type:'uint256'}],[value]),blockNumber:100n,blockHash:hash,transactionHash:launch,logIndex:index,removed:false};}
function fixture(kind='rewards'){
 const store=new WalletStore(':memory:',randomBytes(32).toString('hex')),coinId=randomUUID(),id=randomUUID();store.provision(coinId);store.bindLaunch(coinId,token,launch);const wallet=store.wallet(coinId);
 const receipts=new Map(),raws=[],nonce={value:0},state={canonical:hash,burnProof:true};
 const client={getChainId:async()=>56,getBlock:async({blockNumber}={})=>({number:blockNumber??200n,hash:state.canonical,timestamp:BigInt(Math.floor(Date.now()/1000))}),getBalance:async()=>10n**20n,getCode:async({address})=>address===contract?'0x01':'0x',getTransactionCount:async()=>nonce.value,getGasPrice:async()=>1n,estimateGas:async()=>21000n,
  getLogs:async()=>[log(zeroAddress,a,100n),log(zeroAddress,b,100n,1),log(zeroAddress,contract,50n,2)],
  readContract:async({functionName,args})=>functionName==='totalSupply'?250n:functionName==='getTokenV8Safe'?{status:1,tokenVersion:6,quoteTokenAddress:zeroAddress,dexId:0,buyTaxRate:300n}:args[0]===a||args[0]===b?100n:500n,
  simulateContract:async({args})=>({result:args[0].inputAmount*1000n}),
  getTransactionReceipt:async({hash:h})=>{if(h===launch)return {status:'success',blockNumber:100n,blockHash:hash};if(receipts.has(h))return receipts.get(h);const e=Error();e.name='TransactionReceiptNotFoundError';throw e;},
  sendRawTransaction:async({serializedTransaction})=>{raws.push(serializedTransaction);const h=keccak256(serializedTransaction);if(!receipts.has(h)){const tx=parseTransaction(serializedTransaction);let logs=[];
   if(tx.to.toLowerCase()===PORTAL.toLowerCase())logs=[log(PORTAL,wallet.address,500n)];
   if(tx.to.toLowerCase()===token.toLowerCase()&&state.burnProof){const decoded=decodeFunctionData({abi:parseAbi(['function transfer(address,uint256) returns(bool)']),data:tx.data});logs=[log(wallet.address,decoded.args[0],decoded.args[1])];}
   receipts.set(h,{status:'success',blockNumber:190n,blockHash:hash,logs});nonce.value++;}throw Error('Lost acknowledgement after broadcast');}
 };
 const engine=new SigningEngine(store,client,{buybacksEnabled:true,slippageBps:100,maxGasPriceWei:1n,gasReserveWei:1000n,settlementAddress:a});engine.bindLaunch=async()=>({});const campaigns=new Campaigns(store,engine);
 const input={id,coinId,kind,amountWei:'1000000',expiresAt:Date.now()+240000};campaigns.start(input);
 return {store,engine,campaigns,input,wallet,client,raws,receipts,state};
}
async function finish(f){for(let i=0;i<30;i++){const r=await f.campaigns.tick(f.input.id);if(['complete','failed','partial'].includes(r.status))return r;}throw Error('Did not finish');}
test('deterministic allocations include gas, exclude uneconomical dust and retain rounding remainder',()=>{
 const result=allocateRewards({[a]:'100',[b]:'100',[contract]:'1'},1000000n,25200n);assert.deepEqual(result,[{address:a,amountWei:'474800'},{address:b,amountWei:'474800'}]);
 assert.throws(()=>allocateRewards({[a]:'1'},1n,25200n));
});
test('holder ledger rejects missing history and duplicate logs, handles mint, transfer and burn',()=>{
 const balances={};applyTransfers(balances,[log(zeroAddress,a,100n),log(a,b,40n,1),log(b,zeroAddress,10n,2)],token);assert.deepEqual(balances,{[a]:'60',[b]:'30'});
 assert.throws(()=>applyTransfers({},[log(a,b,100n)],token));assert.throws(()=>applyTransfers({},[log(zeroAddress,a,100n),log(zeroAddress,a,100n)],token));
 assert.equal(netReceived([log(a,b,10n),log(b,a,3n,1)],token,b),7n);
});
test('reward campaign derives holders on chain, excludes contracts, journals two exact payments and survives replay',async()=>{
 const f=fixture();try{const result=await finish(f);assert.equal(result.status,'complete');assert.equal(result.recipientCount,2);assert.equal(result.paidWei,'949600');assert.equal(f.raws.length,2);
  const txs=f.raws.map(raw=>parseTransaction(raw));assert.deepEqual(txs.map(t=>t.to.toLowerCase()),[a,b]);assert.deepEqual(txs.map(t=>t.value),[474800n,474800n]);
  const restarted=new Campaigns(f.store,f.engine);assert.equal((await restarted.tick(f.input.id)).status,'complete');assert.equal(f.raws.length,2);assert.deepEqual(restarted.start(f.input),result);
  assert.throws(()=>restarted.start({...f.input,amountWei:'1000001'}));
 }finally{f.store.close();}
});
test('combined buy and burn burns only tokens from the confirmed buy receipt and never buys twice',async()=>{
 const f=fixture('buyback_burn');try{const result=await finish(f);assert.equal(result.status,'complete');assert.equal(result.boughtTokenWei,'500');assert.equal(result.burnedTokenWei,'500');assert.equal(result.transactions.length,2);assert.equal(f.raws.length,2);
  const burn=parseTransaction(f.raws[1]);const decoded=decodeFunctionData({abi:parseAbi(['function transfer(address,uint256) returns(bool)']),data:burn.data});assert.equal(decoded.args[0].toLowerCase(),DEAD);assert.equal(decoded.args[1],500n);
 }finally{f.store.close();}
});
test('snapshot reorg and unapproved reward intent fail before money moves',async()=>{
 const f=fixture();try{await f.campaigns.tick(f.input.id);f.state.canonical='0x'+'c'.repeat(64);await assert.rejects(f.campaigns.tick(f.input.id),/reorganized/);assert.equal(f.raws.length,0);
  await assert.rejects(f.engine.execute({id:randomUUID(),coinId:f.input.coinId,kind:'reward',amountWei:'100',expiresAt:Date.now()+60000}));
  await assert.rejects(f.engine.execute({id:randomUUID(),coinId:f.input.coinId,kind:'compute',amountWei:'100',expiresAt:Date.now()+60000}),/campaign/);
 }finally{f.store.close();}
});
test('successful EVM status without a burn transfer never completes the burn campaign',async()=>{
 const f=fixture('buyback_burn');try{f.state.burnProof=false;await assert.rejects(finish(f),/Burn-sink receipt/);assert.equal(f.campaigns.status(f.input.id).status,'running');assert.equal(f.raws.length,2);}finally{f.store.close();}
});
test('large price impact is rejected even with a valid quote',()=>{const f=fixture();try{assert.throws(()=>f.engine.checkPriceImpact(1000n,900n,1n,1n),/price-impact/);f.engine.checkPriceImpact(1000n,980n,1n,1n);}finally{f.store.close();}});
test('expired unsigned reward legs produce partial results and never replace a payment',async()=>{
 const f=fixture();try{
  for(let i=0;i<5;i++)await f.campaigns.tick(f.input.id);
  const legs=f.campaigns.legs(f.input.id);assert.equal(legs[0].status,'confirmed');assert.equal(legs[1].expires_at,0,'unused recipients do not inherit the first recipient deadline');
  f.store.db.prepare('UPDATE campaign_legs SET expires_at=1 WHERE id=?').run(legs[1].id);
  const result=await finish(f);assert.equal(result.status,'partial');assert.equal(result.paidWei,'474800');assert.equal(f.raws.length,1);
 }finally{f.store.close();}
});
test('incomplete holder history does not commit a partially mutated ledger',async()=>{
 const f=fixture();try{await f.campaigns.tick(f.input.id);f.client.getLogs=async()=>[log(zeroAddress,a,10n),log(b,a,20n,1)];await assert.rejects(f.campaigns.tick(f.input.id),/Incomplete/);const r=JSON.parse(f.campaigns.row(f.input.id).record);assert.deepEqual(r.balances,{});assert.equal(r.cursor,'100');assert.equal(f.raws.length,0);}finally{f.store.close();}
});
test('a budget too small for reward gas fails without locking the wallet indefinitely',async()=>{
 const f=fixture();try{f.engine.policy.maxGasPriceWei=1000n;await f.campaigns.tick(f.input.id);await f.campaigns.tick(f.input.id);const result=await f.campaigns.tick(f.input.id);assert.equal(result.status,'failed');assert.equal(f.raws.length,0);}finally{f.store.close();}
});
