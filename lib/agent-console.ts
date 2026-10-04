import { db } from './server';
import type { Coin } from './model';
export async function agentConsole(coin: Coin) {
  const now = Date.now();
  const [research, run, content, operation, domain, lease, health, events, memory] = await Promise.all([
    db().prepare('SELECT status,started_at,finished_at FROM research_runs WHERE coin_id=? ORDER BY started_at DESC LIMIT 1').bind(coin.id).first<{ status: string; started_at: number; finished_at: number | null }>(),
    db().prepare("SELECT status,created_at FROM agent_runs WHERE coin_id=? AND kind='plan' ORDER BY created_at DESC LIMIT 1").bind(coin.id).first<{ status: string; created_at: string }>(),
    db().prepare("SELECT status,updated_at FROM content_jobs WHERE coin_id=? AND status NOT IN ('complete','failed') ORDER BY created_at DESC LIMIT 1").bind(coin.id).first<{ status: string; updated_at: number }>(),
    db().prepare("SELECT kind,status,created_at FROM agent_operations WHERE coin_id=? AND status IN ('queued','signed','broadcast') ORDER BY created_at DESC LIMIT 1").bind(coin.id).first<{ kind: string; status: string; created_at: number }>(),
    db().prepare("SELECT status,updated_at FROM domain_orders WHERE coin_id=? AND status NOT IN ('live','complete','failed') ORDER BY created_at DESC LIMIT 1").bind(coin.id).first<{ status: string; updated_at: number }>(),
    db().prepare('SELECT lease_until,next_run_at FROM runtime_leases WHERE coin_id=?').bind(coin.id).first<{ lease_until: number; next_run_at: number }>(),
    db().prepare('SELECT checked_at FROM runtime_health ORDER BY checked_at DESC LIMIT 1').first<{ checked_at: number }>(),
    db().prepare('SELECT id,message,created_at FROM events WHERE coin_id=? ORDER BY created_at DESC LIMIT 8').bind(coin.id).all<{ id: string; message: string; created_at: string }>(),
    db().prepare('SELECT COUNT(*) AS entries,MAX(created_at) AS updated FROM agent_memories WHERE coin_id=?').bind(coin.id).first<{ entries: number; updated: number | null }>(),
  ]);
  let state = 'scheduled', changedAt: number | null = null;
  const stale = !health || now - health.checked_at > 180000;
  if (!coin.tokenAddress) state = 'awaiting_launch';
  else if (stale) state = 'worker_unconfirmed';
  else if (research?.status === 'searching' && now - research.started_at < 120000) { state = 'researching'; changedAt = research.started_at; }
  else if (operation) { state = operation.kind === 'compute' ? 'funding_services' : 'transaction_pending'; changedAt = operation.created_at; }
  else if (content) { state = ['uncertain', 'reconciling'].includes(content.status) ? 'verification_pending' : content.status === 'posting' ? 'posting' : content.status === 'generating' ? 'creating_image' : 'publication_queued'; changedAt = content.updated_at; }
  else if (domain) { state = 'domain_pending'; changedAt = domain.updated_at; }
  else if (run?.status === 'reserved') { state = lease && lease.lease_until > now ? 'planning' : 'verification_pending'; changedAt = Date.parse(run.created_at); }
  else if (coin.balance < coin.threshold) state = 'awaiting_funds';
  else if (lease && lease.lease_until > now) state = 'checking';
  return { state, changedAt, observedAt: now, workerSeenAt: health?.checked_at ?? null, nextCheckAt: lease?.next_run_at && lease.next_run_at > now ? lease.next_run_at : null,
    memory: { entries: Number(memory?.entries ?? 0), updatedAt: memory?.updated ?? null }, events: events.results.map(e => ({ id: e.id, message: e.message, createdAt: e.created_at })) };
}
