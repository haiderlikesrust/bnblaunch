CREATE TABLE `wallet_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet` text NOT NULL,
	`message` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `wallet_challenge_expiry_idx` ON `wallet_challenges` (`expires_at`);--> statement-breakpoint
CREATE INDEX `wallet_challenge_wallet_idx` ON `wallet_challenges` (`wallet`);--> statement-breakpoint
CREATE TABLE `wallet_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `wallet_session_expiry_idx` ON `wallet_sessions` (`expires_at`);