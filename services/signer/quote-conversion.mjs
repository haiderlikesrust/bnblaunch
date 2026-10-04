import {randomUUID} from 'node:crypto';
import {encodeFunctionData,decodeEventLog,zeroAddress} from 'viem';
import {WBNB,V2_ROUTER,V3_ROUTER,erc20QuoteAbi,v2ConversionAbi,v3ConversionAbi,findConversionRoute,quoteConversion,packedRoute,validateConversionRoute,sameAddress} from '../../shared/quote-pairs.mjs';
import {netReceived,pendingCampaign} from './campaigns.mjs';
import {hasPendingDomainBridge} from './domain-funding.mjs';
const same=sameAddress;
const phaseKind={reset:'convert_reset',approve:'convert_approve',swap:'convert_swap',unwrap:'convert_unwrap'};
const MIN_OUTPUT=1000000000000000n;
export class QuoteConversions{
 constructor(store,engine){
  this.store=store;this.engine=engine;this.client=engine.client;
  store.db.exec(`CREATE TABLE IF NOT EXISTS quote_conversions(id TEXT PRIMARY KEY,coin_id TEXT NOT NULL REFERENCES wallets(coin_id),quote_token TEXT NOT NULL,amount_units TEXT NOT NULL,phase TEXT NOT NULL,route TEXT NOT NULL,output_units TEXT NOT NULL DEFAULT '0',minimum_units TEXT NOT NULL DEFAULT '0',current_id TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,next_attempt_at INTEGER NOT NULL DEFAULT 0);
  CREATE UNIQUE INDEX IF NOT EXISTS conversion_open ON quote_conversions(coin_id) WHERE phase NOT IN ('complete','failed');
  CREATE TABLE IF NOT EXISTS conversion_legs(id TEXT PRIMARY KEY,batch_id TEXT NOT NULL REFERENCES quote_conversions(id),kind TEXT NOT NULL,amount_units TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS conversion_cursor(id INTEGER PRIMARY KEY CHECK(id=1),coin_id TEXT NOT NULL);INSERT OR IGNORE INTO conversion_cursor VALUES(1,'');`);
 }
 async realized(coinId){
  const rows=this.store.db.prepare("SELECT q.output_units,i.receipt_block,i.receipt_hash FROM quote_conversions q JOIN conversion_legs l ON l.batch_id=q.id AND l.kind='convert_unwrap' JOIN intents i ON i.id=l.id AND i.status='confirmed' WHERE q.coin_id=?").all(coinId);
  const last=rows.reduce((a,b)=>!a||BigInt(b.receipt_block)>BigInt(a.receipt_block)?b:a,null);
  if(last&&((await this.client.getBlock({blockNumber:BigInt(last.receipt_block)})).hash!==last.receipt_hash))throw Error('Conversion history reorganized; reconciliation required');
  return rows.reduce((sum,r)=>sum+BigInt(r.output_units),0n);
 }
 consumed(coinId){
  return this.store.db.prepare("SELECT q.amount_units FROM quote_conversions q JOIN conversion_legs l ON l.batch_id=q.id AND l.kind='convert_swap' JOIN intents i ON i.id=l.id AND i.status='confirmed' WHERE q.coin_id=?").all(coinId).reduce((sum,r)=>sum+BigInt(r.amount_units),0n);
 }
 records(coinId){
  return this.store.db.prepare('SELECT id,quote_token,amount_units,output_units,phase,updated_at FROM quote_conversions WHERE coin_id=? ORDER BY created_at DESC LIMIT 6').all(coinId).map(r=>({id:r.id,quoteToken:r.quote_token,amountUnits:r.amount_units,outputWei:r.output_units,phase:r.phase,updatedAt:r.updated_at,transactions:this.store.db.prepare('SELECT i.tx_hash AS hash,i.kind,i.status FROM conversion_legs l JOIN intents i ON i.id=l.id WHERE l.batch_id=? AND i.tx_hash IS NOT NULL ORDER BY i.created_at').all(r.id)}));
 }
 batchFor(row,active=true){
  const leg=this.store.db.prepare('SELECT * FROM conversion_legs WHERE id=?').get(row.id),batch=leg&&this.store.db.prepare('SELECT * FROM quote_conversions WHERE id=?').get(leg.batch_id);
  if(!batch||batch.coin_id!==row.coin_id||leg.kind!==row.kind||leg.amount_units!==row.amount_wei||(active&&(batch.current_id!==row.id||phaseKind[batch.phase]!==row.kind)))throw Error('Conversion intent is not authorized');
  return batch;
 }
 async transaction(row,wallet){
  const batch=this.batchFor(row),route=validateConversionRoute(JSON.parse(batch.route),batch.quote_token),amount=BigInt(batch.amount_units);
  if(!same(wallet.quote_token,batch.quote_token)||same(batch.quote_token,zeroAddress)||same(batch.quote_token,WBNB))throw Error('Conversion asset does not match the launch');
  const spender=route.kind==='v2'?V2_ROUTER:V3_ROUTER;
  if(row.kind==='convert_unwrap'){
   const output=BigInt(batch.output_units);if(output<=0n||output!==BigInt(row.amount_wei))throw Error('No verified conversion proceeds');
   return {to:WBNB,value:0n,data:encodeFunctionData({abi:erc20QuoteAbi,functionName:'withdraw',args:[output]})};
  }
  const fees=await this.engine.protocolFees.quote(wallet);
  if(!same(fees.quoteToken,batch.quote_token)||BigInt(fees.distributedQuoteUnits)-this.consumed(wallet.coin_id)<amount)throw Error('Conversion exceeds verified fee income');
  const balance=await this.client.readContract({address:batch.quote_token,abi:erc20QuoteAbi,functionName:'balanceOf',args:[wallet.address],blockTag:'pending'});
  if(balance<amount)throw Error('Insufficient quote-token fees');
  const expected=await quoteConversion(this.client,route,amount),gasPrice=await this.client.getGasPrice();
  if(expected<MIN_OUTPUT||expected<gasPrice*1500000n*2n)throw Error('Fees must accumulate before conversion is economical');
  if(row.kind==='convert_approve'||row.kind==='convert_reset')return {to:batch.quote_token,value:0n,data:encodeFunctionData({abi:erc20QuoteAbi,functionName:'approve',args:[spender,row.kind==='convert_reset'?0n:amount]})};
  if(row.kind!=='convert_swap')throw Error('Invalid conversion step');
  const allowance=await this.client.readContract({address:batch.quote_token,abi:erc20QuoteAbi,functionName:'allowance',args:[wallet.address,spender]});
  if(allowance<amount)throw Error('Conversion approval is not confirmed');
  const output=await quoteConversion(this.client,route,amount),probeAmount=amount/1000n||1n,probe=await quoteConversion(this.client,route,probeAmount);
  this.engine.checkPriceImpact(amount,output,probeAmount,probe);
  const minimum=output*(10000n-BigInt(this.engine.policy.slippageBps))/10000n;
  if(minimum<MIN_OUTPUT)throw Error('Conversion size is outside economical bounds');
  this.store.db.prepare('UPDATE quote_conversions SET minimum_units=? WHERE id=? AND current_id=?').run(minimum.toString(),batch.id,row.id);
  const deadline=BigInt(Math.floor(row.expires_at/1000));
  return {to:spender,value:0n,data:route.kind==='v2'?encodeFunctionData({abi:v2ConversionAbi,functionName:'swapExactTokensForTokensSupportingFeeOnTransferTokens',args:[amount,minimum,route.tokens,wallet.address,deadline]}):encodeFunctionData({abi:v3ConversionAbi,functionName:'exactInput',args:[{path:packedRoute(route),recipient:wallet.address,deadline,amountIn:amount,amountOutMinimum:minimum}]})};
 }
 async verifyReceipt(row,wallet,receipt){
  const batch=this.batchFor(row,false);
  if(row.kind==='convert_swap'){
   const out=netReceived(receipt.logs??[],WBNB,wallet.address),spent=-netReceived(receipt.logs??[],batch.quote_token,wallet.address);
   if(out<BigInt(batch.minimum_units)||out<=0n||spent!==BigInt(batch.amount_units))throw Error('Conversion receipt does not prove the authorized input and output');
   if(BigInt(batch.output_units)!==0n&&BigInt(batch.output_units)!==out)throw Error('Conversion receipt changed');
   this.store.db.prepare('UPDATE quote_conversions SET output_units=? WHERE id=?').run(out.toString(),batch.id);
  }
  if(row.kind==='convert_unwrap'){
   let unwrapped=0n;for(const log of receipt.logs??[]){if(!same(log.address,WBNB))continue;try{const e=decodeEventLog({abi:erc20QuoteAbi,topics:log.topics,data:log.data,strict:true});if(e.eventName==='Withdrawal'&&same(e.args.src,wallet.address))unwrapped+=e.args.wad;}catch{}}
   if(unwrapped!==BigInt(batch.output_units)||unwrapped!==BigInt(row.amount_wei))throw Error('Native BNB receipt does not match conversion proceeds');
  }
 }
 async start(wallet){
  const fees=await this.engine.protocolFees.quote(wallet),remaining=BigInt(fees.distributedQuoteUnits??0)-this.consumed(wallet.coin_id);
  if(remaining<=0n)return null;
  const head=await this.engine.chainReady(),balance=await this.client.readContract({address:wallet.quote_token,abi:erc20QuoteAbi,functionName:'balanceOf',args:[wallet.address],blockNumber:head.number-3n});
  let amount=remaining<balance?remaining:balance;if(amount<=0n)return null;
  let selected=await findConversionRoute(this.client,wallet.quote_token,amount);
  for(let attempt=0;;attempt++){
   const probeAmount=amount/1000n||1n,probe=await quoteConversion(this.client,selected,probeAmount);
   try{this.engine.checkPriceImpact(amount,selected.output,probeAmount,probe);break;}catch{if(attempt>=8||amount<=1n)throw Error('No economical conversion within price-impact policy');amount/=2n;selected={...selected,output:await quoteConversion(this.client,selected,amount)};}
  }
  if(selected.output<MIN_OUTPUT)return null;
  const {output,...route}=selected,spender=route.kind==='v2'?V2_ROUTER:V3_ROUTER;
  const allowance=await this.client.readContract({address:wallet.quote_token,abi:erc20QuoteAbi,functionName:'allowance',args:[wallet.address,spender]});
  const phase=allowance>=amount?'swap':allowance>0n?'reset':'approve',id=randomUUID(),now=Date.now();
  // Exact input and its route are durable before any approval is signed.
  this.store.db.prepare('INSERT INTO quote_conversions(id,coin_id,quote_token,amount_units,phase,route,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id,wallet.coin_id,wallet.quote_token,amount.toString(),phase,JSON.stringify(route),now,now);
  return this.store.db.prepare('SELECT * FROM quote_conversions WHERE id=?').get(id);
 }
 async tick(){
  const cursor=this.store.db.prepare('SELECT coin_id FROM conversion_cursor WHERE id=1').get().coin_id;
  const select="SELECT w.coin_id FROM wallets w JOIN wallet_quotes q ON q.coin_id=w.coin_id WHERE w.token_address IS NOT NULL AND q.quote_token<>?";
  const next=this.store.db.prepare(select+' AND w.coin_id>? ORDER BY w.coin_id LIMIT 1').get(zeroAddress,cursor)??this.store.db.prepare(select+' ORDER BY w.coin_id LIMIT 1').get(zeroAddress);
  if(!next)return {processed:false};
  this.store.db.prepare('UPDATE conversion_cursor SET coin_id=? WHERE id=1').run(next.coin_id);
  const wallet=this.store.wallet(next.coin_id);
  if(pendingCampaign(this.store,wallet.coin_id)||hasPendingDomainBridge(this.store,wallet.coin_id))return {processed:false,reason:'wallet_busy'};
  let batch=this.store.db.prepare("SELECT * FROM quote_conversions WHERE coin_id=? AND phase NOT IN ('complete','failed')").get(wallet.coin_id);
  if(!batch){
   if(this.store.pending(wallet.coin_id))return {processed:false,reason:'transaction_pending'};
   const recent=this.store.db.prepare("SELECT next_attempt_at FROM quote_conversions WHERE coin_id=? ORDER BY created_at DESC LIMIT 1").get(wallet.coin_id);
   if(recent?.next_attempt_at>Date.now())return {processed:false,reason:'conversion_retry'};
   const fence=this.store.acquire(wallet.coin_id);try{await this.engine.bindLaunch(wallet.coin_id,wallet.launch_hash);batch=await this.start(this.store.wallet(wallet.coin_id));}finally{this.store.release(wallet.coin_id,fence);}
   if(!batch)return {processed:false,reason:'fees_accumulating'};
  }
  if(batch.next_attempt_at>Date.now())return {processed:false,reason:'conversion_retry'};
  let intent=batch.current_id?this.store.intent(batch.current_id):null;
  if(intent&&['signed','broadcast'].includes(intent.status)){await this.engine.reconcile(intent.id);intent=this.store.intent(intent.id);}
  if(intent?.status==='confirmed'){
   const nextPhase={reset:'approve',approve:'swap',swap:'unwrap',unwrap:'complete'}[batch.phase];
   this.store.db.prepare('UPDATE quote_conversions SET phase=?,current_id=NULL,updated_at=? WHERE id=? AND current_id=?').run(nextPhase,Date.now(),batch.id,intent.id);
   return {processed:true,phase:nextPhase};
  }
  if(intent?.status==='reverted'){
   // A failed unwrap keeps the already converted WBNB receipt for a later
   // retry. Never sell the input again after a confirmed swap.
   this.store.db.prepare('UPDATE quote_conversions SET phase=?,current_id=NULL,next_attempt_at=?,updated_at=? WHERE id=?').run(batch.phase==='unwrap'?'unwrap':'failed',Date.now()+300000,Date.now(),batch.id);
   return {processed:true,phase:'retry'};
  }
  if(intent&&['signed','broadcast'].includes(intent.status))return {processed:true,phase:batch.phase};
  if(intent?.status==='created'&&intent.expires_at<=Date.now()){this.store.expireUnsigned(intent.id);intent=this.store.intent(intent.id);}
  if(!intent||intent.status==='expired'){
   const id=randomUUID(),kind=phaseKind[batch.phase],amountWei=batch.phase==='unwrap'?batch.output_units:batch.amount_units;
   this.store.db.exec('BEGIN IMMEDIATE');try{
    this.store.db.prepare('INSERT INTO conversion_legs(id,batch_id,kind,amount_units) VALUES(?,?,?,?)').run(id,batch.id,kind,amountWei);
    const updated=this.store.db.prepare('UPDATE quote_conversions SET current_id=? WHERE id=? AND current_id IS ?').run(id,batch.id,batch.current_id);
    if(updated.changes!==1)throw Error('Concurrent conversion step');
    intent=this.store.createIntent({id,coinId:wallet.coin_id,kind,amountWei,expiresAt:Date.now()+300000});this.store.db.exec('COMMIT');
   }catch(e){this.store.db.exec('ROLLBACK');throw e}
  }
  try{await this.engine.execute({id:intent.id,coinId:intent.coin_id,kind:intent.kind,amountWei:intent.amount_wei,expiresAt:intent.expires_at});}
  catch(e){this.store.db.prepare('UPDATE quote_conversions SET next_attempt_at=? WHERE id=?').run(Date.now()+60000,batch.id);throw e;}
  return {processed:true,phase:batch.phase};
 }
}
