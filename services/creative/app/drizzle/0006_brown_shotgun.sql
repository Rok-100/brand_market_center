ALTER TABLE `creative_artist_projects` ADD `project_period` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `creative_artist_projects` ADD `owner_id` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `creative_artist_projects` ADD `creator_id` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `creative_artist_projects` ADD `creator_name` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `creative_artist_projects` ADD `actual_fee` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `creative_artist_projects` ADD `rights_scope` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `creative_artist_projects` ADD `rights_start_date` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `creative_artist_projects` ADD `rights_end_date` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `creative_artist_projects` ADD `rights_file_url` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `creative_artist_projects` ADD `value_judgement` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `creative_artist_projects` ADD `decision` text DEFAULT '推进' NOT NULL;
--> statement-breakpoint
ALTER TABLE `creative_artist_projects` ADD `decision_by` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `creative_artist_projects` ADD `decision_at` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `creative_artist_projects` ADD `shoot_date` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `creative_artist_projects` ADD `final_date` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `creative_artist_projects` ADD `launch_date` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `creative_artist_projects` ADD `first_creation_plan` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE INDEX `creative_artist_projects_artist_idx` ON `creative_artist_projects` (`artist_name`,`project_period`);
