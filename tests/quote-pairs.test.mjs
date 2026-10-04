import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {zeroAddress} from 'viem';
import {quoteTokenInfo,validateConversionRoute,WBNB,gasDepositTarget} from '../shared/quote-pairs.mjs';
import {launchParams} from '../lib/flap.ts';
import {PLATFORM_POLICY} from '../lib/platform-policy.ts';
register('./runtime-loader.mjs',import.meta.url);globalThis.__shenTestEnv={};
const {parseQuoteBuy}=await import('../lib/launch-validation.ts');
const {verifyGasDeposit}=await import('../lib/gas-deposit.ts');
const {curveCandles}=await import('../lib/curve-candles.ts');
const asset='0x1111111111111111111111111111111111111111';
test('new launches use two percent tax and quote base units without rounding',()=>{
 const p=launchParams({...PLATFORM_POLICY,name:'Test',symbol:'TEST',quoteToken:asset},'cid',asset,'0x'+'1'.repeat(64),parseQuoteBuy('1.234567',6));
 assert.equal(p.buyTaxRate,200);assert.equal(p.sellTaxRate,200);assert.equal(p.quoteAmt,1234567n);assert.equal(p.quoteToken,asset);assert.equal(p.dividendToken,asset);
 assert.throws(()=>parseQuoteBuy('1.2345678',6));assert.equal(parseQuoteBuy('1',0),1n);
});
test('curve candles preserve the quote token decimals instead of treating every amount as BNB',()=>{
 const candles=curveCandles([{block:1,logIndex:0,time:1700000100,tokenWei:'100000000000000000000',quoteWei:'2500000'}],6);
 assert.equal(candles[0].close,.025);assert.equal(candles[0].volume,2.5);
});
test('pair metadata is checked on-chain and conversion paths cannot select arbitrary routers or intermediaries',async()=>{
 const client={readContract:async({functionName})=>({getQuoteTokenConfiguration:{enabled:1,dexId:0},symbol:'PAIR',name:'Pair',decimals:6})[functionName]};
 assert.equal((await quoteTokenInfo(client,asset)).decimals,6);
 await assert.rejects(quoteTokenInfo({...client,readContract:async()=>({enabled:0})},asset));
 assert.throws(()=>validateConversionRoute({kind:'v3',tokens:[asset,WBNB],fees:[999]},asset));
 assert.throws(()=>validateConversionRoute({kind:'v2',tokens:[asset,'0x'+'2'.repeat(40),WBNB]},asset));
 assert.throws(()=>validateConversionRoute({kind:'arbitrary',tokens:[asset,WBNB]},asset));
 assert.equal(gasDepositTarget(2000000000000000n,3000000000n),6500000000000000n);
});
test('gas deposit needs exact creator, agent, amount and canonical confirmed receipt',async()=>{
 const deposit={creator:asset,wallet:'0x'+'2'.repeat(40),amount_wei:'6500',tx_hash:'0x'+'a'.repeat(64)},blockHash='0x'+'b'.repeat(64);
 let tx={from:deposit.creator,to:deposit.wallet,value:6500n,input:'0x'},head=103n,hash=blockHash;
 const client={getChainId:async()=>56,getTransaction:async()=>tx,getTransactionReceipt:async()=>({status:'success',blockNumber:100n,blockHash}),getBlockNumber:async()=>head,getBlock:async()=>({hash})};
 assert.equal((await verifyGasDeposit(client,deposit)).blockNumber,'100');head=102n;assert.equal(await verifyGasDeposit(client,deposit),null);head=103n;
 tx={...tx,to:zeroAddress};await assert.rejects(verifyGasDeposit(client,deposit),/does not match/);tx={...tx,to:deposit.wallet};hash='0x'+'c'.repeat(64);await assert.rejects(verifyGasDeposit(client,deposit),/confirmation changed/);
});
