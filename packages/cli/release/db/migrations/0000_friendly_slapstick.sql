CREATE TABLE `epics` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`abbr` text,
	`description` text,
	`confirmed_at` text,
	`deleted_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_epics_project_name_alive` ON `epics` (`project_id`,`name`) WHERE "epics"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`deleted_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`repo_path` text NOT NULL,
	`type` text,
	`language` text,
	`language_raw` text,
	`framework` text,
	`framework_raw` text,
	`schema_sources` text,
	`api_base_paths` text,
	`routing_files` text,
	`entrypoint_files` text,
	`integrations` text,
	`path_aliases` text,
	`base_url` text,
	`validation_warnings` text,
	`last_synced_commit` text,
	`deleted_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `repository_phase_status` (
	`repository_id` text NOT NULL,
	`phase` text NOT NULL,
	`built_at` text,
	`built_from_commit` text,
	`validity` text DEFAULT 'fresh' NOT NULL,
	`confirmed_at` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`repository_id`, `phase`),
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pipeline_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`step_id` integer,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`data` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`step_id`) REFERENCES `pipeline_steps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_pipeline_events_run` ON `pipeline_events` (`run_id`,`id`);--> statement-breakpoint
CREATE TABLE `pipeline_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`repo_id` text,
	`kind` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`triggered_by` text,
	`total_steps` integer,
	`completed_steps` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`meta` text,
	`started_at` text DEFAULT (datetime('now')) NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_pipeline_runs_project` ON `pipeline_runs` (`project_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_pipeline_runs_repo` ON `pipeline_runs` (`repo_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_pipeline_runs_status` ON `pipeline_runs` (`status`);--> statement-breakpoint
CREATE TABLE `pipeline_steps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`phase` text NOT NULL,
	`step` text NOT NULL,
	`label` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`duration_ms` integer,
	`llm_provider` text,
	`model` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`cache_creation_tokens` integer,
	`cache_read_tokens` integer,
	`cost_usd` real,
	`error_message` text,
	`error_stack` text,
	`log_file` text,
	`meta` text,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_pipeline_steps_run` ON `pipeline_steps` (`run_id`,`id`);