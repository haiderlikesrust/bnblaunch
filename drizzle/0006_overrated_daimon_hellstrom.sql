CREATE TABLE `agent_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`coin_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount_wei` text NOT NULL,
	`status` text NOT NULL,
	`tx_hash` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`reason` text NOT NULL,
	FOREIGN KEY (`coin_id`) REFERENCES `coins`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `operations_status_idx` ON `agent_operations` (`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `operation_tx_unique` ON `agent_operations` (`tx_hash`);--> statement-breakpoint
CREATE TABLE `runtime_leases` (
	`coin_id` text PRIMARY KEY NOT NULL,
	`lease_id` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`next_run_at` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`coin_id`) REFERENCES `coins`(`id`) ON UPDATE no action ON DELETE no action
);
