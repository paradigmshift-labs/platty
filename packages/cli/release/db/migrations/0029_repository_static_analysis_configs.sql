CREATE TABLE `repository_static_analysis_configs` (
  `id` text PRIMARY KEY NOT NULL,
  `repository_id` text NOT NULL,
  `schema_version` integer NOT NULL,
  `config_json` text NOT NULL,
  `version` integer NOT NULL,
  `status` text NOT NULL,
  `created_by` text,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  `updated_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_repository_static_analysis_configs_active` ON `repository_static_analysis_configs` (`repository_id`) WHERE `status` = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_repository_static_analysis_configs_version` ON `repository_static_analysis_configs` (`repository_id`,`version`);
--> statement-breakpoint
CREATE INDEX `idx_repository_static_analysis_configs_repo_status` ON `repository_static_analysis_configs` (`repository_id`,`status`);
