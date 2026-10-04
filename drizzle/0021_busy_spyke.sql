ALTER TABLE `launch_authorizations` ADD `initial_buy_wei` text DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `prepared_launches` ADD `initial_buy_wei` text DEFAULT '0' NOT NULL;