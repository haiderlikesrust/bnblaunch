-- Release the old rejection cooldown once on deployment. Do not replay any
-- unsettled provider request or override a successfully approved plan's timing.
UPDATE runtime_leases SET next_run_at=0,next_plan_at=0
WHERE lease_until<unixepoch()*1000
AND NOT EXISTS(SELECT 1 FROM agent_runs WHERE agent_runs.coin_id=runtime_leases.coin_id AND status='reserved')
AND EXISTS(
 SELECT 1 FROM agent_runs AS latest
 WHERE latest.coin_id=runtime_leases.coin_id AND latest.kind='plan' AND latest.status='settled'
 AND latest.id=(SELECT id FROM agent_runs WHERE coin_id=runtime_leases.coin_id AND kind='plan' ORDER BY created_at DESC,id DESC LIMIT 1)
 AND NOT EXISTS(SELECT 1 FROM agent_memories WHERE agent_memories.id=latest.id AND agent_memories.coin_id=latest.coin_id)
)
AND (SELECT COUNT(*) FROM agent_runs WHERE coin_id=runtime_leases.coin_id AND kind='plan' AND status='settled'
 AND NOT EXISTS(SELECT 1 FROM agent_memories WHERE agent_memories.id=agent_runs.id AND agent_memories.coin_id=agent_runs.coin_id))<3;
