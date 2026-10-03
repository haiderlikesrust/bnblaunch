import { parseAbi, zeroAddress, type Address } from 'viem';
import { db } from './server';
import { chainClient } from './providers';
import { PORTAL } from '../shared/flap-contract.mjs';

const WBNB='0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const tokenAbi=parseAbi(['function taxProcessor() view returns(address)']);
const processorAbi=parseAbi([
 'function taxToken() view returns(address)','function marketAddress() view returns(address)','function weth() view returns(address)',
 'function feeConfigV2() view returns((uint16 marketBps,uint16 deflationBps,uint16 lpBps,uint16 dividendBps,uint16 feeRate,bool isWeth,uint16 commissionBps,address dividendToken))',
 'function totalQuoteSentToMarketing() view returns(uint256)','function marketQuoteBalance() view returns(uint256)',
]);
export type FeeSample={processor:string;blockNumber:string;blockHash:string;observedAt:number;balanceWei:string;cumulativeFeesWei:string;pendingFeesWei:string};
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
class RoutingChanged extends Error {}
const routingEvents=parseAbi([
 'event TaxTokenAddressesUpdated(address indexed token, address beneficiary, address feeReceiver)',
 'event MarketWalletChanged(address indexed token, address indexed oldMarket, address indexed newMarket)',
]);
export async function continuousRouting(client:ReturnType<typeof chainClient>,token:Address,fromBlock:bigint,toBlock:bigint){
 if(toBlock<fromBlock)return true;
 // Bound historical RPC work; a longer gap starts a fresh observation window.
 if(toBlock-fromBlock+1n>20000n)return false;
 for(let start=fromBlock;start<=toBlock;start+=5000n){
  const end=start+4999n<toBlock?start+4999n:toBlock;
  const logs=await Promise.all(routingEvents.map(event=>client.getLogs({address:PORTAL,event,args:{token},fromBlock:start,toBlock:end,strict:true})));
  if(logs.some(rows=>rows.length>0))return false;
 }
 return true;
}
export async function readFeeSample(client:ReturnType<typeof chainClient>,token:Address,treasury:Address,blockNumber:bigint,balanceWei:string):Promise<FeeSample>{
 const block=await client.getBlock({blockNumber});
 const processor=await client.readContract({address:token,abi:tokenAbi,functionName:'taxProcessor',blockNumber});
 if(same(processor,zeroAddress))throw new RoutingChanged('Fee processor unavailable');
 const [boundToken,beneficiary,wrapped,config,total,pending]=await Promise.all([
  client.readContract({address:processor,abi:processorAbi,functionName:'taxToken',blockNumber}),
  client.readContract({address:processor,abi:processorAbi,functionName:'marketAddress',blockNumber}),
  client.readContract({address:processor,abi:processorAbi,functionName:'weth',blockNumber}),
  client.readContract({address:processor,abi:processorAbi,functionName:'feeConfigV2',blockNumber}),
  client.readContract({address:processor,abi:processorAbi,functionName:'totalQuoteSentToMarketing',blockNumber}),
  client.readContract({address:processor,abi:processorAbi,functionName:'marketQuoteBalance',blockNumber}),
 ]);
 if(!same(boundToken,token)||!same(beneficiary,treasury)||!same(wrapped,WBNB)||!config.isWeth||config.marketBps!==10000||config.lpBps!==0||config.dividendBps!==0||config.deflationBps!==0)throw new RoutingChanged('Fee routing no longer matches this treasury');
 const canonical=await client.getBlock({blockNumber});
 if(canonical.hash!==block.hash||Date.now()-Number(block.timestamp)*1000>120000)throw Error('Fee snapshot changed or is stale');
 return {processor:processor.toLowerCase(),blockNumber:block.number.toString(),blockHash:block.hash,observedAt:Number(block.timestamp)*1000,balanceWei,cumulativeFeesWei:total.toString(),pendingFeesWei:pending.toString()};
}
export function feeWindows(samples:FeeSample[]){
 const rows=[...samples].sort((a,b)=>a.observedAt-b.observedAt),last=rows.at(-1);if(!last)return [];
 return [60,360,1440].map(minutes=>{
  const cutoff=last.observedAt-minutes*60000;
  const baseline=rows.filter(r=>r.observedAt<=cutoff).at(-1)??rows[0],duration=last.observedAt-baseline.observedAt;
  const valid=duration>=60000&&baseline.processor===last.processor&&BigInt(last.cumulativeFeesWei)>=BigInt(baseline.cumulativeFeesWei);
  const delta=valid?BigInt(last.cumulativeFeesWei)-BigInt(baseline.cumulativeFeesWei):null;
  return {requestedMinutes:minutes,observedMinutes:Math.round(duration/6000)/10,fullWindow:duration>=minutes*60000,distributedWei:delta?.toString()??null,averageWeiPerHour:delta===null?null:(delta*3600000n/BigInt(duration)).toString()};
 });
}
export async function treasuryFlow(coinId:string,token:Address,treasury:Address,blockNumber:bigint,balanceWei:string){
 try{
  const client=chainClient(),sample=await readFeeSample(client,token,treasury,blockNumber,balanceWei);
  const rows=await db().prepare('SELECT processor,block_number AS blockNumber,block_hash AS blockHash,observed_at AS observedAt,balance_wei AS balanceWei,cumulative_fees_wei AS cumulativeFeesWei,pending_fees_wei AS pendingFeesWei FROM treasury_observations WHERE coin_id=? AND observed_at>=? ORDER BY observed_at').bind(coinId,sample.observedAt-172800000).all<FeeSample>();
  let history=rows.results;const previous=history.at(-1);
  if(previous){if(BigInt(previous.blockNumber)>blockNumber)return {status:'unavailable',reason:'RPC snapshot regressed',windows:[]};const canonical=await client.getBlock({blockNumber:BigInt(previous.blockNumber)});if(canonical.hash!==previous.blockHash||previous.processor!==sample.processor||BigInt(sample.cumulativeFeesWei)<BigInt(previous.cumulativeFeesWei)||!await continuousRouting(client,token,BigInt(previous.blockNumber)+1n,blockNumber)){await db().prepare('DELETE FROM treasury_observations WHERE coin_id=?').bind(coinId).run();history=[];}}
  if((await client.getBlock({blockNumber})).hash!==sample.blockHash)throw Error('Fee observation reorganized');
  await db().prepare('INSERT INTO treasury_observations(id,coin_id,processor,block_number,block_hash,observed_at,balance_wei,cumulative_fees_wei,pending_fees_wei) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(coin_id,block_number) DO NOTHING').bind(coinId+':'+sample.blockNumber,coinId,sample.processor,sample.blockNumber,sample.blockHash,sample.observedAt,sample.balanceWei,sample.cumulativeFeesWei,sample.pendingFeesWei).run();
  // These rows are a bounded observation cache, never the accounting ledger.
  await db().prepare('DELETE FROM treasury_observations WHERE coin_id=? AND observed_at<?').bind(coinId,sample.observedAt-259200000).run();
  const windows=feeWindows([...history.filter(r=>r.blockNumber!==sample.blockNumber),sample]);
  return {status:windows.some(w=>w.distributedWei!==null)?'observed':'baseline',source:'Flap tax-processor cumulative marketing dispatch',observedAt:sample.observedAt,pendingFeesWei:sample.pendingFeesWei,lifetimeDistributedWei:sample.cumulativeFeesWei,windows,notes:'Rates cover the shown observed intervals. Dispatches can be lumpy. Pending fees are not spendable; wallet deposits are not classified as fees.'};
 }catch(error){if(error instanceof RoutingChanged)await db().prepare('DELETE FROM treasury_observations WHERE coin_id=?').bind(coinId).run();return {status:'unavailable',reason:'Confirmed fee observations unavailable or routing changed',windows:[]};}
}
