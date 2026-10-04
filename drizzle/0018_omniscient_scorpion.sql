CREATE TABLE `research_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`coin_id` text NOT NULL,
	`query` text NOT NULL,
	`status` text NOT NULL,
	`sources` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`coin_id`) REFERENCES `coins`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `research_coin_time` ON `research_runs` (`coin_id`,`started_at`);