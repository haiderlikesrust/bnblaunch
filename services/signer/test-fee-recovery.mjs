import { formatEther, isAddress } from 'viem';
import { pendingCampaign } from './campaigns.mjs';
import { hasPendingDomainBridge } from './domain-funding.mjs';

export class RecoveryError extends Error { constructor(message){super(message);this.name='RecoveryError';} }
const requireThat=(ok,message)=>{if(!ok)throw new RecoveryError(message);};
const same=(a,b)=>a?.toLowerCase()===b?.toLowerCase();

// Local administrator tooling only. No HTTP route or model intent accepts this
// kind. The caller supplies a fixed, user-authorized recovery specification.
export async function recoverTestFees(store,engine,authority,{execute=false}={}){
 const {id,coinId,address,token,recipient,maximumWei,previousRecoveryIds=[]}=authority;
 requireThat(isAddress(recipient)&&!same(recipient,address)&&BigInt(maximumWei)>0n,'Invalid recovery authorization');
 requireThat(Array.isArray(previousRecoveryIds)&&previousRecoveryIds.length<=10&&new Set(previousRecoveryIds).size===previousRecoveryIds.length&&!previousRecoveryIds.includes(id),'Invalid prior recovery authorization');
 const wallet=store.wallet(coinId);
 requireThat(wallet&&same(wallet.address,address)&&same(wallet.token_address,token),'MARTIAN wallet or token does not match the authorized recovery');
 const fence=store.acquire(coinId);
 try{
  let previouslyRecovered=0n;
  for(const previousId of previousRecoveryIds){
   const previous=store.intent(previousId);if(!previous)continue;
   const saved=JSON.parse(previous.request);
   requireThat(previous.coin_id===coinId&&previous.kind==='test_recovery'&&same(saved.recipient,recipient),'Earlier recovery journal does not match the authorization');
   if(previous.tx_hash){
    if(!['confirmed','reverted'].includes(previous.status)){
     const result=execute?await engine.reconcile(previousId):previous;
     return {mode:execute?'resume':'preview',recipient,amountBnb:formatEther(BigInt(previous.amount_wei)),status:result.status,hash:previous.tx_hash,previousPayment:true,repeatPayment:false};
    }
    // A confirmed older payment counts toward the revised total, and its
    // canonical receipt must still verify before another transfer is allowed.
    await engine.reconcile(previousId);
    if(previous.status==='confirmed')previouslyRecovered+=BigInt(previous.amount_wei);
   }else{
    requireThat(!previous.raw_tx&&['created','expired'].includes(previous.status),'Earlier recovery needs reconciliation');
    // Supersede only unsigned authority. Its journal remains intact and the
    // old command can no longer execute it after this revised authorization.
    if(execute)store.db.prepare("UPDATE intents SET status='expired' WHERE id=? AND status='created' AND tx_hash IS NULL AND raw_tx IS NULL").run(previousId);
   }
  }
  const remaining=BigInt(maximumWei)-previouslyRecovered;
  const prior=store.intent(id);
  if(prior){
   const saved=JSON.parse(prior.request);
   requireThat(prior.coin_id===coinId&&prior.kind==='test_recovery'&&same(saved.recipient,recipient)&&saved.maximumWei===maximumWei&&JSON.stringify(saved.previousRecoveryIds??[])===JSON.stringify(previousRecoveryIds),'Recovery journal does not match the authorization');
   if(prior.tx_hash){
    const result=execute?await engine.reconcile(id):prior;
    return {mode:execute?'resume':'preview',recipient,amountBnb:formatEther(BigInt(prior.amount_wei)),status:result.status,hash:prior.tx_hash,repeatPayment:false};
   }
   requireThat(prior.status==='created'&&!prior.raw_tx,'Recovery requires manual reconciliation');
  }
  if(remaining<=0n)return {mode:execute?'execute':'preview',status:'limit_reached',recipient,previouslyRecoveredBnb:formatEther(previouslyRecovered),maximumTotalBnb:formatEther(BigInt(maximumWei)),repeatPayment:false};
  requireThat(!store.pending(coinId),'An existing transaction must finish before recovery');
  requireThat(!pendingCampaign(store,coinId),'An existing treasury campaign must finish before recovery');
  requireThat(!hasPendingDomainBridge(store,coinId),'An existing domain payment must finish before recovery');
  requireThat(!store.db.prepare("SELECT id FROM intents WHERE coin_id=? AND id<>? AND status='created' AND expires_at>?").all(coinId,id,Date.now()).some(row=>!previousRecoveryIds.includes(row.id)),'An authorized payment is waiting; retry after it finishes');
  requireThat(engine.protocolFees,'Verified protocol fee accounting is required');
  await engine.bindLaunch(coinId,wallet.launch_hash);
  const head=await engine.chainReady(),client=engine.client;
  const [pendingBalance,confirmedBalance,nonce,latest,gasPrice,code,fees]=await Promise.all([
   client.getBalance({address,blockTag:'pending'}),client.getBalance({address,blockNumber:head.number-3n}),
   client.getTransactionCount({address,blockTag:'pending'}),client.getTransactionCount({address,blockTag:'latest'}),
   client.getGasPrice(),client.getCode({address:recipient,blockTag:'pending'}),engine.protocolFees.quote(wallet),
  ]);
  requireThat(nonce===latest,'An untracked pending transaction needs reconciliation');
  requireThat(!code||code==='0x','Recovery destination must be a plain BNB Chain wallet');
  requireThat(gasPrice>0n&&gasPrice<=engine.policy.maxGasPriceWei,'Gas price is outside the configured limit');
  requireThat(/^\d+$/.test(fees.reserveWei??''),'Protocol reserve is unverified');
  const reserve=BigInt(fees.reserveWei),gasReserve=engine.policy.gasReserveWei;
  requireThat(typeof gasReserve==='bigint'&&gasReserve>0n,'A positive operating gas reserve is required');
  const balance=pendingBalance<confirmedBalance?pendingBalance:confirmedBalance;
  // Estimate with one wei first so an all-available-balance estimate cannot
  // fail merely because it leaves no room for gas. Validate the final amount too.
  const baseGas=await client.estimateGas({account:address,to:recipient,value:1n,data:'0x'}),gas=baseGas*120n/100n;
  requireThat(gas>=21000n&&gas<=100000n,'Unexpected recovery gas estimate');
  const available=balance-reserve-gasReserve-gas*gasPrice;
  requireThat(available>0n,'No BNB is available after SHEN fees and gas reserves');
  const value=available<remaining?available:remaining;
  const transaction={to:recipient,value,data:'0x',nonce,gas,gasPrice};
  requireThat(await client.estimateGas({account:address,...transaction})<=gas,'Recovery gas estimate changed');
  const quote={coinId,from:address,recipient,amountBnb:formatEther(value),amountWei:value.toString(),previouslyRecoveredBnb:formatEther(previouslyRecovered),maximumTotalBnb:formatEther(BigInt(maximumWei)),protocolReserveBnb:formatEther(reserve),operatingReserveBnb:formatEther(gasReserve),maximumGasBnb:formatEther(gas*gasPrice)};
  if(!execute)return {mode:'preview',...quote};
  // Fixed ID + encrypted signed bytes make retries resume the same transfer.
  // Created-but-unsigned rows may be requoted under the wallet's existing fence.
  const request=JSON.stringify({coinId,kind:'test_recovery',recipient,maximumWei,previousRecoveryIds,amountWei:value.toString()});
  store.db.prepare("INSERT INTO intents(id,coin_id,request,kind,amount_wei,expires_at,status,created_at) VALUES(?,?,?,'test_recovery',?,?,'created',?) ON CONFLICT(id) DO UPDATE SET request=excluded.request,amount_wei=excluded.amount_wei,expires_at=excluded.expires_at WHERE intents.status='created' AND intents.raw_tx IS NULL")
   .run(id,coinId,request,value.toString(),Date.now()+60000,Date.now());
  const raw=await store.account(coinId).signTransaction({...transaction,chainId:56,type:'legacy'});
  await store.persistSigned(id,fence,raw,transaction);
  const result=await engine.reconcile(id);
  return {mode:'execute',...quote,status:result.status,hash:result.hash};
 }finally{store.release(coinId,fence);}
}
