import { db } from './server';
export async function agentMemory(coinId: string) {
  const rows = await db().prepare('SELECT summary,next_steps,created_at FROM agent_memories WHERE coin_id=? ORDER BY created_at DESC,id DESC LIMIT 8')
    .bind(coinId).all<{ summary: string; next_steps: string; created_at: number }>();
  return { kind: 'Previous approved plans, not proof of execution. Verify outcomes against receipts.', entries: rows.results.map(r => ({ summary: r.summary, nextSteps: r.next_steps, recordedAt: r.created_at })) };
}
export function memoryStatement(lease: { coinId: string; id: string }, runId: string, summary: string, nextSteps: string, now: number) {
  return db().prepare("INSERT INTO agent_memories(id,coin_id,summary,next_steps,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM runtime_leases WHERE coin_id=? AND lease_id=? AND lease_until>?) ON CONFLICT(id) DO NOTHING")
    .bind(runId, lease.coinId, summary, nextSteps, now, lease.coinId, lease.id, now);
}
