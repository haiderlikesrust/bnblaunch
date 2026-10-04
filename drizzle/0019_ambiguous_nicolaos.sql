CREATE TABLE `x_oauth_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`coin_id` text NOT NULL,
	`owner` text NOT NULL,
	`encrypted_verifier` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`coin_id`) REFERENCES `coins`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `x_oauth_owner_time` ON `x_oauth_attempts` (`owner`,`created_at`);--> statement-breakpoint
ALTER TABLE `content_jobs` ADD `x_provider` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `content_jobs` ADD `billing` text;--> statement-breakpoint
ALTER TABLE `x_accounts` ADD `auth_type` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `x_accounts` ADD `reconnect_required` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `x_accounts` ADD `refresh_status` text DEFAULT 'idle' NOT NULL;