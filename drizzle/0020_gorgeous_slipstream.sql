CREATE TABLE `agent_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`coin_id` text NOT NULL,
	`summary` text NOT NULL,
	`next_steps` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`coin_id`) REFERENCES `coins`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agent_memory_time` ON `agent_memories` (`coin_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `model_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`coin_id` text NOT NULL,
	`run_id` text NOT NULL,
	`kind` text NOT NULL,
	`model` text NOT NULL,
	`generation_id` text,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`reasoning_tokens` integer,
	`cached_tokens` integer,
	`cost_microusd` integer,
	`quoted_prompt` text NOT NULL,
	`quoted_completion` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`coin_id`) REFERENCES `coins`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `model_usage_coin_time` ON `model_usage` (`coin_id`,`created_at`);