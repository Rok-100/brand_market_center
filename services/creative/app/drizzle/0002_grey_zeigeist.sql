CREATE TABLE `competitor_scripts` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`brand` text DEFAULT '待补充' NOT NULL,
	`product` text DEFAULT '待补充' NOT NULL,
	`copy` text NOT NULL,
	`source` text DEFAULT '批量导入' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `competitor_scripts_created_idx` ON `competitor_scripts` (`created_at`);