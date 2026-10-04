import { randomUUID } from 'node:crypto';
import { parseAbi, zeroAddress } from 'viem';
import { PORTAL } from '../../shared/flap-contract.mjs';
import { pendingCampaign } from './campaigns.mjs';
import { hasPendingDomainBridge } from './domain-funding.mjs';

const tokenAbi=parseAbi(['function taxProcessor() view returns(address)']);
const processorAbi=parseAbi([
 'function taxToken() view returns(address)','function marketAddress() view returns(address)','function weth() view returns(address)',
 'function feeConfigV2() view returns((uint16 marketBps,uint16 deflationBps,uint16 lpBps,uint16 dividendBps,uint16 feeRate,bool isWeth,uint16 commissionBps,address dividendToken))',
 'function totalQuoteSentToMarketing() view returns(uint256)',
]);
const routingEvents=parseAbi(['event TaxTokenAddressesUpdated(address indexed token,address beneficiary,address feeReceiver)','event MarketWalletChanged(address indexed token,address indexed oldMarket,address indexed newMarket)']);
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const WBNB='0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
export const PROTOCOL_FEE_BPS=1500n;
export function protocolAllocation(total,spent){
 if(total<0n||spent<0n)throw Error('Invalid protocol accounting');
 const accrued=total*PROTOCOL_FEE_BPS/10000n;
 if(spent>accrued)throw Error('Protocol accounting requires reconciliation');
 return {accrued,due:accrued-spent};
}

// Platform accounting only. No prompt, chat message or agent plan selects this
// percentage, recipient token, batch authority or burn destination.
export class ProtocolFees{
 constructor(store,engine,campaigns){
  this.store=store;this.engine=engine;this.client=engine.client;this.campaigns=campaigns;
  store.db.exec(`CREATE TABLE IF NOT EXISTS protocol_fees(coin_id TEXT PRIMARY KEY REFERENCES wallets(coin_id),processor TEXT NOT NULL,block_number TEXT NOT NULL,block_hash TEXT NOT NULL,total_wei TEXT NOT NULL DEFAULT '0',checked_at INTEGER NOT NULL DEFAULT 0)`);
  store.db.exec("CREATE TABLE IF NOT EXISTS protocol_cursor(id INTEGER PRIMARY KEY CHECK(id=1),coin_id TEXT NOT NULL); INSERT OR IGNORE INTO protocol_cursor VALUES(1,'')");
 }
 async quote(wallet){
  if(!wallet.token_address)return {accruedWei:'0',reserveWei:'0',distributedFeesWei:'0',spentWei:'0'};
  const head=await this.engine.chainReady(),at=head.number-3n;
  const launch=await this.client.getTransactionReceipt({hash:wallet.launch_hash});
  if(launch.status!=='success'||launch.blockNumber>at)throw Error('Confirmed launch required for fee accounting');
  const prior=this.store.db.prepare('SELECT * FROM protocol_fees WHERE coin_id=?').get(wallet.coin_id);
  if(prior&&((await this.client.getBlock({blockNumber:BigInt(prior.block_number)})).hash!==prior.block_hash||BigInt(prior.block_number)>at))throw Error('Fee history reorganized; reconciliation required');
  const processor=await this.client.readContract({address:wallet.token_address,abi:tokenAbi,functionName:'taxProcessor',blockNumber:at});
  const original=prior?.processor??await this.client.readContract({address:wallet.token_address,abi:tokenAbi,functionName:'taxProcessor',blockNumber:launch.blockNumber});
  if(same(processor,zeroAddress)||!same(processor,original))throw Error('Fee processor changed; reconciliation required');
  const start=prior?BigInt(prior.block_number)+1n:launch.blockNumber;
  // Advance a durable bounded routing audit before releasing any funds. Large
  // offline gaps catch up across worker cycles, rather than assuming continuity.
  const end=start+4999n<at?start+4999n:at;
  const block=await this.client.getBlock({blockNumber:end});
  if(start<=end){
   const logs=await Promise.all(routingEvents.map(event=>this.client.getLogs({address:PORTAL,event,args:{token:wallet.token_address},fromBlock:start,toBlock:end,strict:true})));
   if(logs.some(rows=>rows.length))throw Error('Fee beneficiary history changed; reconciliation required');
  }
  const [bound,market,wrapped,config,total]=await Promise.all(['taxToken','marketAddress','weth','feeConfigV2','totalQuoteSentToMarketing'].map(functionName=>this.client.readContract({address:processor,abi:processorAbi,functionName,blockNumber:end})));
  if(!same(bound,wallet.token_address)||!same(market,wallet.address)||!same(wrapped,WBNB)||!config.isWeth||config.marketBps!==10000||config.lpBps!==0||config.dividendBps!==0||config.deflationBps!==0)throw Error('Fee routing does not match the agent treasury');
  if(total<0n||(prior&&total<BigInt(prior.total_wei))||(await this.client.getBlock({blockNumber:end})).hash!==block.hash)throw Error('Fee counter changed; reconciliation required');
  const values=[processor.toLowerCase(),end.toString(),block.hash,total.toString(),Date.now()];
  if(prior){
   if(!this.store.db.prepare('UPDATE protocol_fees SET processor=?,block_number=?,block_hash=?,total_wei=?,checked_at=? WHERE coin_id=? AND block_number=? AND block_hash=? AND total_wei=?').run(...values,wallet.coin_id,prior.block_number,prior.block_hash,prior.total_wei).changes)throw Error('Concurrent fee observation; retry');
  }else this.store.db.prepare('INSERT INTO protocol_fees(processor,block_number,block_hash,total_wei,checked_at,coin_id) VALUES(?,?,?,?,?,?)').run(...values,wallet.coin_id);
  if(end<at)throw Error('Fee routing audit is catching up');
  const buys=this.store.db.prepare("SELECT i.amount_wei,i.receipt_block,i.receipt_hash FROM intents i JOIN campaign_legs l ON l.id=i.id JOIN campaigns c ON c.id=l.campaign_id WHERE c.coin_id=? AND c.kind='shen_buyback_burn' AND i.kind='buyback' AND i.status='confirmed'").all(wallet.coin_id);
  const latest=buys.reduce((a,b)=>!a||BigInt(b.receipt_block??-1)>BigInt(a.receipt_block??-1)?b:a,null);
  if(latest&&(!latest.receipt_hash||latest.receipt_block===null||BigInt(latest.receipt_block)>at||(await this.client.getBlock({blockNumber:BigInt(latest.receipt_block)})).hash!==latest.receipt_hash))throw Error('Protocol purchase receipt reorganized; reconciliation required');
  const spent=buys.reduce((sum,row)=>sum+BigInt(row.amount_wei),0n),allocation=protocolAllocation(total,spent);
  return {accruedWei:allocation.accrued.toString(),reserveWei:allocation.due.toString(),distributedFeesWei:total.toString(),spentWei:spent.toString()};
 }
 async tick(){
  // Round-robin, one coin per tick; existing campaigns keep their immutable ID.
  const cursor=this.store.db.prepare('SELECT coin_id FROM protocol_cursor WHERE id=1').get().coin_id;
  const wallet=this.store.db.prepare('SELECT * FROM wallets WHERE token_address IS NOT NULL AND coin_id>? ORDER BY coin_id LIMIT 1').get(cursor)??this.store.db.prepare('SELECT * FROM wallets WHERE token_address IS NOT NULL ORDER BY coin_id LIMIT 1').get();
  if(!wallet)return {processed:false};
  this.store.db.prepare('UPDATE protocol_cursor SET coin_id=? WHERE id=1').run(wallet.coin_id);
  const pending=pendingCampaign(this.store,wallet.coin_id);
  if(pending?.kind==='shen_buyback_burn'){
   this.store.db.prepare('UPDATE protocol_fees SET checked_at=? WHERE coin_id=?').run(Date.now(),wallet.coin_id);
   return {processed:true,campaign:await this.campaigns.tick(pending.id)};
  }
  const fees=await this.quote(wallet),amount=BigInt(fees.reserveWei);
  const unfinishedBurn=this.store.db.prepare("SELECT record FROM campaigns WHERE coin_id=? AND kind='shen_buyback_burn' AND status IN ('partial','failed')").all(wallet.coin_id).some(c=>{const r=JSON.parse(c.record);return r.boughtTokenWei&&r.boughtTokenWei!==r.burnedTokenWei;});
  if(unfinishedBurn)return {processed:false,reason:'burn_reconciliation_required'};
  if(pending||this.store.pending(wallet.coin_id)||hasPendingDomainBridge(this.store,wallet.coin_id)||!this.engine.policy.shenTokenAddress||!this.engine.policy.buybacksEnabled||amount<10000000000000000n)return {processed:false};
  // 0.01 BNB is a batching minimum, not a deduction: smaller allocations remain reserved.
  const batch=amount>100000000000000000n?100000000000000000n:amount;
  const input={id:randomUUID(),coinId:wallet.coin_id,kind:'shen_buyback_burn',amountWei:batch.toString(),expiresAt:Date.now()+300000};
  return {processed:true,campaign:this.campaigns.start(input,true)};
 }
}
