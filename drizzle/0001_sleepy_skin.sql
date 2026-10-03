CREATE TABLE `prepared_launches` (
	`id` text PRIMARY KEY NOT NULL,
	`coin_id` text NOT NULL,
	`creator` text NOT NULL,
	`treasury` text NOT NULL,
	`calldata` text NOT NULL,
	`predicted_address` text NOT NULL,
	`cid` text NOT NULL,
	`created_at` text NOT NULL,
	`tx_hash` text,
	FOREIGN KEY (`coin_id`) REFERENCES `coins`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `prepared_launches_coin_idx` ON `prepared_launches` (`coin_id`);