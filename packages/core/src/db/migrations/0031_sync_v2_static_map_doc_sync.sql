ALTER TABLE `documents` ADD `content_hash` text;
--> statement-breakpoint
ALTER TABLE `documents` ADD `static_snapshot_id` text;
--> statement-breakpoint
ALTER TABLE `documents` ADD `document_source_hash` text;
--> statement-breakpoint
CREATE INDEX `idx_documents_static_snapshot` ON `documents` (`static_snapshot_id`);
--> statement-breakpoint
CREATE INDEX `idx_documents_document_source_hash` ON `documents` (`project_id`,`document_source_hash`);
--> statement-breakpoint
CREATE TABLE `static_map_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `current_step` text,
  `staging_db_path` text,
  `repo_pins_json` text,
  `snapshot_id` text,
  `error_message` text,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  `updated_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_static_map_runs_project` ON `static_map_runs` (`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_static_map_runs_project_status` ON `static_map_runs` (`project_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_static_map_runs_snapshot` ON `static_map_runs` (`snapshot_id`);
--> statement-breakpoint
CREATE TABLE `static_merkle_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `snapshot_kind` text DEFAULT 'project' NOT NULL,
  `analysis_branch` text,
  `source_commit` text,
  `repo_commit_pins_json` text NOT NULL,
  `root_hash` text NOT NULL,
  `hash_set_json` text NOT NULL,
  `reason_inputs_json` text NOT NULL,
  `created_by_run_id` text,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_static_merkle_snapshots_project` ON `static_merkle_snapshots` (`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_static_merkle_snapshots_project_created` ON `static_merkle_snapshots` (`project_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_static_merkle_snapshots_run` ON `static_merkle_snapshots` (`created_by_run_id`);
--> statement-breakpoint
CREATE TABLE `doc_sync_plans` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `from_snapshot_id` text,
  `to_snapshot_id` text NOT NULL,
  `status` text DEFAULT 'technical_pending' NOT NULL,
  `counts_json` text,
  `error_message` text,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  `updated_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_doc_sync_plans_project` ON `doc_sync_plans` (`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_doc_sync_plans_status` ON `doc_sync_plans` (`project_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_doc_sync_plans_to_snapshot` ON `doc_sync_plans` (`to_snapshot_id`);
--> statement-breakpoint
CREATE TABLE `doc_sync_candidates` (
  `id` text PRIMARY KEY NOT NULL,
  `plan_id` text NOT NULL,
  `phase` text NOT NULL,
  `kind` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `target_json` text NOT NULL,
  `old_hash` text,
  `new_hash` text,
  `reason_inputs_json` text NOT NULL,
  `decision` text,
  `rationale` text,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  `updated_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`plan_id`) REFERENCES `doc_sync_plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_doc_sync_candidates_plan` ON `doc_sync_candidates` (`plan_id`);
--> statement-breakpoint
CREATE INDEX `idx_doc_sync_candidates_plan_phase` ON `doc_sync_candidates` (`plan_id`,`phase`);
--> statement-breakpoint
CREATE INDEX `idx_doc_sync_candidates_status` ON `doc_sync_candidates` (`plan_id`,`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_doc_sync_candidates_plan_target` ON `doc_sync_candidates` (`plan_id`,`phase`,`target_json`);
--> statement-breakpoint
CREATE TABLE `doc_sync_outputs` (
  `id` text PRIMARY KEY NOT NULL,
  `plan_id` text NOT NULL,
  `candidate_id` text NOT NULL,
  `document_json` text NOT NULL,
  `evidence_json` text NOT NULL,
  `content_hash` text NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`plan_id`) REFERENCES `doc_sync_plans`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`candidate_id`) REFERENCES `doc_sync_candidates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_doc_sync_outputs_candidate` ON `doc_sync_outputs` (`candidate_id`);
--> statement-breakpoint
CREATE INDEX `idx_doc_sync_outputs_plan` ON `doc_sync_outputs` (`plan_id`);
