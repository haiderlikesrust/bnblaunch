ALTER TABLE `launch_authorizations` ADD `tweet_url` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `prepared_launches` ADD `tweet_url` text DEFAULT '' NOT NULL;