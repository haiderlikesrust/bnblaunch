import { env } from 'cloudflare:workers';
import { db, AppError } from './server';
import { signerRequest } from './signer';
import { createDomainProvider, DomainProviderError, type DomainProvider } from './domain-provider';
import { createDomainHosting, HostingError } from './domain-hosting';
import { domainProposal, type DomainProposal } from './domain-policy';

const DAY=86400000;
const ACTIVE="'queued','funding','reserve','purchase','owned','dns','route','deploy','verify','review'";
type Order={id:string;coin_id:string;domain:string;kind:'register'|'renew';payload:string;status:string;cost_cents:number;funding_cents:number;minimum_credit_cents:number;credit_cents:number;reserved_cents:number;charged_cents:number;funding_expires_at:number|null;checkout_id:string|null;purchase_started_at:number|null;purchase_attempts:number;provider_order:string|null;route_attempted:number;deploy_attempted:number;created_at:number;updated_at:number};
type Funding={id:string;coinId:string;status:string;amountCents:number;checkoutId:string|null;estimatedCreditCents:number|null;credited:boolean;creditedMicrousd:number;bridgeHash:string|null;bridgeAmountWei:string|null;bridgeGasWei:string|null;reason:string|null};
type DomainRow={coin_id:string;domain:string;state:string;verification_token:string;expires_at:number|null;order_id:string;last_error:string|null};
export function domainsConfigured(){return env.DOMAIN_AUTO_FUNDING_ENABLED==='true'&&env.SHEN_RUNTIME==='node'&&!!(env.PORKBUN_API_KEY&&env.PORKBUN_SECRET_KEY&&env.DOKPLOY_URL&&env.DOKPLOY_API_KEY&&env.DOKPLOY_COMPOSE_ID&&env.HOSTING_IPV4);}
export async function domainSnapshot(coinId:string,enabled:boolean){
 const current=await db().prepare('SELECT domain,state,expires_at FROM coin_domains WHERE coin_id=?').bind(coinId).first<{domain:string;state:string;expires_at:number|null}>();
 const pending=await db().prepare(`SELECT domain,kind,status,last_error FROM domain_orders WHERE coin_id=? AND status IN (${ACTIVE}) ORDER BY created_at DESC LIMIT 1`).bind(coinId).first();
 const credit=await db().prepare('SELECT COALESCE(SUM(credit_cents-charged_cents-reserved_cents),0) AS available FROM domain_orders WHERE coin_id=?').bind(coinId).first<{available:number}>();
 const lastAttempt=await db().prepare('SELECT domain,kind,status,last_error,cost_cents,charged_cents,updated_at FROM domain_orders WHERE coin_id=? ORDER BY created_at DESC LIMIT 1').bind(coinId).first();
 return {enabled:enabled&&domainsConfigured(),current,pending,lastAttempt,registrarCreditCents:Number(credit?.available??0),renewalDue:!!current?.expires_at&&current.expires_at-Date.now()<30*DAY,allowedTlds:['com','fun','xyz','ai'],custody:'platform-managed registrar account'};
}
export function domainOrderStatement(lease:{coinId:string;id:string},runId:string,proposal:DomainProposal,now:number){
 const p=domainProposal.parse(proposal);
 return db().prepare(`INSERT INTO domain_orders(id,coin_id,domain,kind,payload,status,created_at,updated_at)
 SELECT ?,id,?,?,?,'queued',?,? FROM coins WHERE id=? AND token_address IS NOT NULL AND json_extract(config,'$.lastPlanRunId')=?
 AND EXISTS(SELECT 1 FROM runtime_leases WHERE coin_id=coins.id AND lease_id=? AND lease_until>?)
 AND EXISTS(SELECT 1 FROM site_revisions WHERE coin_id=coins.id)
 AND NOT EXISTS(SELECT 1 FROM agent_operations WHERE coin_id=coins.id AND status IN ('queued','signed','broadcast'))
 AND NOT EXISTS(SELECT 1 FROM domain_orders WHERE coin_id=coins.id AND status IN (${ACTIVE}))
 AND NOT EXISTS(SELECT 1 FROM domain_orders WHERE domain=? AND coin_id!=coins.id AND status IN (${ACTIVE}))
 AND ((?='register' AND NOT EXISTS(SELECT 1 FROM coin_domains WHERE coin_id=coins.id OR domain=?)) OR
 (?='renew' AND EXISTS(SELECT 1 FROM coin_domains WHERE coin_id=coins.id AND domain=? AND expires_at<?)))
 ON CONFLICT(id) DO NOTHING`).bind(runId,p.domain,p.kind,JSON.stringify(p),now,now,lease.coinId,runId,lease.id,now,p.domain,p.kind,p.domain,p.kind,p.domain,now+30*DAY);
}
export async function domainFundingRequests(){
 if(!domainsConfigured())return [];
 const rows=await db().prepare("SELECT id,coin_id,payload,funding_cents,minimum_credit_cents,funding_expires_at FROM domain_orders WHERE status='funding' ORDER BY updated_at,created_at LIMIT 3").all<{id:string;coin_id:string;payload:string;funding_cents:number;minimum_credit_cents:number;funding_expires_at:number}>();
 if(rows.results.length)await db().batch(rows.results.map(r=>db().prepare("UPDATE domain_orders SET updated_at=? WHERE id=? AND status='funding'").bind(Date.now(),r.id)));
 return rows.results.map(r=>({id:r.id,coinId:r.coin_id,amountCents:Number(r.funding_cents),minimumCreditCents:Number(r.minimum_credit_cents),maxBnbWei:domainProposal.parse(JSON.parse(r.payload)).maxBnbWei,expiresAt:Number(r.funding_expires_at)}));
}
const provider=()=>createDomainProvider({apiKey:env.PORKBUN_API_KEY!,secretKey:env.PORKBUN_SECRET_KEY!});
const hosting=()=>createDomainHosting({dokployUrl:env.DOKPLOY_URL!,apiKey:env.DOKPLOY_API_KEY!,composeId:env.DOKPLOY_COMPOSE_ID!,ipv4:env.HOSTING_IPV4!});
type Dependencies={registrar:DomainProvider;host:ReturnType<typeof createDomainHosting>;funding:(id:string)=>Promise<Funding|null>};
export async function runDomainTick(injected?:Dependencies){
 if(!injected&&!domainsConfigured())return {processed:false,reason:'domains_not_configured'};
 const now=Date.now(),fence=crypto.randomUUID();
 await db().prepare("INSERT INTO domain_control(id,lease_until) VALUES('worker',0) ON CONFLICT(id) DO NOTHING").run();
 const acquired=await db().prepare("UPDATE domain_control SET lease_id=?,lease_until=? WHERE id='worker' AND lease_until<?").bind(fence,now+300000,now).run();
 if(!acquired.meta.changes)return {processed:false,reason:'domain_worker_busy'};
 const guard="EXISTS(SELECT 1 FROM domain_control WHERE id='worker' AND lease_id=? AND lease_until>?)";
 let job:Order|null=null;
 try{
  job=await db().prepare(`SELECT * FROM domain_orders WHERE status IN (${ACTIVE.replace(",'review'",'')},'live') AND next_attempt_at<=? ORDER BY next_attempt_at,created_at LIMIT 1`).bind(now).first<Order>();
  if(!job)return {processed:false,reason:'no_due_domains'};
  const j=job,p=domainProposal.parse(JSON.parse(j.payload)),d=injected??{registrar:provider(),host:hosting(),funding:async(id:string)=>(await signerRequest<{job:Funding|null}>(`/v1/domain-funding/${id}/record`)).job};
  const update=async(fields:string,...values:unknown[])=>{const saved=await db().prepare(`UPDATE domain_orders SET ${fields},updated_at=? WHERE id=? AND ${guard}`).bind(...values,Date.now(),j.id,fence,Date.now()).run();if(!saved.meta.changes)throw new AppError(409,'Domain lease expired.');return saved;};
  const next=async(status:string,delay=15000)=>update('status=?,next_attempt_at=?,last_error=NULL',status,Date.now()+delay);
  const fail=async(code:string)=>update("status='failed',reserved_cents=0,last_error=?",code);
  if(j.status==='queued'){
   const check=await d.registrar.check(j.domain);
   if(check.premium||check.annualRenewalCents>p.maxAnnualRenewalCents){await fail('PRICE_OUTSIDE_AGENT_BUDGET');return {processed:true,reason:'domain_over_budget'};}
   const quote=await d.registrar.quote(j.domain,j.kind);
   if(quote.costCents>p.maxCostCents||quote.withinMonthlySpendLimit===false){await fail('REGISTRAR_BUDGET_OR_LIMIT');return {processed:true,reason:'domain_over_budget'};}
   const credit=await db().prepare('SELECT COALESCE(SUM(credit_cents-charged_cents-reserved_cents),0) AS available FROM domain_orders WHERE coin_id=?').bind(j.coin_id).first<{available:number}>();
   const shortfall=Math.max(0,quote.costCents-Number(credit?.available??0));
   // Cover the published processor fee conservatively; exact checkout credit
   // is validated again before a bridge is allowed. Leftover stays this coin's.
   const topup=shortfall?Math.max(100,Math.ceil(shortfall/0.98)+1):0;
   await update('cost_cents=?,funding_cents=?,minimum_credit_cents=?,funding_expires_at=?,status=?,next_attempt_at=?',quote.costCents,topup,shortfall,Date.now()+DAY,topup?'funding':'reserve',Date.now());
  }else if(j.status==='funding'){
   const receipt=await d.funding(j.id);
   if(!receipt){if(j.funding_expires_at!<=Date.now())await fail('UNSTARTED_FUNDING_EXPIRED');return {processed:true,reason:'awaiting_domain_funding_worker'};}
   if(receipt.id!==j.id||receipt.coinId!==j.coin_id||receipt.amountCents!==j.funding_cents)throw new AppError(503,'Domain funding journal mismatch.');
   if(receipt.credited){
    if(!receipt.checkoutId||!Number.isSafeInteger(receipt.creditedMicrousd)||receipt.creditedMicrousd<=0||receipt.creditedMicrousd>j.funding_cents*10000||receipt.creditedMicrousd%10000)throw new AppError(503,'Invalid registrar credit evidence.');
    const confirmed=await d.registrar.cryptoTopupStatus(receipt.checkoutId);
    if(!confirmed.credited||confirmed.state!=='COMPLETED')throw new AppError(503,'Registrar credit is pending.');
    // One row is the receipt and balance source: retry cannot grant twice.
    await update("credit_cents=?,checkout_id=?,status='reserve',next_attempt_at=?",receipt.creditedMicrousd/10000,receipt.checkoutId,Date.now());
   }else if(receipt.status==='failed'||receipt.status==='expired'){
    await fail('FUNDING_FAILED');
   }else if(['review','recovery_required','needs_reconciliation'].includes(receipt.status)){
    await update("status='review',last_error=?",'FUNDING_RECONCILIATION_REQUIRED');
   }else await update('next_attempt_at=?',Date.now()+30000);
  }else if(j.status==='reserve'){
   // Refresh quote after bridging. Never pay a higher price than approved.
   const quote=await d.registrar.quote(j.domain,j.kind);
   const checked=await d.registrar.check(j.domain);
   if(checked.annualRenewalCents>p.maxAnnualRenewalCents||quote.costCents>p.maxCostCents){await fail('PRICE_CHANGED');return {processed:true,reason:'domain_price_changed'};}
   const balance=await d.registrar.balance();
   const saved=await db().prepare(`UPDATE domain_orders SET cost_cents=?,reserved_cents=?,status='purchase',next_attempt_at=?,updated_at=? WHERE id=? AND ${guard}
    AND ? <= (SELECT COALESCE(SUM(credit_cents-charged_cents-reserved_cents),0) FROM domain_orders WHERE coin_id=?)
    AND ? >= (SELECT COALESCE(SUM(credit_cents-charged_cents),0) FROM domain_orders)`)
    .bind(quote.costCents,quote.costCents,Date.now(),Date.now(),j.id,fence,Date.now(),quote.costCents,j.coin_id,balance.balanceCents).run();
   if(!saved.meta.changes)await update('next_attempt_at=?,last_error=?',Date.now()+300000,'REGISTRAR_CREDIT_UNAVAILABLE');
  }else if(j.status==='purchase'){
   const started=j.purchase_started_at??Date.now();
   // Before dispatch, permanently retain the original timestamp and ID.
   await update('purchase_started_at=?,purchase_attempts=purchase_attempts+1',started);
   const paid=await d.registrar.purchase({domain:j.domain,kind:j.kind,costCents:j.cost_cents,idempotencyKey:'shen:'+j.id,startedAt:started,previouslyAttempted:j.purchase_attempts>0});
   await update("provider_order=?,charged_cents=?,reserved_cents=0,status='owned',next_attempt_at=?",JSON.stringify(paid),paid.costCents,Date.now());
  }else if(j.status==='owned'){
   const owned=await d.registrar.detail(j.domain);
   if(owned.status!=='ACTIVE')throw new AppError(503,'Registration is pending.');
   if(j.kind==='renew'){const prior=await db().prepare('SELECT expires_at FROM coin_domains WHERE coin_id=? AND domain=?').bind(j.coin_id,j.domain).first<{expires_at:number}>();if(!prior||owned.expiresAt<=prior.expires_at)throw new AppError(503,'Renewal expiry is awaiting registrar confirmation.');}
   if(j.kind==='register'&&Math.abs(owned.createdAt-j.purchase_started_at!)>2*DAY)throw new AppError(503,'Registration identity requires reconciliation.');
   // Disable account-funded renewals before marking this purchase operational.
   await d.registrar.setAutoRenewOff(j.domain,'shen:'+j.id+':autorenew-off');
   await db().batch([
    db().prepare(`INSERT INTO coin_domains(coin_id,domain,state,verification_token,expires_at,order_id,updated_at) SELECT ?,?,'provisioning',?,?,?,? WHERE ${guard}
     ON CONFLICT(coin_id) DO UPDATE SET expires_at=excluded.expires_at,order_id=excluded.order_id,updated_at=excluded.updated_at WHERE coin_domains.domain=excluded.domain`).bind(j.coin_id,j.domain,crypto.randomUUID(),owned.expiresAt,j.id,Date.now(),fence,Date.now()),
    db().prepare(`UPDATE domain_orders SET status=?,next_attempt_at=?,updated_at=? WHERE id=? AND ${guard}`).bind(j.kind==='renew'?'verify':'dns',Date.now(),Date.now(),j.id,fence,Date.now()),
    db().prepare(`INSERT INTO events(id,coin_id,owner,name,message,created_at) SELECT ?,id,owner,json_extract(config,'$.name'),?,? FROM coins WHERE id=? AND ${guard} ON CONFLICT(id) DO NOTHING`).bind('domain:'+j.id,`${j.domain} ${j.kind==='renew'?'renewed':'registered'}; registrar cost $${(j.charged_cents/100).toFixed(2)}. Hosting verification pending.`,new Date().toISOString(),j.coin_id,fence,Date.now()),
   ]);
  }else if(j.status==='dns'){
   await d.registrar.ensureDns(j.domain,env.HOSTING_IPV4!,'shen:'+j.id+':dns',j.purchase_started_at!);
   await next('route');
  }else if(j.status==='route'){
   await update('route_attempted=1');
   const route=await d.host.ensureRoute(j.domain,{allowCreate:!j.route_attempted});
   if(route)await next('deploy');else await update("status='review',last_error=?",'HOST_ROUTE_RECONCILIATION_REQUIRED');
  }else if(j.status==='deploy'){
   if(!j.deploy_attempted){
    // Dokploy can restart this container before answering. The attempt is
    // durable first; the next worker probes instead of triggering a loop.
    await update('deploy_attempted=1');
    const result=await d.host.queueDeployment(j.domain,j.id);
    if(!result.queued){await update('deploy_attempted=0,next_attempt_at=?',Date.now()+60000);return {processed:true,reason:'hosting_busy'};}
   }
   await next('verify',60000);
  }else if(j.status==='verify'||j.status==='live'){
   const mapped=await db().prepare('SELECT * FROM coin_domains WHERE coin_id=? AND domain=?').bind(j.coin_id,j.domain).first<DomainRow>();
   if(!mapped)throw new AppError(503,'Domain mapping is pending.');
   const result=await d.host.verifySite(j.domain,j.coin_id,mapped.verification_token);
   await db().prepare(`UPDATE coin_domains SET state=?,last_error=?,updated_at=? WHERE coin_id=? AND domain=? AND ${guard}`).bind(result.live?'live':mapped.state==='live'||mapped.state==='degraded'?'degraded':'provisioning',result.live?null:'DNS_OR_HTTPS_PENDING',Date.now(),j.coin_id,j.domain,fence,Date.now()).run();
   await next(result.live?'live':'verify',result.live?6*3600000:300000);
  }
  return {processed:true,reason:'domain_'+j.status};
 }catch(error){
  if(job){
   const ambiguous=error instanceof DomainProviderError&&error.ambiguous;
   if(error instanceof HostingError&&!error.uncertain){
    const flag=job.status==='route'&&!job.route_attempted?'route_attempted':job.status==='deploy'&&!job.deploy_attempted?'deploy_attempted':null;
    if(flag)await db().prepare(`UPDATE domain_orders SET ${flag}=0 WHERE id=? AND ${guard}`).bind(job.id,fence,Date.now()).run();
   }
   const explicitRejection=error instanceof DomainProviderError&&!error.ambiguous&&!error.retryable&&(['queued','reserve'].includes(job.status)||job.status==='purchase'&&job.purchase_attempts===0);
   const code=error instanceof DomainProviderError?error.code:'DOMAIN_SERVICE_PENDING';
   // Paid ambiguity retains credit and retries the SAME key only inside the
   // registrar's 24h window. After that, human reconciliation is required.
   const expired=ambiguous&&code==='IDEMPOTENCY_WINDOW_EXPIRED';
   await db().prepare(`UPDATE domain_orders SET status=?,reserved_cents=?,last_error=?,next_attempt_at=?,updated_at=? WHERE id=? AND status=? AND ${guard}`)
    .bind(explicitRejection?'failed':expired?'review':job.status,explicitRejection?0:job.reserved_cents,code,Date.now()+300000,Date.now(),job.id,job.status,fence,Date.now()).run();
  }
  return {processed:!!job,reason:'domain_pending_reconciliation'};
 }finally{await db().prepare("UPDATE domain_control SET lease_id=NULL,lease_until=0 WHERE id='worker' AND lease_id=?").bind(fence).run();}
}
