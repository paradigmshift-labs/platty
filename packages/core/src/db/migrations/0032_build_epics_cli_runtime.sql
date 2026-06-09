CREATE TABLE `build_epics_drafts` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `project_id` text NOT NULL,
  `status` text NOT NULL,
  `draft_json` text NOT NULL,
  `validation_json` text NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  `updated_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `generation_runs`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_build_epics_drafts_run` ON `build_epics_drafts` (`run_id`);
--> statement-breakpoint
CREATE INDEX `idx_build_epics_drafts_project` ON `build_epics_drafts` (`project_id`);
