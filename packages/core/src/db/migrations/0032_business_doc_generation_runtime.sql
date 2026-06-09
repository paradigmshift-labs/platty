CREATE TABLE `business_doc_generation_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `status` text NOT NULL,
  `policy_json` text NOT NULL,
  `preview_snapshot_json` text NOT NULL,
  `selected_epic_ids_json` text NOT NULL,
  `source_commit` text DEFAULT 'unknown' NOT NULL,
  `force_regenerate` integer DEFAULT 0 NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  `updated_at` text DEFAULT (datetime('now')) NOT NULL,
  `finished_at` text,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_business_doc_generation_runs_project_status_created` ON `business_doc_generation_runs` (`project_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_business_doc_generation_runs_project_created` ON `business_doc_generation_runs` (`project_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `business_doc_generation_tasks` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `project_id` text NOT NULL,
  `epic_id` text,
  `task_type` text NOT NULL,
  `document_type` text NOT NULL,
  `scope` text NOT NULL,
  `scope_id` text NOT NULL,
  `target_key` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `depends_on_task_ids_json` text NOT NULL,
  `attempt_no` integer DEFAULT 0 NOT NULL,
  `max_repair_attempts` integer DEFAULT 1 NOT NULL,
  `worker_id` text,
  `lease_token` text,
  `lease_expires_at` text,
  `context_handle` text,
  `submitted_json` text,
  `validation_errors` text,
  `saved_document_id` text,
  `last_error_json` text,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  `updated_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `business_doc_generation_runs`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`epic_id`) REFERENCES `epics`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`saved_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_business_doc_generation_tasks_run_target` ON `business_doc_generation_tasks` (`run_id`,`target_key`);
--> statement-breakpoint
CREATE INDEX `idx_business_doc_generation_tasks_run_status` ON `business_doc_generation_tasks` (`run_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_business_doc_generation_tasks_run_type_status` ON `business_doc_generation_tasks` (`run_id`,`task_type`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_business_doc_generation_tasks_project_scope` ON `business_doc_generation_tasks` (`project_id`,`scope`,`scope_id`);
--> statement-breakpoint
CREATE TABLE `business_doc_context_bundles` (
  `context_handle` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `task_id` text NOT NULL,
  `schema_version` text NOT NULL,
  `source_commit` text NOT NULL,
  `manifest_json` text NOT NULL,
  `content_hash` text NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `business_doc_generation_runs`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`task_id`) REFERENCES `business_doc_generation_tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_business_doc_context_bundles_task` ON `business_doc_context_bundles` (`task_id`);
--> statement-breakpoint
CREATE INDEX `idx_business_doc_context_bundles_run` ON `business_doc_context_bundles` (`run_id`);
--> statement-breakpoint
CREATE TABLE `business_doc_context_pages` (
  `context_handle` text NOT NULL,
  `page_token` text NOT NULL,
  `page_kind` text NOT NULL,
  `page_order` integer NOT NULL,
  `summary` text NOT NULL,
  `evidence_ids_json` text NOT NULL,
  `content_json` text NOT NULL,
  `content_hash` text NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  PRIMARY KEY(`context_handle`, `page_token`),
  FOREIGN KEY (`context_handle`) REFERENCES `business_doc_context_bundles`(`context_handle`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_business_doc_context_pages_handle_order` ON `business_doc_context_pages` (`context_handle`,`page_order`);
