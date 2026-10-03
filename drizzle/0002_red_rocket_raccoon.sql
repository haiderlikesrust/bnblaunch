CREATE TABLE `chat_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`coin_id` text NOT NULL,
	`viewer` text NOT NULL,
	`status` text NOT NULL,
	`reserved_microusd` integer NOT NULL,
	`cost_microusd` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`coin_id`) REFERENCES `coins`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `chat_runs_coin_time_idx` ON `chat_runs` (`coin_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `chat_runs_viewer_time_idx` ON `chat_runs` (`viewer`,`created_at`);--> statement-breakpoint
CREATE INDEX `chat_runs_time_idx` ON `chat_runs` (`created_at`);