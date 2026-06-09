CREATE TABLE `generation_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `stage` text NOT NULL,
  `status` text NOT NULL,
  `output_language` text NOT NULL,
  `requested_by` text NOT NULL,
  `source_commit` text DEFAULT 'unknown' NOT NULL,
  `max_concurrent_tasks` integer DEFAULT 0 NOT NULL,
  `approved_by` text,
  `approved_at` text,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  `updated_at` text DEFAULT (datetime('now')) NOT NULL,
  `finished_at` text,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_generation_runs_project_stage_status` ON `generation_runs` (`project_id`,`stage`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_generation_runs_project_created` ON `generation_runs` (`project_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `generation_tasks` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `project_id` text NOT NULL,
  `repository_id` text NOT NULL,
  `document_type` text NOT NULL,
  `target_key` text NOT NULL,
  `target_document_id` text NOT NULL,
  `primary_entry_point_id` text NOT NULL,
  `target_json` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `lease_token` text,
  `leased_by` text,
  `lease_expires_at` text,
  `retry_count` integer DEFAULT 0 NOT NULL,
  `max_retries` integer DEFAULT 2 NOT NULL,
  `last_validation_errors` text,
  `submitted_document` text,
  `saved_document_id` text,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  `updated_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `generation_runs`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`saved_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_generation_tasks_run_target` ON `generation_tasks` (`run_id`,`target_key`);
--> statement-breakpoint
CREATE INDEX `idx_generation_tasks_run_status` ON `generation_tasks` (`run_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_generation_tasks_run_type_status` ON `generation_tasks` (`run_id`,`document_type`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_generation_tasks_repository` ON `generation_tasks` (`repository_id`);
--> statement-breakpoint
CREATE TABLE `generation_events` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `task_id` text,
  `event_type` text NOT NULL,
  `payload_json` text NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `generation_runs`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`task_id`) REFERENCES `generation_tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_generation_events_run_created` ON `generation_events` (`run_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_generation_events_task_created` ON `generation_events` (`task_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `generation_context_bundles` (
  `context_handle` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `task_id` text NOT NULL,
  `source_commit` text NOT NULL,
  `schema_version` text NOT NULL,
  `manifest_json` text NOT NULL,
  `content_hash` text NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `generation_runs`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`task_id`) REFERENCES `generation_tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_generation_context_bundles_task` ON `generation_context_bundles` (`task_id`);
--> statement-breakpoint
CREATE INDEX `idx_generation_context_bundles_run` ON `generation_context_bundles` (`run_id`);
--> statement-breakpoint
CREATE TABLE `generation_context_pages` (
  `context_handle` text NOT NULL,
  `page_id` text NOT NULL,
  `page_kind` text NOT NULL,
  `page_order` integer NOT NULL,
  `summary` text NOT NULL,
  `evidence_ids_json` text NOT NULL,
  `content_json` text NOT NULL,
  `content_hash` text NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  PRIMARY KEY(`context_handle`, `page_id`),
  FOREIGN KEY (`context_handle`) REFERENCES `generation_context_bundles`(`context_handle`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_generation_context_pages_handle_order` ON `generation_context_pages` (`context_handle`,`page_order`);
