CREATE TABLE `content_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`coin_id` text NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`quote` text,
	`user_id` text,
	`media_id` text,
	`tweet_id` text,
	`reserved_microusd` integer DEFAULT 0 NOT NULL,
	`cost_microusd` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`posting_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`coin_id`) REFERENCES `coins`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `content_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`coin_id` text NOT NULL,
	`mime` text NOT NULL,
	`base64` text NOT NULL,
	`model` text NOT NULL,
	`alt_text` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`id`) REFERENCES `content_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`coin_id`) REFERENCES `coins`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `content_jobs_status_idx` ON `content_jobs` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `content_jobs_coin_idx` ON `content_jobs` (`coin_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `x_accounts` (
	`coin_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`username` text NOT NULL,
	`encrypted_session` text NOT NULL,
	`version` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`coin_id`) REFERENCES `coins`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `x_account_user_unique` ON `x_accounts` (`user_id`);--> statement-breakpoint
CREATE TABLE `x_logins` (
	`id` text PRIMARY KEY NOT NULL,
	`coin_id` text NOT NULL,
	`owner` text NOT NULL,
	`user_id` text,
	`username` text NOT NULL,
	`encrypted_session` text,
	`proof` text NOT NULL,
	`tweet_id` text,
	`status` text NOT NULL,
	`cost_microusd` integer NOT NULL,
	`checks` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`coin_id`) REFERENCES `coins`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `x_login_owner_idx` ON `x_logins` (`owner`,`created_at`);