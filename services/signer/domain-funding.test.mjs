import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { encodeAbiParameters,encodeEventTopics,encodeFunctionData,keccak256,parseAbi,recoverTypedDataAddress,zeroAddress } from 'viem';
import { getOrderId } from '@relay-protocol/settlement-sdk';
import { WalletStore } from './store.mjs';
import { SigningEngine } from './engine.mjs';
import { BASE_USDC,RELAY_DEPOSITORY,DomainFunding,hasPendingDomainBridge,paymentUrl,validateCheckout,validateRelayQuote,validateX402 } from './domain-funding.mjs';

const token='0x1111111111111111111111111111111111117777',merchant='0x3333333333333333333333333333333333333333',solver='0xf70da97812cb96acdf810712aa562db8dfa3dbef';
const hash='0x'+'a'.repeat(64),fillHash='0x'+'b'.repeat(64),payHash='0x'+'c'.repeat(64),requestId='0x'+'d'.repeat(64),salt='0x'+'e'.repeat(64);
const routerData='0x000000000000000000000000b92fe925dc43a0ecde6c8b1a2709c170ec4fff4f';
const url='https://api.cdp.coinbase.com/platform/v2/payment-sessions/paymentSession_test-123/authorizations/x402';
const depAbi=parseAbi(['function depositNative(address depositor,bytes32 id) payable']);
const events=parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers});
function checkout(amount=1500){return {status:'SUCCESS',checkoutId:'checkout123',amount_cents:amount,estimatedFee_cents:15,estimatedCredit_cents:amount-15,currency:'USDC',network:'base',payUrl:'https://payments.coinbase.com/payment-sessions/paymentSession_test-123',x402Url:url,expiresAt:new Date(Date.now()+3600000).toISOString()};}
function challenge(){return {x402Version:2,resource:{url,mimeType:'application/json'},accepts:[{scheme:'exact',network:'eip155:8453',asset:BASE_USDC,amount:'15000000',payTo:merchant,maxTimeoutSeconds:300,extra:{name:'USD Coin',version:'2'}}]};}
function quoteFor(payer,amount='15000000'){
 const deadline=Math.floor(Date.now()/1000)+300;
 const order={version:'v1',solverChainId:'base',solver,salt,inputs:[{payment:{chainId:'bnb',currency:zeroAddress,amount:'20000000000000000',weight:'1'},refunds:[{chainId:'bnb',recipient:payer,currency:zeroAddress,minimumAmount:'0',deadline,extraData:routerData}]}],output:{chainId:'base',payments:[{recipient:payer,currency:BASE_USDC,minimumAmount:amount,expectedAmount:amount}],calls:[],deadline,extraData:routerData},fees:[]};
 const orderId=getOrderId(order,{bnb:'ethereum-vm',base:'ethereum-vm'});
 return {protocol:{v2:{hubType:'onchain',orderId,orderData:order,paymentDetails:{chainId:'bnb',depository:RELAY_DEPOSITORY,currency:zeroAddress,amount:order.inputs[0].payment.amount}}},steps:[{id:'deposit',kind:'transaction',requestId,depositAddress:'',items:[{status:'incomplete',data:{chainId:56,from:payer,to:RELAY_DEPOSITORY,value:order.inputs[0].payment.amount,data:encodeFunctionData({abi:depAbi,functionName:'depositNative',args:[payer,orderId]})},check:{method:'GET',endpoint:'/intents/status/v3?requestId='+requestId}}]}],details:{sender:payer,recipient:payer,currencyIn:{currency:{chainId:56,address:zeroAddress},amount:order.inputs[0].payment.amount},currencyOut:{currency:{chainId:8453,address:BASE_USDC},minimumAmount:amount}}};
}
function transfer(from,to,value){return {address:BASE_USDC,topics:encodeEventTopics({abi:events,eventName:'Transfer',args:{from,to}}),data:encodeAbiParameters([{type:'uint256'}],[value])};}
function fixture(){
 const store=new WalletStore(':memory:',randomBytes(32).toString('hex')),coinId=randomUUID(),id=randomUUID();store.provision(coinId);store.bindLaunch(coinId,token,hash);const wallet=store.wallet(coinId);
 const state={baseBalance:0n,sourceReceipt:false,fill:false,paid:false,credited:false,checkoutTimeout:false,paymentTimeout:false,broadcastTimeout:false,quoteMutate:null,calls:[],broadcasts:[]};
 const block=number=>({number:number??100n,hash,timestamp:BigInt(Math.floor(Date.now()/1000))});
 const bnb={getChainId:async()=>56,getBlock:async({blockNumber}={})=>block(blockNumber),getBalance:async()=>1000000000000000000n,getTransactionCount:async()=>0,getGasPrice:async()=>1000000000n,estimateGas:async()=>30000n,getTransactionReceipt:async()=>{if(state.sourceReceipt)return {status:'success',blockNumber:90n,blockHash:hash};const e=Error('missing');e.name='TransactionReceiptNotFoundError';throw e;},sendRawTransaction:async({serializedTransaction})=>{state.broadcasts.push(serializedTransaction);if(state.broadcastTimeout)throw Error('Lost broadcast response');return keccak256(serializedTransaction);}};
 const base={getChainId:async()=>8453,getBlock:async({blockNumber}={})=>block(blockNumber),readContract:async({functionName})=>functionName==='balanceOf'?state.baseBalance:state.paid,getTransactionReceipt:async({hash:txHash})=>({status:'success',blockNumber:90n,blockHash:hash,logs:[txHash===fillHash?transfer(solver,wallet.address,15000000n):transfer(wallet.address,merchant,15000000n)]}),getLogs:async()=>state.paid?[{transactionHash:payHash}]:[]};
 const fetch=async(endpoint,init={})=>{
  state.calls.push({endpoint,init});assert.equal(init.redirect,'error');
  if(endpoint.endsWith('/account/topupCrypto')){if(state.checkoutTimeout)throw Error('Lost checkout response');return json(checkout());}
  if(endpoint.includes('/account/topupCryptoStatus/'))return json({status:'SUCCESS',checkoutId:'checkout123',state:state.credited?'COMPLETED':state.paid?'PROCESSING':'ACTIVE',credited:state.credited,balance_cents:1485});
  if(endpoint.endsWith('/quote/v2')){const body=JSON.parse(init.body);assert.equal(body.originChainId,56);assert.equal(body.destinationChainId,8453);assert.equal(body.recipient,wallet.address);assert.equal(body.refundTo,wallet.address);assert.equal(body.tradeType,'EXACT_OUTPUT');const q=quoteFor(wallet.address,body.amount);state.quoteMutate?.(q);return json(q);}
  if(endpoint.includes('/intents/status/v3'))return json({status:state.fill?'success':'pending',originChainId:56,destinationChainId:8453,inTxHashes:[funding.status(id).bridgeHash],txHashes:[fillHash]});
  if(endpoint===url){
   assert.equal(init.headers?.['X-API-Key'],undefined);const signed=init.headers?.['PAYMENT-SIGNATURE'];
   if(!signed)return json({},402,{'payment-required':Buffer.from(JSON.stringify(challenge())).toString('base64')});
   state.payment=JSON.parse(Buffer.from(signed,'base64').toString('utf8'));state.paid=true;if(state.paymentTimeout)throw Error('Lost payment response');return json({success:true});
  }
  throw Error('Unexpected external endpoint '+endpoint);
 };
 const policy={enabled:true,porkbunApiKey:'test-api',porkbunSecretKey:'test-secret',gasReserveWei:100000n,maxGasPriceWei:2000000000n};
 const dependencies={bnbClient:bnb,baseClient:base,fetch,getOrderId,verifyLaunch:async(c,h)=>{assert.equal(c,coinId);assert.equal(h,hash)}};
 let funding=new DomainFunding(store,dependencies,policy);
 const input={id,coinId,amountCents:1500,minimumCreditCents:1485,maxBnbWei:'30000000000000000',expiresAt:Date.now()+3600000};
 return {store,state,bnb,base,coinId,id,wallet,input,policy,dependencies,get funding(){return funding},restart(){funding=new DomainFunding(store,dependencies,policy)},tick(){return funding.tick(id)},close(){store.close()}};
}

test('official SDK binds canonical BNB deposit to exact Base USDC recipient, amount, and refund',async()=>{
 const f=fixture();try{const q=quoteFor(f.wallet.address);const params={payer:f.wallet.address,amountUsdc:'15000000',maxBnbWei:f.input.maxBnbWei,expiresAt:f.input.expiresAt};assert.equal((await validateRelayQuote(q,params,getOrderId)).to,RELAY_DEPOSITORY);
  const attacks=[q=>q.protocol.v2.orderData.output.payments[0].recipient=merchant,q=>q.protocol.v2.orderData.output.payments[0].minimumAmount='14999999',q=>q.protocol.v2.orderData.output.calls.push({to:merchant}),q=>q.protocol.v2.orderData.inputs[0].refunds[0].recipient=merchant,q=>q.protocol.v2.orderData.inputs[0].payment.amount='99999999999999999',q=>q.protocol.v2.orderData.output.extraData='0x',q=>q.protocol.v2.orderId=salt,q=>q.steps.push(q.steps[0]),q=>q.steps[0].kind='signature',q=>q.steps[0].items[0].data.to=merchant,q=>q.steps[0].items[0].data.data+='00',q=>q.steps[0].items[0].check.endpoint='https://evil.test/'];
  for(const attack of attacks){const bad=structuredClone(q);attack(bad);await assert.rejects(validateRelayQuote(bad,params,getOrderId));}
 }finally{f.close()}
});
test('checkout and x402 validators reject alternate sessions, assets, domains, amounts and extension mechanisms',()=>{
 assert.equal(validateCheckout(checkout(),1500).url,url);assert.equal(validateX402(challenge(),{url,amountCents:1500}).version,2);
 for(const bad of ['https://evil.test/'+url,'https://api.cdp.coinbase.com.evil.test/platform/v2/payment-sessions/paymentSession_x/authorizations/x402',url+'?redirect=evil',url.replace('https:','http:'),url.replace('api.cdp.coinbase.com','user@api.cdp.coinbase.com')])assert.throws(()=>paymentUrl(bad));
 assert.throws(()=>validateCheckout({...checkout(),payUrl:'https://payments.coinbase.com/payment-sessions/paymentSession_OTHER'},1500));
 for(const alter of [c=>c.accepts[0].amount='16000000',c=>c.accepts[0].asset=merchant,c=>c.accepts[0].network='eip155:56',c=>c.accepts[0].extra.name='USDC',c=>c.accepts[0].extra.assetTransferMethod='permit2',c=>c.resource.url='https://evil.test',c=>c.extensions={unknown:{}}]){const c=challenge();alter(c);assert.throws(()=>validateX402(c,{url,amountCents:1500}));}
});
test('durable complete workflow signs only one BNB deposit and one exact USDC authorization; credit requires both receipts and registrar confirmation',async()=>{
 const f=fixture();try{
  assert.equal(f.funding.start(f.input).status,'created');assert.equal(hasPendingDomainBridge(f.store,f.coinId),true);assert.deepEqual(f.funding.start(f.input),f.funding.status(f.id));assert.throws(()=>f.funding.start({...f.input,amountCents:1600}),/immutable/);
  assert.equal((await f.tick()).status,'checkout');assert.equal((await f.tick()).status,'quoted');assert.equal((await f.tick()).status,'signed');
  const stored=JSON.parse(f.funding.row(f.id).record);assert.ok(stored.rawTx);assert.ok(!stored.rawTx.includes('0xf8'));assert.equal(f.state.broadcasts.length,0,'signature is durable before broadcast');
  f.restart();assert.equal((await f.tick()).status,'broadcast');assert.equal(f.state.broadcasts.length,1);f.state.sourceReceipt=true;assert.equal((await f.tick()).status,'awaiting_usdc');
  f.state.fill=true;f.state.baseBalance=15000000n;assert.equal((await f.tick()).status,'bridged');assert.equal((await f.tick()).status,'authorized');assert.equal(f.state.paid,false);
  f.restart();assert.equal((await f.tick()).status,'paid');assert.equal((await f.tick()).status,'paid','provider acceptance alone is not registrar credit');
  const a=f.state.payment.payload.authorization;assert.equal(a.from,f.wallet.address);assert.equal(a.to,merchant);assert.equal(a.value,'15000000');assert.ok(Number(a.validBefore)-Math.floor(Date.now()/1000)<=300);
  const recovered=await recoverTypedDataAddress({domain:{name:'USD Coin',version:'2',chainId:8453,verifyingContract:BASE_USDC},types:{TransferWithAuthorization:[{name:'from',type:'address'},{name:'to',type:'address'},{name:'value',type:'uint256'},{name:'validAfter',type:'uint256'},{name:'validBefore',type:'uint256'},{name:'nonce',type:'bytes32'}]},primaryType:'TransferWithAuthorization',message:{...a,value:BigInt(a.value),validAfter:BigInt(a.validAfter),validBefore:BigInt(a.validBefore)},signature:f.state.payment.payload.signature});assert.equal(recovered.toLowerCase(),f.wallet.address.toLowerCase());
  f.state.credited=true;const done=await f.tick();assert.equal(done.status,'complete');assert.equal(done.creditedMicrousd,14850000);assert.equal(done.fillHash,fillHash);assert.equal(done.paymentHash,payHash);assert.equal(hasPendingDomainBridge(f.store,f.coinId),false);
  await f.tick();assert.equal(f.state.calls.filter(c=>c.init.headers?.['PAYMENT-SIGNATURE']).length,1);assert.equal(f.state.calls.filter(c=>c.endpoint.endsWith('/account/topupCrypto')).length,1);
 }finally{f.close()}
});
test('unknown checkout creation reuses its durable key within retention and never retries after retention',async()=>{const f=fixture();try{f.funding.start(f.input);f.state.checkoutTimeout=true;await assert.rejects(f.tick(),/Lost checkout/);f.restart();await assert.rejects(f.tick(),/Lost checkout/);assert.equal(f.state.calls.length,2);assert.equal(f.state.calls[0].init.headers['Idempotency-Key'],f.state.calls[1].init.headers['Idempotency-Key']);const row=f.funding.row(f.id),record=JSON.parse(row.record);record.checkoutStartedAt=Date.now()-86400001;f.store.db.prepare('UPDATE domain_funding_jobs SET record=? WHERE id=?').run(JSON.stringify(record),f.id);assert.equal((await f.tick()).status,'needs_reconciliation');assert.equal(f.state.calls.length,2);assert.equal(hasPendingDomainBridge(f.store,f.coinId),true)}finally{f.close()}});
test('lost BNB broadcast retries the identical signed bytes without re-quoting',async()=>{const f=fixture();try{f.funding.start(f.input);await f.tick();await f.tick();await f.tick();f.state.broadcastTimeout=true;await assert.rejects(f.tick(),/Lost broadcast/);f.restart();await assert.rejects(f.tick(),/Lost broadcast/);assert.equal(f.state.broadcasts.length,2);assert.equal(f.state.broadcasts[0],f.state.broadcasts[1]);assert.equal(f.state.calls.filter(c=>c.endpoint.endsWith('/quote/v2')).length,1)}finally{f.close()}});
test('unknown payment result never resubmits or creates a new EIP-3009 nonce',async()=>{const f=fixture();try{f.state.baseBalance=15000000n;f.funding.start(f.input);await f.tick();await f.tick();await f.tick();f.state.paymentTimeout=true;await assert.rejects(f.tick(),/Lost payment/);const firstNonce=f.state.payment.payload.authorization.nonce;f.restart();await f.tick();f.state.credited=true;assert.equal((await f.tick()).status,'complete');assert.equal(f.state.payment.payload.authorization.nonce,firstNonce);assert.equal(f.state.calls.filter(c=>c.init.headers?.['PAYMENT-SIGNATURE']).length,1)}finally{f.close()}});
test('regular signer cannot allocate a nonce while domain funding is pending',async()=>{const f=fixture();try{f.funding.start(f.input);const engine=new SigningEngine(f.store,f.bnb,{settlementAddress:merchant,gasReserveWei:1n,maxGasPriceWei:2000000000n});engine.bindLaunch=async()=>{};await assert.rejects(engine.execute({id:randomUUID(),coinId:f.coinId,kind:'compute',amountWei:'1',expiresAt:Date.now()+60000}),/Domain funding/);assert.equal(f.state.broadcasts.length,0)}finally{f.close()}});
test('lost wallet fence cannot publish signed bridge bytes or send funds',async()=>{const f=fixture();try{f.funding.start(f.input);await f.tick();await f.tick();f.bnb.estimateGas=async()=>{f.store.db.prepare('UPDATE wallets SET lock_until=0 WHERE coin_id=?').run(f.coinId);return 30000n};await assert.rejects(f.tick(),/lease changed/);assert.equal(f.funding.status(f.id).status,'quoted');assert.equal(f.state.broadcasts.length,0);assert.equal(JSON.parse(f.funding.row(f.id).record).rawTx,undefined)}finally{f.close()}});
test('incorrect Base RPC, bridge quotes and untracked nonces fail before signing',async()=>{for(const mode of ['base','quote','nonce']){const f=fixture();try{f.funding.start(f.input);await f.tick();if(mode==='base')f.base.getChainId=async()=>56;if(mode==='quote')f.state.quoteMutate=q=>q.steps[0].items[0].data.to=merchant;if(mode==='nonce'){await f.tick();f.bnb.getTransactionCount=async({blockTag})=>blockTag==='pending'?1:0;}await assert.rejects(f.tick());assert.equal(f.state.broadcasts.length,0);assert.equal(JSON.parse(f.funding.row(f.id).record).rawTx,undefined)}finally{f.close()}}});
test('gas is inside the authorized BNB maximum and insufficient registrar credit is rejected before bridging',async()=>{
 for(const mode of ['gas','credit']){const f=fixture();try{f.funding.start({...f.input,...(mode==='gas'?{maxBnbWei:'20000000000000000'}:{minimumCreditCents:1490})});const checkout=await f.tick();if(mode==='credit'){assert.equal(checkout.status,'failed');assert.equal(f.state.calls.length,1)}else{await f.tick();await assert.rejects(f.tick(),/plus maximum gas/)}assert.equal(f.state.broadcasts.length,0)}finally{f.close()}}
});
test('production funding rejects sandbox keys and sandbox checkout evidence',async()=>{
 const f=fixture();try{f.policy.porkbunApiKey='pk1_sb_example';assert.throws(()=>f.funding.start(f.input),/Sandbox/);f.policy.porkbunApiKey='test-api';f.funding.start(f.input);f.funding.fetch=async()=>json({...checkout(),sandbox:true});await assert.rejects(f.tick(),/Sandbox/);assert.equal(f.state.broadcasts.length,0)}finally{f.close()}
});
test('seven-day Relay settlement deadline is accepted but stale local quotes are refreshed before signing',async()=>{
 const f=fixture();try{const q=quoteFor(f.wallet.address),deadline=Math.floor(Date.now()/1000)+7*86400;q.protocol.v2.orderData.output.deadline=deadline;q.protocol.v2.orderData.inputs[0].refunds[0].deadline=deadline;q.protocol.v2.orderId=getOrderId(q.protocol.v2.orderData,{bnb:'ethereum-vm',base:'ethereum-vm'});q.steps[0].items[0].data.data=encodeFunctionData({abi:depAbi,functionName:'depositNative',args:[f.wallet.address,q.protocol.v2.orderId]});await validateRelayQuote(q,{payer:f.wallet.address,amountUsdc:'15000000',maxBnbWei:f.input.maxBnbWei,expiresAt:f.input.expiresAt},getOrderId);
  f.funding.start(f.input);await f.tick();await f.tick();const r=JSON.parse(f.funding.row(f.id).record);r.quoteObtainedAt=Date.now()-90001;f.store.db.prepare('UPDATE domain_funding_jobs SET record=? WHERE id=?').run(JSON.stringify(r),f.id);assert.equal((await f.tick()).status,'checkout');assert.equal(f.state.broadcasts.length,0);
 }finally{f.close()}
});
test('real signer entrypoint starts with automatic funding disabled and the pinned SDK installed',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'shen-signer-start-')),root=resolve(tmpdir());requireSafe();let child;
 function requireSafe(){assert.ok(resolve(directory).startsWith(root+sep),'Temporary test directory must stay under OS temp');}
 try{
  child=spawn(process.execPath,['index.mjs'],{cwd:new URL('.',import.meta.url),env:{...process.env,PORT:'0',HOST:'127.0.0.1',SIGNER_DB_PATH:join(directory,'signer.sqlite'),SIGNER_MASTER_KEY:randomBytes(32).toString('hex'),SIGNER_WEB_TOKEN:'web-'.repeat(20),SIGNER_WORKER_TOKEN:'worker-'.repeat(20),BNB_RPC_URL:'https://example.invalid',SIGNER_SETTLEMENT_ADDRESS:merchant,SIGNER_SLIPPAGE_BPS:'50',SIGNER_GAS_RESERVE_WEI:'1',SIGNER_MAX_GAS_PRICE_WEI:'1000000000',DOMAIN_AUTO_FUNDING_ENABLED:'false',PORKBUN_API_KEY:'',PORKBUN_SECRET_KEY:''},stdio:['ignore','pipe','pipe'],windowsHide:true});
  await new Promise((done,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Signer did not start')),10000);child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('SHEN signing service listening')){clearTimeout(timer);done()}});child.once('exit',code=>{clearTimeout(timer);reject(Error('Signer exited before listening: '+code))});});
 }finally{if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise(done=>child.once('exit',done))}requireSafe();rmSync(directory,{recursive:true,force:true})}
});
