import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./runtime-loader.mjs',import.meta.url);globalThis.__shenTestEnv={};
const {feeWindows,readFeeSample,continuousRouting}=await import('../lib/treasury-flow.ts');
const {marketNumber,tokenMarket}=await import('../lib/market.ts');
const token='0x1111111111111111111111111111111111111111',wallet='0x2222222222222222222222222222222222222222',processor='0x3333333333333333333333333333333333333333';
const sample=(t,total,balance='1')=>({processor,blockNumber:String(t),blockHash:'0x'+'a'.repeat(64),observedAt:t,balanceWei:balance,cumulativeFeesWei:String(total),pendingFeesWei:'9000'});
test('fee rates use actual elapsed counter differences, not treasury deposits or pending fees',()=>{
 assert.equal(feeWindows([sample(1000,100)])[0].distributedWei,null);
 const windows=feeWindows([sample(1000,100),sample(1801000,160,'99999999999')]);assert.equal(windows[0].distributedWei,'60');assert.equal(windows[0].averageWeiPerHour,'120');assert.equal(windows[0].fullWindow,false);assert.equal(windows[0].observedMinutes,30);
 assert.equal(feeWindows([sample(1000,100),sample(3601000,100,'99999')])[0].distributedWei,'0');assert.equal(feeWindows([sample(1000,100),sample(3601000,99)])[0].distributedWei,null);
});
test('fee snapshots pin every contract read and reject changed bindings and in-flight reorgs',async()=>{
 const calls=[],block={number:100n,hash:'0x'+'a'.repeat(64),timestamp:BigInt(Math.floor(Date.now()/1000))};let beneficiary=wallet,reorg=false,blocks=0;
 const client={getBlock:async v=>{assert.equal(v.blockNumber,100n);return {...block,hash:reorg&&blocks++?'0x'+'b'.repeat(64):block.hash}},readContract:async args=>{calls.push(args);const values={taxProcessor:processor,taxToken:token,marketAddress:beneficiary,weth:'0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',feeConfigV2:{isWeth:true,marketBps:10000,lpBps:0,dividendBps:0,deflationBps:0},totalQuoteSentToMarketing:33n,marketQuoteBalance:7n};return values[args.functionName]}};
 assert.equal((await readFeeSample(client,token,wallet,100n,'4')).cumulativeFeesWei,'33');assert.ok(calls.every(c=>c.blockNumber===100n));beneficiary=token;await assert.rejects(readFeeSample(client,token,wallet,100n,'4'),/routing/);beneficiary=wallet;reorg=true;await assert.rejects(readFeeSample(client,token,wallet,100n,'4'),/changed/);
});
test('routing checks cover both privileged update events, use bounded ranges and invalidate long gaps',async()=>{
 const calls=[];let changed=false;const client={getLogs:async args=>{calls.push(args);return changed&&args.event.name==='MarketWalletChanged'?[{}]:[]}};
 assert.equal(await continuousRouting(client,token,1n,5100n),true);assert.equal(calls.length,4);assert.ok(calls.every(c=>c.args.token===token&&c.toBlock-c.fromBlock<5000n));changed=true;assert.equal(await continuousRouting(client,token,1n,10n),false);assert.equal(await continuousRouting(client,token,1n,30000n),false);
});
test('market valuation keeps missing market cap separate from FDV and rejects mismatched tokens',()=>{
 for(const invalid of [null,undefined,'','NaN','Infinity','-1',' 2 ',3])assert.equal(marketNumber(invalid),null);
 const payload={data:{id:'bsc_'+token,attributes:{address:token,market_cap_usd:null,fdv_usd:'12345',price_usd:'0.02',total_reserve_in_usd:'100',volume_usd:{h24:'80'}}}};
 const data=tokenMarket(payload,token,Date.now());assert.equal(data.valuation.marketCapUsd,null);assert.equal(data.valuation.fullyDilutedValuationUsd,12345);assert.equal(data.valuation.volume24hUsd,80);assert.throws(()=>tokenMarket(payload,wallet,Date.now()),/identity/);
});
