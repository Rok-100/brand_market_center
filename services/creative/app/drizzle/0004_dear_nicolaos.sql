CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`draft_id` text DEFAULT '' NOT NULL,
	`type` text DEFAULT 'workflow' NOT NULL,
	`title` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`is_read` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`user_id`,`is_read`,`created_at`);--> statement-breakpoint
CREATE TABLE `review_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`action` text NOT NULL,
	`stage` text NOT NULL,
	`actor_id` text DEFAULT '' NOT NULL,
	`actor_name` text DEFAULT '' NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `review_actions_draft_idx` ON `review_actions` (`draft_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `script_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`version` integer NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`editor_id` text DEFAULT '' NOT NULL,
	`editor_name` text DEFAULT '' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `script_versions_draft_idx` ON `script_versions` (`draft_id`,`version`);--> statement-breakpoint
CREATE TABLE `workspace_users` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_no` text NOT NULL,
	`external_user_id` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`name` text NOT NULL,
	`department` text DEFAULT '' NOT NULL,
	`center` text DEFAULT '' NOT NULL,
	`job_title` text DEFAULT '' NOT NULL,
	`feishu_user_id` text DEFAULT '' NOT NULL,
	`role` text DEFAULT 'contributor' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_users_employee_no_unique` ON `workspace_users` (`employee_no`);--> statement-breakpoint
ALTER TABLE `creative_drafts` ADD `creator_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `creative_drafts` ADD `creator_name` text DEFAULT '历史用户' NOT NULL;--> statement-breakpoint
ALTER TABLE `creative_drafts` ADD `uploader_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `creative_drafts` ADD `uploader_name` text DEFAULT '历史导入' NOT NULL;--> statement-breakpoint
ALTER TABLE `creative_drafts` ADD `author_type` text DEFAULT '内部同事' NOT NULL;--> statement-breakpoint
ALTER TABLE `creative_drafts` ADD `author_name` text DEFAULT '待补充' NOT NULL;--> statement-breakpoint
ALTER TABLE `creative_drafts` ADD `author_user_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `creative_drafts` ADD `team_lead_reviewer_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `creative_drafts` ADD `team_lead_reviewer_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `creative_drafts` ADD `supervisor_reviewer_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `creative_drafts` ADD `supervisor_reviewer_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `creative_drafts` ADD `current_reviewer_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `creative_drafts` ADD `priority` text DEFAULT '普通' NOT NULL;--> statement-breakpoint
ALTER TABLE `creative_drafts` ADD `due_date` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `creative_drafts` ADD `resume_stage` text DEFAULT 'pending_team_lead' NOT NULL;--> statement-breakpoint
ALTER TABLE `creative_scripts` ADD `author_type` text DEFAULT '历史素材' NOT NULL;--> statement-breakpoint
ALTER TABLE `creative_scripts` ADD `author_name` text DEFAULT '待补充' NOT NULL;--> statement-breakpoint
ALTER TABLE `creative_scripts` ADD `author_user_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `creative_scripts` ADD `uploader_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `creative_scripts` ADD `uploader_name` text DEFAULT '历史导入' NOT NULL;--> statement-breakpoint
ALTER TABLE `creative_scripts` ADD `final_reviewer_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `creative_scripts` ADD `final_reviewer_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `creative_scripts` ADD `archived_from_draft_id` text DEFAULT '' NOT NULL;