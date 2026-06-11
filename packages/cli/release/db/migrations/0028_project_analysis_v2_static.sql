CREATE TABLE `analysis_review_decisions` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `repo_id` text NOT NULL,
  `target_type` text NOT NULL,
  `target_id` text NOT NULL,
  `target_source` text DEFAULT 'entry_point' NOT NULL,
  `decision` text NOT NULL,
  `reason` text NOT NULL,
  `note` text,
  `decided_by` text,
  `decided_at` text DEFAULT (datetime('now')) NOT NULL,
  `source_run_id` text,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  `updated_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`target_id`) REFERENCES `entry_points`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_analysis_review_decisions_target` ON `analysis_review_decisions` (`project_id`,`repo_id`,`target_type`,`target_id`);
--> statement-breakpoint
CREATE INDEX `idx_analysis_review_decisions_project_repo` ON `analysis_review_decisions` (`project_id`,`repo_id`);
--> statement-breakpoint
CREATE INDEX `idx_analysis_review_decisions_project_decision` ON `analysis_review_decisions` (`project_id`,`decision`);
--> statement-breakpoint
CREATE TABLE `pipeline_run_links` (
  `id` text PRIMARY KEY NOT NULL,
  `parent_run_id` text NOT NULL,
  `child_run_id` text NOT NULL,
  `relation` text NOT NULL,
  `phase` text,
  `repo_id` text,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`parent_run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`child_run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pipeline_run_links_unique` ON `pipeline_run_links` (`parent_run_id`,`child_run_id`,`relation`);
--> statement-breakpoint
CREATE INDEX `idx_pipeline_run_links_parent` ON `pipeline_run_links` (`parent_run_id`);
--> statement-breakpoint
CREATE INDEX `idx_pipeline_run_links_child` ON `pipeline_run_links` (`child_run_id`);
--> statement-breakpoint
CREATE INDEX `idx_pipeline_run_links_repo` ON `pipeline_run_links` (`repo_id`);
