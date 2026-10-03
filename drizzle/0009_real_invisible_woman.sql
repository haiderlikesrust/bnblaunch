CREATE TABLE `coin_images` (
	`coin_id` text PRIMARY KEY NOT NULL,
	`mime` text NOT NULL,
	`base64` text NOT NULL,
	FOREIGN KEY (`coin_id`) REFERENCES `coins`(`id`) ON UPDATE no action ON DELETE no action
);
