CREATE TABLE `project_phase_status` (
  `project_id` text NOT NULL,
  `phase` text NOT NULL,
  `status` text NOT NULL,
  `source_run_id` text,
  `source_commit` text,
  `upstream_versions` text,
  `updated_at` integer NOT NULL,
  `meta` text,
  PRIMARY KEY(`project_id`, `phase`),
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `repository_phase_status` ADD `status` text NOT NULL DEFAULT 'passed';
--> statement-breakpoint
ALTER TABLE `repository_phase_status` ADD `source_run_id` text;
--> statement-breakpoint
ALTER TABLE `repository_phase_status` ADD `source_commit` text;
--> statement-breakpoint
ALTER TABLE `repository_phase_status` ADD `upstream_versions` text;
--> statement-breakpoint
ALTER TABLE `repository_phase_status` ADD `meta` text;
--> statement-breakpoint
ALTER TABLE `documents` ADD `source_run_id` text;
--> statement-breakpoint
ALTER TABLE `documents` ADD `source_commit` text;
