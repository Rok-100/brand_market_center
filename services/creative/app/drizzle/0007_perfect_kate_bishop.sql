ALTER TABLE `creator_collaborations` ADD `material_type` text DEFAULT '付费KOC原片' NOT NULL;--> statement-breakpoint
ALTER TABLE `creator_collaborations` ADD `owner_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `creator_collaborations` ADD `shooting_date` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `creator_collaborations` ADD `launch_date` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `creator_collaborations` ADD `abnormal_stage` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `creator_collaborations` ADD `abnormal_note` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `creator_collaborations` ADD `asset_link` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `creator_collaborations_launch_idx` ON `creator_collaborations` (`launch_date`,`owner_id`);