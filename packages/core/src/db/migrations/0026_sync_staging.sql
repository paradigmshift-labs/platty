CREATE TABLE `sync_plans` (
  `id` text PRIMARY KEY NOT NULL,
  `repo_id` text NOT NULL,
  `project_id` text NOT NULL,
  `from_commit` text,
  `to_commit` text,
  `status` text DEFAULT 'running' NOT NULL,
  `mode` text DEFAULT 'with_project_cascade' NOT NULL,
  `plan_json` text,
  `summary_json` text,
  `error_message` text,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  `updated_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sync_plans_repo` ON `sync_plans` (`repo_id`);
--> statement-breakpoint
CREATE INDEX `idx_sync_plans_project` ON `sync_plans` (`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_sync_plans_status` ON `sync_plans` (`status`);
--> statement-breakpoint
CREATE TABLE `sync_plan_items` (
  `id` text PRIMARY KEY NOT NULL,
  `sync_plan_id` text NOT NULL,
  `kind` text NOT NULL,
  `target_id` text,
  `target_key` text,
  `status` text DEFAULT 'pending' NOT NULL,
  `attempt_count` integer DEFAULT 0 NOT NULL,
  `payload_json` text,
  `error_message` text,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  `updated_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`sync_plan_id`) REFERENCES `sync_plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sync_plan_items_plan` ON `sync_plan_items` (`sync_plan_id`);
--> statement-breakpoint
CREATE INDEX `idx_sync_plan_items_status` ON `sync_plan_items` (`sync_plan_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_sync_plan_items_target` ON `sync_plan_items` (`sync_plan_id`,`kind`,`target_id`);
--> statement-breakpoint
CREATE TABLE `sync_static_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `sync_plan_id` text NOT NULL,
  `repo_id` text NOT NULL,
  `project_id` text NOT NULL,
  `source` text NOT NULL,
  `snapshot_json` text NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`sync_plan_id`) REFERENCES `sync_plans`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sync_static_snapshots_plan` ON `sync_static_snapshots` (`sync_plan_id`);
--> statement-breakpoint
CREATE INDEX `idx_sync_static_snapshots_repo` ON `sync_static_snapshots` (`repo_id`);
--> statement-breakpoint
CREATE INDEX `idx_sync_static_snapshots_project` ON `sync_static_snapshots` (`project_id`);
--> statement-breakpoint
CREATE TABLE `sync_document_outputs` (
  `id` text PRIMARY KEY NOT NULL,
  `sync_plan_id` text NOT NULL,
  `document_id` text,
  `project_id` text NOT NULL,
  `type` text NOT NULL,
  `track` text NOT NULL,
  `scope` text NOT NULL,
  `scope_id` text,
  `status` text NOT NULL,
  `validity` text DEFAULT 'fresh' NOT NULL,
  `summary` text,
  `content` text,
  `raw_llm_output` text DEFAULT '' NOT NULL,
  `updated_by` text DEFAULT 'llm' NOT NULL,
  `source_run_id` text,
  `source_commit` text,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`sync_plan_id`) REFERENCES `sync_plans`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sync_document_outputs_plan_canonical` ON `sync_document_outputs` (`sync_plan_id`,`project_id`,`type`,`scope`,`scope_id`);
--> statement-breakpoint
CREATE INDEX `idx_sync_document_outputs_plan` ON `sync_document_outputs` (`sync_plan_id`);
--> statement-breakpoint
CREATE INDEX `idx_sync_document_outputs_project` ON `sync_document_outputs` (`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_sync_document_outputs_document` ON `sync_document_outputs` (`document_id`);
--> statement-breakpoint
CREATE TABLE `sync_document_output_deps` (
  `output_id` text NOT NULL,
  `code_node_id` text NOT NULL,
  `dep_type` text NOT NULL,
  PRIMARY KEY(`output_id`, `code_node_id`, `dep_type`),
  FOREIGN KEY (`output_id`) REFERENCES `sync_document_outputs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sync_document_output_deps_node` ON `sync_document_output_deps` (`code_node_id`);
--> statement-breakpoint
CREATE TABLE `sync_document_output_relation_links` (
  `output_id` text NOT NULL,
  `relation_id` text,
  `repo_id` text NOT NULL,
  `source_node_id` text NOT NULL,
  `kind` text NOT NULL,
  `target` text,
  `operation` text,
  `canonical_target` text,
  `payload_json` text,
  `evidence_node_ids_json` text NOT NULL,
  `confidence` text NOT NULL,
  `unresolved_reason` text,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`output_id`) REFERENCES `sync_document_outputs`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`relation_id`) REFERENCES `code_relations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_sync_document_output_relation_links_output` ON `sync_document_output_relation_links` (`output_id`);
--> statement-breakpoint
CREATE INDEX `idx_sync_document_output_relation_links_relation` ON `sync_document_output_relation_links` (`relation_id`);
--> statement-breakpoint
CREATE INDEX `idx_sync_document_output_relation_links_canonical_target` ON `sync_document_output_relation_links` (`repo_id`,`kind`,`canonical_target`);
