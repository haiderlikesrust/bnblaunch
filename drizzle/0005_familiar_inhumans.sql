CREATE TABLE `agent_wallets` (
	`coin_id` text PRIMARY KEY NOT NULL,
	`address` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`coin_id`) REFERENCES `coins`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_wallet_address_unique` ON `agent_wallets` (`address`);--> statement-breakpoint
CREATE TABLE `launch_authorizations` (
	`id` text PRIMARY KEY NOT NULL,
	`coin_id` text NOT NULL,
	`creator` text NOT NULL,
	`treasury` text NOT NULL,
	`message` text NOT NULL,
	`config_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`coin_id`) REFERENCES `coins`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `launch_auth_coin_idx` ON `launch_authorizations` (`coin_id`);--> statement-breakpoint
CREATE TABLE `runtime_health` (
	`id` text PRIMARY KEY NOT NULL,
	`checked_at` integer NOT NULL,
	`capabilities` text NOT NULL,
	`version` text NOT NULL
);
