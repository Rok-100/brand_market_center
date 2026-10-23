CREATE TABLE `creative_artist_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`artist_name` text NOT NULL,
	`product` text NOT NULL,
	`project_type` text DEFAULT '实拍艺人' NOT NULL,
	`phase` text DEFAULT '筹备中' NOT NULL,
	`owner` text DEFAULT '待分配' NOT NULL,
	`next_milestone` text DEFAULT '' NOT NULL,
	`eta` text DEFAULT '' NOT NULL,
	`risk` text DEFAULT '' NOT NULL,
	`script_summary` text DEFAULT '' NOT NULL,
	`production_summary` text DEFAULT '' NOT NULL,
	`launch_summary` text DEFAULT '' NOT NULL,
	`prep_summary` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `creative_work_events` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_name` text NOT NULL,
	`action` text NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `creative_work_events_item_idx` ON `creative_work_events` (`item_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `creative_work_items` (
	`id` text PRIMARY KEY NOT NULL,
	`review_section` text NOT NULL,
	`script_type` text DEFAULT '' NOT NULL,
	`cooperation_type` text DEFAULT '' NOT NULL,
	`material_name` text NOT NULL,
	`author_id` text DEFAULT '' NOT NULL,
	`author_name` text NOT NULL,
	`product` text DEFAULT '' NOT NULL,
	`feishu_url` text NOT NULL,
	`artist_name` text DEFAULT '' NOT NULL,
	`project_name` text DEFAULT '' NOT NULL,
	`priority` text DEFAULT '普通' NOT NULL,
	`due_date` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`submitter_id` text NOT NULL,
	`submitter_name` text NOT NULL,
	`status` text DEFAULT 'pending_review' NOT NULL,
	`current_step` integer DEFAULT 1 NOT NULL,
	`archived_at` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `creative_work_items_status_idx` ON `creative_work_items` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `creative_work_items_submitter_idx` ON `creative_work_items` (`submitter_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `creative_work_reviewers` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`reviewer_id` text NOT NULL,
	`reviewer_name` text NOT NULL,
	`reviewer_role` text NOT NULL,
	`step_order` integer NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`decided_at` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `creative_work_reviewers_item_idx` ON `creative_work_reviewers` (`item_id`,`step_order`);--> statement-breakpoint
CREATE INDEX `creative_work_reviewers_assignee_idx` ON `creative_work_reviewers` (`reviewer_id`,`status`);--> statement-breakpoint
CREATE TABLE `script_alternatives` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`request` text DEFAULT '' NOT NULL,
	`creator_id` text DEFAULT '' NOT NULL,
	`creator_name` text DEFAULT '' NOT NULL,
	`adopted` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `script_alternatives_draft_idx` ON `script_alternatives` (`draft_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `creative_drafts` ADD `talent_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `creative_drafts` ADD `video_links` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `creative_scripts` ADD `talent_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace_users` ADD `login_registered` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace_users` ADD `preloaded` integer DEFAULT false NOT NULL;