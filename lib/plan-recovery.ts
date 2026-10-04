import { db } from './server';
import { providerHoldStatement } from './provider-holds';

export const PLANNING_LEASE_MS=480000;
export async function recoverInterruptedPlans(lease:{coinId:string;id:string}){
 const now=Date.now(),finished=new Date(now).toISOString();
 const fence={sql:'EXISTS(SELECT 1 FROM runtime_leases WHERE coin_id=? AND lease_id=? AND lease_until>?)',values:[lease.coinId,lease.id,now]};
 // Only a newly acquired lease may recover older attempts. A recent request
 // or a plan with approved memory must never be reclassified as interrupted.
 const rows=await db().prepare(`SELECT id,reserved_microusd FROM agent_runs WHERE coin_id=? AND kind='plan' AND status='reserved' AND created_at<=?
  AND NOT EXISTS(SELECT 1 FROM agent_memories WHERE agent_memories.id=agent_runs.id)
  AND ${fence.sql} ORDER BY created_at LIMIT 10`).bind(lease.coinId,new Date(now-PLANNING_LEASE_MS).toISOString(),...fence.values).all<{id:string;reserved_microusd:number}>();
 let recovered=0;
 for(const run of rows.results){
  if(!Number.isSafeInteger(run.reserved_microusd)||run.reserved_microusd<=0)continue;
  const result=await db().batch([
   providerHoldStatement(run.id,lease.coinId,run.reserved_microusd,fence),
   db().prepare(`UPDATE agent_runs SET status='settled',cost_microusd=0,output=?,finished_at=? WHERE id=? AND coin_id=? AND status='reserved'
    AND EXISTS(SELECT 1 FROM agent_runs h WHERE h.id=? AND h.coin_id=? AND h.kind='provider_hold' AND h.status='reserved' AND h.reserved_microusd=?) AND ${fence.sql}`)
    .bind(JSON.stringify({rejection:{code:'interrupted'}}),finished,run.id,lease.coinId,run.id+':unverified',lease.coinId,run.reserved_microusd,...fence.values),
   db().prepare(`INSERT INTO events(id,coin_id,owner,name,message,created_at) SELECT ?,id,owner,json_extract(config,'$.name'),?,? FROM coins WHERE id=?
    AND EXISTS(SELECT 1 FROM agent_runs WHERE id=? AND status='settled' AND finished_at=?) AND ${fence.sql} ON CONFLICT(id) DO NOTHING`)
    .bind(run.id+':recovered','Recovered an interrupted planning attempt. Its unverified cost remains reserved separately; other work can continue.',finished,lease.coinId,run.id,finished,...fence.values),
   db().prepare(`UPDATE runtime_leases SET next_plan_at=0 WHERE coin_id=? AND lease_id=? AND lease_until>?
    AND EXISTS(SELECT 1 FROM agent_runs WHERE id=? AND status='settled' AND finished_at=?)`).bind(...fence.values,run.id,finished),
  ]);
  recovered+=Number(result[1].meta.changes);
 }
 // No balance update: the full original reservation remains held. Without a
 // receipt, a restart cannot prove which provider calls completed or their cost.
 return recovered;
}
