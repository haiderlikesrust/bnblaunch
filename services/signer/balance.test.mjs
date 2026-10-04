import test from 'node:test';
import assert from 'node:assert/strict';
import {walletBalanceSnapshot,feeAccountingIssue} from './balance.mjs';

test('a failed fee audit returns the actual balance with unknown reserves, never zero reserves',async()=>{
 const wallet={coin_id:'coin',address:'0x'+'1'.repeat(40),token_address:'0x'+'2'.repeat(40)};
 const engine={chainReady:async()=>({number:100n})};
 const client={getBalance:async({blockNumber})=>{assert.equal(blockNumber,97n);return 16632794145599999n}};
 const data=await walletBalanceSnapshot(wallet,engine,client,{quote:async()=>{throw Error('limited to a 5 blocks range: https://secret-rpc/APIKEY')}});
 assert.equal(data.balanceWei,'16632794145599999');assert.equal(data.protocolReserveWei,null);assert.equal(data.feeAccountingReady,false);assert.equal(data.feeAccountingIssue,'rpc_log_limit');assert.equal(JSON.stringify(data).includes('APIKEY'),false);
 const ready=await walletBalanceSnapshot(wallet,engine,client,{quote:async()=>({reserveWei:'123'})});assert.equal(ready.protocolReserveWei,'123');assert.equal(ready.feeAccountingReady,true);
});
test('fee diagnostics recognize nested archive errors without exposing provider messages',()=>{
 assert.equal(feeAccountingIssue(new Error('Provider failed',{cause:{details:'missing trie node'}})),'historical_rpc_required');
 assert.equal(feeAccountingIssue(Error('Fee routing audit is catching up')),'fee_audit_pending');
 assert.equal(feeAccountingIssue(Error('Fee routing does not match')),'fee_verification_failed');
});
