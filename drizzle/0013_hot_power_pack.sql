CREATE TABLE `domain_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`coin_id` text NOT NULL,
	`domain` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`cost_cents` integer DEFAULT 0 NOT NULL,
	`funding_cents` integer DEFAULT 0 NOT NULL,
	`credit_cents` integer DEFAULT 0 NOT NULL,
	`reserved_cents` integer DEFAULT 0 NOT NULL,
	`charged_cents` integer DEFAULT 0 NOT NULL,
	`funding_expires_at` integer,
	`checkout_id` text,
	`purchase_started_at` integer,
	`purchase_attempts` integer DEFAULT 0 NOT NULL,
	`provider_order` text,
	`route_attempted` integer DEFAULT 0 NOT NULL,
	`deploy_attempted` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`coin_id`) REFERENCES `coins`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `domain_order_due` ON `domain_orders` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `domain_order_coin` ON `domain_orders` (`coin_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `domain_checkout_unique` ON `domain_orders` (`checkout_id`);
--> statement-breakpoint
CREATE TABLE `coin_domains` (
	`coin_id` text PRIMARY KEY NOT NULL,
	`domain` text NOT NULL,
	`state` text NOT NULL,
	`verification_token` text NOT NULL,
	`expires_at` integer,
	`order_id` text NOT NULL,
	`last_error` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`coin_id`) REFERENCES `coins`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `domain_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coin_domain_unique` ON `coin_domains` (`domain`);--> statement-breakpoint
CREATE TABLE `domain_control` (
	`id` text PRIMARY KEY NOT NULL,
	`lease_id` text,
	`lease_until` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
