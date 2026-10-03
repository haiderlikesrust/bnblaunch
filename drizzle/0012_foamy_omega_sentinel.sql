CREATE TABLE `site_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`coin_id` text NOT NULL,
	`revision` integer NOT NULL,
	`content` text NOT NULL,
	`published_at` integer NOT NULL,
	FOREIGN KEY (`coin_id`) REFERENCES `coins`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_revision_unique` ON `site_revisions` (`coin_id`,`revision`);--> statement-breakpoint
CREATE TABLE `treasury_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`coin_id` text NOT NULL,
	`processor` text NOT NULL,
	`block_number` text NOT NULL,
	`block_hash` text NOT NULL,
	`observed_at` integer NOT NULL,
	`balance_wei` text NOT NULL,
	`cumulative_fees_wei` text NOT NULL,
	`pending_fees_wei` text NOT NULL,
	FOREIGN KEY (`coin_id`) REFERENCES `coins`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `treasury_observation_block` ON `treasury_observations` (`coin_id`,`block_number`);--> statement-breakpoint
CREATE INDEX `treasury_observation_time` ON `treasury_observations` (`coin_id`,`observed_at`);