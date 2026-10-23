CREATE TABLE `creative_scripts` (
	`id` text PRIMARY KEY NOT NULL,
	`script_type` text NOT NULL,
	`product` text NOT NULL,
	`title` text NOT NULL,
	`copy` text NOT NULL,
	`status` text DEFAULT '待验证' NOT NULL,
	`source` text DEFAULT '文字导入' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `creative_scripts_type_idx` ON `creative_scripts` (`script_type`);--> statement-breakpoint
CREATE INDEX `creative_scripts_product_idx` ON `creative_scripts` (`product`);--> statement-breakpoint
CREATE TABLE `creative_videos` (
	`id` text PRIMARY KEY NOT NULL,
	`script_id` text NOT NULL,
	`title` text NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`duration` text DEFAULT '--:--' NOT NULL,
	`cover_tone` text DEFAULT 'forest' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`script_id`) REFERENCES `creative_scripts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `creative_videos_script_idx` ON `creative_videos` (`script_id`);