CREATE TABLE `creator_collaborations` (
	`id` text PRIMARY KEY NOT NULL,
	`creator_name` text NOT NULL,
	`platform` text DEFAULT '抖音' NOT NULL,
	`product` text NOT NULL,
	`owner` text DEFAULT '待分配' NOT NULL,
	`stage` text DEFAULT '待建联' NOT NULL,
	`due_date` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `creator_collaborations_stage_idx` ON `creator_collaborations` (`stage`);--> statement-breakpoint
ALTER TABLE `competitor_scripts` ADD `script_type` text DEFAULT '自产脚本' NOT NULL;