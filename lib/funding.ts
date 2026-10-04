import { env } from "cloudflare:workers";
import { parseAbi, isAddress, type Address, type Hex } from "viem";
import { AppError, db, remoteJson } from "./server";
import { chainClient } from "./providers";

// Standard BNB/USD feed, distinct from the 18-decimal SVR feed.
const FEED="0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE";
const abi=parseAbi(["function decimals() view returns(uint8)","function latestRoundData() view returns(uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)"]);
// The latest price is shared for 30 seconds (still inside the feed's 120-second
// freshness rule), so public chart traffic cannot exhaust the signer's RPC quota.
// Block-pinned settlement reads are never cached.
let latestPrice:{value:Awaited<ReturnType<typeof readPrice>>;expires:number}|undefined,priceRequest:Promise<Awaited<ReturnType<typeof readPrice>>>|undefined;
export async function bnbPrice(blockNumber?:bigint){
  if(blockNumber!==undefined)return readPrice(blockNumber);
  if(latestPrice&&latestPrice.expires>Date.now())return latestPrice.value;
  priceRequest??=readPrice().then(value=>{latestPrice={value,expires:Date.now()+30000};return value}).finally(()=>{priceRequest=undefined});
  return priceRequest;
}
async function readPrice(blockNumber?:bigint){
  const client=chainClient();
  if(await client.getChainId()!==56)throw new AppError(503,"Incorrect funding chain.");
  const [block,decimals,round]=await Promise.all([client.getBlock(blockNumber?{blockNumber}:{}),client.readContract({address:FEED,abi,functionName:"decimals",blockNumber}),client.readContract({address:FEED,abi,functionName:"latestRoundData",blockNumber})]);
  if(decimals!==8||round[1]<=0n||round[3]===0n||round[3]>block.timestamp||block.timestamp-round[3]>120n||round[4]<round[0])throw new AppError(503,"BNB funding price is stale or invalid.");
  return {answer:round[1],block:block.number,roundId:round[0],updatedAt:round[3]};
}
export function usdMicros(wei:bigint,answer:bigint){return wei*answer/100000000000000000000n;}
export async function hasPrepaidServices(coinId:string,creditMicrousd:number){
  if(!Number.isSafeInteger(creditMicrousd)||creditMicrousd<=0)return false;
  return !!await db().prepare("SELECT settlement_id FROM compute_funding WHERE coin_id=? AND amount_microusd>0 LIMIT 1").bind(coinId).first();
}
export async function computeCapacity(){
  if(!env.OPENROUTER_MANAGEMENT_KEY)throw new AppError(412,"Compute funding reconciliation is not configured.");
  const result=await remoteJson<{data:{total_credits:number;total_usage:number}}>("https://openrouter.ai/api/v1/credits",{headers:{Authorization:"Bearer "+env.OPENROUTER_MANAGEMENT_KEY}});
  const {total_credits, total_usage}=result.data;
  if(!Number.isFinite(total_credits)||!Number.isFinite(total_usage)||total_credits<0||total_usage<0)throw new AppError(503,"Compute account balance could not be verified.");
  const liability=await db().prepare(`SELECT
    COALESCE((SELECT SUM(ai_credit_microusd) FROM coins),0)+
    COALESCE((SELECT SUM(reserved_microusd) FROM chat_runs WHERE status='reserved'),0)+
    COALESCE((SELECT SUM(reserved_microusd) FROM agent_runs WHERE status='reserved'),0)+
    COALESCE((SELECT SUM(reserved_microusd) FROM agent_operations WHERE kind='compute' AND status IN ('queued','signed','broadcast')),0) AS total`).first<{total:number}>();
  return {available:Math.max(0,Math.floor((total_credits-total_usage)*1e6*.9)),liability:liability?.total??0};
}
export async function settleComputePayment(op:{id:string;coin_id:string;amount_wei:string;created_at:number},hash:Hex){
  if(!env.SIGNER_SETTLEMENT_ADDRESS||!isAddress(env.SIGNER_SETTLEMENT_ADDRESS))throw new AppError(412,"Compute settlement wallet is missing.");
  const wallet=await db().prepare("SELECT address FROM agent_wallets WHERE coin_id=?").bind(op.coin_id).first<{address:string}>();
  if(!wallet)throw new AppError(409,"Agent wallet not found.");
  const client=chainClient(),[tx,receipt,head]=await Promise.all([client.getTransaction({hash}),client.getTransactionReceipt({hash}),client.getBlockNumber()]);
  if(receipt.status!=="success"||head-receipt.blockNumber<3n||tx.from.toLowerCase()!==wallet.address||tx.to?.toLowerCase()!==env.SIGNER_SETTLEMENT_ADDRESS.toLowerCase()||tx.value!==BigInt(op.amount_wei)||(tx.input!=="0x"&&tx.input!=="0x0"))throw new AppError(409,"Service payment is not confirmed or does not match the intent.");
  const block=await client.getBlock({blockNumber:receipt.blockNumber});
  if(block.hash!==receipt.blockHash||Number(block.timestamp)*1000<op.created_at-60000)throw new AppError(409,"Service payment receipt changed or predates its intent.");
  const price=await bnbPrice(receipt.blockNumber),credit=Number(usdMicros(tx.value,price.answer));
  if(!Number.isSafeInteger(credit)||credit<=0)throw new AppError(409,"Invalid confirmed credit value.");
  if(await db().prepare("SELECT settlement_id FROM compute_funding WHERE settlement_id=?").bind(hash).first())return;
  const capacity=await computeCapacity();
  // SQL repeats the liability check atomically; parallel settlements cannot each
  // allocate the same centrally funded OpenRouter balance.
  const results=await db().batch([
    db().prepare(`INSERT INTO compute_funding(settlement_id,coin_id,amount_microusd,settled_at,valuation)
      SELECT ?,?,?,?,? WHERE ? >= ? + COALESCE((SELECT SUM(ai_credit_microusd) FROM coins),0)
      + COALESCE((SELECT SUM(reserved_microusd) FROM chat_runs WHERE status='reserved'),0)
      + COALESCE((SELECT SUM(reserved_microusd) FROM agent_runs WHERE status='reserved'),0)
      + COALESCE((SELECT SUM(reserved_microusd) FROM agent_operations WHERE kind='compute' AND status IN ('queued','signed','broadcast') AND id!=?),0)
      AND EXISTS(SELECT 1 FROM agent_operations WHERE id=? AND status!='confirmed') ON CONFLICT(settlement_id) DO NOTHING`)
      .bind(hash,op.coin_id,credit,Number(block.timestamp)*1000,JSON.stringify({feed:FEED,decimals:8,roundId:price.roundId.toString(),answer:price.answer.toString(),updatedAt:price.updatedAt.toString(),blockNumber:receipt.blockNumber.toString(),blockHash:receipt.blockHash,amountWei:tx.value.toString()}),capacity.available,credit,op.id,op.id),
    db().prepare("UPDATE coins SET ai_credit_microusd=ai_credit_microusd+? WHERE id=? AND EXISTS(SELECT 1 FROM compute_funding WHERE settlement_id=? AND coin_id=?) AND EXISTS(SELECT 1 FROM agent_operations WHERE id=? AND status!='confirmed')").bind(credit,op.coin_id,hash,op.coin_id,op.id),
    db().prepare("UPDATE agent_operations SET status='confirmed',tx_hash=? WHERE id=? AND EXISTS(SELECT 1 FROM compute_funding WHERE settlement_id=? AND coin_id=?)").bind(hash,op.id,hash,op.coin_id),
  ]);
  if(!results[0].meta.changes)throw new AppError(412,"Service payment is confirmed; credit awaits available central compute funding.");
}
