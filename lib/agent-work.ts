import { db } from './server';
import type { TaskUpdate } from './agent-work-policy';

export type AgentTask={id:string;goal:string;nextStep:string;status:'active'|'blocked'|'complete'|'abandoned';evidence:TaskUpdate['evidence'];createdAt:number;updatedAt:number};
export async function agentTasks(coinId:string):Promise<AgentTask[]>{
  const rows=await db().prepare("SELECT * FROM agent_tasks WHERE coin_id=? ORDER BY CASE WHEN status IN ('active','blocked') THEN 0 ELSE 1 END,updated_at DESC,id DESC LIMIT 6").bind(coinId).all<{id:string;goal:string;next_step:string;status:AgentTask['status'];evidence:string|null;created_at:number;updated_at:number}>();
  return rows.results.map(r=>({id:r.id,goal:r.goal,nextStep:r.next_step,status:r.status,evidence:r.evidence?JSON.parse(r.evidence):null,createdAt:r.created_at,updatedAt:r.updated_at}));
}
export async function validateTask(coinId:string,task:TaskUpdate){
  const old=task.id?await db().prepare('SELECT status,created_at FROM agent_tasks WHERE id=? AND coin_id=?').bind(task.id,coinId).first<{status:string;created_at:number}>():null;
  if(task.id&&!old)throw Error('Task does not belong to this coin');
  if(old&&!['active','blocked'].includes(old.status))throw Error('Closed tasks cannot be rewritten');
  if(!old&&task.status!=='active')throw Error('A new task must start active');
  if(!old){const count=await db().prepare("SELECT COUNT(*) AS n FROM agent_tasks WHERE coin_id=? AND status IN ('active','blocked')").bind(coinId).first<{n:number}>();if(Number(count?.n??0)>=3)throw Error('Active task limit reached');}
  if(task.status==='complete'){
    if(!task.evidence)throw Error('Task completion requires a receipt');
    const queries={treasury:"SELECT id FROM agent_operations WHERE coin_id=? AND id=? AND status='confirmed' AND created_at>=?",research:"SELECT id FROM research_runs WHERE coin_id=? AND id=? AND status='complete' AND started_at>=?",browser:"SELECT id FROM browser_sessions WHERE coin_id=? AND id=? AND status='complete' AND started_at>=?",publication:"SELECT id FROM content_jobs WHERE coin_id=? AND id=? AND status='complete' AND created_at>=?",website:'SELECT id FROM site_revisions WHERE coin_id=? AND id=? AND published_at>=?'};
    if(!await db().prepare(queries[task.evidence.kind]).bind(coinId,task.evidence.id,old!.created_at).first())throw Error('Task completion receipt is not confirmed for this task');
  }else if(task.evidence)throw Error('Only completed tasks carry completion evidence');
}
export function taskStatement(lease:{coinId:string;id:string},runId:string,task:TaskUpdate,now:number){
  const fence="EXISTS(SELECT 1 FROM runtime_leases l JOIN coins c ON c.id=l.coin_id WHERE l.coin_id=? AND l.lease_id=? AND l.lease_until>? AND json_extract(c.config,'$.lastPlanRunId')=?)";
  const evidence=task.evidence?JSON.stringify(task.evidence):null;
  if(task.id)return db().prepare(`UPDATE agent_tasks SET goal=?,next_step=?,status=?,evidence=?,updated_at=? WHERE id=? AND coin_id=? AND status IN ('active','blocked') AND ${fence}`).bind(task.goal,task.nextStep,task.status,evidence,now,task.id,lease.coinId,lease.coinId,lease.id,now,runId);
  return db().prepare(`INSERT INTO agent_tasks(id,coin_id,goal,next_step,status,evidence,created_at,updated_at) SELECT ?,?,?,?,'active',NULL,?,? WHERE ${fence} AND (SELECT COUNT(*) FROM agent_tasks WHERE coin_id=? AND status IN ('active','blocked'))<3 ON CONFLICT(id) DO NOTHING`).bind(runId,lease.coinId,task.goal,task.nextStep,now,now,lease.coinId,lease.id,now,runId,lease.coinId);
}

// A finished publication can wake an approved plan early, once its result is
// new to the planner. Failed/rejected plans retain their independent backoff.
export async function hasNewWorkResult(coinId:string,lastPlanId:unknown,observedAt:unknown){
  if(typeof lastPlanId!=='string'||typeof observedAt!=='number')return false;
  const latest=await db().prepare("SELECT id,status,finished_at FROM agent_runs WHERE coin_id=? AND kind='plan' ORDER BY created_at DESC,id DESC LIMIT 1").bind(coinId).first<{id:string;status:string;finished_at:string|null}>();
  if(!latest||latest.id!==lastPlanId||latest.status!=='settled'||!latest.finished_at||Date.now()-Date.parse(latest.finished_at)<60000)return false;
  if(await db().prepare("SELECT id FROM content_jobs WHERE coin_id=? AND status IN ('complete','failed') AND updated_at>? LIMIT 1").bind(coinId,observedAt).first())return true;
  // Market moves wake planning at most once per ten minutes: small alternating
  // trades on a thin curve must not force a paid cycle every worker pass.
  if(Date.now()-Date.parse(latest.finished_at)<600000)return false;
  return !!await db().prepare("SELECT id FROM agent_signals WHERE coin_id=? AND observed_at>? LIMIT 1").bind(coinId,observedAt).first();
}
