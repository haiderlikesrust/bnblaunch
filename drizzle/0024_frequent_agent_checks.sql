ALTER TABLE `runtime_leases` ADD `next_plan_at` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Preserve existing paid-planning delays while bringing wallet checks forward.
UPDATE runtime_leases SET next_plan_at=next_run_at WHERE EXISTS (SELECT 1 FROM agent_runs WHERE agent_runs.coin_id=runtime_leases.coin_id AND kind='plan');
--> statement-breakpoint
UPDATE runtime_leases SET next_run_at=0;
