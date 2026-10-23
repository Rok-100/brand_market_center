CREATE TABLE `creative_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`product` text NOT NULL,
	`script_type` text NOT NULL,
	`template_id` text DEFAULT '' NOT NULL,
	`template_title` text DEFAULT '' NOT NULL,
	`requirements` text DEFAULT '' NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'generated' NOT NULL,
	`feedback` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `creative_drafts_status_idx` ON `creative_drafts` (`status`);