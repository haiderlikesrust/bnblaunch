import { pendingCampaign } from './campaigns.mjs';
import { randomBytes } from 'node:crypto';
import { decodeEventLog, decodeFunctionData, encodeFunctionData, isAddress, keccak256, parseAbi, parseTransaction, recoverTransactionAddress, recoverTypedDataAddress, zeroAddress } from 'viem';

// Audited integration surface: one native BNB deposit, one Base USDC EIP-3009
// authorization. There is intentionally no arbitrary transfer/signing interface.
// https://docs.relay.link/references/api/api_core_concepts/input-validation
// https://porkbun.com/llms/guides/pay-with-usdc-x402
// https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md
export const BASE_USDC='0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
export const RELAY_DEPOSITORY='0x4cd00e387622c35bddb9b4c962c136462338bc31';
const RELAY_ROUTER_DATA='0x000000000000000000000000b92fe925dc43a0ecde6c8b1a2709c170ec4fff4f';
const RELAY='https://api.relay.link',PORKBUN='https://api.porkbun.com/api/json/v3';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,HEX32=/^0x[0-9a-f]{64}$/i;
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const depositAbi=parseAbi(['function depositNative(address depositor,bytes32 id) payable']);
const usdcAbi=parseAbi(['function balanceOf(address) view returns(uint256)','function authorizationState(address,bytes32) view returns(bool)']);
const usdcEvents=parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)','event AuthorizationUsed(address indexed authorizer,bytes32 indexed nonce)']);
const authTypes={TransferWithAuthorization:[{name:'from',type:'address'},{name:'to',type:'address'},{name:'value',type:'uint256'},{name:'validAfter',type:'uint256'},{name:'validBefore',type:'uint256'},{name:'nonce',type:'bytes32'}]};
const authDomain={name:'USD Coin',version:'2',chainId:8453,verifyingContract:BASE_USDC};
// Standard Chainlink BNB/USD feed on BNB Chain, also used by the web's credit valuation.
const BNB_USD_FEED='0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE';
const feedAbi=parseAbi(['function decimals() view returns(uint8)','function latestRoundData() view returns(uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)']);
function requireThat(value,message){if(!value)throw Error(message);}
function uint(value){requireThat(typeof value==='string'&&/^(0|[1-9]\d{0,77})$/.test(value),'Invalid integer amount');return BigInt(value);}
function assertKeys(value,keys){requireThat(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>keys.includes(k)),'Unexpected funding input field');}
export function paymentUrl(value){
 requireThat(typeof value==='string'&&value.length<512,'Missing Coinbase x402 URL');const u=new URL(value);
 requireThat(u.protocol==='https:'&&u.hostname==='api.cdp.coinbase.com'&&!u.port&&!u.username&&!u.password&&!u.search&&!u.hash&&/^\/platform\/v2\/payment-sessions\/paymentSession_[A-Za-z0-9_-]+\/authorizations\/x402$/.test(u.pathname),'Unsupported Coinbase payment endpoint');return u.href;
}
export function validateCheckout(value,amountCents,now=Date.now()){
 requireThat(value?.status==='SUCCESS'&&/^[A-Za-z0-9_-]{1,128}$/.test(value.checkoutId??'')&&value.amount_cents===amountCents&&value.currency==='USDC'&&value.network==='base','Porkbun checkout identity or amount mismatch');
 requireThat(Number.isSafeInteger(value.estimatedCredit_cents)&&value.estimatedCredit_cents>0&&value.estimatedCredit_cents<=amountCents&&Number.isSafeInteger(value.estimatedFee_cents)&&value.estimatedFee_cents>=0&&value.estimatedCredit_cents+value.estimatedFee_cents===amountCents,'Porkbun checkout credit is invalid');
 const expires=Date.parse(value.expiresAt);requireThat(Number.isFinite(expires)&&expires>now+60000&&expires<=now+172800000,'Invalid checkout expiry');
 const url=paymentUrl(value.x402Url);const pay=new URL(value.payUrl);
 requireThat(pay.origin==='https://payments.coinbase.com'&&!pay.username&&!pay.password&&!pay.search&&!pay.hash&&pay.pathname===new URL(url).pathname.replace('/platform/v2','').replace('/authorizations/x402',''),'Coinbase checkout session mismatch');
 return {id:value.checkoutId,url,amountCents,estimatedCreditCents:value.estimatedCredit_cents,expiresAt:expires};
}

// getOrderId MUST be the official @relay-protocol/settlement-sdk implementation
// in production. It is injected solely so tests do not call external services.
export async function validateRelayQuote(quote,{payer,amountUsdc,maxBnbWei,expiresAt,now=Date.now()},getOrderId){
 requireThat(typeof getOrderId==='function','Relay order verification is unavailable');
 const p=quote?.protocol?.v2,o=p?.orderData;
 requireThat(p?.hubType==='onchain'&&o?.version==='v1'&&HEX32.test(p.orderId??'')&&Array.isArray(o.inputs)&&o.inputs.length===1&&Array.isArray(o.fees)&&o.fees.length===0,'Unsupported Relay order');
 requireThat(o.solverChainId==='base'&&same(o.solver,'0xf70da97812cb96acdf810712aa562db8dfa3dbef')&&HEX32.test(o.salt??''),'Unsupported Relay solver');
 const input=o.inputs[0],payment=input.payment,out=o.output;
 requireThat(payment?.chainId==='bnb'&&same(payment.currency,zeroAddress)&&payment.weight==='1'&&uint(payment.amount)>0n&&uint(payment.amount)<=uint(maxBnbWei),'Relay input exceeds the authorized BNB amount');
 requireThat(out?.chainId==='base'&&Array.isArray(out.payments)&&out.payments.length===1&&Array.isArray(out.calls)&&out.calls.length===0&&out.extraData===RELAY_ROUTER_DATA,'Unsupported Relay destination calls');
 const recipient=out.payments[0];requireThat(same(recipient.recipient,payer)&&same(recipient.currency,BASE_USDC)&&uint(recipient.minimumAmount)===uint(amountUsdc)&&uint(recipient.expectedAmount)>=uint(amountUsdc),'Relay destination differs from the authorized USDC payment');
 // Relay's current canonical order deadline is seven days. That is an order
 // settlement deadline, not our authority to sign: local expiry/freshness below
 // independently limits when this request can move BNB.
 requireThat(expiresAt>now+30000&&Number.isSafeInteger(out.deadline)&&out.deadline*1000>now+30000&&out.deadline*1000<=now+8*86400000,'Relay order deadline is invalid');
 requireThat(Array.isArray(input.refunds)&&input.refunds.length>0&&input.refunds.length<=2&&input.refunds.every(r=>same(r.recipient,payer)&&((r.chainId==='bnb'&&same(r.currency,zeroAddress))||(r.chainId==='base'&&same(r.currency,BASE_USDC)))&&r.minimumAmount==='0'&&r.deadline===out.deadline&&r.extraData===RELAY_ROUTER_DATA),'Relay refund is not bound to this wallet');
 const computed=await getOrderId(o,{bnb:'ethereum-vm',base:'ethereum-vm'});requireThat(same(computed,p.orderId),'Relay order hash mismatch');
 const pd=p.paymentDetails;requireThat(pd?.chainId==='bnb'&&same(pd.depository,RELAY_DEPOSITORY)&&same(pd.currency,zeroAddress)&&pd.amount===payment.amount,'Relay payment metadata mismatch');
 requireThat(Array.isArray(quote.steps)&&quote.steps.length===1,'Multiple Relay steps are not supported');const step=quote.steps[0];
 requireThat(step.id==='deposit'&&step.kind==='transaction'&&(!step.depositAddress||step.depositAddress==='')&&Array.isArray(step.items)&&step.items.length===1&&HEX32.test(step.requestId??''),'Unsupported Relay deposit step');
 const item=step.items[0],tx=item.data;
 requireThat(item.status==='incomplete'&&tx?.chainId===56&&same(tx.from,payer)&&same(tx.to,RELAY_DEPOSITORY)&&uint(tx.value)===uint(payment.amount),'Relay transaction does not match the order');
 const decoded=decodeFunctionData({abi:depositAbi,data:tx.data});requireThat(decoded.functionName==='depositNative'&&same(decoded.args[0],payer)&&same(decoded.args[1],computed)&&same(tx.data,encodeFunctionData({abi:depositAbi,functionName:'depositNative',args:[payer,computed]})),'Relay deposit calldata is not canonical');
 requireThat(item.check?.method==='GET'&&item.check.endpoint==='/intents/status/v3?requestId='+step.requestId,'Unexpected Relay status endpoint');
 const details=quote.details;requireThat(same(details?.sender,payer)&&same(details?.recipient,payer)&&details.currencyIn?.currency?.chainId===56&&same(details.currencyIn.currency.address,zeroAddress)&&details.currencyIn.amount===payment.amount&&details.currencyOut?.currency?.chainId===8453&&same(details.currencyOut.currency.address,BASE_USDC)&&uint(details.currencyOut.minimumAmount)===uint(amountUsdc),'Relay quote summary mismatch');
 return {to:RELAY_DEPOSITORY,value:payment.amount,data:tx.data,orderId:computed,requestId:step.requestId,deadline:out.deadline};
}

export function validateX402(challenge,{url,amountCents}){
 const version=challenge?.x402Version;requireThat([1,2].includes(version)&&Array.isArray(challenge.accepts)&&challenge.accepts.length>0&&challenge.accepts.length<=8,'Unsupported x402 challenge');
 const amount=String(amountCents*10000),network=version===2?'eip155:8453':'base';
 const matches=challenge.accepts.filter(a=>a?.scheme==='exact'&&a.network===network&&same(a.asset,BASE_USDC)&&(version===2?a.amount:a.maxAmountRequired)===amount);
 requireThat(matches.length===1,'Checkout has no unique exact Base USDC payment');const accepted=matches[0];
 requireThat(isAddress(accepted.payTo)&&!same(accepted.payTo,zeroAddress)&&accepted.extra?.name==='USD Coin'&&accepted.extra?.version==='2'&&(!accepted.extra.assetTransferMethod||accepted.extra.assetTransferMethod==='eip3009'),'Unsupported USDC authorization domain');
 requireThat(Number.isSafeInteger(accepted.maxTimeoutSeconds)&&accepted.maxTimeoutSeconds>=30&&accepted.maxTimeoutSeconds<=3600,'Invalid x402 authorization lifetime');
 requireThat((version===2?challenge.resource?.url:accepted.resource)===url,'x402 challenge resource mismatch');
 requireThat(!challenge.extensions||Object.keys(challenge.extensions).length===0,'Unsupported x402 extensions');
 return {version,accepted,resource:version===2?challenge.resource:undefined};
}

// Other wallet spending waits while BNB is reserved for or moving through the
// bridge. Once BNB has left (USDC-side states) or a job awaits reconciliation,
// the wallet is not frozen; the per-coin unique index still blocks new funding.
// Unknown states block by default.
export function hasPendingDomainBridge(store,coinId){
 if(!store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='domain_funding_jobs'").get())return false;
 return !!store.db.prepare("SELECT id FROM domain_funding_jobs WHERE coin_id=? AND status NOT IN ('complete','failed','needs_reconciliation','bridged','authorized','payment_sending','paid')").get(coinId);
}

export class DomainFunding {
 constructor(store,{bnbClient,baseClient,fetch:request=globalThis.fetch,getOrderId,verifyLaunch,protocolReserve=async()=>0n},policy){
  this.store=store;this.bnb=bnbClient;this.base=baseClient;this.fetch=request;this.getOrderId=getOrderId;this.verifyLaunch=verifyLaunch;this.policy=policy;
  this.protocolReserve=protocolReserve;
  requireThat(typeof getOrderId==='function'&&typeof verifyLaunch==='function','Funding validators are required');
  this.store.db.exec(`CREATE TABLE IF NOT EXISTS domain_funding_jobs(id TEXT PRIMARY KEY,coin_id TEXT NOT NULL REFERENCES wallets(coin_id),request TEXT NOT NULL,status TEXT NOT NULL,record TEXT NOT NULL,version INTEGER NOT NULL,nonce INTEGER,created_at INTEGER NOT NULL);
   CREATE UNIQUE INDEX IF NOT EXISTS domain_funding_pending_coin ON domain_funding_jobs(coin_id) WHERE status NOT IN ('complete','failed');
   CREATE UNIQUE INDEX IF NOT EXISTS domain_funding_nonce ON domain_funding_jobs(coin_id,nonce);`);
 }
 row(id){return this.store.db.prepare('SELECT * FROM domain_funding_jobs WHERE id=?').get(id);}
 status(id){const row=this.row(id);if(!row)return null;const r=JSON.parse(row.record);return {id:row.id,coinId:row.coin_id,status:row.status,amountCents:r.input.amountCents,checkoutId:r.checkout?.id??null,estimatedCreditCents:r.checkout?.estimatedCreditCents??null,bridgeAmountWei:r.bridge?.value??'0',bridgeHash:r.bridgeHash??null,bridgeGasWei:r.bridgeGasWei??null,fillHash:r.fillHash??null,paymentHash:r.paymentHash??null,paymentSubmitted:!!r.paymentAttemptedAt,credited:row.status==='complete',creditedMicrousd:row.status==='complete'?r.checkout.estimatedCreditCents*10000:0,reason:r.reason??null};}
 start(input){
  assertKeys(input,['id','coinId','amountCents','minimumCreditCents','maxBnbWei','expiresAt']);
  requireThat(UUID.test(input.id??'')&&UUID.test(input.coinId??'')&&Number.isSafeInteger(input.amountCents)&&input.amountCents>=100&&input.amountCents<=50000&&uint(input.maxBnbWei)>0n,'Invalid domain funding request');
  requireThat(Number.isSafeInteger(input.minimumCreditCents)&&input.minimumCreditCents>0&&input.minimumCreditCents<=input.amountCents,'Invalid minimum registrar credit');
  const request=JSON.stringify({coinId:input.coinId,amountCents:input.amountCents,minimumCreditCents:input.minimumCreditCents,maxBnbWei:input.maxBnbWei,expiresAt:input.expiresAt});
  const prior=this.row(input.id);if(!prior&&pendingCampaign(this.store,input.coinId))throw Error('Treasury campaign is pending');if(prior){requireThat(prior.request===request,'Domain funding request is immutable');return this.status(input.id);}
  requireThat(this.policy.enabled===true&&this.policy.porkbunApiKey&&this.policy.porkbunSecretKey,'Automatic domain funding is not configured');
  requireThat(!/^(pk1|sk1)_sb_/.test(this.policy.porkbunApiKey)&&!/^(pk1|sk1)_sb_/.test(this.policy.porkbunSecretKey),'Sandbox registrar credentials are not allowed');
  requireThat(Number.isSafeInteger(input.expiresAt)&&input.expiresAt>Date.now()+60000&&input.expiresAt<=Date.now()+86400000,'Invalid funding expiry');
  requireThat(this.store.wallet(input.coinId)?.token_address,'Confirmed launched coin wallet required');
  this.store.db.prepare("INSERT INTO domain_funding_jobs(id,coin_id,request,status,record,version,created_at) VALUES(?,?,?,'created',?,0,?)").run(input.id,input.coinId,request,JSON.stringify({input}),Date.now());return this.status(input.id);
 }
 save(row,fence,status,record,nonce=row.nonce){
  const now=Date.now(),result=this.store.db.prepare(`UPDATE domain_funding_jobs SET status=?,record=?,nonce=?,version=version+1 WHERE id=? AND version=? AND status=? AND EXISTS(SELECT 1 FROM wallets WHERE coin_id=domain_funding_jobs.coin_id AND lock_id=? AND lock_until>?)`).run(status,JSON.stringify(record),nonce,row.id,row.version,row.status,fence,now);
  requireThat(result.changes===1,'Funding lease changed; no external action is authorized');return this.row(row.id);
 }
 async response(url,init={}){return await this.fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(20000)});}
 async json(url,init={}){const r=await this.response(url,init);requireThat(r.ok,'Funding provider response is unavailable');const text=await r.text();requireThat(text.length<=262144,'Funding response is too large');return JSON.parse(text);}
 async porkbun(path,body,idempotencyKey){
  const response=await this.response(PORKBUN+path,{method:body?'POST':'GET',headers:{'X-API-Key':this.policy.porkbunApiKey,'X-Secret-API-Key':this.policy.porkbunSecretKey,'Content-Type':'application/json',...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},...(body?{body:JSON.stringify(body)}:{})});
  requireThat(response.ok,'Registrar funding response unavailable');requireThat(!['true','1'].includes(response.headers.get('x-porkbun-sandbox')?.toLowerCase())&&!['true','1'].includes(response.headers.get('x-porkbun-mock')?.toLowerCase()),'Sandbox registrar response rejected');
  const text=await response.text();requireThat(text.length<=262144,'Registrar funding response too large');const result=JSON.parse(text);requireThat(result.sandbox!==true&&result.mock!==true,'Sandbox registrar response rejected');return result;
 }
 // Relay's BNB input may not exceed the oracle price for the USDC out by more
 // than 8% plus $1 of bridge fees, whatever ceiling the agent proposed.
 async fairBridgeCeiling(amountUsdc){
  const [decimals,round]=await Promise.all([this.bnb.readContract({address:BNB_USD_FEED,abi:feedAbi,functionName:'decimals'}),this.bnb.readContract({address:BNB_USD_FEED,abi:feedAbi,functionName:'latestRoundData'})]);
  const answer=BigInt(round[1]),updatedAt=Number(round[3]);
  requireThat(Number(decimals)===8&&answer>0n&&updatedAt>0&&Date.now()/1000-updatedAt<3600&&BigInt(round[4])>=BigInt(round[0]),'BNB price feed is unavailable or stale');
  return uint(amountUsdc)*10n**20n/answer*108n/100n+10n**26n/answer;
 }
 async head(client,id){requireThat(await client.getChainId()===id,'Funding RPC chain mismatch');const head=await client.getBlock();requireThat(head.number>=3n&&Math.abs(Date.now()/1000-Number(head.timestamp))<90,'Funding RPC head is stale');return head;}
 async baseBalance(address){const head=await this.head(this.base,8453),block=await this.base.getBlock({blockNumber:head.number-3n});const value=await this.base.readContract({address:BASE_USDC,abi:usdcAbi,functionName:'balanceOf',args:[address],blockNumber:block.number});requireThat((await this.base.getBlock({blockNumber:block.number})).hash===block.hash,'Base balance reorganized');return value;}
 async confirmedUsdcTransfer(hash,to,minimum,from){
  requireThat(HEX32.test(hash),'Invalid USDC transaction hash');const head=await this.head(this.base,8453);let receipt;
  try{receipt=await this.base.getTransactionReceipt({hash});}catch(e){if(e.name==='TransactionReceiptNotFoundError')return false;throw e;}
  if(receipt.status!=='success'||head.number-receipt.blockNumber<3n)return false;
  requireThat((await this.base.getBlock({blockNumber:receipt.blockNumber})).hash===receipt.blockHash,'USDC receipt reorganized');
  return receipt.logs.some(log=>{if(!same(log.address,BASE_USDC))return false;try{const e=decodeEventLog({abi:usdcEvents,topics:log.topics,data:log.data});return e.eventName==='Transfer'&&same(e.args.to,to)&&(!from||same(e.args.from,from))&&e.args.value>=minimum;}catch{return false;}});
 }
 async tick(id){
  let row=this.row(id);requireThat(row,'Domain funding request not found');if(['complete','failed'].includes(row.status))return this.status(id);
  requireThat(this.policy.enabled===true,'Automatic domain funding is disabled');const fence=this.store.acquire(row.coin_id);
  try{
   row=this.row(id);let r=JSON.parse(row.record);const wallet=this.store.wallet(row.coin_id),input=r.input;
   await this.verifyLaunch(row.coin_id,wallet.launch_hash);
   if(['created','checkout','quoted','bridged'].includes(row.status)&&Date.now()>=Math.min(input.expiresAt,r.checkout?.expiresAt??Infinity)){this.save(row,fence,'failed',{...r,reason:'Unsigned funding request expired'});return this.status(id);}
   if(row.status==='created'||row.status==='creating'){
    // Replay the identical request/key only inside Porkbun's 24-hour retention
    // period. Never create a new checkout after an unknown outcome.
    if(row.status==='created'){r={...r,checkoutStartedAt:Date.now(),checkoutKey:'shen-domain-'+id};row=this.save(row,fence,'creating',r);}
    if(Date.now()-r.checkoutStartedAt>=86400000-60000){this.save(row,fence,'needs_reconciliation',{...r,reason:'Checkout idempotency retention elapsed'});return this.status(id);}
    const checkout=validateCheckout(await this.porkbun('/account/topupCrypto',{amount:input.amountCents},r.checkoutKey),input.amountCents);
    if(checkout.estimatedCreditCents<input.minimumCreditCents){this.save(row,fence,'failed',{...r,checkout,reason:'Checkout credit is below the required domain funding amount'});return this.status(id);}
    this.save(row,fence,'checkout',{...r,checkout});return this.status(id);
   }
   if(row.status==='needs_reconciliation')return this.status(id);
   if(row.status==='checkout'){
    const balance=await this.baseBalance(wallet.address),required=BigInt(input.amountCents)*10000n;
    if(balance>=required){this.save(row,fence,'bridged',r);return this.status(id);}
    const amountUsdc=(required-balance).toString();
    const body={user:wallet.address,recipient:wallet.address,refundTo:wallet.address,originChainId:56,destinationChainId:8453,originCurrency:zeroAddress,destinationCurrency:BASE_USDC,tradeType:'EXACT_OUTPUT',amount:amountUsdc,explicitDeposit:true,includeProtocolData:true,useDepositAddress:false,useExternalLiquidity:false,useFallbacks:false,slippageTolerance:'50'};
    const quote=await this.json(RELAY+'/quote/v2',{method:'POST',headers:{'Content-Type':'application/json',...(this.policy.relayApiKey?{'x-api-key':this.policy.relayApiKey}:{})},body:JSON.stringify(body)});
    const bridge=await validateRelayQuote(quote,{payer:wallet.address,amountUsdc,maxBnbWei:input.maxBnbWei,expiresAt:Math.min(input.expiresAt,r.checkout.expiresAt)},this.getOrderId);
    requireThat(uint(bridge.value)<=await this.fairBridgeCeiling(amountUsdc),'Relay quote exceeds the fair BNB price for this payment');
    this.save(row,fence,'quoted',{...r,quote,quoteObtainedAt:Date.now(),bridge,amountUsdc,baseBefore:balance.toString()});return this.status(id);
   }
   if(row.status==='quoted'){
    if(r.bridge.deadline*1000<Date.now()+30000||!Number.isSafeInteger(r.quoteObtainedAt)||Date.now()-r.quoteObtainedAt>90000){this.save(row,fence,'checkout',{...r,quote:undefined,bridge:undefined});return this.status(id);}
    requireThat(!this.store.pending(row.coin_id),'Agent transaction is still pending');
    const bridge=await validateRelayQuote(r.quote,{payer:wallet.address,amountUsdc:r.amountUsdc,maxBnbWei:input.maxBnbWei,expiresAt:Math.min(input.expiresAt,r.checkout.expiresAt)},this.getOrderId);
    requireThat(uint(bridge.value)<=await this.fairBridgeCeiling(r.amountUsdc),'Relay quote exceeds the fair BNB price for this payment');
    const head=await this.head(this.bnb,56),transaction={to:bridge.to,value:uint(bridge.value),data:bridge.data};
    const [nonce,latest,balance,confirmed,gasPrice,estimate]=await Promise.all([this.bnb.getTransactionCount({address:wallet.address,blockTag:'pending'}),this.bnb.getTransactionCount({address:wallet.address,blockTag:'latest'}),this.bnb.getBalance({address:wallet.address,blockTag:'pending'}),this.bnb.getBalance({address:wallet.address,blockNumber:head.number-3n}),this.bnb.getGasPrice(),this.bnb.estimateGas({account:wallet.address,...transaction})]);
    requireThat(nonce===latest&&Number.isSafeInteger(nonce),'Untracked pending BNB nonce');
    // A lagging RPC must not hand back a nonce this signer already used.
    const recorded=this.store.db.prepare('SELECT MAX(n) AS n FROM (SELECT MAX(nonce) AS n FROM intents WHERE coin_id=? UNION ALL SELECT MAX(nonce) AS n FROM domain_funding_jobs WHERE coin_id=?)').get(row.coin_id,row.coin_id)?.n;
    requireThat(recorded===null||recorded===undefined||nonce>Number(recorded),'BNB nonce is behind this wallet journal');const gas=estimate*120n/100n;
    requireThat(gasPrice>0n&&gasPrice<=BigInt(this.policy.maxGasPriceWei)&&gas>0n&&gas<=200000n,'Bridge gas exceeds policy');
    requireThat(transaction.value+gas*gasPrice<=uint(input.maxBnbWei),'Bridge amount plus maximum gas exceeds the authorized BNB budget');
    requireThat((balance<confirmed?balance:confirmed)>=transaction.value+gas*gasPrice+BigInt(this.policy.gasReserveWei)+await this.protocolReserve(wallet),'Insufficient confirmed BNB for bridge, gas and protocol reserves');
    const expected={...transaction,nonce,gas,gasPrice,chainId:56,type:'legacy'};
    const raw=await this.store.account(row.coin_id).signTransaction(expected),parsed=parseTransaction(raw),sender=await recoverTransactionAddress({serializedTransaction:raw});
    requireThat(same(sender,wallet.address)&&parsed.chainId===56&&parsed.type==='legacy'&&same(parsed.to,transaction.to)&&parsed.value===transaction.value&&parsed.data===transaction.data&&parsed.nonce===nonce&&parsed.gas===gas&&parsed.gasPrice===gasPrice,'Signed bridge differs from approved transaction');
    this.save(row,fence,'signed',{...r,rawTx:this.store.seal(raw,'domain-bridge:'+id),bridgeHash:keccak256(raw),bridgeGasWei:(gas*gasPrice).toString()},nonce);return this.status(id);
   }
   if(row.status==='signed'||row.status==='broadcast'){
    const head=await this.head(this.bnb,56);let receipt;
    try{receipt=await this.bnb.getTransactionReceipt({hash:r.bridgeHash});}catch(e){if(e.name!=='TransactionReceiptNotFoundError')throw e;}
    if(receipt){
     if(head.number-receipt.blockNumber<3n)return this.status(id);
     requireThat((await this.bnb.getBlock({blockNumber:receipt.blockNumber})).hash===receipt.blockHash,'Bridge receipt reorganized');
     if(receipt.status!=='success'){this.save(row,fence,'failed',{...r,reason:'Bridge source transaction reverted'});return this.status(id);}
     this.save(row,fence,'awaiting_usdc',{...r,bridgeBlock:receipt.blockNumber.toString(),bridgeBlockHash:receipt.blockHash});return this.status(id);
    }
    // If another transaction consumed this nonce, these bytes can never be mined.
    // That must hold for ten minutes before the job fails without moving BNB.
    if(row.status==='broadcast'&&await this.bnb.getTransactionCount({address:wallet.address,blockTag:'latest'})>row.nonce){
     if(!r.nonceConsumedAt){this.save(row,fence,'broadcast',{...r,nonceConsumedAt:Date.now()});return this.status(id);}
     if(Date.now()-r.nonceConsumedAt>600000){this.save(row,fence,'failed',{...r,reason:'Bridge nonce was used by another transaction; no bridge payment was sent'});return this.status(id);}
     return this.status(id);
    }
    // Persist a broadcast state before the network call. Retry only these same
    // signed bytes; never create a replacement quote or transaction after this.
    row=this.save(row,fence,'broadcast',r);const raw=this.store.open(r.rawTx,'domain-bridge:'+id);requireThat(keccak256(raw)===r.bridgeHash,'Bridge journal hash mismatch');
    try{const hash=await this.bnb.sendRawTransaction({serializedTransaction:raw});requireThat(same(hash,r.bridgeHash),'Bridge broadcast returned a different hash');}catch(e){if(!/already known|known transaction|nonce too low/i.test(String(e?.message)))throw e;}
    return this.status(id);
   }
   if(row.status==='awaiting_usdc'){
    const result=await this.json(RELAY+'/intents/status/v3?requestId='+r.bridge.requestId,{headers:this.policy.relayApiKey?{'x-api-key':this.policy.relayApiKey}:{}});
    if(['refund','failure'].includes(result.status)){this.save(row,fence,'needs_reconciliation',{...r,reason:'Relay reported a refund or failed fill; verify retained funds before retrying'});return this.status(id);}
    if(result.status!=='success'){if(Number.isSafeInteger(r.awaitingSince)&&Date.now()-r.awaitingSince>21600000)this.save(row,fence,'needs_reconciliation',{...r,reason:'Relay fill was not confirmed within six hours'});else if(!r.awaitingSince)this.save(row,fence,'awaiting_usdc',{...r,awaitingSince:Date.now()});return this.status(id);}
    requireThat(result.originChainId===56&&result.destinationChainId===8453&&Array.isArray(result.inTxHashes)&&result.inTxHashes.some(hash=>same(hash,r.bridgeHash))&&Array.isArray(result.txHashes)&&result.txHashes.length>0&&result.txHashes.length<=8,'Relay fill identity mismatch');
    let fillHash;for(const hash of result.txHashes)if(await this.confirmedUsdcTransfer(hash,wallet.address,BigInt(r.amountUsdc))){fillHash=hash;break;}
    if(!fillHash)return this.status(id);
    if(await this.baseBalance(wallet.address)<BigInt(input.amountCents)*10000n)return this.status(id);
    this.save(row,fence,'bridged',{...r,fillHash});return this.status(id);
   }
   if(row.status==='bridged'){
    requireThat(await this.baseBalance(wallet.address)>=BigInt(input.amountCents)*10000n,'Confirmed Base USDC is insufficient');
    const response=await this.response(r.checkout.url);requireThat(response.status===402,'Coinbase did not return a payment challenge');
    const encoded=response.headers.get('payment-required');let challenge;
    if(encoded){requireThat(encoded.length<=32768,'x402 challenge is too large');challenge=JSON.parse(Buffer.from(encoded,'base64').toString('utf8'));}
    else{const text=await response.text();requireThat(text.length<=32768,'x402 challenge is too large');challenge=JSON.parse(text);}
    const verified=validateX402(challenge,{url:r.checkout.url,amountCents:input.amountCents}),now=Math.floor(Date.now()/1000);
    const authorization={from:wallet.address,to:verified.accepted.payTo,value:String(input.amountCents*10000),validAfter:String(now-60),validBefore:String(Math.min(now+Math.min(300,verified.accepted.maxTimeoutSeconds),Math.floor(Math.min(input.expiresAt,r.checkout.expiresAt)/1000))),nonce:'0x'+randomBytes(32).toString('hex')};
    requireThat(Number(authorization.validBefore)>now+15,'Checkout authorization window expired');
    const typed={domain:authDomain,types:authTypes,primaryType:'TransferWithAuthorization',message:{...authorization,value:BigInt(authorization.value),validAfter:BigInt(authorization.validAfter),validBefore:BigInt(authorization.validBefore)}};
    const signature=await this.store.account(row.coin_id).signTypedData(typed);requireThat(same(await recoverTypedDataAddress({...typed,signature}),wallet.address),'USDC signature verification failed');
    const payload=verified.version===2?{x402Version:2,accepted:verified.accepted,resource:verified.resource,payload:{signature,authorization}}:{x402Version:1,scheme:'exact',network:'base',payload:{signature,authorization}};
    this.save(row,fence,'authorized',{...r,payment:this.store.seal(JSON.stringify(payload),'domain-x402:'+id),authNonce:authorization.nonce,authValidBefore:Number(authorization.validBefore),paymentVersion:verified.version});return this.status(id);
   }
   if(row.status==='authorized'){
    if(r.authValidBefore<=Date.now()/1000+5){this.save(row,fence,'failed',{...r,reason:'Unsubmitted USDC authorization expired'});return this.status(id);}
    const payment=this.store.open(r.payment,'domain-x402:'+id),head=await this.head(this.base,8453);row=this.save(row,fence,'payment_sending',{...r,paymentAttemptedAt:Date.now(),paymentStartBlock:(head.number-3n).toString()});
    // After a timeout/crash, poll this checkout. Never generate another nonce or
    // submit another payment automatically, even if the response was lost.
    const response=await this.response(r.checkout.url,{headers:{[r.paymentVersion===2?'PAYMENT-SIGNATURE':'X-PAYMENT']:Buffer.from(payment).toString('base64')}});
    if(response.ok)this.save(row,fence,'paid',{...JSON.parse(row.record),paymentHttpStatus:response.status});
    return this.status(id);
   }
   if(row.status==='payment_sending'||row.status==='paid'){
    const status=await this.porkbun('/account/topupCryptoStatus/'+encodeURIComponent(r.checkout.id));
    requireThat(status?.status==='SUCCESS'&&status.checkoutId===r.checkout.id&&['ACTIVE','PROCESSING','COMPLETED','EXPIRED','FAILED','DEACTIVATED'].includes(status.state),'Porkbun checkout reconciliation mismatch');
    if(status.state==='COMPLETED'&&status.credited===true){
     // The authorization is valid for at most five minutes after paymentStartBlock,
     // so its receipt lies in a short, fixed window however late this check runs.
     const head=await this.head(this.base,8453),fromBlock=BigInt(r.paymentStartBlock),confirmed=head.number-3n,windowEnd=fromBlock+2000n,toBlock=confirmed<windowEnd?confirmed:windowEnd;
     requireThat(toBlock>=fromBlock,'Base confirmation head regressed');const events=[];
     for(let start=fromBlock;start<=toBlock;start+=2000n)events.push(...await this.base.getLogs({address:BASE_USDC,event:usdcEvents[1],args:{authorizer:wallet.address,nonce:r.authNonce},fromBlock:start,toBlock:start+1999n<toBlock?start+1999n:toBlock,strict:true}));
     requireThat(events.length<=1,'Ambiguous USDC authorization receipt');if(!events.length)return this.status(id);
     const payload=JSON.parse(this.store.open(r.payment,'domain-x402:'+id)),a=payload.payload.authorization;
     if(!await this.confirmedUsdcTransfer(events[0].transactionHash,a.to,BigInt(a.value),wallet.address))return this.status(id);
     this.save(row,fence,'complete',{...r,paymentHash:events[0].transactionHash,creditedAt:Date.now()});return this.status(id);
    }
    if(['FAILED','EXPIRED','DEACTIVATED'].includes(status.state)&&Date.now()/1000>r.authValidBefore+90){
     const head=await this.head(this.base,8453),used=await this.base.readContract({address:BASE_USDC,abi:usdcAbi,functionName:'authorizationState',args:[wallet.address,r.authNonce],blockNumber:head.number-3n});
     this.save(row,fence,used?'needs_reconciliation':'failed',{...r,reason:used?'USDC was spent but registrar credit is unconfirmed':'Expired checkout and unused authorization'});
    }
    return this.status(id);
   }
   throw Error('Unsupported funding state');
  }finally{this.store.release(row.coin_id,fence);}
 }
}
