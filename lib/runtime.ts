import { agentMemory, memoryStatement } from "./agent-memory";
import { xCosts } from "./social-config";
import { recordResearch, researchHistory } from "./research-history";
import { browserReady, browseResearch } from './browser-research';
import { recordMarketSignals, signalHistory } from './agent-signals';
import { researchSources } from "./research-preview";
import { researchStep, browseStep, pulseMinutes } from "./agent-work-policy";
import { agentTasks, validateTask, taskStatement, hasNewWorkResult } from "./agent-work";
import { serviceFundingAmount } from '../shared/service-funding.mjs';
import { env } from "cloudflare:workers";
import { z } from "zod";
import { formatEther, parseEther, parseAbi, type Address } from "viem";
import { agentModel, GUARDRAIL_MODEL } from "./agent-models";
import { chatPrice, callCeiling, chatCompletion, PaidCompletionRejected } from "./chat-completion";
import { AppError, db, type CoinRow } from "./server";
import { signerRequest } from "./signer";
import { bnbPrice, computeCapacity, hasPrepaidServices } from "./funding";
import { chainClient, research } from "./providers";
import { agentPlan, PLANNER_RULES, PLAN_FORMAT_RULES, PLAN_GUARD_RULES, validatePlanFunds } from "./runtime-policy";
import type { Coin } from "./model";
import { contentCapabilities, contentJobStatement, contentSnapshot } from './content-runtime';
import { validatePublication } from './content-policy';
import { marketContext } from './market';
import { treasuryFlow } from './treasury-flow';
import { publishedWebsite, websiteStatements } from './websites';
import { domainSnapshot, domainOrderStatement, domainsConfigured } from './domain-runtime';
import { boundedPlanningContext } from './planning-context';
import { websiteTiming } from './website-timing';
import { planValidationDiagnostic, readPlanDiagnostic, publicPlanDiagnostic, type PlanDiagnostic } from './plan-diagnostics';
// Reasoning and visible JSON share the provider's output limit.
const PLANNER_OUTPUT_TOKENS=8192;
const GUARD_OUTPUT_TOKENS=4096;
// An uncertain publication owns its already-deducted credit. It must not
// freeze unrelated work, but orphaned or mismatched reservations still block.
const isolatedContentHold=`r.kind='content' AND EXISTS(SELECT 1 FROM content_jobs j WHERE r.id='content:'||j.id AND j.coin_id=r.coin_id AND j.reserved_microusd=r.reserved_microusd AND j.status IN ('uncertain','reconciling'))`;

type Lease={coinId:string;id:string};
export async function requireWorker(request:Request){
  if(request.headers.get("origin"))throw new AppError(403,"Browser access is not supported.");
  const expected=env.WORKER_TOKEN,actual=request.headers.get("authorization");
  if(!expected||expected.length<40||!actual)throw new AppError(401,"Worker authentication required.");
  const digest=async(v:string)=>new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v)));
  const [a,b]=await Promise.all([digest(actual),digest("Bearer "+expected)]);let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];if(diff)throw new AppError(401,"Worker authentication required.");
}
export async function runtimeCapabilities(){
  if(!env.OPENROUTER_API_KEY||!env.OPENROUTER_MANAGEMENT_KEY)return [];
  const [signer,capacity]=await Promise.all([signerRequest<{chainId:number;signingReady:boolean;settlementAddress:string;domainFundingEnabled?:boolean}>("/v1/status"),computeCapacity()]);
  if(signer.chainId!==56||!signer.signingReady||signer.settlementAddress?.toLowerCase()!==env.SIGNER_SETTLEMENT_ADDRESS?.toLowerCase()||capacity.available<=0||capacity.available<capacity.liability)return [];
  return ["funding-reconciliation","cost-reservations","autonomous-planning","transaction-execution","website-publishing",...(domainsConfigured()&&signer.domainFundingEnabled?["custom-domains"]:[]),...await contentCapabilities(),...(env.BRAVE_API_KEY&&Number(env.BRAVE_COST_MICROUSD)>0?["brave-research"]:[])];
}
async function acquire():Promise<Lease|null>{
  const now=Date.now();
  await db().prepare("INSERT INTO runtime_leases(coin_id,lease_until,next_run_at) SELECT id,0,0 FROM coins WHERE token_address IS NOT NULL ON CONFLICT(coin_id) DO NOTHING").run();
  const candidate=await db().prepare("SELECT coin_id FROM runtime_leases WHERE lease_until<? AND next_run_at<=? ORDER BY next_run_at,coin_id LIMIT 1").bind(now,now).first<{coin_id:string}>();if(!candidate)return null;
  const id=crypto.randomUUID();const r=await db().prepare("UPDATE runtime_leases SET lease_id=?,lease_until=? WHERE coin_id=? AND lease_until<? AND next_run_at<=?").bind(id,now+480000,candidate.coin_id,now,now).run();return r.meta.changes?{coinId:candidate.coin_id,id}:null;
}
async function reserve(lease:Lease,ceiling:number){
  const id=crypto.randomUUID(),now=new Date().toISOString();
  const result=await db().batch([
    db().prepare(`INSERT INTO agent_runs(id,coin_id,kind,status,reserved_microusd,created_at) SELECT ?,id,'plan','reserved',?,? FROM coins WHERE id=? AND ai_credit_microusd>=?
      AND EXISTS(SELECT 1 FROM runtime_leases WHERE coin_id=coins.id AND lease_id=? AND lease_until>?)
      AND NOT EXISTS(SELECT 1 FROM agent_runs r WHERE r.coin_id=coins.id AND r.status='reserved' AND NOT (${isolatedContentHold}))`).bind(id,ceiling,now,lease.coinId,ceiling,lease.id,Date.now()),
    db().prepare("UPDATE coins SET ai_credit_microusd=ai_credit_microusd-? WHERE id=? AND EXISTS(SELECT 1 FROM agent_runs WHERE id=?)").bind(ceiling,lease.coinId,id),
  ]);
  if(!result[0].meta.changes)throw new AppError(412,"Insufficient available credit for this plan.");return {id,ceiling};
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
  const lease=await acquire();if(!lease)return {processed:false,reason:"no_due_agents"};let nextMinutes=.5,nextPlanAt:number|null=null,lastReason="wallet_check_failed";
  const tickResult=(reason:string)=>{lastReason=reason;return {processed:true,reason}};
  const rejectedResult=async(reason:string,diagnostic?:PlanDiagnostic)=>{
    // Retry only settled attempts: unknown charges keep their reservation and
    // remain blocked for reconciliation. Limit bursts to three failures/15 min.
    const recent=await db().prepare("SELECT COUNT(*) AS total FROM agent_runs WHERE coin_id=? AND kind='plan' AND status='settled' AND created_at>=? AND NOT EXISTS(SELECT 1 FROM agent_memories WHERE agent_memories.id=agent_runs.id AND agent_memories.coin_id=agent_runs.coin_id)").bind(lease.coinId,new Date(Date.now()-15*60000).toISOString()).first<{total:number}>();
    if(Number(recent?.total??0)<3){nextPlanAt=0;nextMinutes=0;}
    else{nextPlanAt=Date.now()+15*60000;nextMinutes=1;}
    const rejection=diagnostic?publicPlanDiagnostic(diagnostic):null;
    if(rejection)console.warn(`Agent plan rejected [${rejection.code}]: ${rejection.message}`);
    return {...tickResult(reason),rejection};
  };
  try{
    const row=await db().prepare("SELECT * FROM coins WHERE id=? AND token_address IS NOT NULL").bind(lease.coinId).first<CoinRow>();if(!row)return {processed:false,reason:"coin_unavailable"};
    const coin=JSON.parse(row.config) as Coin & {lastPlanRunId?:string;workObservedAt?:number;nextResearchQuery?:string|null;treasuryThesis?:unknown};
    const wallet=await signerRequest<{address:string;tokenAddress:string;balanceWei:string;protocolReserveWei?:string|null;feeAccountingReady?:boolean;feeAccountingIssue?:string;observedAt:number;block:string}>(`/v1/wallets/${coin.id}/balance`);
    if(wallet.address.toLowerCase()!==row.treasury_address||wallet.tokenAddress?.toLowerCase()!==row.token_address)throw new AppError(503,"Agent wallet binding mismatch.");
    const wei=BigInt(wallet.balanceWei),balance=Number(formatEther(wei)),treasuryFunded=wei>=parseEther(String(coin.threshold));
    // A confirmed service payment converts treasury BNB into usable credit.
    // Do not require that same BNB to remain in the wallet to use the credit.
    const active=treasuryFunded||await hasPrepaidServices(coin.id,row.ai_credit_microusd);
    const nextCoin={...coin,balance,treasuryObservedAt:wallet.observedAt,state:active?"active":"dormant"} as Coin;
    await db().prepare("UPDATE coins SET config=?,updated_at=? WHERE id=? AND config=?").bind(JSON.stringify(nextCoin),new Date().toISOString(),coin.id,row.config).run();
    if(wallet.feeAccountingReady===false||typeof wallet.protocolReserveWei!=="string"||!/^\d+$/.test(wallet.protocolReserveWei))return tickResult(["historical_rpc_required","rpc_log_limit","fee_audit_pending"].includes(wallet.feeAccountingIssue??"")?wallet.feeAccountingIssue!:"fee_verification_failed");
    lastReason="service_check_failed";
    const feeFlow=await treasuryFlow(coin.id,row.token_address as Address,wallet.address as Address,BigInt(wallet.block),wallet.balanceWei);
    if(!active)return tickResult("awaiting_treasury_funding");
    nextMinutes=1;
    if(await db().prepare("SELECT id FROM agent_operations WHERE coin_id=? AND status IN ('queued','signed','broadcast')").bind(coin.id).first())return tickResult("transaction_pending");
    if(await db().prepare(`SELECT r.id FROM agent_runs r WHERE r.coin_id=? AND r.status='reserved' AND NOT (${isolatedContentHold})`).bind(coin.id).first())return tickResult("provider_cost_reconciliation_required");
    const heldContent=!!await db().prepare(`SELECT r.id FROM agent_runs r WHERE r.coin_id=? AND r.status='reserved' AND (${isolatedContentHold})`).bind(coin.id).first();
    if(await db().prepare("SELECT id FROM domain_orders WHERE coin_id=? AND status IN ('queued','funding','reserve','purchase','review')").bind(coin.id).first())return tickResult("domain_payment_pending");
    const currentMarket=await marketContext(row.token_address!);
    await recordMarketSignals(lease,currentMarket);
    const schedule=await db().prepare("SELECT next_plan_at FROM runtime_leases WHERE coin_id=?").bind(coin.id).first<{next_plan_at:number}>();
    if(schedule&&schedule.next_plan_at>Date.now()&&!await hasNewWorkResult(coin.id,coin.lastPlanRunId,coin.workObservedAt))return tickResult("awaiting_next_plan");
    lastReason="model_pricing_unavailable";
    const prices=await Promise.all([chatPrice(agentModel(coin.modelId).id),chatPrice(GUARDRAIL_MODEL)]);
    const researchRate=Number(env.BRAVE_COST_MICROUSD);
    const canResearch=coin.research&&!!env.BRAVE_API_KEY&&Number.isSafeInteger(researchRate)&&researchRate>0;
    const canBrowse=coin.research&&await browserReady();
    let maxSearches=canResearch||canBrowse?2:0;
    let ceiling=callCeiling(prices[0],PLANNER_OUTPUT_TOKENS)*(maxSearches+1)+callCeiling(prices[1],GUARD_OUTPUT_TOKENS,64000)+maxSearches*(canResearch?researchRate:0);
    lastReason="social_billing_invalid";
    const xRates=coin.social?xCosts("https://shen.now"):null;
    const contentAllowance=heldContent?0:(coin.images?125000:0)+(xRates?xRates.post+xRates.upload+xRates.read*3:0);
    // Prefer a smaller useful cycle when credit cannot reserve every tool step.
    while(maxSearches>0&&row.ai_credit_microusd<ceiling+contentAllowance){maxSearches--;ceiling=callCeiling(prices[0],PLANNER_OUTPUT_TOKENS)*(maxSearches+1)+callCeiling(prices[1],GUARD_OUTPUT_TOKENS,64000)+maxSearches*(canResearch?researchRate:0);}
    lastReason="signer_policy_unavailable";
    const signerPolicy=await signerRequest<{gasReserveWei:string;buybacksEnabled:boolean}>("/v1/status");
    const protocolReserve=BigInt(wallet.protocolReserveWei);
    const minimumGas=BigInt(signerPolicy.gasReserveWei),gasReserve=wei/100n>minimumGas?wei/100n:minimumGas,available=wei>gasReserve+protocolReserve?wei-gasReserve-protocolReserve:0n;
    if(row.ai_credit_microusd<ceiling+contentAllowance){
      // Below the activation threshold, use already-paid credit only. New
      // payments still require the treasury threshold and all reserve checks.
      if(!treasuryFunded)return tickResult("awaiting_service_funding");
      lastReason="funding_price_unavailable";
      const price=await bnbPrice();
      lastReason="service_capacity_unavailable";
      const capacity=await computeCapacity();
      // A refill can be smaller than the preferred batch. Funds, gas and
      // provider collateral bound it; no fixed fraction of treasury does.
      const affordable=Number((available>minimumGas?available-minimumGas:0n)*price.answer/100000000000000000000n);
      const target=Math.floor(Math.min(Math.max(5000000,(ceiling+contentAllowance)*8),affordable,(capacity.available-capacity.liability)/1.2));
      if(target+row.ai_credit_microusd<ceiling+contentAllowance||target<=0)return tickResult("awaiting_service_funding");
      const payment=serviceFundingAmount({targetMicrousd:target,price:price.answer,availableWei:available>minimumGas?available-minimumGas:0n,capacityMicrousd:capacity.available-capacity.liability,address:env.SIGNER_SETTLEMENT_ADDRESS});
      if(!payment)return tickResult("service_deposit_minimum_or_collateral_required");
      const {amountWei:amount,reserveMicrousd:fundingReserve}=payment;
      await queue(lease,"compute",amount.toString(),"Prepay metered agent services from treasury.",{reserve:fundingReserve,capacity:capacity.available});return tickResult("service_payment_queued");
    }
    lastReason="planning_context_unavailable";
    const tokenBalance=await chainClient().readContract({address:coin.tokenAddress as Address,abi:parseAbi(["function balanceOf(address) view returns(uint256)"]),functionName:"balanceOf",args:[wallet.address as Address]});
    const [community,market,hosted,costs,domains,operations]=await Promise.all([contentSnapshot(coin),Promise.resolve(currentMarket),publishedWebsite(coin.id),db().prepare(`SELECT
      (SELECT COALESCE(SUM(cost_microusd),0) FROM agent_runs WHERE coin_id=? AND status='settled' AND created_at>?) +
      (SELECT COALESCE(SUM(cost_microusd),0) FROM chat_runs WHERE coin_id=? AND status='settled' AND created_at>?) AS hour,
      (SELECT COALESCE(SUM(cost_microusd),0) FROM agent_runs WHERE coin_id=? AND status='settled' AND created_at>?) +
      (SELECT COALESCE(SUM(cost_microusd),0) FROM chat_runs WHERE coin_id=? AND status='settled' AND created_at>?) AS day`)
      .bind(coin.id,new Date(Date.now()-3600000).toISOString(),coin.id,Date.now()-3600000,coin.id,new Date(Date.now()-86400000).toISOString(),coin.id,Date.now()-86400000).first<{hour:number;day:number}>(),domainSnapshot(coin.id,coin.website&&capabilities.includes("custom-domains")),db().prepare("SELECT id,kind,amount_wei AS amountWei,status,reason,created_at AS createdAt,tx_hash AS hash FROM agent_operations WHERE coin_id=? ORDER BY created_at DESC LIMIT 8").bind(coin.id).all()]);
    const websiteQuote=coin.website&&!hosted?await bnbPrice().catch(()=>null):null;
    const siteTiming=websiteTiming(feeFlow.lifetimeDistributedWei,websiteQuote?.answer);
    const observedAt=Date.now();
    const [tasks,history,cycleCosts]=await Promise.all([agentTasks(coin.id),researchHistory(coin.id),db().prepare("SELECT cost_microusd FROM agent_runs WHERE coin_id=? AND kind='plan' AND status='settled' ORDER BY created_at DESC,id DESC LIMIT 8").bind(coin.id).all<{cost_microusd:number}>()]);
    const run=await reserve(lease,ceiling);
    let paidCost=0;
    const rejectPlan=async(diagnostic:PlanDiagnostic,extraCost=0,reason='plan_rejected')=>{
      await settle(coin.id,run,paidCost+extraCost,JSON.stringify({rejection:diagnostic}));
      return rejectedResult(reason,diagnostic);
    };
    // Unexpected failures retain a cooldown; settled rejections can retry on
    // the next worker pass with a bounded burst. Approved plans set their pace.
    nextPlanAt=Date.now()+15*60000;
    // Any ambiguous provider failure keeps its reservation. Non-billable chain
    // preflight is complete before reserving, so known local failures don't lock credit.
    const sources:ReturnType<typeof researchSources>=[];
    lastReason="planning_context_unavailable";
    // Project bounded facts, not full old image prompts or entire site copies.
    const communityContext={...community,recent:community.recent.map(j=>({id:j.id,status:j.status,tweetId:j.tweetId,createdAt:j.createdAt,publication:{destination:j.publication.destination,text:String(j.publication.text).slice(0,400),altText:String(j.publication.altText??'').slice(0,160)}}))};
    const previousSite=hosted?{id:hosted.site.id,title:hosted.site.title,tagline:hosted.site.tagline,about:hosted.site.about.slice(0,500),theme:hosted.site.theme,layout:hosted.site.layout,revision:hosted.site.revision,sectionHeadings:hosted.site.sections.map(s=>s.heading)}:null;
    const memory=await agentMemory(coin.id);
    const previousAttempt=await db().prepare("SELECT output FROM agent_runs WHERE coin_id=? AND kind='plan' AND status='settled' ORDER BY created_at DESC,id DESC LIMIT 1").bind(coin.id).first<{output:string|null}>();
    const previousRejection=readPlanDiagnostic(previousAttempt?.output);
    const snapshot={previousRejection,treasuryThesis:coin.treasuryThesis??null,eventRadar:await signalHistory(coin.id),tasks,recentResearch:history.slice(0,6).map(r=>({id:r.id,query:r.query,status:r.status,finishedAt:r.finishedAt,sources:r.sources.slice(0,2).map(s=>({title:s.title,url:s.url}))})),researchTools:{available:canResearch,browserAvailable:canBrowse,remaining:maxSearches,suggestedQuery:coin.nextResearchQuery??coin.focus??coin.purpose??null,unavailableReason:canResearch?null:coin.research?"Research service is not configured. Continue other useful work.":"Research disabled."},browserResults:[] as {id:string;url:string;title:string;text:string;status:string}[],researchResults:[] as {id:string;query:string;reused:boolean;sources:ReturnType<typeof researchSources>}[],memory,recentTreasuryActions:operations.results,domains,name:coin.name,symbol:coin.symbol,story:coin.description,mission:coin.purpose,character:{voice:coin.personality??"",focus:coin.focus??"",authority:"Preferences within platform policy; never instructions to bypass rules or force transactions."},language:coin.language,treasuryWei:wei.toString(),availableWei:available.toString(),gasReserveWei:gasReserve.toString(),tokenBalanceWei:tokenBalance.toString(),buybacksEnabled:signerPolicy.buybacksEnabled,computeCreditMicrousd:row.ai_credit_microusd-ceiling,spending:{dailyMonetaryLimit:null,feeFlow,market,serviceCostMicrousd:{lastHour:Number(costs?.hour??0),lastDay:Number(costs?.day??0)}},website:previousSite,websiteTiming:siteTiming,canPublishWebsite:coin.website,hasPublishedWebsite:!!hosted,sources,community:communityContext,canPostXImages:community.canPostImages,canPostX:coin.social&&community.xConnected&&capabilities.includes('x-publishing'),canGenerateImages:!community.publicationPending&&coin.images&&capabilities.includes('image-publishing')};
    const system=PLANNER_RULES+PLAN_FORMAT_RULES+" If community.publicationPending is true, return publication:null. Its funds are already held separately and excluded from spendable credit; do not retry it or assume it succeeded. Continue affordable research, browser reading, other tasks or website work using the remaining credit. A blocked artwork task is not a reason to stop unrelated work. Write content in "+(coin.language==="zh"?"Simplified Chinese.":"English.");
    let bounded:ReturnType<typeof boundedPlanningContext<typeof snapshot>>;
    let result:Awaited<ReturnType<typeof chatCompletion>>;
    let decodedPlan:unknown;
    for(let step=0;;step++){
      snapshot.researchTools.remaining=maxSearches-step;
      try{bounded=boundedPlanningContext(system,snapshot)}catch(error){await settle(coin.id,run,paidCost,'Essential planning context exceeded the local input bound.');throw error;}
      lastReason="planner_request_failed";
      try{result=await chatCompletion(prices[0],system,bounded,PLANNER_OUTPUT_TOKENS,32000,{coinId:coin.id,runId:run.id,kind:"planner"});}catch(error){
        if(error instanceof PaidCompletionRejected)return await rejectPlan({code:error.truncated?'planner_truncated':'planner_output'},error.cost,error.truncated?'planner_output_truncated':'plan_rejected');
        if(error instanceof AppError&&(error.status===413||error.status===412))await settle(coin.id,run,paidCost,'Planner request rejected before dispatch.');throw error;
      }
      paidCost+=result.cost;
      try{decodedPlan=JSON.parse(result.text)}catch{return await rejectPlan({code:'invalid_json'});}
      const tool=researchStep.safeParse(decodedPlan),browse=browseStep.safeParse(decodedPlan);
      if(!tool.success&&!browse.success)break;
      if(step>=maxSearches)return await rejectPlan({code:'tool_budget'});
      if(browse.success){
        if(!canBrowse||!history.some(r=>r.status==='complete'&&r.sources.some(source=>source.url===browse.data.url)))return await rejectPlan({code:'browser_source'});
        snapshot.browserResults.push(await browseResearch(coin.id,run.id+':browser:'+step,browse.data.url));
        continue;
      }
      if(!canResearch||!tool.success)return await rejectPlan({code:'research_unavailable'});
      const query=tool.data.query,normalize=(v:string)=>v.normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
      const prior=history.find(r=>r.status==='complete'&&r.finishedAt&&r.finishedAt>Date.now()-3600000&&normalize(r.query)===normalize(query));
      const id=prior?.id??run.id+':research:'+step;
      lastReason="research_request_failed";
      const fullSources=prior?.sources??await recordResearch({...coin,nextResearchQuery:query},id,()=>research({...coin,nextResearchQuery:query}));
      if(!prior){paidCost+=researchRate;history.unshift({id,query,status:'complete',sources:fullSources,startedAt:Date.now(),finishedAt:Date.now()});}
      const found=fullSources.slice(0,3).map(s=>({title:s.title.slice(0,120),url:s.url.slice(0,512),description:s.description.slice(0,400)}));
      snapshot.sources=found;
      snapshot.researchResults.push({id,query,reused:!!prior,sources:found});
      // One real source preview per cycle, in addition to the bounded model
      // tool steps. Persist it even if the final plan is later rejected.
      if(canBrowse&&snapshot.browserResults.length===0&&fullSources[0])snapshot.browserResults.push(await browseResearch(coin.id,run.id+':preview',fullSources[0].url));
      snapshot.recentResearch=history.slice(0,6).map(r=>({id:r.id,query:r.query,status:r.status,finishedAt:r.finishedAt,sources:r.sources.slice(0,2).map(s=>({title:s.title,url:s.url}))}));
    }
    let plan;
    try{plan=validatePlanFunds(agentPlan.parse(decodedPlan),available,tokenBalance);if(["buyback","buyback_burn"].includes(plan.transaction.kind)&&!signerPolicy.buybacksEnabled)throw Error("Buyback policy disabled");if(plan.domain&&(!domains.enabled||domains.pending))throw Error("Domain capability unavailable");if(plan.task)await validateTask(coin.id,plan.task);if(plan.publication&&community.publicationPending)throw Error('A publication is already pending');if(plan.publication)validatePublication(plan.publication,{social:snapshot.canPostX,images:snapshot.canGenerateImages,connected:community.xConnected});}catch(error){return await rejectPlan(planValidationDiagnostic(error));}
    // Pace from verified whole-cycle costs; a first cycle estimates review cost
    // from the planner receipt until an actual completed cycle is available.
    const averageCost=cycleCosts.results.length?cycleCosts.results.reduce((n,r)=>n+Number(r.cost_microusd),0)/cycleCosts.results.length:paidCost*2;
    const cadence=pulseMinutes(row.ai_credit_microusd-paidCost,Math.max(averageCost,paidCost));
    plan={...plan,nextCheckMinutes:cadence};
    lastReason="guard_request_failed";
    let guard;
    try{guard=await chatCompletion(prices[1],PLAN_GUARD_RULES,{snapshot:bounded,plan},GUARD_OUTPUT_TOKENS,64000,{coinId:coin.id,runId:run.id,kind:"plan-guard"});}catch(error){
      if(error instanceof PaidCompletionRejected)return await rejectPlan({code:error.truncated?'guard_truncated':'guard_output'},error.cost,error.truncated?'guard_output_truncated':'plan_rejected');
      if(error instanceof AppError&&(error.status===413||error.status===412))await settle(coin.id,run,paidCost,'Guard request rejected before dispatch.');throw error;
    }
    lastReason="plan_save_failed";
    let decoded:unknown;try{decoded=JSON.parse(guard.text)}catch{decoded=null}
    const verdict=z.object({allow:z.boolean(),reason:z.string().max(1000)}).strict().safeParse(decoded);
    if(!verdict.success)return await rejectPlan({code:'guard_output'},guard.cost);
    if(!verdict.data.allow)return await rejectPlan({code:'guard_denied',reviewReason:verdict.data.reason},guard.cost);
    await settle(coin.id,run,paidCost+guard.cost,JSON.stringify(plan));
    const current=await db().prepare("SELECT config FROM coins WHERE id=?").bind(coin.id).first<{config:string}>();if(!current)throw new AppError(409,"Coin changed during planning.");
    const updated={...JSON.parse(current.config),lastPlanRunId:run.id,nextResearchQuery:coin.research?plan.nextResearchQuery:null,workObservedAt:observedAt,...(plan.treasuryThesis?{treasuryThesis:{...plan.treasuryThesis,updatedAt:Date.now()}}:{})};
    const now=Date.now();
    const saved=await db().batch([
      db().prepare("UPDATE coins SET config=?,updated_at=? WHERE id=? AND config=? AND EXISTS(SELECT 1 FROM runtime_leases WHERE coin_id=? AND lease_id=? AND lease_until>?)").bind(JSON.stringify(updated),new Date().toISOString(),coin.id,current.config,coin.id,lease.id,now),
      db().prepare("INSERT INTO agent_chat_control(coin_id,closed_until) SELECT ?,? WHERE EXISTS(SELECT 1 FROM runtime_leases WHERE coin_id=? AND lease_id=? AND lease_until>?) ON CONFLICT(coin_id) DO UPDATE SET closed_until=excluded.closed_until").bind(coin.id,now+plan.closeChatMinutes*60000,coin.id,lease.id,now),
      db().prepare("INSERT INTO events(id,coin_id,owner,name,message,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM runtime_leases WHERE coin_id=? AND lease_id=? AND lease_until>?)").bind(run.id,coin.id,row.owner,coin.name,plan.summary,new Date().toISOString(),coin.id,lease.id,now),
      memoryStatement(lease,run.id,plan.summary,plan.memory??"",now),
      ...(plan.task?[taskStatement(lease,run.id,plan.task,now)]:[]),
      ...(plan.publication?[contentJobStatement(lease,run.id,plan.publication)]:[]),
      ...(coin.website&&plan.website?websiteStatements(lease,run.id,plan.website,now):[]),
      ...(coin.website&&plan.domain?[domainOrderStatement(lease,run.id,plan.domain,now)]:[]),
    ]);
    if(!saved[0].meta.changes)throw new AppError(409,"Agent planning lease expired.");
    if(plan.transaction.kind!=="none")await queue(lease,plan.transaction.kind,plan.transaction.amountWei,plan.transaction.reason);
    nextPlanAt=Date.now()+plan.nextCheckMinutes*60000;return tickResult("plan_completed");
  } catch(error) {console.warn(`Agent check failed [${lastReason}].`);throw error;
  } finally {await db().prepare("UPDATE runtime_leases SET lease_id=NULL,lease_until=0,next_run_at=?,next_plan_at=COALESCE(?,next_plan_at),last_checked_at=?,last_reason=? WHERE coin_id=? AND lease_id=?").bind(Date.now()+nextMinutes*60000,nextPlanAt,Date.now(),lastReason,lease.coinId,lease.id).run();}
}
