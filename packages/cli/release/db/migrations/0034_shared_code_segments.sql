CREATE TABLE `shared_code_segments` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
  `repo_id` text NOT NULL REFERENCES `repositories`(`id`) ON DELETE cascade,
  `root_node_id` text NOT NULL REFERENCES `code_nodes`(`id`) ON DELETE cascade,
  `root_symbol` text NOT NULL,
  `root_file_path` text NOT NULL,
  `detector_version` text NOT NULL,
  `summary_schema_version` text NOT NULL,
  `segment_hash` text NOT NULL,
  `source_hash` text NOT NULL,
  `used_by_entrypoint_count` integer NOT NULL,
  `covered_node_ids_json` text NOT NULL,
  `deterministic_summary_json` text NOT NULL,
  `llm_summary_json` text,
  `summary_status` text NOT NULL,
  `validity` text DEFAULT 'fresh' NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  `updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_shared_code_segments_root_version`
ON `shared_code_segments` (`project_id`, `repo_id`, `root_node_id`, `detector_version`);
--> statement-breakpoint
CREATE INDEX `idx_shared_code_segments_project_repo`
ON `shared_code_segments` (`project_id`, `repo_id`);
--> statement-breakpoint
CREATE INDEX `idx_shared_code_segments_validity`
ON `shared_code_segments` (`project_id`, `validity`);
--> statement-breakpoint
CREATE INDEX `idx_shared_code_segments_source_hash`
ON `shared_code_segments` (`project_id`, `repo_id`, `source_hash`);
--> statement-breakpoint
CREATE TABLE `shared_code_segment_entrypoints` (
  `segment_id` text NOT NULL REFERENCES `shared_code_segments`(`id`) ON DELETE cascade,
  `entry_point_id` text NOT NULL REFERENCES `entry_points`(`id`) ON DELETE cascade,
  `target_key` text NOT NULL,
  `document_type` text NOT NULL,
  `root_depth` integer NOT NULL,
  PRIMARY KEY (`segment_id`, `entry_point_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_shared_code_segment_entrypoints_entry`
ON `shared_code_segment_entrypoints` (`entry_point_id`);
--> statement-breakpoint
CREATE TABLE `shared_code_segment_nodes` (
  `segment_id` text NOT NULL REFERENCES `shared_code_segments`(`id`) ON DELETE cascade,
  `node_id` text NOT NULL REFERENCES `code_nodes`(`id`) ON DELETE cascade,
  `role` text NOT NULL,
  `depth_from_root` integer NOT NULL,
  PRIMARY KEY (`segment_id`, `node_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_shared_code_segment_nodes_node`
ON `shared_code_segment_nodes` (`node_id`);
