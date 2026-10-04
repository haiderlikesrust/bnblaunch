import { db } from './server';

// A timeout is not a receipt. Retain only the unknown call's allowance while
// releasing unused budget and allowing unrelated work to use remaining credit.
export const isolatedProviderHold=`r.kind='provider_hold' AND EXISTS(SELECT 1 FROM agent_runs parent WHERE r.id=parent.id||':unverified' AND parent.coin_id=r.coin_id AND parent.status='settled' AND r.reserved_microusd<=parent.reserved_microusd-parent.cost_microusd)`;
export function providerHoldStatement(runId:string,coinId:string,amount:number,fence={sql:'1=1',values:[] as unknown[]}){
 return db().prepare(`INSERT INTO agent_runs(id,coin_id,kind,status,reserved_microusd,output,created_at) SELECT ?,?,'provider_hold','reserved',?,'Provider charge is unverified; credit remains reserved separately.',? WHERE EXISTS(SELECT 1 FROM agent_runs WHERE id=? AND coin_id=? AND status='reserved') AND ${fence.sql} ON CONFLICT(id) DO NOTHING`)
  .bind(runId+':unverified',coinId,amount,new Date().toISOString(),runId,coinId,...fence.values);
}
