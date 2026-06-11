CREATE TABLE `epic_domains` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `name` text NOT NULL,
  `stable_key` text,
  `summary` text,
  `status` text,
  `source` text,
  `confidence` text,
  `sort_order` integer DEFAULT 0 NOT NULL,
  `confirmed_at` text,
  `deleted_at` text,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  `updated_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_epic_domains_project_name_alive` ON `epic_domains` (`project_id`,`name`) WHERE `deleted_at` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_epic_domains_project_stable_key` ON `epic_domains` (`project_id`,`stable_key`) WHERE `stable_key` IS NOT NULL;
--> statement-breakpoint
ALTER TABLE `epics` ADD `domain_id` text REFERENCES `epic_domains`(`id`) ON DELETE set null;
--> statement-breakpoint
CREATE INDEX `idx_epics_domain` ON `epics` (`domain_id`);
