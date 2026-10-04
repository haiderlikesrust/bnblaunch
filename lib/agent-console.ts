import { db } from './server';
import type { Coin } from './model';
import { signalHistory } from './agent-signals';
import { agentTasks } from './agent-work';
import { readPlanDiagnostic, publicPlanDiagnostic } from './plan-diagnostics';
export async function agentConsole(coin: Coin) {
  const now = Date.now();
  const [research, run, content, operation, domain, lease, health, events, memory, tasks, signals, moves, config] = await Promise.all([
    db().prepare('SELECT status,started_at,finished_at FROM research_runs WHERE coin_id=? ORDER BY started_at DESC LIMIT 1').bind(coin.id).first<{ status: string; started_at: number; finished_at: number | null }>(),
    db().prepare("SELECT status,created_at,finished_at,output,EXISTS(SELECT 1 FROM agent_memories WHERE agent_memories.id=agent_runs.id AND agent_memories.coin_id=agent_runs.coin_id) AS approved FROM agent_runs WHERE coin_id=? AND kind='plan' ORDER BY created_at DESC,id DESC LIMIT 1").bind(coin.id).first<{ status: string; created_at: string;finished_at:string|null;output:string|null;approved:boolean|number }>(),
    db().prepare("SELECT status,updated_at FROM content_jobs WHERE coin_id=? AND status NOT IN ('complete','failed') ORDER BY created_at DESC LIMIT 1").bind(coin.id).first<{ status: string; updated_at: number }>(),
    db().prepare("SELECT kind,status,created_at FROM agent_operations WHERE coin_id=? AND status IN ('queued','signed','broadcast') ORDER BY created_at DESC LIMIT 1").bind(coin.id).first<{ kind: string; status: string; created_at: number }>(),
    db().prepare("SELECT status,updated_at FROM domain_orders WHERE coin_id=? AND status NOT IN ('live','complete','failed') ORDER BY created_at DESC LIMIT 1").bind(coin.id).first<{ status: string; updated_at: number }>(),
    db().prepare('SELECT lease_until,next_run_at,next_plan_at,last_checked_at,last_reason FROM runtime_leases WHERE coin_id=?').bind(coin.id).first<{ lease_until: number; next_run_at: number;next_plan_at:number;last_checked_at:number|null;last_reason:string|null }>(),
    db().prepare("SELECT checked_at,capabilities FROM runtime_health WHERE id='worker'").first<{ checked_at: number;capabilities:string }>(),
    db().prepare('SELECT id,message,created_at FROM events WHERE coin_id=? ORDER BY created_at DESC LIMIT 8').bind(coin.id).all<{ id: string; message: string; created_at: string }>(),
    db().prepare('SELECT COUNT(*) AS entries,MAX(created_at) AS updated FROM agent_memories WHERE coin_id=?').bind(coin.id).first<{ entries: number; updated: number | null }>(),
    agentTasks(coin.id),signalHistory(coin.id),
    db().prepare("SELECT id,kind,status,amount_wei AS amountWei,tx_hash AS hash,reason,created_at AS createdAt FROM agent_operations WHERE coin_id=? AND kind!='compute' ORDER BY created_at DESC LIMIT 10").bind(coin.id).all(),
    db().prepare('SELECT config FROM coins WHERE id=?').bind(coin.id).first<{config:string}>(),
  ]);
  let state = 'scheduled', changedAt: number | null = null;
  const stale = !health || now - health.checked_at > 180000 && !(lease&&lease.lease_until>now);
  let capable=false;try{capable=JSON.parse(health?.capabilities??'[]').includes('autonomous-planning')}catch{}
  if (!coin.tokenAddress) state = 'awaiting_launch';
  else if (stale) state = 'worker_unconfirmed';
  else if (!capable) state = 'services_unavailable';
  else if (research?.status === 'searching' && now - research.started_at < 120000) { state = 'researching'; changedAt = research.started_at; }
  else if (operation) { state = operation.kind === 'compute' ? 'funding_services' : 'transaction_pending'; changedAt = operation.created_at; }
  else if (content) { state = ['uncertain', 'reconciling'].includes(content.status) ? 'verification_pending' : content.status === 'posting' ? 'posting' : content.status === 'generating' ? 'creating_image' : 'publication_queued'; changedAt = content.updated_at; }
  else if (domain) { state = 'domain_pending'; changedAt = domain.updated_at; }
  else if (run?.status === 'reserved') { state = lease && lease.lease_until > now ? 'planning' : 'verification_pending'; changedAt = Date.parse(run.created_at); }
  else if (lease && lease.lease_until > now) state = 'checking';
  else if (lease?.last_reason) {
    const states:Record<string,string>={planner_output_truncated:'planner_output_truncated',guard_output_truncated:'guard_output_truncated',model_pricing_unavailable:'model_pricing_unavailable',research_configuration_required:'research_configuration_required',social_billing_invalid:'social_billing_invalid',signer_policy_unavailable:'signer_policy_unavailable',funding_price_unavailable:'funding_price_unavailable',service_capacity_unavailable:'service_capacity_unavailable',planning_context_unavailable:'planning_context_unavailable',research_request_failed:'research_request_failed',planner_request_failed:'planner_request_failed',guard_request_failed:'guard_request_failed',plan_save_failed:'plan_save_failed',awaiting_treasury_funding:'awaiting_funds',historical_rpc_required:'historical_rpc_required',rpc_log_limit:'rpc_log_limit',fee_audit_pending:'fee_audit_pending',fee_verification_failed:'fee_verification_failed',wallet_check_failed:'wallet_check_failed',service_check_failed:'service_check_failed',awaiting_service_funding:'awaiting_service_credit',service_deposit_minimum_or_collateral_required:'service_funding_blocked',awaiting_next_plan:'scheduled',plan_completed:'scheduled',plan_rejected:'plan_rejected'};
    state=states[lease.last_reason]??'checking';changedAt=lease.last_checked_at;
  }
  else state='check_unconfirmed';
  if(state==='scheduled'&&run?.status==='settled'&&!run.approved)state='planning_retry_scheduled';
  const diagnostic=run?.status==='settled'&&!run.approved?readPlanDiagnostic(run.output):null;
  const lastPlan=run?{outcome:run.approved?'approved':run.status==='reserved'?'pending':'not_approved',startedAt:Date.parse(run.created_at),finishedAt:run.finished_at?Date.parse(run.finished_at):null,rejection:diagnostic?publicPlanDiagnostic(diagnostic):null}:null;
  return { state, changedAt, observedAt: now,lastCheckAt:lease?.last_checked_at??null, workerSeenAt: health?.checked_at ?? null, nextCheckAt: lease?.next_run_at && lease.next_run_at > now ? lease.next_run_at : null,nextPlanAt:lease?.next_plan_at&&lease.next_plan_at>now?lease.next_plan_at:null,lastPlan,
    tasks,signals,moves:moves.results,treasuryThesis:config?JSON.parse(config.config).treasuryThesis??null:null,memory: { entries: Number(memory?.entries ?? 0), updatedAt: memory?.updated ?? null }, events: events.results.map(e => ({ id: e.id, message: e.message, createdAt: e.created_at })) };
}
