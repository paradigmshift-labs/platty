ALTER TABLE `epics` ADD `stable_key` text;
--> statement-breakpoint
ALTER TABLE `epics` ADD `summary` text;
--> statement-breakpoint
ALTER TABLE `epics` ADD `status` text;
--> statement-breakpoint
ALTER TABLE `epics` ADD `source` text;
--> statement-breakpoint
ALTER TABLE `epics` ADD `confidence` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_epics_project_stable_key` ON `epics` (`project_id`,`stable_key`) WHERE `stable_key` IS NOT NULL;
--> statement-breakpoint
CREATE TABLE `epic_document_links` (
  `epic_id` text NOT NULL,
  `document_id` text NOT NULL,
  `document_type` text NOT NULL,
  `role` text NOT NULL,
  `reason` text NOT NULL,
  `confidence` text NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`epic_id`) REFERENCES `epics`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_epic_document_links_unique` ON `epic_document_links` (`epic_id`,`document_id`,`role`);
--> statement-breakpoint
CREATE INDEX `idx_epic_document_links_epic` ON `epic_document_links` (`epic_id`);
--> statement-breakpoint
CREATE INDEX `idx_epic_document_links_document` ON `epic_document_links` (`document_id`);
--> statement-breakpoint
CREATE TABLE `epic_dependencies` (
  `source_epic_id` text NOT NULL,
  `target_epic_id` text NOT NULL,
  `kind` text NOT NULL,
  `reason` text NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`source_epic_id`) REFERENCES `epics`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`target_epic_id`) REFERENCES `epics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_epic_dependencies_unique` ON `epic_dependencies` (`source_epic_id`,`target_epic_id`,`kind`);
--> statement-breakpoint
CREATE INDEX `idx_epic_dependencies_source` ON `epic_dependencies` (`source_epic_id`);
--> statement-breakpoint
CREATE INDEX `idx_epic_dependencies_target` ON `epic_dependencies` (`target_epic_id`);
--> statement-breakpoint
CREATE TABLE `epic_confirm_logs` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `payload_json` text NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_epic_confirm_logs_project` ON `epic_confirm_logs` (`project_id`);
