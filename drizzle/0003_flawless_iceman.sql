CREATE TABLE `agent_chat_control` (
	`coin_id` text PRIMARY KEY NOT NULL,
	`closed_until` integer NOT NULL,
	FOREIGN KEY (`coin_id`) REFERENCES `coins`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `compute_funding` (
	`settlement_id` text PRIMARY KEY NOT NULL,
	`coin_id` text NOT NULL,
	`amount_microusd` integer NOT NULL,
	`settled_at` integer NOT NULL,
	FOREIGN KEY (`coin_id`) REFERENCES `coins`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `funding_coin_time_idx` ON `compute_funding` (`coin_id`,`settled_at`);