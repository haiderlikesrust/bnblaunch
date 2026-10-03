import { randomUUID } from 'node:crypto';
import { decodeEventLog, parseAbi, zeroAddress } from 'viem';
import { PORTAL } from '../../shared/flap-contract.mjs';
import { hasPendingDomainBridge } from './domain-funding.mjs';

export const DEAD='0x000000000000000000000000000000000000dead';
const transfers=parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const tokenAbi=parseAbi(['function totalSupply() view returns(uint256)','function balanceOf(address) view returns(uint256)']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const terminal=s=>['complete','partial','failed'].includes(s);
export function pendingCampaign(store,coinId){
 if(!store.db.prepare("SELECT 1 FROM sqlite_master WHERE name='campaigns'").get())return null;
 return store.db.prepare("SELECT * FROM campaigns WHERE coin_id=? AND status NOT IN ('complete','partial','failed')").get(coinId);
}
export function campaignLeg(store,id){
 if(!store.db.prepare("SELECT 1 FROM sqlite_master WHERE name='campaign_legs'").get())return null;
 return store.db.prepare('SELECT l.*,c.coin_id,c.status AS campaign_status,c.record AS campaign_record FROM campaign_legs l JOIN campaigns c ON c.id=l.campaign_id WHERE l.id=?').get(id);
}
export function netReceived(logs,token,address){
 let total=0n;
 for(const log of logs){if(!same(log.address,token))continue;let event;try{event=decodeEventLog({abi:transfers,data:log.data,topics:log.topics,strict:true});}catch{continue;}
  if(same(event.args.to,address))total+=event.args.value;
  if(same(event.args.from,address))total-=event.args.value;
 }return total;
}
export function applyTransfers(balances,logs,token){
 const ordered=[...logs].sort((a,b)=>Number(a.blockNumber-b.blockNumber)||a.logIndex-b.logIndex);
 const seen=new Set();
 for(const log of ordered){
  if(!same(log.address,token)||log.removed||!Number.isSafeInteger(log.logIndex)||!log.transactionHash||!log.blockHash)throw Error('Invalid holder log');
  const key=log.transactionHash+':'+log.logIndex;if(seen.has(key))throw Error('Duplicate holder log');seen.add(key);
  const {args}=decodeEventLog({abi:transfers,data:log.data,topics:log.topics,strict:true});
  for(const [address,delta] of [[args.from,-args.value],[args.to,args.value]]){
   const a=address.toLowerCase();if(a===zeroAddress)continue;const value=BigInt(balances[a]??0)+delta;
   if(value<0n)throw Error('Incomplete holder history');if(value===0n)delete balances[a];else balances[a]=value.toString();
  }
 }return balances;
}
// Pro-rata BNB; deduct a worst-case gas allowance before allocating. Dust is
// excluded iteratively, never replaced by an arbitrary top-holder list.
export function allocateRewards(holders,budget,gasPerTransfer){
 let eligible=Object.entries(holders).filter(([,v])=>BigInt(v)>0n).sort(([a],[b])=>a.localeCompare(b));
 while(eligible.length){
  const pool=budget-BigInt(eligible.length)*gasPerTransfer;if(pool<=0n)throw Error('Reward budget cannot cover recipient gas');
  const supply=eligible.reduce((n,[,v])=>n+BigInt(v),0n);
  const payouts=eligible.map(([address,v])=>({address,amountWei:(pool*BigInt(v)/supply).toString()}));
  const keep=payouts.filter(p=>BigInt(p.amountWei)>gasPerTransfer*2n);
  if(keep.length===eligible.length)return keep;
  const addresses=new Set(keep.map(p=>p.address));eligible=eligible.filter(([a])=>addresses.has(a));
 }throw Error('No economical eligible reward recipients');
}

export class Campaigns{
 constructor(store,engine){
  this.store=store;this.engine=engine;this.client=engine.client;
  store.db.exec(`CREATE TABLE IF NOT EXISTS campaigns(id TEXT PRIMARY KEY,coin_id TEXT NOT NULL REFERENCES wallets(coin_id),kind TEXT NOT NULL,amount_wei TEXT NOT NULL,request TEXT NOT NULL,status TEXT NOT NULL,record TEXT NOT NULL,created_at INTEGER NOT NULL,lease TEXT,lease_until INTEGER NOT NULL DEFAULT 0);
   CREATE UNIQUE INDEX IF NOT EXISTS campaign_pending_coin ON campaigns(coin_id) WHERE status NOT IN ('complete','partial','failed');
   CREATE TABLE IF NOT EXISTS campaign_legs(id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL REFERENCES campaigns(id),position INTEGER NOT NULL,kind TEXT NOT NULL,amount_wei TEXT NOT NULL,recipient TEXT,gas_limit_wei TEXT,expires_at INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'queued',tx_hash TEXT,UNIQUE(campaign_id,position));`);
 }
 row(id){return this.store.db.prepare('SELECT * FROM campaigns WHERE id=?').get(id);}
 legs(id){return this.store.db.prepare('SELECT * FROM campaign_legs WHERE campaign_id=? ORDER BY position').all(id);}
 status(id){
  const c=this.row(id);if(!c)return null;const r=JSON.parse(c.record),legs=this.legs(id);
  return {id:c.id,coinId:c.coin_id,kind:c.kind,amountWei:c.amount_wei,status:c.status,stage:r.stage,reason:r.reason??null,snapshotBlock:r.snapshotBlock??null,snapshotHash:r.snapshotHash??null,
   recipientCount:legs.filter(l=>l.kind==='reward').length,confirmedCount:legs.filter(l=>l.status==='confirmed').length,
   paidWei:legs.filter(l=>l.kind==='reward'&&l.status==='confirmed').reduce((s,l)=>s+BigInt(l.amount_wei),0n).toString(),boughtTokenWei:r.boughtTokenWei??null,burnedTokenWei:r.burnedTokenWei??null,
   transactions:legs.filter(l=>l.tx_hash).slice(-100).map(l=>({id:l.id,kind:l.kind,recipient:l.recipient,amountWei:l.amount_wei,hash:l.tx_hash,status:l.status})),transactionCount:legs.filter(l=>l.tx_hash).length};
 }
 start(input){
  if(!input||Object.keys(input).some(k=>!['id','coinId','kind','amountWei','expiresAt'].includes(k))||!UUID.test(input.id)||!UUID.test(input.coinId)||!['rewards','buyback_burn'].includes(input.kind)||!/^\d{1,78}$/.test(input.amountWei)||BigInt(input.amountWei)<=0n)throw Error('Invalid campaign');
  const request=JSON.stringify({coinId:input.coinId,kind:input.kind,amountWei:input.amountWei,expiresAt:input.expiresAt}),prior=this.row(input.id);
  if(prior){if(prior.request!==request)throw Error('Campaign is immutable');return this.status(input.id);}
  if(!Number.isSafeInteger(input.expiresAt)||input.expiresAt<=Date.now()||input.expiresAt>Date.now()+300000)throw Error('Campaign authorization expired');
  if(input.kind==='buyback_burn'&&!this.engine.policy.buybacksEnabled)throw Error('Buybacks are not enabled');
  const fence=this.store.acquire(input.coinId);
  try{
   if(!this.store.wallet(input.coinId)?.token_address)throw Error('Confirmed launch required');
   if(hasPendingDomainBridge(this.store,input.coinId)||this.store.pending(input.coinId))throw Error('Wallet payment is pending');
   this.store.db.prepare("INSERT INTO campaigns(id,coin_id,kind,amount_wei,request,status,record,created_at) VALUES(?,?,?,?,?,'running',?,?)").run(input.id,input.coinId,input.kind,input.amountWei,request,JSON.stringify({stage:'initialize',deadline:Date.now()+86400000}),Date.now());
  }finally{this.store.release(input.coinId,fence);}return this.status(input.id);
 }
 addLeg(c,position,kind,amount,recipient=null,gas=null){
  this.store.db.prepare('INSERT INTO campaign_legs(id,campaign_id,position,kind,amount_wei,recipient,gas_limit_wei,expires_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(campaign_id,position) DO NOTHING').run(randomUUID(),c.id,position,kind,amount,recipient,gas,0);
 }
 async tick(id){
  let c=this.row(id);if(!c)throw Error('Campaign not found');if(terminal(c.status))return this.status(id);
  const lease=randomUUID();if(!this.store.db.prepare('UPDATE campaigns SET lease=?,lease_until=? WHERE id=? AND lease_until<?').run(lease,Date.now()+120000,id,Date.now()).changes)throw Error('Campaign is busy');
  const r=JSON.parse(c.record),wallet=this.store.wallet(c.coin_id),token=wallet.token_address;
  const save=(status='running')=>{if(!this.store.db.prepare('UPDATE campaigns SET status=?,record=? WHERE id=? AND lease=? AND lease_until>?').run(status,JSON.stringify(r),id,lease,Date.now()).changes)throw Error('Campaign lease expired');};
  try{
   await this.engine.bindLaunch(c.coin_id,wallet.launch_hash);
   if(Date.now()>r.deadline&&!this.legs(id).some(l=>this.store.intent(l.id)?.tx_hash)){
    r.reason='Campaign authority expired before any transfer';save('failed');return this.status(id);
   }
   if(r.stage==='initialize'){
    const head=await this.engine.chainReady(),snapshot=head.number-12n,block=await this.client.getBlock({blockNumber:snapshot}),launch=await this.client.getTransactionReceipt({hash:wallet.launch_hash});
    if(snapshot<launch.blockNumber)throw Error('Launch awaits snapshot confirmations');
    const balance=await this.client.getBalance({address:wallet.address,blockNumber:snapshot});
    if(BigInt(c.amount_wei)+this.engine.policy.gasReserveWei>balance)throw Error('Insufficient campaign funds');
    r.snapshotBlock=snapshot.toString();r.snapshotHash=block.hash;r.cursor=launch.blockNumber.toString();r.balances={};r.holders={};r.validated=0;
    r.rangeSize=2000;r.stage=c.kind==='rewards'?'index':'buy';save();return this.status(id);
   }
   if(Date.now()>r.deadline&&['index','validate','buy'].includes(r.stage)&&!this.legs(id).some(l=>this.store.intent(l.id)?.tx_hash)){
    r.reason='Campaign authority expired before any transfer';save('failed');return this.status(id);
   }
   if(c.kind==='rewards'){
    const block=await this.client.getBlock({blockNumber:BigInt(r.snapshotBlock)});
    if(block.hash!==r.snapshotHash)throw Error('Reward snapshot reorganized; manual reconciliation required');
    if(r.stage==='index'){
     if(Date.now()>r.deadline){r.reason='Holder indexing exceeded the authorization window';save('failed');return this.status(id);}
     const from=BigInt(r.cursor),snapshot=BigInt(r.snapshotBlock),to=from+BigInt(r.rangeSize)-1n<snapshot?from+BigInt(r.rangeSize)-1n:snapshot;
     const end=await this.client.getBlock({blockNumber:to});
     let logs;try{logs=await this.client.getLogs({address:token,event:transfers[0],fromBlock:from,toBlock:to,strict:true});if(logs.length>=10000)throw Error('Log batch too large');}
     catch(error){if(r.rangeSize<=1)throw error;r.rangeSize=Math.max(1,Math.floor(r.rangeSize/2));save();return this.status(id);}
     for(const [number,hash] of new Map(logs.map(l=>[l.blockNumber,l.blockHash])))if((await this.client.getBlock({blockNumber:number})).hash!==hash)throw Error('Holder log reorganized');
     if((await this.client.getBlock({blockNumber:to})).hash!==end.hash)throw Error('Holder range reorganized');
     applyTransfers(r.balances,logs,token);if(Object.keys(r.balances).length>50000)throw Error('Holder ledger exceeds supported snapshot size');
     r.cursor=(to+1n).toString();
     if(to===snapshot){const supply=await this.client.readContract({address:token,abi:tokenAbi,functionName:'totalSupply',blockNumber:snapshot});
      if(Object.values(r.balances).reduce((s,v)=>s+BigInt(v),0n)!==supply)throw Error('Holder ledger does not match on-chain supply');
      r.candidates=Object.keys(r.balances).sort();r.stage='validate';
     }save();return this.status(id);
    }
    if(r.stage==='validate'){
     const excluded=new Set([zeroAddress,DEAD,PORTAL,token,wallet.address,...Array.from({length:256},(_,i)=>'0x'+i.toString(16).padStart(40,'0'))].map(a=>a.toLowerCase()));
     for(const a of r.candidates.slice(r.validated,r.validated+25)){
      if(!excluded.has(a)){const code=await this.client.getCode({address:a,blockNumber:BigInt(r.snapshotBlock)});
       if(!code||code==='0x'){const balance=await this.client.readContract({address:token,abi:tokenAbi,functionName:'balanceOf',args:[a],blockNumber:BigInt(r.snapshotBlock)});if(balance!==BigInt(r.balances[a]))throw Error('Holder snapshot balance mismatch');r.holders[a]=balance.toString();}}
      r.validated++;
     }
     if(r.validated===r.candidates.length){
      const gas=25200n*this.engine.policy.maxGasPriceWei;let payouts;
      try{payouts=allocateRewards(r.holders,BigInt(c.amount_wei),gas);}catch{r.reason='No economical eligible distribution fits the authorized budget';save('failed');return this.status(id);}
      this.store.db.exec('BEGIN IMMEDIATE');try{payouts.forEach((p,i)=>this.addLeg(c,i,'reward',p.amountWei,p.address,gas.toString()));r.stage='pay';delete r.balances;delete r.holders;delete r.candidates;save();this.store.db.exec('COMMIT');}catch(e){this.store.db.exec('ROLLBACK');throw e;}
     }else save();return this.status(id);
    }
   }
   if(c.kind==='buyback_burn'&&r.stage==='buy'&&!this.legs(id).length)this.addLeg(c,0,'buyback',c.amount_wei);
   const legs=this.legs(id),leg=legs.find(l=>!['confirmed','reverted','expired'].includes(l.status));
   if(leg){
    let intent=this.store.intent(leg.id);
    if(intent?.tx_hash){await this.engine.reconcile(leg.id);intent=this.store.intent(leg.id);}
    else if((leg.expires_at>0&&Date.now()>leg.expires_at)||Date.now()>r.deadline){
     this.store.expireUnsigned(leg.id);this.store.db.prepare("UPDATE campaign_legs SET status='expired' WHERE id=?").run(leg.id);return this.status(id);
    }else{if(!leg.expires_at){leg.expires_at=Date.now()+300000;this.store.db.prepare('UPDATE campaign_legs SET expires_at=? WHERE id=? AND expires_at=0').run(leg.expires_at,leg.id);}
     await this.engine.execute({id:leg.id,coinId:c.coin_id,kind:leg.kind,amountWei:leg.amount_wei,expiresAt:leg.expires_at});intent=this.store.intent(leg.id);}
    if(intent)this.store.db.prepare('UPDATE campaign_legs SET status=?,tx_hash=? WHERE id=?').run(intent.status,intent.tx_hash,leg.id);
    return this.status(id);
   }
   if(c.kind==='buyback_burn'){
    const buy=legs[0];if(buy?.status!=='confirmed'){r.reason='Buy did not confirm; no burn was attempted';save('failed');return this.status(id);}
    await this.engine.reconcile(buy.id);
    if(r.stage==='buy'){
     const receipt=await this.client.getTransactionReceipt({hash:buy.tx_hash}),received=netReceived(receipt.logs,token,wallet.address);
     if(received<=0n)throw Error('Buy receipt has no verified tokens received');
     r.boughtTokenWei=received.toString();r.stage='burn';
     this.store.db.exec('BEGIN IMMEDIATE');try{this.addLeg(c,1,'burn',received.toString());save();this.store.db.exec('COMMIT');}catch(e){this.store.db.exec('ROLLBACK');throw e;}return this.status(id);
    }
    const burn=legs[1];if(burn?.status==='confirmed'){
     await this.engine.reconcile(burn.id);const receipt=await this.client.getTransactionReceipt({hash:burn.tx_hash});r.burnedTokenWei=netReceived(receipt.logs,token,DEAD).toString();
     if(r.burnedTokenWei!==r.boughtTokenWei)throw Error('Burn receipt amount mismatch');
    }
   }
   // Every leg was independently confirmed against a canonical receipt. Partial
   // distributions are disclosed; an expired/reverted payout is never recreated.
   r.stage='finished';save(legs.every(l=>l.status==='confirmed')?'complete':legs.some(l=>l.status==='confirmed')?'partial':'failed');return this.status(id);
  }catch(error){try{const committed=JSON.parse(this.row(id).record);committed.reason='Awaiting verified chain data or transaction reconciliation';this.store.db.prepare('UPDATE campaigns SET record=? WHERE id=? AND lease=? AND lease_until>?').run(JSON.stringify(committed),id,lease,Date.now());}catch{}throw error;}finally{this.store.db.prepare('UPDATE campaigns SET lease=NULL,lease_until=0 WHERE id=? AND lease=?').run(id,lease);}
 }
}
