import { env } from "cloudflare:workers";
import { z } from "zod";
import { formatEther, parseEther, parseAbi, type Address } from "viem";
import { agentModel, GUARDRAIL_MODEL } from "./agent-models";
import { chatPrice, callCeiling, chatCompletion } from "./chat-completion";
import { AppError, db, type CoinRow } from "./server";
import { signerRequest } from "./signer";
import { bnbPrice, computeCapacity } from "./funding";
import { chainClient, research } from "./providers";
import { agentPlan, PLANNER_RULES, PLAN_GUARD_RULES, validatePlanFunds } from "./runtime-policy";
import type { Coin } from "./model";
import { contentCapabilities, contentJobStatement, contentSnapshot } from './content-runtime';
import { validatePublication } from './content-policy';

type Lease={coinId:string;id:string};
export async function requireWorker(request:Request){
  if(request.headers.get("origin"))throw new AppError(403,"Browser access is not supported.");
  const expected=env.WORKER_TOKEN,actual=request.headers.get("authorization");
  if(!expected||expected.length<40||!actual)throw new AppError(401,"Worker authentication required.");
  const digest=async(v:string)=>new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v)));
  const [a,b]=await Promise.all([digest(actual),digest("Bearer "+expected)]);let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];if(diff)throw new AppError(401,"Worker authentication required.");
}
export async function runtimeCapabilities(){
  if(!env.OPENROUTER_API_KEY||!env.OPENROUTER_MANAGEMENT_KEY||!Number(env.AGENT_DAILY_LIMIT_MICROUSD))return [];
  const [signer,capacity]=await Promise.all([signerRequest<{chainId:number;signingReady:boolean;settlementAddress:string}>("/v1/status"),computeCapacity()]);
  if(signer.chainId!==56||!signer.signingReady||signer.settlementAddress?.toLowerCase()!==env.SIGNER_SETTLEMENT_ADDRESS?.toLowerCase()||capacity.available<=0||capacity.available<capacity.liability)return [];
  return ["funding-reconciliation","cost-reservations","autonomous-planning","transaction-execution","website-publishing",...await contentCapabilities(),...(env.BRAVE_API_KEY&&Number(env.BRAVE_COST_MICROUSD)>0?["brave-research"]:[])];
}
async function acquire():Promise<Lease|null>{
  const now=Date.now();
  await db().prepare("INSERT INTO runtime_leases(coin_id,lease_until,next_run_at) SELECT id,0,0 FROM coins WHERE token_address IS NOT NULL ON CONFLICT(coin_id) DO NOTHING").run();
  const candidate=await db().prepare("SELECT coin_id FROM runtime_leases WHERE lease_until<? AND next_run_at<=? ORDER BY next_run_at,coin_id LIMIT 1").bind(now,now).first<{coin_id:string}>();if(!candidate)return null;
  const id=crypto.randomUUID();const r=await db().prepare("UPDATE runtime_leases SET lease_id=?,lease_until=? WHERE coin_id=? AND lease_until<? AND next_run_at<=?").bind(id,now+240000,candidate.coin_id,now,now).run();return r.meta.changes?{coinId:candidate.coin_id,id}:null;
}
async function reserve(lease:Lease,ceiling:number){
  const cap=Number(env.AGENT_DAILY_LIMIT_MICROUSD);if(!Number.isSafeInteger(cap)||cap<=0)throw new AppError(412,"Platform agent allowance is required.");
  const id=crypto.randomUUID(),now=new Date().toISOString(),day=new Date(Date.now()-86400000).toISOString();
  const result=await db().batch([
    db().prepare(`INSERT INTO agent_runs(id,coin_id,kind,status,reserved_microusd,created_at) SELECT ?,id,'plan','reserved',?,? FROM coins WHERE id=? AND ai_credit_microusd>=?
      AND EXISTS(SELECT 1 FROM runtime_leases WHERE coin_id=coins.id AND lease_id=? AND lease_until>?)
      AND COALESCE((SELECT SUM(COALESCE(cost_microusd,reserved_microusd)) FROM agent_runs WHERE created_at>?),0)+?<=?`).bind(id,ceiling,now,lease.coinId,ceiling,lease.id,Date.now(),day,ceiling,cap),
    db().prepare("UPDATE coins SET ai_credit_microusd=ai_credit_microusd-? WHERE id=? AND EXISTS(SELECT 1 FROM agent_runs WHERE id=?)").bind(ceiling,lease.coinId,id),
  ]);
  if(!result[0].meta.changes)throw new AppError(412,"Insufficient credit or platform allowance for this plan.");return {id,ceiling};
}
async function settle(coinId:string,run:{id:string;ceiling:number},cost:number,output:string){
  if(!Number.isSafeInteger(cost)||cost<0||cost>run.ceiling)throw new AppError(503,"Agent cost needs reconciliation.");
  await db().batch([
    db().prepare("UPDATE coins SET ai_credit_microusd=ai_credit_microusd+? WHERE id=? AND EXISTS(SELECT 1 FROM agent_runs WHERE id=? AND status='reserved')").bind(run.ceiling-cost,coinId,run.id),
    db().prepare("UPDATE agent_runs SET status='settled',cost_microusd=?,output=?,finished_at=? WHERE id=? AND status='reserved'").bind(cost,output,new Date().toISOString(),run.id),
  ]);
}
async function queue(lease:Lease,kind:string,amount:string,reason:string,funding?:{reserve:number;capacity:number}){
  const now=Date.now(),id=crypto.randomUUID();
  await db().prepare(`INSERT INTO agent_operations(id,coin_id,kind,amount_wei,reserved_microusd,status,expires_at,created_at,reason)
    SELECT ?,?,?,?,?,'queued',?,?,? WHERE EXISTS(SELECT 1 FROM runtime_leases WHERE coin_id=? AND lease_id=? AND lease_until>?)
    AND NOT EXISTS(SELECT 1 FROM agent_operations WHERE coin_id=? AND status IN ('queued','signed','broadcast'))
    AND (?=0 OR ? >= ? + COALESCE((SELECT SUM(ai_credit_microusd) FROM coins),0)
      + COALESCE((SELECT SUM(reserved_microusd) FROM chat_runs WHERE status='reserved'),0)
      + COALESCE((SELECT SUM(reserved_microusd) FROM agent_runs WHERE status='reserved'),0)
      + COALESCE((SELECT SUM(reserved_microusd) FROM agent_operations WHERE kind='compute' AND status IN ('queued','signed','broadcast')),0))`)
    .bind(id,lease.coinId,kind,amount,funding?.reserve??0,now+300000,now,reason,lease.coinId,lease.id,now,lease.coinId,funding?.reserve??0,funding?.capacity??0,funding?.reserve??0).run();
}
export async function refreshRuntimeHealth(){
  const capabilities=await runtimeCapabilities();
  await db().prepare("INSERT INTO runtime_health(id,checked_at,capabilities,version) VALUES('worker',?,?,'1') ON CONFLICT(id) DO UPDATE SET checked_at=excluded.checked_at,capabilities=excluded.capabilities,version=excluded.version").bind(Date.now(),JSON.stringify(capabilities)).run();
  return capabilities;
}
export async function runAgentTick(capabilities?:string[]){
  capabilities??=await refreshRuntimeHealth();
  if(!capabilities.includes("autonomous-planning"))return {processed:false,reason:"runtime_configuration_required"};
  const lease=await acquire();if(!lease)return {processed:false,reason:"no_due_agents"};let nextMinutes=5;
  try{
    const row=await db().prepare("SELECT * FROM coins WHERE id=? AND token_address IS NOT NULL").bind(lease.coinId).first<CoinRow>();if(!row)return {processed:false,reason:"coin_unavailable"};
    const coin=JSON.parse(row.config) as Coin;
    const wallet=await signerRequest<{address:string;tokenAddress:string;balanceWei:string;observedAt:number}>(`/v1/wallets/${coin.id}/balance`);
    if(wallet.address.toLowerCase()!==row.treasury_address||wallet.tokenAddress?.toLowerCase()!==row.token_address)throw new AppError(503,"Agent wallet binding mismatch.");
    const wei=BigInt(wallet.balanceWei),balance=Number(formatEther(wei)),active=wei>=parseEther(String(coin.threshold));
    const nextCoin={...coin,balance,treasuryObservedAt:wallet.observedAt,state:active?"active":"dormant"} as Coin;
    await db().prepare("UPDATE coins SET config=?,updated_at=? WHERE id=? AND config=?").bind(JSON.stringify(nextCoin),new Date().toISOString(),coin.id,row.config).run();
    if(!active)return {processed:true,reason:"awaiting_treasury_funding"};
    if(await db().prepare("SELECT id FROM agent_operations WHERE coin_id=? AND status IN ('queued','signed','broadcast')").bind(coin.id).first())return {processed:true,reason:"transaction_pending"};
    if(await db().prepare("SELECT id FROM agent_runs WHERE coin_id=? AND status='reserved'").bind(coin.id).first())return {processed:true,reason:"provider_cost_reconciliation_required"};
    const prices=await Promise.all([chatPrice(agentModel(coin.modelId).id),chatPrice(GUARDRAIL_MODEL)]);
    const researchCost=coin.research?Number(env.BRAVE_COST_MICROUSD):0;
    if(coin.research&&(!Number.isSafeInteger(researchCost)||researchCost<=0||!env.BRAVE_API_KEY))throw new AppError(412,"Brave billing must be configured before research.");
    const ceiling=callCeiling(prices[0])+callCeiling(prices[1])+researchCost;
    const contentAllowance=(coin.images?125000:0)+(coin.social?21000:0);
    if(row.ai_credit_microusd<ceiling+contentAllowance){
      const target=Math.max(5000000,(ceiling+contentAllowance)*8),price=await bnbPrice(),capacity=await computeCapacity();
      const fundingReserve=Math.ceil(target*1.2);
      if(capacity.available-capacity.liability<fundingReserve)return {processed:true,reason:"central_compute_funding_required"};
      const amount=(BigInt(target)*100000000000000000000n+price.answer-1n)/price.answer;
      if(amount>wei/4n)return {processed:true,reason:"awaiting_service_funding"};
      await queue(lease,"compute",amount.toString(),"Prepay metered agent services from treasury.",{reserve:fundingReserve,capacity:capacity.available});return {processed:true,reason:"service_payment_queued"};
    }
    const tokenBalance=await chainClient().readContract({address:coin.tokenAddress as Address,abi:parseAbi(["function balanceOf(address) view returns(uint256)"]),functionName:"balanceOf",args:[wallet.address as Address]});
    const signerPolicy=await signerRequest<{gasReserveWei:string;buybacksEnabled:boolean}>("/v1/status");
    const minimumGas=BigInt(signerPolicy.gasReserveWei),gasReserve=wei/100n>minimumGas?wei/100n:minimumGas,available=wei>gasReserve?wei-gasReserve:0n;
    const community=await contentSnapshot(coin);
    const run=await reserve(lease,ceiling);
    // Any ambiguous provider failure keeps its reservation. Non-billable chain
    // preflight is complete before reserving, so known local failures don't lock credit.
    const sources=coin.research?await research(coin):[];
    const snapshot={name:coin.name,symbol:coin.symbol,mission:coin.purpose,language:coin.language,treasuryWei:wei.toString(),availableWei:available.toString(),gasReserveWei:gasReserve.toString(),tokenBalanceWei:tokenBalance.toString(),buybacksEnabled:signerPolicy.buybacksEnabled,computeCreditMicrousd:row.ai_credit_microusd-ceiling,website:coin.site??null,sources,community,canPostX:coin.social&&community.xConnected&&capabilities.includes('x-publishing'),canGenerateImages:coin.images&&capabilities.includes('image-publishing')};
    const result=await chatCompletion(prices[0],PLANNER_RULES+" Write content in "+(coin.language==="zh"?"Simplified Chinese.":"English."),snapshot);
    let plan;
    try{plan=validatePlanFunds(agentPlan.parse(JSON.parse(result.text)),available,tokenBalance);if(plan.transaction.kind==="buyback"&&!signerPolicy.buybacksEnabled)throw Error("Buyback policy disabled");if(plan.publication)validatePublication(plan.publication,{social:snapshot.canPostX,images:snapshot.canGenerateImages,connected:community.xConnected});}catch{await settle(coin.id,run,result.cost+researchCost,"Plan rejected by schema or spending policy.");return {processed:true,reason:"plan_rejected"};}
    const guard=await chatCompletion(prices[1],PLAN_GUARD_RULES,{snapshot,plan});
    let decoded:unknown;try{decoded=JSON.parse(guard.text)}catch{decoded=null}
    const verdict=z.object({allow:z.boolean(),reason:z.string().max(1000)}).strict().safeParse(decoded);
    await settle(coin.id,run,result.cost+guard.cost+researchCost,JSON.stringify(plan));
    if(!verdict.success||!verdict.data.allow)return {processed:true,reason:"plan_rejected"};
    const current=await db().prepare("SELECT config FROM coins WHERE id=?").bind(coin.id).first<{config:string}>();if(!current)throw new AppError(409,"Coin changed during planning.");
    const updated={...JSON.parse(current.config),...(coin.website&&plan.website?{site:plan.website}:{})};
    const now=Date.now();
    const saved=await db().batch([
      db().prepare("UPDATE coins SET config=?,updated_at=? WHERE id=? AND config=? AND EXISTS(SELECT 1 FROM runtime_leases WHERE coin_id=? AND lease_id=? AND lease_until>?)").bind(JSON.stringify(updated),new Date().toISOString(),coin.id,current.config,coin.id,lease.id,now),
      db().prepare("INSERT INTO agent_chat_control(coin_id,closed_until) SELECT ?,? WHERE EXISTS(SELECT 1 FROM runtime_leases WHERE coin_id=? AND lease_id=? AND lease_until>?) ON CONFLICT(coin_id) DO UPDATE SET closed_until=excluded.closed_until").bind(coin.id,now+plan.closeChatMinutes*60000,coin.id,lease.id,now),
      db().prepare("INSERT INTO events(id,coin_id,owner,name,message,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM runtime_leases WHERE coin_id=? AND lease_id=? AND lease_until>?)").bind(run.id,coin.id,row.owner,coin.name,plan.summary,new Date().toISOString(),coin.id,lease.id,now),
      ...(plan.publication?[contentJobStatement(lease,run.id,plan.publication)]:[]),
    ]);
    if(!saved[0].meta.changes)throw new AppError(409,"Agent planning lease expired.");
    if(plan.transaction.kind!=="none")await queue(lease,plan.transaction.kind,plan.transaction.amountWei,plan.transaction.reason);
    nextMinutes=plan.nextCheckMinutes;return {processed:true,reason:"plan_completed"};
  } finally {await db().prepare("UPDATE runtime_leases SET lease_id=NULL,lease_until=0,next_run_at=? WHERE coin_id=? AND lease_id=?").bind(Date.now()+nextMinutes*60000,lease.coinId,lease.id).run();}
}
