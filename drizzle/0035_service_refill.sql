-- A confirmed deposit awaiting ledger allocation must never cause another
-- deposit for the same agent, including after process restarts.
CREATE UNIQUE INDEX `one_pending_compute_payment` ON `agent_operations` (`coin_id`)
WHERE kind='compute' AND status IN ('queued','signed','broadcast','awaiting_credit');
