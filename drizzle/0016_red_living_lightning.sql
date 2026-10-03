CREATE TABLE `curve_cursors` (
	`coin_id` text PRIMARY KEY NOT NULL,
	`token_address` text NOT NULL,
	`launch_hash` text NOT NULL,
	`next_block` integer NOT NULL,
	`start_block` integer NOT NULL,
	`last_hash` text,
	`lease_id` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`checked_at` integer DEFAULT 0 NOT NULL,
	`migrated` integer DEFAULT 0 NOT NULL,
	`caught_up` integer DEFAULT 0 NOT NULL,
	`range_size` integer DEFAULT 2000 NOT NULL,
	FOREIGN KEY (`coin_id`) REFERENCES `coins`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `curve_token_unique` ON `curve_cursors` (`token_address`);--> statement-breakpoint
CREATE TABLE `curve_trades` (
	`id` text PRIMARY KEY NOT NULL,
	`coin_id` text NOT NULL,
	`block_number` integer NOT NULL,
	`block_hash` text NOT NULL,
	`time` integer NOT NULL,
	`log_index` integer NOT NULL,
	`token_wei` text NOT NULL,
	`quote_wei` text NOT NULL,
	`side` text NOT NULL,
	`tx_hash` text NOT NULL,
	FOREIGN KEY (`coin_id`) REFERENCES `coins`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `curve_trade_time` ON `curve_trades` (`coin_id`,`time`);--> statement-breakpoint
CREATE INDEX `curve_trade_block` ON `curve_trades` (`coin_id`,`block_number`);