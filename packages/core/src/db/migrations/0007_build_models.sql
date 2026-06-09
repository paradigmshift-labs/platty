CREATE TABLE `models` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`name` text NOT NULL,
	`table_name` text NOT NULL,
	`comment` text,
	`description` text,
	`fields` text NOT NULL,
	`relations` text NOT NULL,
	`is_deprecated` integer DEFAULT false NOT NULL,
	`source_file` text,
	`line_start` integer,
	`line_end` integer,
	`orm` text NOT NULL,
	`built_from_commit` text,
	`validity` text DEFAULT 'fresh' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_models_repo_name` ON `models` (`repository_id`,`name`);