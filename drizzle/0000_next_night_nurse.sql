CREATE TABLE `coins` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`config` text NOT NULL,
	`token_address` text,
	`treasury_address` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`ai_credit_microusd` integer DEFAULT 0 NOT NULL,
	`daily_limit_microusd` integer DEFAULT 100000 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `coins_owner_idx` ON `coins` (`owner`);--> statement-breakpoint
CREATE UNIQUE INDEX `coins_token_unique` ON `coins` (`token_address`);--> statement-breakpoint
CREATE UNIQUE INDEX `coins_treasury_unique` ON `coins` (`treasury_address`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`coin_id` text NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`message` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`coin_id`) REFERENCES `coins`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `events_owner_time_idx` ON `events` (`owner`,`created_at`);--> statement-breakpoint
CREATE TABLE `launch_plans` (
	`coin_id` text PRIMARY KEY NOT NULL,
	`creator` text NOT NULL,
	`treasury` text NOT NULL,
	`calldata` text NOT NULL,
	`predicted_address` text NOT NULL,
	`cid` text NOT NULL,
	`created_at` text NOT NULL,
	`tx_hash` text,
	FOREIGN KEY (`coin_id`) REFERENCES `coins`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`coin_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`reserved_microusd` integer NOT NULL,
	`cost_microusd` integer,
	`output` text,
	`created_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`coin_id`) REFERENCES `coins`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `runs_coin_time_idx` ON `agent_runs` (`coin_id`,`created_at`);