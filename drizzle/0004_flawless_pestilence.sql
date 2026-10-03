CREATE TABLE `market_cache` (
	`token_address` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `provider_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`next_at` integer NOT NULL
);
